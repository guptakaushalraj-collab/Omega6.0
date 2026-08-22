"""bin_reporting — :8001 — HELD (not for sale)

Citizen-facing intake. Owns the bin record and orchestrates the pipeline.

Not offered for sale: it is the entry point and the orchestrator, so selling
it would be selling the product rather than a component.

DESIGN — PERSIST FIRST, ENRICH AFTER. The report is written to disk BEFORE any
dependency is called. A member of the public standing next to an overflowing
bin must never lose their submission because an internal service is down.
Classification and dispatch are enrichments layered on afterwards, each
independently degradable, and whatever fails is named in `degraded`.
"""
import base64
import os
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from .clients import classify, dependency_config, emit, request_assignment
from .store import Store

APP_VERSION = "1.0.0"
MAX_IMAGE_BYTES = 8 * 1024 * 1024
UPLOAD_DIR = Path(__file__).resolve().parent / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="bin_reporting", version=APP_VERSION)
store = Store({"reports": []})

STATUSES = ["reported", "assigned", "in_progress", "cleared"]


class ReportIn(BaseModel):
    lat: Optional[float] = None
    lng: Optional[float] = None
    address: Optional[str] = None
    notes: Optional[str] = None
    reporter_name: str = "Anonymous"
    auto_assign: bool = True


class ReportBinIn(BaseModel):
    """Flat alias shape: image as base64, location as a "lat,lng" STRING."""
    image: Optional[str] = None
    location: Optional[str] = Field(None, examples=["12.972,77.595"])
    lat: Optional[float] = None
    lng: Optional[float] = None
    address: Optional[str] = None
    notes: Optional[str] = None
    reporter_name: str = "Anonymous"
    auto_assign: bool = True


class DetectIn(BaseModel):
    binId: Optional[str] = None
    bin_id: Optional[str] = None
    force: bool = False


class StatusPatch(BaseModel):
    status: str


def parse_location(value: str) -> Optional[dict]:
    """Parse the compact "lat,lng" string used by the flat alias API."""
    parts = value.split(",")
    if len(parts) != 2:
        return None
    try:
        lat, lng = float(parts[0].strip()), float(parts[1].strip())
    except ValueError:
        return None
    if abs(lat) > 90 or abs(lng) > 180:
        return None
    return {"lat": lat, "lng": lng}


def _store_image(raw: bytes, ext: str = ".jpg") -> str:
    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(413, f"Photo exceeds {MAX_IMAGE_BYTES} bytes")
    name = f"{store.new_id('img')}{ext}"
    (UPLOAD_DIR / name).write_bytes(raw)
    return name


async def create_report(location: dict, *, address=None, notes=None,
                        reporter_name="Anonymous", photo_filename: Optional[str] = None,
                        auto_assign: bool = True) -> dict:
    """THE INTAKE PIPELINE — shared by the canonical route and /reportBin so
    the two surfaces can never drift apart."""
    report = {
        "id": store.new_id("bin"), "location": location, "address": address,
        "notes": notes, "reporter_name": reporter_name,
        "photo_url": f"/uploads/{photo_filename}" if photo_filename else None,
        "waste_type": None, "classification": None, "status": "reported",
        "assignment": None, "reported_at": store.now(), "cleared_at": None,
    }

    # --- persist BEFORE enriching -----------------------------------------
    data = store.read()
    data["reports"].append(report)
    store.write(data)

    degraded: dict[str, str] = {}

    # --- enrich: classify --------------------------------------------------
    if photo_filename:
        result = await classify((UPLOAD_DIR / photo_filename).read_bytes(), report["id"])
        if result["ok"]:
            report["classification"] = result["data"]["prediction"]
            report["waste_type"] = result["data"]["prediction"]["type"]
        else:
            degraded["classification"] = result["reason"]
    else:
        degraded["classification"] = "no_photo_supplied"

    # --- enrich: dispatch --------------------------------------------------
    if auto_assign:
        result = await request_assignment(report["id"], location, report["waste_type"])
        if result["ok"]:
            d = result["data"]
            report["assignment"] = {"assignment_id": d["id"], "worker_id": d["worker_id"],
                                    "worker_name": d["worker_name"], "distance_km": d["distance_km"]}
            report["status"] = "assigned"
        else:
            # 503 = genuinely no worker free; distinct from an outage.
            degraded["assignment"] = ("no_workers_available"
                                      if result["reason"] == "upstream_503" else result["reason"])

    # --- persist enrichment ------------------------------------------------
    after = store.read()
    for i, r in enumerate(after["reports"]):
        if r["id"] == report["id"]:
            after["reports"][i] = report
            break
    store.write(after)

    # --- fire-and-forget analytics ----------------------------------------
    await emit("bin.reported", report["id"], {"has_photo": bool(photo_filename)})
    if report["waste_type"]:
        await emit("bin.classified", report["id"], {"waste_type": report["waste_type"]})

    return {"report": report, "degraded": degraded or None}


async def reclassify(bin_id: str) -> dict:
    """Backfill a classification skipped at intake — the recovery path that
    makes degrading on classification safe rather than lossy."""
    data = store.read()
    report = next((r for r in data["reports"] if r["id"] == bin_id), None)
    if report is None:
        return {"ok": False, "code": "not_found"}
    if not report["photo_url"]:
        return {"ok": False, "code": "no_photo"}

    path = UPLOAD_DIR / Path(report["photo_url"]).name
    if not path.exists():
        return {"ok": False, "code": "photo_gone"}

    result = await classify(path.read_bytes(), bin_id)
    if not result["ok"]:
        return {"ok": False, "code": "classifier_unavailable", "reason": result["reason"]}

    report["classification"] = result["data"]["prediction"]
    report["waste_type"] = result["data"]["prediction"]["type"]
    store.write(data)
    await emit("bin.classified", bin_id, {"waste_type": report["waste_type"]})
    return {"ok": True, "report": report}


@app.get("/api/v1/health")
def health():
    return {"ok": True, "module": "bin_reporting", "version": APP_VERSION,
            "dependencies": dependency_config()}


@app.post("/api/v1/reports", status_code=201)
async def report_json(body: ReportIn):
    if body.lat is None or body.lng is None:
        raise HTTPException(400, "lat and lng are required")
    return await create_report({"lat": body.lat, "lng": body.lng},
                               address=body.address, notes=body.notes,
                               reporter_name=body.reporter_name,
                               auto_assign=body.auto_assign)


@app.post("/api/v1/reports-upload", status_code=201)
async def report_multipart(photo: UploadFile = File(...), lat: float = Form(...),
                           lng: float = Form(...), address: str = Form(""),
                           notes: str = Form(""), reporter_name: str = Form("Anonymous"),
                           auto_assign: bool = Form(True)):
    if not (photo.content_type or "").startswith("image/"):
        raise HTTPException(400, "Only image uploads are accepted")
    ext = Path(photo.filename or "bin.jpg").suffix or ".jpg"
    name = _store_image(await photo.read(), ext)
    return await create_report({"lat": lat, "lng": lng}, address=address or None,
                               notes=notes or None, reporter_name=reporter_name,
                               photo_filename=name, auto_assign=auto_assign)


@app.get("/api/v1/reports")
def list_reports(status: Optional[str] = None, waste_type: Optional[str] = None, limit: int = 100):
    reports = store.read()["reports"]
    if status:
        reports = [r for r in reports if r["status"] == status]
    if waste_type:
        reports = [r for r in reports if r["waste_type"] == waste_type]
    return {"count": len(reports), "reports": list(reversed(reports))[:min(limit, 500)]}


@app.get("/api/v1/reports/{bin_id}")
def get_report(bin_id: str):
    for r in store.read()["reports"]:
        if r["id"] == bin_id:
            return r
    raise HTTPException(404, "Report not found")


@app.post("/api/v1/reports/{bin_id}/reclassify")
async def reclassify_route(bin_id: str):
    result = await reclassify(bin_id)
    if result["ok"]:
        return result["report"]
    codes = {"not_found": (404, "Report not found"),
             "no_photo": (422, "Report has no photo to classify"),
             "photo_gone": (410, "Stored photo is no longer available")}
    status, msg = codes.get(result["code"], (503, "Classifier unavailable"))
    raise HTTPException(status, msg)


@app.patch("/api/v1/reports/{bin_id}/status")
async def patch_status(bin_id: str, body: StatusPatch):
    if body.status not in STATUSES:
        raise HTTPException(422, f"status must be one of: {', '.join(STATUSES)}")
    data = store.read()
    for r in data["reports"]:
        if r["id"] == bin_id:
            r["status"] = body.status
            r["cleared_at"] = store.now() if body.status == "cleared" else None
            store.write(data)
            if body.status == "cleared":
                await emit("bin.collected", bin_id,
                           {"worker_id": (r.get("assignment") or {}).get("worker_id")})
            return r
    raise HTTPException(404, "Report not found")


# --------------------------------------------------------- flat alias API

@app.post("/reportBin", status_code=201)
async def report_bin(body: ReportBinIn):
    """Flat alias: {image, location: "lat,lng"} -> {binId, type, ...}"""
    location = None
    if body.location:
        location = parse_location(body.location)
        if location is None:
            raise HTTPException(400, 'location must be "lat,lng" — e.g. "12.972,77.595"')
    elif body.lat is not None and body.lng is not None:
        location = {"lat": body.lat, "lng": body.lng}
    if location is None:
        raise HTTPException(400, 'location is required, as "lat,lng" or lat/lng fields')

    photo_name = None
    if body.image:
        raw = body.image
        if raw.lstrip().startswith("data:") and "," in raw[:64]:
            raw = raw.split(",", 1)[1]
        try:
            decoded = base64.b64decode(raw, validate=False)
        except Exception as exc:
            raise HTTPException(400, f"image: not valid base64 ({exc})")
        if not decoded:
            raise HTTPException(400, "image: decoded to zero bytes")
        photo_name = _store_image(decoded, ".png")

    out = await create_report(location, address=body.address, notes=body.notes,
                              reporter_name=body.reporter_name,
                              photo_filename=photo_name, auto_assign=body.auto_assign)
    r = out["report"]
    # binId promoted to the top level — it is what a caller needs next, to pass
    # into /detectWasteType or /notifyPickup.
    return {"binId": r["id"], "status": r["status"], "type": r["waste_type"],
            "location": f"{r['location']['lat']},{r['location']['lng']}",
            "assignedWorker": (r.get("assignment") or {}).get("worker_name"),
            "degraded": out["degraded"], "report": r}


@app.post("/detectWasteType")
async def detect_waste_type(body: DetectIn):
    """Flat alias: {binId} -> {type}.

    LIVES HERE, NOT IN waste_recognition, because it is keyed by binId — and
    that module is a stateless leaf that never sees bin records, only image
    bytes. Giving it binId lookup would force a call back to this module,
    creating a cycle and destroying the dependency-free property that makes it
    the registry's most sellable component.
    """
    bin_id = body.binId or body.bin_id
    if not bin_id:
        raise HTTPException(400, "binId is required")

    # Answer from the stored classification rather than paying for another
    # inference call, unless the caller explicitly forces a re-run.
    existing = next((r for r in store.read()["reports"] if r["id"] == bin_id), None)
    if existing and existing.get("classification") and not body.force:
        c = existing["classification"]
        return {"binId": bin_id, "type": c["type"], "label": c["label"],
                "confidence": c["confidence"], "cached": True}

    result = await reclassify(bin_id)
    if result["ok"]:
        c = result["report"]["classification"]
        return {"binId": bin_id, "type": c["type"], "label": c["label"],
                "confidence": c["confidence"], "cached": False}

    codes = {"not_found": (404, f"No bin with id {bin_id}"),
             "no_photo": (422, "Bin has no photo — waste type cannot be detected"),
             "photo_gone": (410, "Stored photo is no longer available")}
    status, msg = codes.get(result["code"], (503, "Classifier unavailable"))
    raise HTTPException(status, msg)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8001)))

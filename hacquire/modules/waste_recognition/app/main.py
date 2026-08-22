"""waste_recognition — :8002 — SOLD ($42,000)

Classifies waste type from a bin photograph.

Stateless apart from a capped audit log, and with zero outbound dependencies,
which is what makes it the cleanest asset in the registry to divest: a buyer
needs only a host and a model.
"""
import base64
import hashlib
import os
from typing import Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from .store import Store

APP_VERSION = "1.0.0"
MODEL_VERSION = "stub-cv-1.0.0"
MAX_IMAGE_BYTES = 8 * 1024 * 1024
AUDIT_CAP = 500

app = FastAPI(title="waste_recognition", version=APP_VERSION)
store = Store({"classifications": []})

# --- taxonomy -------------------------------------------------------------
TAXONOMY = [
    {"type": "plastic", "label": "Plastic", "color": "#2563eb", "recyclable": True,  "hazardous": False},
    {"type": "organic", "label": "Organic", "color": "#16a34a", "recyclable": False, "hazardous": False},
    {"type": "paper",   "label": "Paper",   "color": "#ca8a04", "recyclable": True,  "hazardous": False},
    {"type": "metal",   "label": "Metal",   "color": "#64748b", "recyclable": True,  "hazardous": False},
    {"type": "glass",   "label": "Glass",   "color": "#0d9488", "recyclable": True,  "hazardous": False},
    {"type": "e-waste", "label": "E-Waste", "color": "#7c3aed", "recyclable": True,  "hazardous": True},
    {"type": "mixed",   "label": "Mixed",   "color": "#78716c", "recyclable": False, "hazardous": False},
]


class ClassifyRequest(BaseModel):
    image_base64: str = Field(..., description="Raw or data: URL base64 image")
    reference: Optional[str] = Field(None, description="Opaque caller correlation id")


class Prediction(BaseModel):
    type: str
    label: str
    color: str
    recyclable: bool
    hazardous: bool
    confidence: float
    alternatives: list
    model_version: str


class ClassificationRecord(BaseModel):
    id: str
    reference: Optional[str]
    prediction: Prediction
    image_bytes: int
    classified_at: str


def classify(image: bytes) -> dict:
    """THE MODEL BOUNDARY.

    Deterministic stub: the image digest selects the prediction, so the same
    photo always yields the same answer. That keeps the API contract and every
    downstream integration exercisable without shipping a model artifact.

    To productionise, replace ONLY this function body with real inference
    (ONNX Runtime, TorchServe, a hosted vision API). Keep the return shape —
    it is the published contract, not an implementation detail.
    """
    if not image:
        raise ValueError("image is empty")

    seed = int.from_bytes(hashlib.sha256(image).digest()[:4], "big")
    primary = TAXONOMY[seed % len(TAXONOMY)]
    confidence = round(0.70 + ((seed >> 8) % 26) / 100, 2)

    # Runners-up drawn without replacement — a real classifier never ranks the
    # same class twice, and consumers assume these are distinct.
    pool = [t for t in TAXONOMY if t["type"] != primary["type"]]
    alternatives = []
    for i in range(2):
        if not pool:
            break
        pick = pool.pop((seed >> (4 * (i + 1))) % len(pool))
        alternatives.append({
            "type": pick["type"],
            "label": pick["label"],
            "confidence": round(confidence * (0.45 - i * 0.15), 2),
        })

    return {**primary, "confidence": confidence,
            "alternatives": alternatives, "model_version": MODEL_VERSION}


def _decode(b64: str) -> bytes:
    # Tolerate a data: URL prefix — browsers produce those from canvas/FileReader.
    if "," in b64[:64] and b64.lstrip().startswith("data:"):
        b64 = b64.split(",", 1)[1]
    try:
        return base64.b64decode(b64, validate=False)
    except Exception as exc:
        raise HTTPException(400, f"image_base64 is not valid base64: {exc}")


def _record(image: bytes, reference: Optional[str]) -> dict:
    if len(image) > MAX_IMAGE_BYTES:
        raise HTTPException(413, f"Image exceeds {MAX_IMAGE_BYTES} bytes")
    try:
        prediction = classify(image)
    except ValueError as exc:
        raise HTTPException(422, str(exc))

    rec = {
        "id": store.new_id("cls"),
        "reference": reference,
        "prediction": prediction,
        "image_bytes": len(image),
        "classified_at": store.now(),
    }
    data = store.read()
    data["classifications"].insert(0, rec)
    # Capped: this module is sold on per-request pricing and must not
    # accumulate unbounded disk on a buyer's host.
    data["classifications"] = data["classifications"][:AUDIT_CAP]
    store.write(data)
    return rec


@app.get("/api/v1/health")
def health():
    return {"ok": True, "module": "waste_recognition",
            "version": APP_VERSION, "model_version": MODEL_VERSION}


@app.get("/api/v1/waste-types")
def waste_types():
    return TAXONOMY


@app.post("/api/v1/classify", response_model=ClassificationRecord)
def classify_json(body: ClassifyRequest):
    """Classify from base64 JSON — the server-to-server intake."""
    return _record(_decode(body.image_base64), body.reference)


@app.post("/api/v1/classify-upload", response_model=ClassificationRecord)
async def classify_upload(photo: UploadFile = File(...), reference: str = ""):
    """Classify from a multipart upload — the browser intake."""
    return _record(await photo.read(), reference or None)


@app.get("/api/v1/classifications")
def list_classifications(limit: int = 50):
    return store.read()["classifications"][: min(limit, AUDIT_CAP)]


@app.get("/api/v1/classifications/{cid}")
def get_classification(cid: str):
    for c in store.read()["classifications"]:
        if c["id"] == cid:
            return c
    raise HTTPException(404, "Classification not found")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8002)))

"""worker_dashboard — :8006 — BOUGHT (FieldOps Crew 3.1.0)

ACQUIRED MODULE. Retains FieldOps conventions:

    /v1 base path · Bearer auth · snake_case · FLAT error envelope
    {"error", "detail"}  — note this differs even from the OTHER acquired
    module, which uses {"error": {"code", "message"}}. Two vendors, two houses.

VOCABULARY IS DELIBERATELY DOMAIN-NEUTRAL: jobs are `job_ref`, not `bin_id`;
this module has no concept of waste. FieldOps sells the same product into
field service, logistics and utilities. Preserving that generality is what
keeps its resale value beyond waste collection, so callers pass a bin id AS a
job_ref and keep waste semantics on their own side.

SELF-CONTAINED: datastore, outbound adapters and HTTP surface all live in this
one file. It imports nothing from a sibling module — its three dependencies
are reached over HTTP at env-supplied URLs and every one of them degrades.

Run standalone:      uvicorn worker_dashboard:app --port 8006
Needs:               fastapi  uvicorn  pydantic  httpx
Env:                 PORT, CREW_AUTH_TOKEN, ROUTE_OPTIMIZER_URL,
                     NOTIFICATION_URL, NOTIFY_API_KEY, ANALYTICS_URL,
                     DEPENDENCY_TIMEOUT_MS
"""
import json
import math
import os
import secrets
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, FastAPI, Header, Request, Response
from fastapi.routing import APIRoute
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

APP_VERSION = "3.1.0"
AUTH_TOKEN = os.getenv("CREW_AUTH_TOKEN", "dev-fieldops-token")
STATUSES = ["assigned", "in_progress", "completed"]
WORKER_STATES = ["available", "busy", "off_shift"]


# ---------------------------------------------------------------------------
# VENDORED DATASTORE
#
# This class is COPIED into every module that needs it, never imported across
# module boundaries. ~40 duplicated lines is the deliberate price of being able
# to hand a buyer this single file and have it run with no shared package to
# untangle. Swap the body for a real database client; no route changes.
# ---------------------------------------------------------------------------
class Store:
    def __init__(self, empty: dict, filename: str = "store.json"):
        self._empty = empty
        self._path = Path(__file__).resolve().parent / "data" / filename
        self._lock = threading.Lock()
        self._path.parent.mkdir(parents=True, exist_ok=True)
        if not self._path.exists():
            self._write_unlocked(empty)

    def _write_unlocked(self, data: dict) -> None:
        # Write-then-rename: a crash mid-write leaves the previous file intact
        # rather than a truncated one.
        tmp = self._path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2))
        tmp.replace(self._path)

    def read(self) -> dict:
        with self._lock:
            try:
                return json.loads(self._path.read_text())
            except (FileNotFoundError, json.JSONDecodeError):
                return json.loads(json.dumps(self._empty))

    def write(self, data: dict) -> None:
        with self._lock:
            self._write_unlocked(data)

    def reset(self) -> None:
        self.write(json.loads(json.dumps(self._empty)))

    @staticmethod
    def new_id(prefix: str) -> str:
        return f"{prefix}_{secrets.token_hex(6)}"

    @staticmethod
    def now() -> str:
        return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


# ---------------------------------------------------------------------------
# OUTBOUND ADAPTERS
#
# Three rules keep this module independently ownable:
#
#   1. Targets resolved from ENV VARS, never hardcoded — swap the provider
#      (including to a competitor's hosted endpoint) without touching code.
#   2. HARD TIMEOUT on every request. A slow dependency must not become our
#      slow response.
#   3. NEVER RAISE. Each returns {"ok": bool, ...} and the caller degrades.
#      A dependency being down degrades a feature; it never fails the request.
#
# Note the adaptation cost of the OTHER acquired module living here: `notify`
# translates our vocabulary into SignalPost's (X-API-Key, recipient_type/body/
# subject_ref). That translation belongs at the call site, not inside the
# module we bought — which stays unmodified and therefore resaleable.
# ---------------------------------------------------------------------------
ROUTE_OPTIMIZER_URL = os.getenv("ROUTE_OPTIMIZER_URL", "")
NOTIFICATION_URL = os.getenv("NOTIFICATION_URL", "")
NOTIFY_API_KEY = os.getenv("NOTIFY_API_KEY", "dev-signalpost-key")
ANALYTICS_URL = os.getenv("ANALYTICS_URL", "")
TIMEOUT_S = float(os.getenv("DEPENDENCY_TIMEOUT_MS", "2500")) / 1000


async def _request(method: str, url: str, **kw) -> dict:
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_S) as client:
            r = await client.request(method, url, **kw)
            if r.status_code >= 400:
                return {"ok": False, "reason": f"upstream_{r.status_code}"}
            return {"ok": True, "data": r.json()}
    except httpx.TimeoutException:
        return {"ok": False, "reason": "timeout"}
    except Exception:
        return {"ok": False, "reason": "unreachable"}


async def optimize_route(start: dict, stops: list[dict]) -> dict:
    """Degradation: caller falls back to unordered stops, so a worker still
    sees their queue when the optimizer is down."""
    if not ROUTE_OPTIMIZER_URL:
        return {"ok": False, "reason": "not_configured"}
    return await _request("POST", f"{ROUTE_OPTIMIZER_URL}/api/v1/optimize",
                          json={"start": start, "stops": stops})


async def notify(recipient_type: str, body: str, subject_ref: str,
                 recipient_id: str | None = None) -> dict:
    """Degradation: the assignment still stands; only the alert is lost."""
    if not NOTIFICATION_URL:
        return {"ok": False, "reason": "not_configured"}
    return await _request(
        "POST", f"{NOTIFICATION_URL}/v1/messages",
        headers={"X-API-Key": NOTIFY_API_KEY},   # SignalPost's scheme, not ours
        json={"recipient_type": recipient_type, "recipient_id": recipient_id,
              "body": body, "subject_ref": subject_ref, "channel": "in_app"},
    )


async def emit(event_type: str, subject_id: str, payload: dict) -> dict:
    """Degradation: metrics lose a data point."""
    if not ANALYTICS_URL:
        return {"ok": False, "reason": "not_configured"}
    return await _request("POST", f"{ANALYTICS_URL}/api/v1/events",
                          json={"type": event_type, "subject_id": subject_id,
                                "source": "worker_dashboard", "payload": payload})


def dependency_config() -> dict:
    return {
        "route_optimizer": ROUTE_OPTIMIZER_URL or None,
        "notification_system": NOTIFICATION_URL or None,
        "analytics_dashboard": ANALYTICS_URL or None,
        "timeout_ms": int(TIMEOUT_S * 1000),
    }


store = Store({"workers": [], "assignments": []})


def fail(status: int, error: str, detail: str) -> JSONResponse:
    """FieldOps error envelope: flat {error, detail}."""
    return JSONResponse(status_code=status, content={"error": error, "detail": detail})


class AuthError(Exception):
    def __init__(self, status: int, error: str, detail: str):
        self.status, self.error, self.detail = status, error, detail


class FieldOpsRoute(APIRoute):
    """Carries the FieldOps error envelope WITH the route, not with the app.

    Same reason as the other acquired module, and the same fix: an app-level
    @exception_handler does not survive being included into a different
    FastAPI app, so a 401 would silently become a 500 in the composed
    deployment. FieldOps' flat {"error","detail"} shape is what their existing
    SDKs parse — it has to hold wherever this router is mounted.
    """

    def get_route_handler(self):
        original = super().get_route_handler()

        async def handler(request: Request) -> Response:
            try:
                return await original(request)
            except AuthError as exc:
                return fail(exc.status, exc.error, exc.detail)

        return handler


router = APIRouter(route_class=FieldOpsRoute)


def require_bearer(authorization: Optional[str] = Header(None)):
    if not authorization:
        raise AuthError(401, "unauthorized", "Authorization header is required.")
    parts = authorization.split()
    if len(parts) != 2 or parts[0] != "Bearer":
        raise AuthError(401, "unauthorized", "Expected 'Authorization: Bearer <token>'.")
    if parts[1] != AUTH_TOKEN:
        raise AuthError(403, "forbidden", "Token not recognised.")
    return parts[1]


class Point(BaseModel):
    lat: float
    lng: float


class WorkerIn(BaseModel):
    name: str
    phone: Optional[str] = None
    location: Point


class WorkerPatch(BaseModel):
    status: Optional[str] = None
    location: Optional[Point] = None


class AssignmentIn(BaseModel):
    job_ref: str = Field(..., description="Caller's opaque job id (a bin id, in this network)")
    location: Point
    metadata: dict[str, Any] = Field(default_factory=dict)


class StatusPatch(BaseModel):
    status: str


def haversine_km(a: dict, b: dict) -> float:
    d_lat, d_lng = math.radians(b["lat"] - a["lat"]), math.radians(b["lng"] - a["lng"])
    h = (math.sin(d_lat / 2) ** 2
         + math.cos(math.radians(a["lat"])) * math.cos(math.radians(b["lat"]))
         * math.sin(d_lng / 2) ** 2)
    return 2 * 6371.0 * math.asin(math.sqrt(h))


@router.get("/v1/health")
def health():
    return {"ok": True, "service": "fieldops-crew", "version": APP_VERSION,
            "dependencies": dependency_config()}


# ------------------------------------------------------------------ workers

@router.post("/v1/workers", status_code=201)
def create_worker(w: WorkerIn, _=Depends(require_bearer)):
    data = store.read()
    worker = {"id": store.new_id("wrk"), "name": w.name, "phone": w.phone,
              "location": w.location.model_dump(), "status": "available",
              "created_at": store.now()}
    data["workers"].append(worker)
    store.write(data)
    return worker


@router.get("/v1/workers")
def list_workers(status: Optional[str] = None, _=Depends(require_bearer)):
    data = store.read()
    workers = [w for w in data["workers"] if not status or w["status"] == status]
    return {"count": len(workers), "workers": [
        {**w,
         "open_assignments": sum(1 for a in data["assignments"]
                                 if a["worker_id"] == w["id"] and a["status"] != "completed"),
         "completed_assignments": sum(1 for a in data["assignments"]
                                      if a["worker_id"] == w["id"] and a["status"] == "completed")}
        for w in workers]}


@router.patch("/v1/workers/{wid}")
def patch_worker(wid: str, body: WorkerPatch, _=Depends(require_bearer)):
    data = store.read()
    for w in data["workers"]:
        if w["id"] == wid:
            if body.status:
                if body.status not in WORKER_STATES:
                    return fail(422, "invalid_status", f"status must be one of: {', '.join(WORKER_STATES)}.")
                w["status"] = body.status
            if body.location:
                w["location"] = body.location.model_dump()
            store.write(data)
            return w
    return fail(404, "not_found", "No worker with that id.")


# -------------------------------------------------------------- assignments

@router.post("/v1/assignments", status_code=201)
async def create_assignment(body: AssignmentIn, _=Depends(require_bearer)):
    """Dispatch the NEAREST AVAILABLE worker.

    Notification and analytics are fire-and-forget: if either is down the
    assignment still stands and is returned normally, with the failure
    surfaced in `side_effects` so the caller can see what did not happen.
    """
    data = store.read()
    if any(a["job_ref"] == body.job_ref and a["status"] != "completed" for a in data["assignments"]):
        return fail(409, "duplicate_job", f"job_ref {body.job_ref} already has an open assignment.")

    available = [w for w in data["workers"] if w["status"] == "available"]
    if not available:
        # A real answer (everyone is busy), NOT an outage — callers must be
        # able to tell these apart.
        return fail(503, "no_workers_available", "No available worker to assign.")

    target = body.location.model_dump()
    nearest = min(available, key=lambda w: haversine_km(target, w["location"]))
    distance = round(haversine_km(target, nearest["location"]), 2)

    assignment = {
        "id": store.new_id("asg"), "job_ref": body.job_ref,
        "worker_id": nearest["id"], "worker_name": nearest["name"],
        "location": target, "metadata": body.metadata, "distance_km": distance,
        "status": "assigned", "assigned_at": store.now(),
        "started_at": None, "completed_at": None,
    }
    nearest["status"] = "busy"
    data["assignments"].append(assignment)
    store.write(data)

    notified = await notify("worker", f"New pickup assigned, {distance} km away.",
                            body.job_ref, nearest["id"])
    emitted = await emit("bin.assigned", body.job_ref,
                         {"worker_id": nearest["id"], "distance_km": distance})
    # The SENDER reports delivery, not the notification module — that keeps
    # notification_system a dependency-free leaf, and more readily sold alone.
    if notified["ok"]:
        await emit("notification.sent", body.job_ref,
                   {"recipient_type": "worker", "trigger": "assigned"})

    return {**assignment, "side_effects": {
        "notification": "sent" if notified["ok"] else f"skipped:{notified['reason']}",
        "analytics": "recorded" if emitted["ok"] else f"skipped:{emitted['reason']}"}}


@router.get("/v1/assignments")
def list_assignments(worker_id: Optional[str] = None, status: Optional[str] = None,
                     job_ref: Optional[str] = None, _=Depends(require_bearer)):
    items = store.read()["assignments"]
    if worker_id:
        items = [a for a in items if a["worker_id"] == worker_id]
    if status:
        items = [a for a in items if a["status"] == status]
    if job_ref:
        items = [a for a in items if a["job_ref"] == job_ref]
    return {"count": len(items), "assignments": list(reversed(items))}


@router.patch("/v1/assignments/{aid}")
async def patch_assignment(aid: str, body: StatusPatch, _=Depends(require_bearer)):
    if body.status not in STATUSES:
        return fail(422, "invalid_status", f"status must be one of: {', '.join(STATUSES)}.")

    data = store.read()
    assignment = next((a for a in data["assignments"] if a["id"] == aid), None)
    if assignment is None:
        return fail(404, "not_found", "No assignment with that id.")
    if assignment["status"] == "completed":
        return fail(409, "already_completed", "Completed assignments are immutable.")

    assignment["status"] = body.status
    worker = next((w for w in data["workers"] if w["id"] == assignment["worker_id"]), None)

    if body.status == "in_progress":
        assignment["started_at"] = store.now()
    elif body.status == "completed":
        assignment["completed_at"] = store.now()
        # Free the worker ONLY if this was their last open job — a worker
        # holding several stops must not flip back to available prematurely.
        still_open = any(a["worker_id"] == assignment["worker_id"]
                         and a["id"] != assignment["id"] and a["status"] != "completed"
                         for a in data["assignments"])
        if worker and not still_open:
            worker["status"] = "available"

    # Persist BEFORE side effects: keeps the ordering explicit so a later
    # refactor cannot reintroduce a lost-update race.
    store.write(data)

    side_effects: dict[str, str] = {}
    if body.status == "completed":
        citizen = await notify("citizen",
                               "The bin you reported has been cleared. Thanks for helping keep the city clean!",
                               assignment["job_ref"])
        admin = await notify("admin",
                             f"{assignment['worker_name']} cleared {assignment['job_ref']}.",
                             assignment["job_ref"])
        emitted = await emit("bin.collected", assignment["job_ref"],
                             {"worker_id": assignment["worker_id"]})
        side_effects = {
            "citizen_notification": "sent" if citizen["ok"] else f"skipped:{citizen['reason']}",
            "admin_notification": "sent" if admin["ok"] else f"skipped:{admin['reason']}",
            "analytics": "recorded" if emitted["ok"] else f"skipped:{emitted['reason']}",
        }
        for ok, who in ((citizen["ok"], "citizen"), (admin["ok"], "admin")):
            if ok:
                await emit("notification.sent", assignment["job_ref"],
                           {"recipient_type": who, "trigger": "completed"})

    return {**assignment, "side_effects": side_effects}


@router.get("/v1/workers/{wid}/queue")
async def worker_queue(wid: str, _=Depends(require_bearer)):
    """A worker's open jobs, sequenced.

    DEGRADES rather than fails: if route_optimizer is unreachable the stops
    come back unordered with optimized=false and a degraded_reason, so the
    worker still sees their queue. Always check `optimized` before relying on
    stop order.
    """
    data = store.read()
    worker = next((w for w in data["workers"] if w["id"] == wid), None)
    if worker is None:
        return fail(404, "not_found", "No worker with that id.")

    stops = [{"assignment_id": a["id"], "job_ref": a["job_ref"],
              "location": a["location"], "metadata": a["metadata"]}
             for a in data["assignments"]
             if a["worker_id"] == wid and a["status"] != "completed"]

    if not stops:
        return {"worker_id": wid, "worker_name": worker["name"], "optimized": True,
                "total_distance_km": 0, "stops": []}

    result = await optimize_route(worker["location"], stops)
    if not result["ok"]:
        return {"worker_id": wid, "worker_name": worker["name"], "optimized": False,
                "degraded_reason": result["reason"], "total_distance_km": None,
                "stops": stops}

    await emit("route.optimized", wid, {"stop_count": len(stops)})
    return {"worker_id": wid, "worker_name": worker["name"], "optimized": True,
            "strategy": result["data"]["strategy"],
            "total_distance_km": result["data"]["total_distance_km"],
            "stops": result["data"]["stops"]}


# --------------------------------------------------------------- packaging
# TWO DEPLOYMENT SHAPES, ONE IMPLEMENTATION.
#
#   router — mount into any FastAPI app:
#              app.include_router(router, prefix="worker")
#   app    — run this module as its own service:
#              uvicorn worker_dashboard:app --port 8006
#
# The router is the unit of COMPOSITION; the app is the unit of SALE. Exposing
# both means the single-process monolith and the six-service network are the
# same code, so choosing one deployment today does not foreclose the other —
# and a buyer still receives a service, not a fragment of ours.
app = FastAPI(title="FieldOps Crew", version=APP_VERSION)
app.include_router(router)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8006)))

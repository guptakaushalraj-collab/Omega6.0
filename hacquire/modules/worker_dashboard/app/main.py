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
"""
import math
import os
from typing import Any, Optional

from fastapi import Depends, FastAPI, Header, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .clients import dependency_config, emit, notify, optimize_route
from .store import Store

APP_VERSION = "3.1.0"
AUTH_TOKEN = os.getenv("CREW_AUTH_TOKEN", "dev-fieldops-token")
STATUSES = ["assigned", "in_progress", "completed"]
WORKER_STATES = ["available", "busy", "off_shift"]

app = FastAPI(title="FieldOps Crew", version=APP_VERSION)
store = Store({"workers": [], "assignments": []})


def fail(status: int, error: str, detail: str) -> JSONResponse:
    """FieldOps error envelope: flat {error, detail}."""
    return JSONResponse(status_code=status, content={"error": error, "detail": detail})


class AuthError(Exception):
    def __init__(self, status: int, error: str, detail: str):
        self.status, self.error, self.detail = status, error, detail


def require_bearer(authorization: Optional[str] = Header(None)):
    if not authorization:
        raise AuthError(401, "unauthorized", "Authorization header is required.")
    parts = authorization.split()
    if len(parts) != 2 or parts[0] != "Bearer":
        raise AuthError(401, "unauthorized", "Expected 'Authorization: Bearer <token>'.")
    if parts[1] != AUTH_TOKEN:
        raise AuthError(403, "forbidden", "Token not recognised.")
    return parts[1]


@app.exception_handler(AuthError)
def _auth_handler(_r: Request, exc: AuthError):
    return fail(exc.status, exc.error, exc.detail)


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


@app.get("/v1/health")
def health():
    return {"ok": True, "service": "fieldops-crew", "version": APP_VERSION,
            "dependencies": dependency_config()}


# ------------------------------------------------------------------ workers

@app.post("/v1/workers", status_code=201)
def create_worker(w: WorkerIn, _=Depends(require_bearer)):
    data = store.read()
    worker = {"id": store.new_id("wrk"), "name": w.name, "phone": w.phone,
              "location": w.location.model_dump(), "status": "available",
              "created_at": store.now()}
    data["workers"].append(worker)
    store.write(data)
    return worker


@app.get("/v1/workers")
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


@app.patch("/v1/workers/{wid}")
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

@app.post("/v1/assignments", status_code=201)
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


@app.get("/v1/assignments")
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


@app.patch("/v1/assignments/{aid}")
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


@app.get("/v1/workers/{wid}/queue")
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8006)))

"""notification_system — :8005 — BOUGHT (SignalPost Relay 2.4.1)

ACQUIRED MODULE. Conventions below are the ORIGINAL vendor's and are retained
deliberately:

    /v1 base path (not /api/v1) · X-API-Key auth · snake_case payloads
    vendor error envelope {"error": {"code", "message"}}

Existing SignalPost client SDKs and the vendor's published docs must keep
working, and a future buyer expects the API they purchased. Normalising this
to house style would break both and destroy the property that makes it
independently sellable. Adaptation is carried at the CALL SITE — see the
`notify` adapter inside modules/worker_dashboard/worker_dashboard.py.

This file is delivered EXACTLY as acquired plus the /notifyPickup alias; it
imports nothing from this network, so it can be resold as a single file.

KNOWN GAP: only `in_app` actually delivers. sms/email/push are accepted and
recorded as "queued" but nothing sends them — the SignalPost gateway
credentials were NOT part of the acquisition.

Run standalone:      uvicorn notification_system:app --port 8005
Needs:               fastapi  uvicorn  pydantic
Env:                 PORT (default 8005), NOTIFY_API_KEY, MAX_MESSAGES
"""
import json
import os
import secrets
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, FastAPI, Header, Query, Request, Response
from fastapi.routing import APIRoute
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

APP_VERSION = "2.4.1"
API_KEY = os.getenv("NOTIFY_API_KEY", "dev-signalpost-key")
MAX_MESSAGES = int(os.getenv("MAX_MESSAGES", 10000))
MAX_BODY_CHARS = 1000
CHANNELS = ["in_app", "sms", "email", "push"]
RECIPIENTS = ["citizen", "worker", "admin"]


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


store = Store({"messages": []})


def fail(status: int, code: str, message: str) -> JSONResponse:
    """Vendor error envelope — differs from the in-house modules' flat shape."""
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message}})


class ApiKeyError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status, self.code, self.message = status, code, message


class SignalPostRoute(APIRoute):
    """Carries the vendor error envelope WITH the route, not with the app.

    An app-level @exception_handler is registered on ONE FastAPI instance. The
    moment this router is included into somebody else's app — the composed
    single-process deployment, or a buyer's own gateway — that handler is left
    behind and an unauthenticated call turns into a 500 instead of SignalPost's
    documented 401. Wrapping the route handler keeps
    {"error":{"code","message"}} intact wherever the router is mounted, which
    is exactly the guarantee an acquired module has to make.
    """

    def get_route_handler(self):
        original = super().get_route_handler()

        async def handler(request: Request) -> Response:
            try:
                return await original(request)
            except ApiKeyError as exc:
                return fail(exc.status, exc.code, exc.message)

        return handler


router = APIRouter(route_class=SignalPostRoute)


def require_api_key(x_api_key: Optional[str] = Header(None)):
    if not x_api_key:
        raise ApiKeyError(401, "missing_api_key", "X-API-Key header is required.")
    if x_api_key != API_KEY:
        raise ApiKeyError(403, "invalid_api_key", "The supplied API key was not recognised.")
    return x_api_key


class MessageIn(BaseModel):
    recipient_type: str = Field(..., examples=["worker"])
    recipient_id: Optional[str] = None
    channel: str = "in_app"
    body: str
    subject_ref: Optional[str] = Field(None, description="Opaque correlation id — use the bin id")
    metadata: dict[str, Any] = Field(default_factory=dict)


class PickupIn(BaseModel):
    binId: Optional[str] = None
    bin_id: Optional[str] = None
    recipient_type: str = "citizen"
    recipient_id: Optional[str] = None
    channel: str = "in_app"
    message: Optional[str] = None


def _persist(recipient_type: str, recipient_id: Optional[str], channel: str,
             body: str, subject_ref: Optional[str], metadata: dict) -> dict:
    msg = {
        "id": store.new_id("msg"),
        "recipient_type": recipient_type,
        "recipient_id": recipient_id,
        "channel": channel,
        "body": body.strip(),
        "subject_ref": subject_ref,
        "metadata": metadata,
        # Only in_app is genuinely delivered by this build — see module docstring.
        "delivery_status": "delivered" if channel == "in_app" else "queued",
        "acknowledged": False,
        "created_at": store.now(),
        "acknowledged_at": None,
    }
    data = store.read()
    data["messages"].insert(0, msg)
    data["messages"] = data["messages"][:MAX_MESSAGES]
    store.write(data)
    return msg


@router.get("/v1/health")
def health():
    return {"ok": True, "service": "signalpost-relay", "version": APP_VERSION}


@router.get("/v1/channels")
def channels(_=Depends(require_api_key)):
    return {"channels": CHANNELS}


@router.post("/v1/messages", status_code=201)
def send(msg: MessageIn, _=Depends(require_api_key)):
    if not msg.recipient_type:
        return fail(400, "missing_recipient_type", "recipient_type is required.")
    if not msg.body or not msg.body.strip():
        return fail(400, "missing_body", "body is required and must be non-empty.")
    if len(msg.body) > MAX_BODY_CHARS:
        return fail(422, "body_too_long", f"body exceeds {MAX_BODY_CHARS} characters.")
    if msg.channel not in CHANNELS:
        return fail(422, "unsupported_channel", f"channel must be one of: {', '.join(CHANNELS)}.")
    return _persist(msg.recipient_type, msg.recipient_id, msg.channel,
                    msg.body, msg.subject_ref, msg.metadata)


@router.get("/v1/messages")
def inbox(recipient_type: Optional[str] = None, recipient_id: Optional[str] = None,
          subject_ref: Optional[str] = None, unacknowledged: Optional[str] = None,
          limit: int = 100, _=Depends(require_api_key)):
    msgs = store.read()["messages"]
    if recipient_type:
        msgs = [m for m in msgs if m["recipient_type"] == recipient_type]
    if recipient_id:
        msgs = [m for m in msgs if m["recipient_id"] == recipient_id]
    if subject_ref:
        msgs = [m for m in msgs if m["subject_ref"] == subject_ref]
    if unacknowledged == "true":
        msgs = [m for m in msgs if not m["acknowledged"]]
    # Note the envelope — another SignalPost convention the in-house modules
    # do not share.
    return {"count": len(msgs), "messages": msgs[:min(limit, 500)]}


@router.get("/v1/messages/{mid}")
def get_message(mid: str, _=Depends(require_api_key)):
    for m in store.read()["messages"]:
        if m["id"] == mid:
            return m
    return fail(404, "message_not_found", "No message with that id.")


@router.post("/v1/messages/{mid}/ack")
def ack(mid: str, _=Depends(require_api_key)):
    """Idempotent — re-acknowledging preserves the original acknowledged_at."""
    data = store.read()
    for m in data["messages"]:
        if m["id"] == mid:
            if not m["acknowledged"]:
                m["acknowledged"] = True
                m["acknowledged_at"] = store.now()
                store.write(data)
            return m
    return fail(404, "message_not_found", "No message with that id.")


@router.post("/v1/messages/ack_all")
def ack_all(body: dict, _=Depends(require_api_key)):
    rt, rid = body.get("recipient_type"), body.get("recipient_id")
    if not rt and not rid:
        return fail(400, "missing_selector", "Supply recipient_type and/or recipient_id.")
    data, now, n = store.read(), store.now(), 0
    for m in data["messages"]:
        if rt and m["recipient_type"] != rt:
            continue
        if rid and m["recipient_id"] != rid:
            continue
        if m["acknowledged"]:
            continue
        m["acknowledged"], m["acknowledged_at"], n = True, now, n + 1
    store.write(data)
    return {"acknowledged": n}


# ------------------------------------------------------- house aliases
# ADDITIVE ONLY. Everything below sits OUTSIDE /v1 and is ours, not the
# vendor's. The SignalPost surface underneath is untouched, so the module can
# still be resold as the product its buyers already integrate against — these
# routes are a convenience layer a new owner can delete without breaking a
# single documented endpoint.
#
# AUTH APPLIES TO ALL OF THEM. Being outside /v1 means the key check has to be
# attached explicitly rather than inherited. An unauthenticated notification
# endpoint is a spam vector — anyone who finds the URL can push messages to
# citizens in the city's name — so an alias must never become a way around
# auth, however convenient that would be for a demo.


def _send_pickup(bin_id, recipient_type: str, recipient_id, channel: str, message):
    """Compose and persist a pickup notification. Shared by both aliases."""
    if not bin_id:
        return fail(400, "missing_bin_id", "binId is required.")
    if recipient_type not in RECIPIENTS:
        return fail(422, "unsupported_recipient", f"recipient_type must be one of: {', '.join(RECIPIENTS)}.")
    if channel not in CHANNELS:
        return fail(422, "unsupported_channel", f"channel must be one of: {', '.join(CHANNELS)}.")

    default = {
        "citizen": "Good news — the bin you reported has been picked up. Thanks for helping keep the city clean!",
        "worker": f"Pickup scheduled for {bin_id}.",
        "admin": f"Pickup completed for {bin_id}.",
    }[recipient_type]

    text = (message or default).strip()
    if len(text) > MAX_BODY_CHARS:
        return fail(422, "body_too_long", f"message exceeds {MAX_BODY_CHARS} characters.")

    return _persist(recipient_type, recipient_id, channel, text, str(bin_id),
                    {"trigger": "pickup"})


@router.post("/notifyPickup", status_code=201)
def notify_pickup(body: PickupIn, _=Depends(require_api_key)):
    """Flat alias over POST /v1/messages.

    Composes a pickup message and defaults the recipient to `citizen` — the
    person who reported the bin, which is what "alert the user" means here.
    """
    msg = _send_pickup(body.binId or body.bin_id, body.recipient_type,
                       body.recipient_id, body.channel, body.message)
    if isinstance(msg, JSONResponse):
        return msg
    return {"sent": msg["delivery_status"] == "delivered", "messageId": msg["id"],
            "binId": msg["subject_ref"], "recipient": msg["recipient_type"],
            "channel": msg["channel"], "delivery_status": msg["delivery_status"],
            "message": msg["body"]}


@router.post("/pickup", status_code=201)
def pickup(
    body: Optional[PickupIn] = None,
    binId: Optional[str] = Query(None, description="Bin id, e.g. bin_90b813b2c556"),
    _=Depends(require_api_key),
):
    """Notify the citizen that a bin has been cleared.

    Short form of /notifyPickup. Accepts binId as a JSON body or a query
    parameter, and returns the {binId, message} envelope.

    `message` states the EVENT — the pickup happened. Whether the alert
    reached anyone is `delivery_status`, and the text actually sent is
    `notification`. Three different facts, three keys: only `in_app` delivers
    in this build, so a message can legitimately be recorded as "queued" for a
    pickup that definitely completed, and one field cannot honestly carry both.
    """
    msg = _send_pickup(
        (body.binId or body.bin_id) if body else binId,
        body.recipient_type if body else "citizen",
        body.recipient_id if body else None,
        body.channel if body else "in_app",
        body.message if body else None,
    )
    if isinstance(msg, JSONResponse):
        return msg
    return {
        "binId": msg["subject_ref"],
        "message": "Pickup completed",
        "sent": msg["delivery_status"] == "delivered",
        "messageId": msg["id"],
        "recipient": msg["recipient_type"],
        "channel": msg["channel"],
        "delivery_status": msg["delivery_status"],
        "notification": msg["body"],
    }


# --------------------------------------------------------------- packaging
# TWO DEPLOYMENT SHAPES, ONE IMPLEMENTATION.
#
#   router — mount into any FastAPI app:
#              app.include_router(router, prefix="/notify")
#   app    — run this module as its own service:
#              uvicorn notification_system:app --port 8005
#
# The router is the unit of COMPOSITION; the app is the unit of SALE. Exposing
# both means the single-process monolith and the six-service network are the
# same code, so choosing one deployment today does not foreclose the other —
# and a buyer still receives a service, not a fragment of ours.
app = FastAPI(title="SignalPost Relay", version=APP_VERSION)
app.include_router(router)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8005)))

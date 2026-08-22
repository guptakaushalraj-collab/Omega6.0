"""notification_system — :8005 — BOUGHT (SignalPost Relay 2.4.1)

ACQUIRED MODULE. Conventions below are the ORIGINAL vendor's and are retained
deliberately:

    /v1 base path (not /api/v1) · X-API-Key auth · snake_case payloads
    vendor error envelope {"error": {"code", "message"}}

Existing SignalPost client SDKs and the vendor's published docs must keep
working, and a future buyer expects the API they purchased. Normalising this
to house style would break both and destroy the property that makes it
independently sellable. Adaptation is carried at the CALL SITE — see
worker_dashboard/app/clients.py.

KNOWN GAP: only `in_app` actually delivers. sms/email/push are accepted and
recorded as "queued" but nothing sends them — the SignalPost gateway
credentials were NOT part of the acquisition.
"""
import os
from typing import Any, Optional

from fastapi import Depends, FastAPI, Header, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .store import Store

APP_VERSION = "2.4.1"
API_KEY = os.getenv("NOTIFY_API_KEY", "dev-signalpost-key")
MAX_MESSAGES = int(os.getenv("MAX_MESSAGES", 10000))
MAX_BODY_CHARS = 1000
CHANNELS = ["in_app", "sms", "email", "push"]
RECIPIENTS = ["citizen", "worker", "admin"]

app = FastAPI(title="SignalPost Relay", version=APP_VERSION)
store = Store({"messages": []})


def fail(status: int, code: str, message: str) -> JSONResponse:
    """Vendor error envelope — differs from the in-house modules' flat shape."""
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message}})


class ApiKeyError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status, self.code, self.message = status, code, message


def require_api_key(x_api_key: Optional[str] = Header(None)):
    if not x_api_key:
        raise ApiKeyError(401, "missing_api_key", "X-API-Key header is required.")
    if x_api_key != API_KEY:
        raise ApiKeyError(403, "invalid_api_key", "The supplied API key was not recognised.")
    return x_api_key


@app.exception_handler(ApiKeyError)
def _api_key_handler(_request: Request, exc: ApiKeyError):
    return fail(exc.status, exc.code, exc.message)


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


@app.get("/v1/health")
def health():
    return {"ok": True, "service": "signalpost-relay", "version": APP_VERSION}


@app.get("/v1/channels")
def channels(_=Depends(require_api_key)):
    return {"channels": CHANNELS}


@app.post("/v1/messages", status_code=201)
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


@app.get("/v1/messages")
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


@app.get("/v1/messages/{mid}")
def get_message(mid: str, _=Depends(require_api_key)):
    for m in store.read()["messages"]:
        if m["id"] == mid:
            return m
    return fail(404, "message_not_found", "No message with that id.")


@app.post("/v1/messages/{mid}/ack")
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


@app.post("/v1/messages/ack_all")
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


@app.post("/notifyPickup", status_code=201)
def notify_pickup(body: PickupIn, _=Depends(require_api_key)):
    """Flat alias over POST /v1/messages.

    Composes a pickup message and defaults the recipient to `citizen` — the
    person who reported the bin, which is what "alert the user" means here.

    AUTH STILL APPLIES. This route sits outside /v1, so the key check is
    applied explicitly: an unauthenticated notification endpoint is a spam
    vector, and an alias must never become a way around auth.
    """
    bin_id = body.binId or body.bin_id
    if not bin_id:
        return fail(400, "missing_bin_id", "binId is required.")
    if body.recipient_type not in RECIPIENTS:
        return fail(422, "unsupported_recipient", f"recipient_type must be one of: {', '.join(RECIPIENTS)}.")
    if body.channel not in CHANNELS:
        return fail(422, "unsupported_channel", f"channel must be one of: {', '.join(CHANNELS)}.")

    default = {
        "citizen": "Good news — the bin you reported has been picked up. Thanks for helping keep the city clean!",
        "worker": f"Pickup scheduled for {bin_id}.",
        "admin": f"Pickup completed for {bin_id}.",
    }[body.recipient_type]

    text = (body.message or default).strip()
    if len(text) > MAX_BODY_CHARS:
        return fail(422, "body_too_long", f"message exceeds {MAX_BODY_CHARS} characters.")

    msg = _persist(body.recipient_type, body.recipient_id, body.channel,
                   text, str(bin_id), {"trigger": "pickup"})
    return {"sent": msg["delivery_status"] == "delivered", "messageId": msg["id"],
            "binId": msg["subject_ref"], "recipient": msg["recipient_type"],
            "channel": msg["channel"], "delivery_status": msg["delivery_status"],
            "message": msg["body"]}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8005)))

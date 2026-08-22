"""Outbound adapters.

Three rules keep this module independently ownable:

  1. Targets resolved from ENV VARS, never hardcoded — swap the provider
     (including to a competitor's hosted endpoint) without touching code.
  2. HARD TIMEOUT on every request. A slow dependency must not become our
     slow response.
  3. NEVER RAISE. Each returns {"ok": bool, ...} and the caller degrades.
     A dependency being down degrades a feature; it never fails the request.

Note the adaptation cost of the OTHER acquired module living here: `notify`
translates our vocabulary into SignalPost's (X-API-Key, recipient_type/body/
subject_ref). That translation belongs at the call site, not inside the module
we bought — which stays unmodified and therefore resaleable.
"""
import os

import httpx

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

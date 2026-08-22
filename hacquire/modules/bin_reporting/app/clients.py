"""Outbound adapters.

Same three rules as every client layer in the registry: targets from env vars,
hard timeout, never raise — return {"ok": bool, ...} and let the caller degrade.

The worker_dashboard adapter carries the adaptation for that ACQUIRED module:
Bearer auth, snake_case, and its domain-neutral vocabulary (our bin id becomes
its `job_ref`). Keeping that translation here is what lets the purchased
module stay unmodified and therefore resaleable.
"""
import base64
import os

import httpx

WASTE_RECOGNITION_URL = os.getenv("WASTE_RECOGNITION_URL", "")
WORKER_DASHBOARD_URL = os.getenv("WORKER_DASHBOARD_URL", "")
CREW_AUTH_TOKEN = os.getenv("CREW_AUTH_TOKEN", "dev-fieldops-token")
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


async def classify(image: bytes, reference: str) -> dict:
    """Degradation: the bin is stored unclassified and can be backfilled later
    via POST /api/v1/reports/{id}/reclassify."""
    if not WASTE_RECOGNITION_URL:
        return {"ok": False, "reason": "not_configured"}
    return await _request("POST", f"{WASTE_RECOGNITION_URL}/api/v1/classify",
                          json={"image_base64": base64.b64encode(image).decode(),
                                "reference": reference})


async def request_assignment(bin_id: str, location: dict, waste_type: str | None) -> dict:
    """Degradation: the report stays 'reported' and can be dispatched later.

    Note the vocabulary translation — our bin id is its job_ref.
    """
    if not WORKER_DASHBOARD_URL:
        return {"ok": False, "reason": "not_configured"}
    return await _request(
        "POST", f"{WORKER_DASHBOARD_URL}/v1/assignments",
        headers={"Authorization": f"Bearer {CREW_AUTH_TOKEN}"},  # FieldOps' scheme
        json={"job_ref": bin_id, "location": location,
              "metadata": {"waste_type": waste_type}},
    )


async def emit(event_type: str, subject_id: str, payload: dict) -> dict:
    """Degradation: the report succeeds; metrics lose a data point."""
    if not ANALYTICS_URL:
        return {"ok": False, "reason": "not_configured"}
    return await _request("POST", f"{ANALYTICS_URL}/api/v1/events",
                          json={"type": event_type, "subject_id": subject_id,
                                "source": "bin_reporting", "payload": payload})


def dependency_config() -> dict:
    return {
        "waste_recognition": WASTE_RECOGNITION_URL or None,
        "worker_dashboard": WORKER_DASHBOARD_URL or None,
        "analytics_dashboard": ANALYTICS_URL or None,
        "timeout_ms": int(TIMEOUT_S * 1000),
    }

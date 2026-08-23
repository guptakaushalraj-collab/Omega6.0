"""Intelligent Waste Collection Network — single-process deployment.

Mounts all six modules as routers in ONE FastAPI app:

    uvicorn main:app --reload

The distributed deployment — six processes on six ports, talking over HTTP —
is `run_network.py`. Both drive exactly the same module code: every module
exposes a `router` (the unit of composition, used here) and an `app` (the unit
of sale, used there). Choosing one deployment today does not foreclose the
other, and a buyer still receives a whole service rather than a fragment.

WHAT COMPOSITION COSTS. Worth stating plainly, because it is the trade this
file makes:
  · one process, so one module's crash or memory leak takes down all six;
  · one dependency set and one release, so the three SOLD modules can no
    longer be deployed, scaled or versioned by their buyers independently;
  · every path gains a prefix — POST /reportBin becomes POST /bin/reportBin —
    a breaking change for anyone already on the published API.
The acquired modules keep their own base paths, auth schemes and error
envelopes underneath their prefix, so /notify/v1/... and /worker/v1/... behave
exactly as their vendors documented.
"""
import os
from pathlib import Path

from dotenv import load_dotenv

# override=False: an exported value or a platform-injected one always wins
# over a checked-in default. Loaded before anything reads os.environ.
load_dotenv(Path(__file__).resolve().parent / ".env", override=False)

# ---------------------------------------------------------------------------
# SELF-WIRING — must run BEFORE the module imports below.
#
# The modules still reach each other over HTTP even inside one process. They
# hold no references to one another; that absence is precisely what keeps them
# separately sellable, and composition is not a licence to start importing
# across the boundary. So they only need to be told where "each other" now
# lives: this same host, behind the prefixes registered further down.
#
# Each module resolves its dependency URLs from the environment at import
# time, so these defaults have to be in place first — hence the placement
# ahead of the imports rather than tidily beside them.
#
# Without this the dependencies are simply unconfigured and every module
# degrades into an inert island: reports persist, but nothing is classified or
# dispatched. Set any of these in the environment (or .env) to override —
# a SOLD module can still be repointed at its buyer's host from here, exactly
# as in the distributed deployment.
# ---------------------------------------------------------------------------
SELF_BASE_URL = os.getenv("SELF_BASE_URL", f"http://localhost:{os.getenv('PORT', '8000')}")

for _var, _prefix in (
    ("WASTE_RECOGNITION_URL", "/waste"),
    ("ROUTE_OPTIMIZER_URL",   "/route"),
    ("ANALYTICS_URL",         "/analytics"),
    ("NOTIFICATION_URL",      "/notify"),
    ("WORKER_DASHBOARD_URL",  "/worker"),
):
    os.environ.setdefault(_var, SELF_BASE_URL + _prefix)

from fastapi import FastAPI                                              # noqa: E402

from modules.analytics_dashboard.analytics_dashboard import router as analytics_router  # noqa: E402
from modules.bin_reporting.bin_reporting import router as bin_router                    # noqa: E402
from modules.notification_system.notification_system import router as notify_router     # noqa: E402
from modules.route_optimizer.route_optimizer import router as route_router              # noqa: E402
from modules.waste_recognition.waste_recognition import router as waste_router          # noqa: E402
from modules.worker_dashboard.worker_dashboard import router as worker_router           # noqa: E402

app = FastAPI(title="Intelligent Waste Collection Network")

# Register routers
app.include_router(bin_router, prefix="/bin", tags=["bin_reporting"])
app.include_router(waste_router, prefix="/waste", tags=["waste_recognition"])
app.include_router(route_router, prefix="/route", tags=["route_optimizer"])
app.include_router(analytics_router, prefix="/analytics", tags=["analytics_dashboard"])
app.include_router(notify_router, prefix="/notify", tags=["notification_system"])
app.include_router(worker_router, prefix="/worker", tags=["worker_dashboard"])


@app.get("/", tags=["network"])
def index():
    """The registry, and where each module answers under composition."""
    return {
        "service": "Intelligent Waste Collection Network",
        "deployment": "single-process — six routers, one app",
        "modules": {
            "bin_reporting":       {"prefix": "/bin",       "position": "HELD"},
            "waste_recognition":   {"prefix": "/waste",     "position": "SOLD $42,000"},
            "route_optimizer":     {"prefix": "/route",     "position": "SOLD $28,000"},
            "analytics_dashboard": {"prefix": "/analytics", "position": "SOLD $35,000"},
            "notification_system": {"prefix": "/notify",    "position": "BOUGHT — SignalPost Relay 2.4.1"},
            "worker_dashboard":    {"prefix": "/worker",    "position": "BOUGHT — FieldOps Crew 3.1.0"},
        },
        "flat_api": {
            "reportBin":       "POST /bin/reportBin",
            "detectWasteType": "POST /bin/detectWasteType",
            "optimizeRoute":   "GET  /route/optimizeRoute?bins=[...]",
            "analytics":       "GET  /analytics/analytics",
            "notifyPickup":    "POST /notify/notifyPickup",
        },
        "docs": "/docs",
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8000)))

#!/usr/bin/env python3
"""Run all six FastAPI modules with dependency URLs pre-wired.

The modules do not need this script — each runs standalone with
`uvicorn app.main:app` from its own directory. This exists for convenience
when running the full network locally.

    python hacquire/scripts/run_mesh.py          # start all six
    python hacquire/scripts/run_mesh.py --reset  # wipe every datastore first
"""
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODULES_DIR = ROOT / "modules"

NOTIFY_API_KEY = os.getenv("NOTIFY_API_KEY", "dev-signalpost-key")
CREW_AUTH_TOKEN = os.getenv("CREW_AUTH_TOKEN", "dev-fieldops-token")

# Boot order matters only for log readability — every module tolerates its
# dependencies being absent, so any order works.
MODULES = [
    ("waste_recognition",   8002, {}),
    ("route_optimizer",     8003, {}),
    ("analytics_dashboard", 8004, {}),
    ("notification_system", 8005, {"NOTIFY_API_KEY": NOTIFY_API_KEY}),
    ("worker_dashboard",    8006, {
        "ROUTE_OPTIMIZER_URL": "http://localhost:8003",
        "NOTIFICATION_URL":    "http://localhost:8005",
        "ANALYTICS_URL":       "http://localhost:8004",
        "NOTIFY_API_KEY":      NOTIFY_API_KEY,
        "CREW_AUTH_TOKEN":     CREW_AUTH_TOKEN,
    }),
    ("bin_reporting",       8001, {
        "WASTE_RECOGNITION_URL": "http://localhost:8002",
        "WORKER_DASHBOARD_URL":  "http://localhost:8006",
        "ANALYTICS_URL":         "http://localhost:8004",
        "CREW_AUTH_TOKEN":       CREW_AUTH_TOKEN,
    }),
]


def reset_stores() -> None:
    for name, _, _ in MODULES:
        for f in (MODULES_DIR / name / "app" / "data").glob("*.json"):
            f.unlink()
            print(f"  reset {name}/{f.name}")


def main() -> None:
    if "--reset" in sys.argv:
        print("Resetting datastores...")
        reset_stores()
        print()

    procs = []
    for name, port, env in MODULES:
        proc_env = {**os.environ, "PORT": str(port), **env}
        p = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "app.main:app",
             "--host", "0.0.0.0", "--port", str(port), "--log-level", "warning"],
            cwd=MODULES_DIR / name, env=proc_env,
        )
        procs.append((name, port, p))
        print(f"  {name:<22} :{port}")

    print("\nMesh starting. Ctrl-C to stop all six.\n")

    def shutdown(*_):
        for _n, _p, proc in procs:
            proc.terminate()
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        shutdown()


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Intelligent Waste Collection Network — six-process network launcher.

HACQUIRE 2026. Boots the six independent FastAPI modules as SEPARATE
PROCESSES and injects each one's dependency URLs as environment variables.

This is the DISTRIBUTED deployment: six processes, six ports, talking over
HTTP. For the single-process deployment — all six mounted as routers in one
app — see main.py. Both drive the same module code.

This file is a convenience, never a dependency. Nothing in modules/ imports
it, and every module runs perfectly well on its own:

    cd modules/waste_recognition && uvicorn waste_recognition:app --port 8002

That is the point. Each module is a product that can be sold, bought or
replaced independently, so the network must be wired at the BOUNDARY — by
environment variables handed to processes — and never by shared imports.

Usage
-----
    python run_network.py                     # start all six
    python run_network.py --reset             # wipe every datastore, then start
    python run_network.py bin_reporting       # start one module only
    python run_network.py --list              # show the registry and exit

Configuration is read from the environment, then from a `.env` beside this
file if one exists. Copy `.env.example` to `.env` to change ports, tokens or
dependency targets. Every value has a working development default, so
`python run_network.py` works with no configuration at all.
"""
import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
MODULES_DIR = ROOT / "modules"


# override=False: a value already exported in the shell, or injected by a
# container platform, always wins over a checked-in default. The .env file
# fills gaps; it never overwrites the environment.
load_dotenv(ROOT / ".env", override=False)


def env(key: str, default: str) -> str:
    return os.getenv(key, default)


PORTS = {
    "bin_reporting":       int(env("BIN_REPORTING_PORT", "8001")),
    "waste_recognition":   int(env("WASTE_RECOGNITION_PORT", "8002")),
    "route_optimizer":     int(env("ROUTE_OPTIMIZER_PORT", "8003")),
    "analytics_dashboard": int(env("ANALYTICS_DASHBOARD_PORT", "8004")),
    "notification_system": int(env("NOTIFICATION_SYSTEM_PORT", "8005")),
    "worker_dashboard":    int(env("WORKER_DASHBOARD_PORT", "8006")),
}

HOST = env("HOST", "0.0.0.0")
REACH = env("SERVICE_HOST", "localhost")   # how modules address EACH OTHER
NOTIFY_API_KEY = env("NOTIFY_API_KEY", "dev-signalpost-key")
CREW_AUTH_TOKEN = env("CREW_AUTH_TOKEN", "dev-fieldops-token")


def url(module: str) -> str:
    """Where a module is reachable.

    Falls back to the locally launched process, but an explicit <MODULE>_URL
    overrides it — that single indirection is what lets a SOLD module be
    repointed at the buyer's hosted endpoint with one environment variable
    and no code change.
    """
    return os.getenv(f"{module.upper()}_URL", f"http://{REACH}:{PORTS[module]}")


# Boot order matters only for log readability — every module tolerates its
# dependencies being absent, so any order works. Dependencies listed here are
# CAPABILITIES the module consumes, injected as URLs; none is an import.
REGISTRY = [
    ("waste_recognition",   "SOLD $42,000",              lambda: {}),
    ("route_optimizer",     "SOLD $28,000",              lambda: {}),
    ("analytics_dashboard", "SOLD $35,000",              lambda: {}),
    ("notification_system", "BOUGHT — SignalPost 2.4.1", lambda: {
        "NOTIFY_API_KEY": NOTIFY_API_KEY,
    }),
    ("worker_dashboard",    "BOUGHT — FieldOps 3.1.0",   lambda: {
        "ROUTE_OPTIMIZER_URL": url("route_optimizer"),
        "NOTIFICATION_URL":    url("notification_system"),
        "ANALYTICS_URL":       url("analytics_dashboard"),
        "NOTIFY_API_KEY":      NOTIFY_API_KEY,
        "CREW_AUTH_TOKEN":     CREW_AUTH_TOKEN,
    }),
    ("bin_reporting",       "HELD",                      lambda: {
        "WASTE_RECOGNITION_URL": url("waste_recognition"),
        "WORKER_DASHBOARD_URL":  url("worker_dashboard"),
        "ANALYTICS_URL":         url("analytics_dashboard"),
        "CREW_AUTH_TOKEN":       CREW_AUTH_TOKEN,
    }),
]

NAMES = [name for name, _, _ in REGISTRY]


def reset_stores() -> None:
    """Delete every module's datastore and uploads. Destructive, opt-in."""
    for name in NAMES:
        for target in (MODULES_DIR / name / "data", MODULES_DIR / name / "uploads"):
            if target.exists():
                shutil.rmtree(target)
                print(f"  reset {name}/{target.name}/")


def start(name: str, banner: str, env_extra: dict) -> subprocess.Popen:
    port = PORTS[name]
    proc_env = {**os.environ, "PORT": str(port), **env_extra}
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", f"{name}:app",
         "--host", HOST, "--port", str(port), "--log-level", "warning"],
        cwd=MODULES_DIR / name, env=proc_env,
    )
    print(f"  {name:<22} :{port}   {banner}")
    return proc


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    flags = {a for a in sys.argv[1:] if a.startswith("-")}

    if "--list" in flags:
        print("Intelligent Waste Collection Network — six independent modules\n")
        for name, banner, _ in REGISTRY:
            print(f"  {name:<22} :{PORTS[name]:<6} {banner}")
        return

    unknown = [a for a in args if a not in NAMES]
    if unknown:
        sys.exit(f"Unknown module(s): {', '.join(unknown)}\nKnown: {', '.join(NAMES)}")

    if "--reset" in flags:
        print("Resetting datastores...")
        reset_stores()
        print()

    selected = [row for row in REGISTRY if not args or row[0] in args]

    procs = []
    for name, banner, env_fn in selected:
        procs.append(start(name, banner, env_fn()))

    print(f"\n{len(procs)} module(s) starting. Interactive docs at "
          f"http://{REACH}:{PORTS[selected[0][0]]}/docs — Ctrl-C to stop.\n")

    def shutdown(*_):
        for proc in procs:
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

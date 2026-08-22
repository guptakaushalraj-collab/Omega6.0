"""analytics_dashboard — :8004 — SOLD ($35,000)

Ingests operational events and derives collection metrics.

SELF-CONTAINED BY DESIGN. This single file is the whole module: datastore,
metric derivation and HTTP surface, importing nothing from a sibling.

PUSH-BASED BY DESIGN: it derives everything from events it is sent and never
queries another module's API or reads another module's disk. That inversion is
what makes it independently ownable — an operator running an entirely
different stack adopts it by emitting six documented event shapes.

Run standalone:      uvicorn analytics_dashboard:app --port 8004
Needs:               fastapi  uvicorn  pydantic
Env:                 PORT (default 8004), MAX_EVENTS
"""
import json
import os
import secrets
import threading
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI
from pydantic import BaseModel, Field

APP_VERSION = "1.0.0"
MAX_EVENTS = int(os.getenv("MAX_EVENTS", 20000))


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


app = FastAPI(title="analytics_dashboard", version=APP_VERSION)
store = Store({"events": []})

EVENT_TYPES = [
    "bin.reported", "bin.classified", "bin.assigned",
    "bin.collected", "notification.sent", "route.optimized",
]

# Kept in step with waste_recognition's taxonomy. Duplicated deliberately —
# importing across module boundaries is exactly what the registry forbids.
TYPE_COLORS = {
    "plastic": "#2563eb", "organic": "#16a34a", "paper": "#ca8a04",
    "metal": "#64748b", "glass": "#0d9488", "e-waste": "#7c3aed", "mixed": "#78716c",
}


class EventIn(BaseModel):
    type: str = Field(..., examples=["bin.collected"])
    subject_id: Optional[str] = Field(None, description="Bin id — pairs reported with collected")
    source: Optional[str] = None
    occurred_at: Optional[str] = None
    payload: dict[str, Any] = Field(default_factory=dict)


def _day(iso: str) -> str:
    return iso[:10]


def _resolution_minutes(events: list[dict]) -> list[float]:
    """Pair each collection with its report to derive resolution time.

    Bins reported but never collected are EXCLUDED rather than counted as
    zero — otherwise a growing backlog silently deflates the mean.
    """
    reported = {e["subject_id"]: e["occurred_at"]
                for e in events if e["type"] == "bin.reported" and e.get("subject_id")}
    out = []
    for e in events:
        if e["type"] != "bin.collected" or not e.get("subject_id"):
            continue
        start = reported.get(e["subject_id"])
        if not start:
            continue
        try:
            delta = (datetime.fromisoformat(e["occurred_at"].replace("Z", "+00:00"))
                     - datetime.fromisoformat(start.replace("Z", "+00:00"))).total_seconds() / 60
        except ValueError:
            continue
        if delta >= 0:
            out.append(delta)
    return sorted(out)


def _pct(sorted_vals: list[float], p: int) -> float:
    if not sorted_vals:
        return 0.0
    idx = min(len(sorted_vals) - 1, int(p / 100 * len(sorted_vals)))
    return round(sorted_vals[idx], 1)


def summarize(events: list[dict]) -> dict:
    counts = {t: 0 for t in EVENT_TYPES}
    for e in events:
        if e["type"] in counts:
            counts[e["type"]] += 1

    mix = Counter(e["payload"].get("waste_type")
                  for e in events
                  if e["type"] == "bin.classified" and e["payload"].get("waste_type"))
    total_mix = sum(mix.values())
    waste_mix = [{"type": t, "count": c,
                  "share": round(c / total_mix, 3) if total_mix else 0.0}
                 for t, c in mix.most_common()]

    workers: dict[str, dict] = {}
    for e in events:
        wid = e["payload"].get("worker_id")
        if not wid:
            continue
        row = workers.setdefault(wid, {"worker_id": wid, "assigned": 0, "collected": 0})
        if e["type"] == "bin.assigned":
            row["assigned"] += 1
        if e["type"] == "bin.collected":
            row["collected"] += 1

    res = _resolution_minutes(events)
    reported, collected = counts["bin.reported"], counts["bin.collected"]

    return {
        "totals": {
            "events": len(events), "reported": reported, "collected": collected,
            "outstanding": max(0, reported - collected),
            "notifications_sent": counts["notification.sent"],
            "routes_optimized": counts["route.optimized"],
        },
        "collection_rate": round(collected / reported, 3) if reported else 0.0,
        "resolution_minutes": {
            "samples": len(res),
            "mean": round(sum(res) / len(res), 1) if res else 0.0,
            "p50": _pct(res, 50), "p90": _pct(res, 90),
        },
        "event_counts": counts,
        "waste_mix": waste_mix,
        "worker_activity": sorted(workers.values(), key=lambda w: -w["collected"]),
    }


def trend(events: list[dict], days: int = 7) -> list[dict]:
    out = []
    for i in range(days - 1, -1, -1):
        key = _day((datetime.now(timezone.utc) - timedelta(days=i)).isoformat())
        out.append({
            "date": key,
            "reported": sum(1 for e in events if e["type"] == "bin.reported" and _day(e["occurred_at"]) == key),
            "collected": sum(1 for e in events if e["type"] == "bin.collected" and _day(e["occurred_at"]) == key),
        })
    return out


@app.get("/api/v1/health")
def health():
    return {"ok": True, "module": "analytics_dashboard", "version": APP_VERSION}


@app.get("/api/v1/event-types")
def event_types():
    return EVENT_TYPES


@app.post("/api/v1/events", status_code=202)
def ingest(evt: EventIn):
    """Ingest one event.

    UNKNOWN TYPES ARE ACCEPTED, not rejected — stored with known_type=false and
    excluded from derived metrics. A producer can therefore ship a new event
    type before analytics is upgraded without taking 400s in production.
    """
    record = {
        "id": store.new_id("evt"),
        "type": evt.type,
        "subject_id": evt.subject_id,
        "source": evt.source,
        "payload": evt.payload,
        "occurred_at": evt.occurred_at or store.now(),
        "received_at": store.now(),
        "known_type": evt.type in EVENT_TYPES,
    }
    data = store.read()
    data["events"].append(record)
    if len(data["events"]) > MAX_EVENTS:
        data["events"] = data["events"][-MAX_EVENTS:]  # evict oldest
    store.write(data)
    return {"accepted": True, "id": record["id"], "known_type": record["known_type"]}


@app.get("/api/v1/events")
def list_events(type: Optional[str] = None, subject_id: Optional[str] = None, limit: int = 100):
    events = store.read()["events"]
    if type:
        events = [e for e in events if e["type"] == type]
    if subject_id:
        events = [e for e in events if e["subject_id"] == subject_id]
    return list(reversed(events[-min(limit, 1000):]))


@app.get("/api/v1/summary")
def summary():
    return summarize(store.read()["events"])


@app.get("/api/v1/trends")
def trends(days: int = 7):
    days = max(1, min(days, 90))
    return {"days": days, "series": trend(store.read()["events"], days)}


@app.get("/analytics")
def analytics(days: int = 7):
    """Flat alias returning CHART-READY data.

    The canonical endpoints return arrays of objects; this returns parallel
    labels/values/colors arrays a charting library consumes directly. Saves
    every frontend the same .map() boilerplate and keeps chart colours
    consistent across clients by deciding them server-side.
    """
    days = max(1, min(days, 90))
    events = store.read()["events"]
    s, series = summarize(events), trend(events, days)

    return {
        "generated_at": store.now(),
        "window_days": days,
        "kpis": {
            "reported": s["totals"]["reported"],
            "collected": s["totals"]["collected"],
            "outstanding": s["totals"]["outstanding"],
            "collection_rate": s["collection_rate"],
            "avg_resolution_minutes": s["resolution_minutes"]["mean"],
            "p90_resolution_minutes": s["resolution_minutes"]["p90"],
            "active_workers": len(s["worker_activity"]),
            "notifications_sent": s["totals"]["notifications_sent"],
        },
        "charts": {
            "daily_activity": {
                "type": "line",
                "labels": [d["date"] for d in series],
                "datasets": [
                    {"label": "Reported", "values": [d["reported"] for d in series], "color": "#2563eb"},
                    {"label": "Collected", "values": [d["collected"] for d in series], "color": "#16a34a"},
                ],
            },
            "waste_mix": {
                "type": "pie",
                "labels": [w["type"] for w in s["waste_mix"]],
                "values": [w["count"] for w in s["waste_mix"]],
                "colors": [TYPE_COLORS.get(w["type"], "#78716c") for w in s["waste_mix"]],
            },
            "worker_leaderboard": {
                "type": "bar",
                "labels": [w["worker_id"] for w in s["worker_activity"]],
                "datasets": [
                    {"label": "Collected", "values": [w["collected"] for w in s["worker_activity"]], "color": "#16a34a"},
                    {"label": "Assigned", "values": [w["assigned"] for w in s["worker_activity"]], "color": "#94a3b8"},
                ],
            },
            "status_breakdown": {
                "type": "bar",
                "labels": ["Collected", "Outstanding"],
                "values": [s["totals"]["collected"], s["totals"]["outstanding"]],
                "colors": ["#16a34a", "#ca8a04"],
            },
        },
        "summary": s,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8004)))

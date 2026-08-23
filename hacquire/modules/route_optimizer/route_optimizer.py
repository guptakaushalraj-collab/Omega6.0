"""route_optimizer — :8003 — SOLD ($28,000)

Sequences collection stops into a short round and computes distance matrices.

SELF-CONTAINED BY DESIGN. This single file is the whole module. Pure
computation: no datastore, no outbound dependencies, no coordination between
replicas. Scales horizontally for free, which is why it is worth more to an
operator with real routing volume than to us.

Run standalone:      uvicorn route_optimizer:app --port 8003
Needs:               fastapi  uvicorn  pydantic
Env:                 PORT (default 8003)
"""
import json as _json
import math
import os
from typing import Any, Optional

from fastapi import APIRouter, FastAPI, HTTPException, Query, Request
from pydantic import BaseModel, Field, field_validator

APP_VERSION = "1.0.0"
MAX_STOPS = 200
EARTH_RADIUS_KM = 6371.0
DEFAULT_START = {"lat": 12.9716, "lng": 77.5946}  # Bengaluru city centre

router = APIRouter()


class Point(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)


class Stop(BaseModel):
    """Only `location` is required. Every other field you send is passed
    through untouched onto the sequenced result, so callers can attach their
    own bin_id / waste_type / address and read them straight back off."""
    model_config = {"extra": "allow"}
    id: Optional[str] = None
    location: Point


class OptimizeRequest(BaseModel):
    start: Point
    stops: list[Stop]
    refine: bool = True

    @field_validator("stops")
    @classmethod
    def _cap(cls, v):
        if len(v) > MAX_STOPS:
            raise ValueError(f"stops exceeds the {MAX_STOPS}-stop limit")
        return v


def haversine_km(a: dict, b: dict) -> float:
    d_lat = math.radians(b["lat"] - a["lat"])
    d_lng = math.radians(b["lng"] - a["lng"])
    h = (math.sin(d_lat / 2) ** 2
         + math.cos(math.radians(a["lat"])) * math.cos(math.radians(b["lat"]))
         * math.sin(d_lng / 2) ** 2)
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(h))


def _tour_length(start: dict, order: list[dict]) -> float:
    total, cur = 0.0, start
    for s in order:
        total += haversine_km(cur, s["location"])
        cur = s["location"]
    return total


def _nearest_neighbour(start: dict, stops: list[dict]) -> list[dict]:
    remaining, order, cur = list(stops), [], start
    while remaining:
        best = min(range(len(remaining)),
                   key=lambda i: haversine_km(cur, remaining[i]["location"]))
        nxt = remaining.pop(best)
        order.append(nxt)
        cur = nxt["location"]
    return order


def _two_opt(start: dict, order: list[dict], max_passes: int = 40):
    """Reverse any segment where doing so shortens the tour.

    Nearest-neighbour alone characteristically leaves self-crossings; 2-opt
    removes them, typically buying 10-25% on realistic stop sets. Treated as
    an OPEN tour — the round ends at the last stop, matching how a shift
    actually ends, so the return leg is not counted.
    """
    if len(order) < 3:
        return order, 0

    best, best_len, passes, improved = order[:], _tour_length(start, order), 0, True
    while improved and passes < max_passes:
        improved, passes = False, passes + 1
        for i in range(len(best) - 1):
            for k in range(i + 1, len(best)):
                cand = best[:i] + best[i:k + 1][::-1] + best[k + 1:]
                cand_len = _tour_length(start, cand)
                if cand_len < best_len - 1e-9:
                    best, best_len, improved = cand, cand_len, True
    return best, passes


def optimize(start: dict, stops: list[dict], refine: bool = True) -> dict:
    if not stops:
        return {"stops": [], "total_distance_km": 0.0,
                "strategy": "empty", "two_opt_passes": 0, "improvement_km": 0.0}

    greedy = _nearest_neighbour(start, stops)
    greedy_len = _tour_length(start, greedy)
    order, passes = _two_opt(start, greedy) if refine else (greedy, 0)
    final_len = _tour_length(start, order)

    sequenced, cur, cumulative = [], start, 0.0
    for i, stop in enumerate(order):
        leg = haversine_km(cur, stop["location"])
        cumulative += leg
        cur = stop["location"]
        sequenced.append({**stop, "sequence": i + 1,
                          "leg_distance_km": round(leg, 2),
                          "cumulative_distance_km": round(cumulative, 2)})

    return {
        "stops": sequenced,
        "total_distance_km": round(final_len, 2),
        "strategy": "nearest-neighbor + 2-opt" if refine else "nearest-neighbor",
        "two_opt_passes": passes,
        # Quantifies what 2-opt bought over the greedy tour — useful evidence
        # in a procurement conversation.
        "improvement_km": round(greedy_len - final_len, 2),
    }


def _parse_latlng(value: str) -> Optional[dict]:
    parts = value.split(",")
    if len(parts) != 2:
        return None
    try:
        lat, lng = float(parts[0]), float(parts[1])
    except ValueError:
        return None
    if abs(lat) > 90 or abs(lng) > 180:
        return None
    return {"lat": lat, "lng": lng}


@router.get("/api/v1/health")
def health():
    return {"ok": True, "module": "route_optimizer", "version": APP_VERSION}


@router.post("/api/v1/optimize")
def optimize_route(body: OptimizeRequest):
    stops = [{**s.model_dump(), "location": s.location.model_dump()} for s in body.stops]
    return optimize(body.start.model_dump(), stops, body.refine)


@router.post("/api/v1/distance-matrix")
def distance_matrix(points: list[Point]):
    if not points:
        raise HTTPException(400, "points must be a non-empty array")
    if len(points) > MAX_STOPS:
        raise HTTPException(413, f"points exceeds the {MAX_STOPS}-point limit")
    pts = [p.model_dump() for p in points]
    return {"unit": "km", "points": len(pts),
            "matrix": [[round(haversine_km(a, b), 4) for b in pts] for a in pts]}


def _coerce_stops(entries: list) -> list[dict]:
    """Accept the several shapes a caller might reasonably send.

    ["12.97,77.59"] · [{"lat":..,"lng":..}] · [{"id":..,"location":"lat,lng"}] ·
    [{"id":..,"location":{"lat":..,"lng":..}}] — extra keys pass through onto
    the sequenced result untouched.
    """
    stops: list[dict] = []
    for i, entry in enumerate(entries):
        loc = None
        extra: dict[str, Any] = {}
        if isinstance(entry, str):
            loc = _parse_latlng(entry)
        elif isinstance(entry, dict):
            extra = {k: v for k, v in entry.items() if k != "location"}
            if "lat" in entry and "lng" in entry:
                loc = {"lat": float(entry["lat"]), "lng": float(entry["lng"])}
            elif isinstance(entry.get("location"), str):
                loc = _parse_latlng(entry["location"])
            elif isinstance(entry.get("location"), dict):
                loc = {"lat": float(entry["location"]["lat"]),
                       "lng": float(entry["location"]["lng"])}
        if loc is None:
            raise HTTPException(400, {
                "error": f"bins[{i}] has no usable coordinates",
                "hint": ("This module is stateless and cannot resolve bin ids. "
                         "Fetch coordinates from bin_reporting (GET /api/v1/reports/{id}), "
                         "or use worker_dashboard's GET /v1/workers/{id}/queue, which "
                         "resolves and sequences in one call."),
            })
        stops.append({**extra, "id": extra.get("id") or f"stop_{i+1}", "location": loc})
    return stops


def _sequence(entries: list, start, refine: bool) -> dict:
    """Shared body of both flat aliases, so GET and POST cannot drift."""
    if not isinstance(entries, list):
        raise HTTPException(400, "bins must be a JSON array")
    if len(entries) > MAX_STOPS:
        raise HTTPException(413, f"bins exceeds the {MAX_STOPS}-stop limit")

    stops = _coerce_stops(entries)

    start_pt, defaulted = DEFAULT_START, True
    if start is not None:
        parsed_start = _parse_latlng(start) if isinstance(start, str) else None
        if parsed_start is None and isinstance(start, dict):
            try:
                parsed_start = {"lat": float(start["lat"]), "lng": float(start["lng"])}
            except (KeyError, TypeError, ValueError):
                parsed_start = None
        if parsed_start is None:
            raise HTTPException(400, 'start must be "lat,lng" or {"lat":..,"lng":..}')
        start_pt, defaulted = parsed_start, False

    result = optimize(start_pt, stops, refine)
    return {"start": start_pt, "start_defaulted": defaulted,
            "order": [s["id"] for s in result["stops"]], **result}


class OptimizeIn(BaseModel):
    """Flat alias shape — `bins` takes any of the forms _coerce_stops accepts."""
    bins: list = Field(default_factory=list)
    start: Any = Field(None, examples=["12.972,77.595"])
    refine: bool = True


@router.post("/optimize")
def optimize_alias(body: OptimizeIn):
    """Sequence a set of stops into a short round.

    POST twin of GET /optimizeRoute, for callers with more stops than fit
    comfortably in a query string — a URL has a practical ceiling around 2 KB
    and 200 coordinate pairs blow straight through it. Same parsing, same
    response, shared implementation.

    Still stateless: `bins` must carry COORDINATES. This module cannot resolve
    a bin id without calling bin_reporting, which would forfeit the
    dependency-free property that makes it the registry's cleanest asset.
    """
    if not body.bins:
        raise HTTPException(400, 'bins must be a non-empty array of coordinates')
    return _sequence(body.bins, body.start, body.refine)


@router.get("/optimizeRoute")
def optimize_route_alias(
    bins: str = Query(..., description='JSON array: [{"lat":..,"lng":..}] or ["lat,lng"]'),
    start: Optional[str] = None,
    refine: bool = True,
):
    """Flat alias over POST /api/v1/optimize.

    `bins` must carry COORDINATES. This module is stateless and dependency-free
    — that is its main selling point — so it cannot resolve a bare bin id like
    "bin_1fab6e" to a location. Doing so would require calling bin_reporting
    and forfeit that property.
    """
    try:
        parsed = _json.loads(bins)
    except _json.JSONDecodeError:
        raise HTTPException(400, 'bins must be a JSON array, e.g. bins=[{"lat":12.97,"lng":77.59}]')
    if not isinstance(parsed, list):
        raise HTTPException(400, "bins must be a JSON array")
    if len(parsed) > MAX_STOPS:
        raise HTTPException(413, f"bins exceeds the {MAX_STOPS}-stop limit")

    return _sequence(parsed, start, refine)


@router.get("/", include_in_schema=False)
def index(request: Request):
    """Root index.

    Exists because a bare `GET /` otherwise returns {"detail": "Not Found"} —
    the first thing anyone does with a new service is open its root in a
    browser, and a bare 404 tells them nothing about whether the thing is even
    running.

    Route list is derived from `router.routes`, not hand-written, so it cannot
    drift as routes are added. `mounted_at` comes from the request path, so the
    links are correct whether this runs standalone on its own port or behind a
    prefix inside the composed app.
    """
    base = request.url.path.rstrip("/")
    paths = sorted({r.path for r in router.routes
                     if getattr(r, "path", None) and r.path != "/"})
    return {
        "module": "route_optimizer",
        "version": APP_VERSION,
        "position": "SOLD $28,000 — stop sequencing",
        "status": "running",
        "docs": "/docs",
        "openapi": "/openapi.json",
        "mounted_at": base or "/",
        "routes": [base + p for p in paths],
    }


# --------------------------------------------------------------- packaging
# TWO DEPLOYMENT SHAPES, ONE IMPLEMENTATION.
#
#   router — mount into any FastAPI app:
#              app.include_router(router, prefix="/route")
#   app    — run this module as its own service:
#              uvicorn route_optimizer:app --port 8003
#
# The router is the unit of COMPOSITION; the app is the unit of SALE. Exposing
# both means the single-process monolith and the six-service network are the
# same code, so choosing one deployment today does not foreclose the other —
# and a buyer still receives a service, not a fragment of ours.
app = FastAPI(title="route_optimizer", version=APP_VERSION)
app.include_router(router)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8003)))

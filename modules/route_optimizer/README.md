# route_optimizer

Sequences a worker's collection stops into a short route, and computes
distance matrices.

- **Port** 4103 · **Base path** `/api/v1` · **Auth** none
- **Origin** in-house (MIT, transferable)
- **Dependencies** none — pure computation, no datastore, no outbound calls

## Run

```bash
npm install
npm start           # :4103
```

## Endpoints

### `POST /api/v1/optimize`

Request — see [`samples/request-optimize.json`](./samples/request-optimize.json):

```json
{
  "start": { "lat": 12.9716, "lng": 77.5946 },
  "stops": [
    { "id": "bin_a", "location": { "lat": 12.9784, "lng": 77.6408 } },
    { "id": "bin_b", "location": { "lat": 12.9611, "lng": 77.6387 } }
  ],
  "refine": true
}
```

Each stop needs only `location`; every other field you send is **passed
through untouched** onto the sequenced result, so you can attach your own
`bin_id`, `waste_type`, `address` and read them straight back off the route.

`refine` (default `true`) toggles the 2-opt pass — set `false` for the raw
greedy tour when you need the lowest possible latency.

Response `200`:

```json
{
  "stops": [
    {
      "id": "bin_a",
      "location": { "lat": 12.9784, "lng": 77.6408 },
      "sequence": 1,
      "leg_distance_km": 5.12,
      "cumulative_distance_km": 5.12
    }
  ],
  "total_distance_km": 7.34,
  "strategy": "nearest-neighbor + 2-opt",
  "two_opt_passes": 3,
  "improvement_km": 1.08
}
```

`improvement_km` reports how much 2-opt saved over the greedy tour — useful
for justifying the module's value in a procurement conversation.

Errors: `400` malformed `start`/`stops` (the message names the offending
index) · `413` over 200 stops.

### `POST /api/v1/distance-matrix`

`{ "points": [{lat,lng}, ...] }` → symmetric all-pairs matrix in km. Use this
when you want to run your own solver and just need the geography.

### `POST /api/v1/distance`

`{ "from": {lat,lng}, "to": {lat,lng} }` → single great-circle distance.

### `GET /api/v1/health`

## Algorithm

Greedy nearest-neighbor to build an initial tour, then **2-opt** refinement:
repeatedly reverse any segment where doing so shortens the route. Nearest
neighbor alone is fast but characteristically leaves self-crossings; 2-opt
removes them, typically buying 10–25% on realistic stop sets.

Treated as an **open tour** — the route ends at the last stop and the return
leg to the depot is not counted, matching how collection rounds actually end
(shift over, vehicle parked at or near the last stop).

This is a heuristic, not an exact TSP solve. At the scale of one worker's
daily round (typically under 30 stops) the gap to optimal is small and the
runtime stays in single-digit milliseconds. The `MAX_STOPS = 200` cap exists
because 2-opt is O(n²) per pass — beyond that, batch into multiple rounds or
move to a dedicated solver.

## Configuration

Copy `.env.example` to `.env` and edit; the module loads it via Node's
built-in `process.loadEnvFile` (no dependency added). Real environment
variables take precedence over `.env`.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4103` | Port to listen on |

No outbound dependencies and no state — there is nothing else to configure.

## Mock data

This module is stateless, so `mocks/scenarios.json` holds five solvable
routing scenarios rather than records to load:

| Scenario | Exercises |
|---|---|
| `single_stop` | Degenerate case — no ordering decision |
| `typical_round` | Six central stops; a normal morning round |
| `crossing_path` | Built so greedy self-crosses — 2-opt must report non-zero `improvement_km` |
| `wide_spread` | Far-flung stops ~30 km apart |
| `empty` | Must return an empty route, **not** an error |

```bash
curl -X POST http://localhost:4103/api/v1/optimize \
  -H 'Content-Type: application/json' \
  -d "$(python3 -c "import json;print(json.dumps(json.load(open('mocks/scenarios.json'))[1]['request']))")"
```

## Notes for a buyer

No state and no dependencies, so it scales horizontally with zero
coordination — run as many replicas as you like behind a load balancer.
Distances are great-circle, **not** road distances: if you need
turn-by-turn accuracy, keep this module's sequencing and substitute a road
network provider for `haversineKm` in `src/optimize.js`. The published
response contract is unaffected by that swap.

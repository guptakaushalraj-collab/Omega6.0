# worker_dashboard  *(acquired)*

Field workforce roster and assignment lifecycle: register workers, dispatch
the nearest available one to a job, track it through to completion, and serve
each worker a sequenced queue.

- **Port** 4106 · **Base path** `/v1` · **Auth** `Authorization: Bearer <token>`
- **Origin** **acquired** from FieldOps Software Ltd., 2025-11-02
- **Product** FieldOps Crew API v3.1.0 (v3.0.4 at acquisition)
- **Licence** Proprietary — perpetual, transferable · source code in escrow
- **Dependencies** three, all optional and degrading

## Why this module looks different

Bought, not built — and it keeps FieldOps' conventions: `/v1` base path,
Bearer auth, `snake_case`, and a flat `{ error, detail }` envelope (note this
differs even from the *other* acquired module, which uses
`{ error: { code, message } }` — two vendors, two houses).

More importantly, the **vocabulary is deliberately domain-neutral**. Jobs are
`job_ref`, not `bin_id`; the module has no concept of waste. FieldOps sells
the same product into field service, logistics and utilities. Preserving that
generality is what keeps its resale value beyond waste collection, so callers
pass a bin id *as* a `job_ref` and keep waste semantics on their own side.

## Run

```bash
npm install
npm start    # :4106, standalone — dependencies unset, all features degrade
```

Fully wired:

```bash
ROUTE_OPTIMIZER_URL=http://localhost:4103 \
NOTIFICATION_URL=http://localhost:4105 \
NOTIFY_API_KEY=dev-signalpost-key \
ANALYTICS_URL=http://localhost:4104 \
CREW_AUTH_TOKEN=dev-fieldops-token \
npm start
```

`GET /v1/health` reports which dependencies are configured.

## Authentication

```bash
curl -H "Authorization: Bearer dev-fieldops-token" http://localhost:4106/v1/workers
```

`401` missing/malformed header, `403` wrong token. Health is public.

> `dev-fieldops-token` is a development default. Set `CREW_AUTH_TOKEN` before
> exposing this anywhere real.

## Endpoints

### `POST /v1/workers`

```json
{ "name": "Asha Kumar", "phone": "+91...", "location": { "lat": 12.97, "lng": 77.59 } }
```

### `GET /v1/workers?status=available`

Returns `{ count, workers: [...] }`, each worker annotated with
`open_assignments` and `completed_assignments`.

### `PATCH /v1/workers/:id`

`{ "status": "available" | "busy" | "off_shift" }` and/or `{ "location": {...} }`.

### `POST /v1/assignments`

Dispatches the **nearest available** worker. See
[`samples/request-assignment.json`](./samples/request-assignment.json).

```json
{ "job_ref": "bin_1fab6e6f", "location": { "lat": 12.972, "lng": 77.595 },
  "metadata": { "waste_type": "plastic" } }
```

`201` with the assignment plus a `side_effects` block:

```json
{
  "id": "asg_7b21c9",
  "job_ref": "bin_1fab6e6f",
  "worker_id": "wrk_88a1",
  "worker_name": "Asha Kumar",
  "distance_km": 2.04,
  "status": "assigned",
  "side_effects": { "notification": "sent", "analytics": "recorded" }
}
```

When a dependency is down you get `"notification": "skipped:unreachable"` and
the assignment still succeeds. `metadata` is passed through untouched — it is
where a waste-domain caller parks `waste_type`.

Errors: `400` missing `job_ref`/`location` · `409 duplicate_job` (an open
assignment already exists for that ref) · `503 no_workers_available`.

### `PATCH /v1/assignments/:id`

`{ "status": "in_progress" | "completed" }`. On `completed` the module fires
citizen + admin notifications and a `bin.collected` analytics event, and frees
the worker — but **only if this was their last open job**, so a worker holding
several stops is not flipped back to `available` prematurely.

Completed assignments are immutable: re-patching returns `409 already_completed`.

### `GET /v1/workers/:id/queue`

Open jobs, sequenced via `route_optimizer`:

```json
{ "worker_id": "wrk_88a1", "optimized": true,
  "strategy": "nearest-neighbor + 2-opt", "total_distance_km": 7.34,
  "stops": [ { "job_ref": "bin_a", "sequence": 1, "leg_distance_km": 2.04 } ] }
```

**Degraded** (optimizer unreachable) — still a useful answer, not an error:

```json
{ "worker_id": "wrk_88a1", "optimized": false,
  "degraded_reason": "unreachable", "total_distance_km": null,
  "stops": [ { "job_ref": "bin_a", "location": {...} } ] }
```

Always check `optimized` before relying on `stops` order.

### `GET /v1/health`

Also reports resolved dependency URLs and the timeout — the fastest way to
diagnose a misconfigured deployment.

## Dependencies and degradation

| Capability | Env var | If unavailable |
|---|---|---|
| `route.optimize` | `ROUTE_OPTIMIZER_URL` | Queue returns unordered stops, `optimized: false` |
| `notify.send` | `NOTIFICATION_URL` | Assignment succeeds, `side_effects` says `skipped:<reason>` |
| `analytics.ingest` | `ANALYTICS_URL` | Assignment succeeds, metrics lose a data point |

All three are **optional**. Unset them and the module runs standalone with
those features degraded — never failed. Every outbound call has a hard
timeout (`DEPENDENCY_TIMEOUT_MS`, default 2500 ms) so a slow dependency cannot
become a slow response. See `src/clients.js`.

Note that `src/clients.js` carries the adaptation for the *other* acquired
module: it translates this module's vocabulary into SignalPost's
(`X-API-Key`, `recipient_type`/`body`/`subject_ref`). That translation belongs
at the call site, not inside either purchased module.

## Notes for a buyer

The highest-value module in the registry — the only one with an escrowed
source agreement, and the only one whose vocabulary is vertical-agnostic, so
it resells outside waste collection without modification.

Dispatch is nearest-available-worker by great-circle distance. It does **not**
model shift hours, vehicle capacity, skills, or working time rules. For
regulated workforces you will need to extend the selection logic in
`POST /v1/assignments`; the surrounding lifecycle, auth and degradation
machinery is unaffected by that change.

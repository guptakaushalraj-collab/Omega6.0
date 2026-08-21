# bin_reporting

Citizen-facing intake for overflowing bins. Accepts a photo and location,
orchestrates classification and dispatch, and owns the bin record.

- **Port** 4101 · **Base path** `/api/v1` · **Auth** none (public intake)
- **Origin** in-house (MIT, transferable)
- **Dependencies** three, all optional and degrading

## Run

```bash
npm install
npm start    # :4101, standalone — becomes a pure intake log
```

Fully wired:

```bash
WASTE_RECOGNITION_URL=http://localhost:4102 \
WORKER_DASHBOARD_URL=http://localhost:4106 \
CREW_AUTH_TOKEN=dev-fieldops-token \
ANALYTICS_URL=http://localhost:4104 \
npm start
```

## Design: persist first, enrich after

A citizen's report is written to disk **before** any dependency is called.
Classification and dispatch are enrichments layered on afterwards, each
independently degradable.

This ordering is the whole point. A member of the public standing next to an
overflowing bin must never lose their submission because an internal service
is down. Whatever fails, the report survives and the response tells you
exactly what was skipped.

## Endpoints

### `POST /api/v1/reports`

Multipart (browsers) — see [`samples/request-report.md`](./samples/request-report.md):

```bash
curl -X POST http://localhost:4101/api/v1/reports \
  -F "photo=@bin.jpg" \
  -F "lat=12.972" -F "lng=77.595" \
  -F "address=MG Road bus stop" \
  -F "reporter_name=Asha"
```

Or JSON (no photo — skips classification):

```bash
curl -X POST http://localhost:4101/api/v1/reports \
  -H 'Content-Type: application/json' \
  -d '{"lat":12.972,"lng":77.595,"address":"MG Road","auto_assign":true}'
```

`201` — see [`samples/response-report.json`](./samples/response-report.json):

```json
{
  "report": {
    "id": "bin_1fab6e6fa493",
    "location": { "lat": 12.972, "lng": 77.595 },
    "address": "MG Road bus stop",
    "photo_url": "/uploads/1787316473129-a1b2c3d4.jpg",
    "waste_type": "plastic",
    "classification": { "type": "plastic", "confidence": 0.86, "...": "..." },
    "status": "assigned",
    "assignment": {
      "assignment_id": "asg_7b21c9",
      "worker_id": "wrk_88a1",
      "worker_name": "Asha Kumar",
      "distance_km": 2.04
    },
    "reported_at": "2026-08-21T13:47:53.136Z",
    "cleared_at": null
  },
  "degraded": null
}
```

**Always check `degraded`.** It is `null` on a fully successful intake, or an
object naming what was skipped and why:

```json
{ "degraded": { "classification": "unreachable", "assignment": "no_workers_available" } }
```

Reasons: `not_configured`, `unreachable`, `timeout`, `upstream_<status>`,
`no_photo_supplied`, `no_workers_available`. Note the last is a *real*
answer — every worker is busy — not an outage, and is reported distinctly
from `upstream_503`.

`auto_assign` defaults to `true`; set `false` to log without dispatching.
Errors: `400` invalid coordinates · `413` photo over 8 MB · `500` non-image upload.

### `POST /api/v1/reports/:id/reclassify`

Backfills a classification skipped at intake. This is the recovery path that
makes degrading on classification safe rather than lossy — sweep for
`waste_type: null` after an outage and replay.

`404` no such report · `422` no photo · `410` photo no longer on disk ·
`503` classifier still down.

### `GET /api/v1/reports?status=&waste_type=&limit=`

`{ "count": n, "reports": [...] }`, newest first, `limit` ≤500.

### `PATCH /api/v1/reports/:id/status`

`{ "status": "reported" | "assigned" | "in_progress" | "cleared" }`.

Normally the lifecycle is driven by `worker_dashboard` completing the
assignment. This endpoint is for manual correction, and for operators running
`bin_reporting` without a dispatch module.

### `GET /api/v1/health`

Reports resolved dependency URLs — the fastest way to spot a misconfigured
deployment.

## Dependencies and degradation

| Capability | Env var | If unavailable |
|---|---|---|
| `waste.classify` | `WASTE_RECOGNITION_URL` | Stored unclassified; recover via `/reclassify` |
| `workforce.dispatch` | `WORKER_DASHBOARD_URL` | Stays `reported`; dispatch later |
| `analytics.ingest` | `ANALYTICS_URL` | Report succeeds; metrics lose a point |

With none configured, this module is a self-contained bin intake log — still
useful, and the minimum a buyer gets with no other purchase.

`src/clients.js` carries the adaptation for the acquired `worker_dashboard`:
Bearer auth, `snake_case`, and its domain-neutral vocabulary (our bin id
becomes its `job_ref`). That translation lives here, at the call site, so the
purchased module stays unmodified and therefore resaleable.

## Notes for a buyer

Intake is unauthenticated by design — it is a public civic reporting surface.
Before public deployment put rate limiting and abuse protection in front of
`POST /api/v1/reports`; neither is included, and photo upload is an obvious
abuse vector.

Photos are stored on local disk under `uploads/`. For multi-instance
deployment, substitute object storage in the multer `diskStorage` config in
`src/server.js` — `photo_url` is already an indirection, so nothing
downstream changes.

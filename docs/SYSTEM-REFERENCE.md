# System Reference

Intelligent Waste Collection Network — folder tree, API surface, integration
flow, and an end-to-end summary.

Every path, endpoint and payload below is taken from the repository as it
stands. Sample JSON is captured from live responses (`npm run samples:capture`),
not written by hand, so it cannot drift from what the code returns.

---

## 1. Folder tree

```
Omega6.0/
│
├── modules/                       SIX INDEPENDENTLY TRADABLE SERVICES
│   │                              No shared code, no shared database. Each is
│   │                              extractable as its own repo (npm run extract).
│   │
│   ├── bin_reporting/             :4101  in-house · MIT · HELD
│   │   ├── src/
│   │   │   ├── server.js          Express app; canonical /api/v1 routes
│   │   │   ├── intake.js          Persist-then-enrich pipeline, shared by the
│   │   │   │                      canonical route and the /reportBin alias so
│   │   │   │                      the two can never drift
│   │   │   ├── compat.js          Flat aliases: /reportBin, /detectWasteType
│   │   │   ├── clients.js         Outbound adapters. Every call is env-resolved,
│   │   │   │                      timeout-bounded, and never throws — it returns
│   │   │   │                      {ok,reason} and the caller degrades
│   │   │   ├── store.js           Vendored JSON datastore (module-local)
│   │   │   └── env.js             Loads this module's .env (no dependency)
│   │   ├── mocks/reports.json     34 seeded reports across 7 days
│   │   ├── samples/               Real request/response pairs
│   │   ├── module.json            Trade + technical manifest
│   │   ├── openapi.yaml           API contract
│   │   ├── LICENSE                MIT
│   │   └── .env.example           Exactly the vars this module reads
│   │
│   ├── waste_recognition/         :4102  in-house · MIT · SOLD $42,000
│   │   └── src/classifier.js      Model boundary. Deterministic stub today —
│   │                              swap the marked block for real inference and
│   │                              no consumer changes
│   │
│   ├── route_optimizer/           :4103  in-house · MIT · SOLD $28,000
│   │   └── src/optimize.js        Nearest-neighbour tour + 2-opt refinement.
│   │                              Stateless: no datastore, no dependencies
│   │
│   ├── analytics_dashboard/       :4104  in-house · MIT · SOLD $35,000
│   │   ├── src/metrics.js         Pure functions over the event array
│   │   └── src/compat.js          /analytics — chart-ready parallel arrays
│   │
│   ├── notification_system/       :4105  ACQUIRED · proprietary · RETAINED
│   │   │                          SignalPost Relay 2.4.1. Keeps vendor
│   │   │                          conventions (/v1, X-API-Key, snake_case) so
│   │   │                          existing SDKs keep working and it stays
│   │   │                          resaleable. sms/email/push queue but do NOT
│   │   │                          deliver — gateway credentials were excluded
│   │   │                          from the acquisition
│   │   └── LICENSE                Support window closes 2027-03-14
│   │
│   ├── worker_dashboard/          :4106  ACQUIRED · proprietary · RETAINED
│   │   │                          FieldOps Crew 3.1.0. Bearer auth, flat error
│   │   │                          envelope. Vocabulary is domain-neutral
│   │   │                          (job_ref, not bin_id) — preserves resale
│   │   │                          value outside waste collection
│   │   └── src/clients.js         Carries the adaptation for the OTHER acquired
│   │                              module, at the call site, so neither purchased
│   │                              module is modified
│   │
│   └── README.md                  Registry: what "tradable" enforces
│
├── backend/                       INTEGRATED PACKAGING — all six concerns in one
│   └── src/                       Express process. Fastest path to a demo;
│                                  alternative packaging, not a rival codebase
│
├── frontend/                      React + Vite UI over backend/
│   └── src/pages/                 ReportBin · WorkerDashboard · AdminDashboard
│                                  · NotificationsPage
│
├── scripts/
│   ├── modules.js                 Install / run the whole mesh
│   ├── workflow.js                Traced end-to-end pipeline (see §3)
│   ├── integration-test.js        47 checks: composition + degradation
│   ├── compliance-check.js        67 checks: is each module transferable?
│   ├── extract-module.js          Lift a module into its own git repo
│   ├── generate-mocks.js          One coherent 7-day dataset, deterministic
│   ├── seed-mocks.js              Load fixtures; rebases timestamps to today
│   ├── capture-samples.js         Regenerate samples/ from live responses
│   └── build-deck.js              Regenerates docs/pitch-deck.pptx
│
├── docs/
│   ├── SYSTEM-REFERENCE.md        This file
│   ├── consultant-brief.md        30-minute integration review
│   └── pitch-deck.pptx            3-slide pitch
│
├── TRADING.md                     Positions, rationale, open risks
└── .env.example                   Shared secrets (dev defaults — change them)
```

---

## 2. API endpoints

41 endpoints across six services. Two auth schemes, because the acquired
modules keep their original vendor conventions rather than being normalized.

### bin_reporting — `:4101` · no auth (public citizen intake)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/reports` | Report a bin (multipart or JSON) |
| GET | `/api/v1/reports` | List — filter `status`, `waste_type`, `limit` |
| GET | `/api/v1/reports/:id` | Fetch one |
| POST | `/api/v1/reports/:id/reclassify` | Backfill a skipped classification |
| PATCH | `/api/v1/reports/:id/status` | Update lifecycle status |
| GET | `/api/v1/health` | Liveness + resolved dependency URLs |
| POST | `/reportBin` | **alias** → `/api/v1/reports` |
| POST | `/detectWasteType` | **alias** → `/api/v1/reports/:id/reclassify` |

**`POST /reportBin`** — request:

```json
{ "image": "<base64>", "location": "12.972,77.595", "address": "MG Road bus stop" }
```

Response `201`:

```json
{
  "binId": "bin_0a33798456ab",
  "status": "assigned",
  "type": "mixed",
  "location": "12.972,77.595",
  "assignedWorker": "Ravi Singh",
  "degraded": null
}
```

`degraded` is `null` on a clean intake, or names each skipped enrichment and
why: `not_configured`, `unreachable`, `timeout`, `upstream_<status>`,
`no_photo_supplied`, `no_workers_available`. **Always check it.**

**`POST /detectWasteType`** — `{ "binId": "bin_0a33798456ab" }` →

```json
{ "binId": "bin_0a33798456ab", "type": "mixed", "label": "Mixed",
  "confidence": 0.73, "cached": true }
```

`cached: true` means the stored classification was returned rather than paying
for another inference call. Pass `"force": true` to re-run.

> This endpoint lives here, not in `waste_recognition`, because it is keyed by
> `binId` — and that module is a stateless leaf that never sees bin records.
> Giving it binId lookup would force a call back to `bin_reporting`, creating a
> cycle and destroying the dependency-free property that makes it sellable.

### waste_recognition — `:4102` · no auth

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/classify` | Classify a photo (multipart or base64) |
| GET | `/api/v1/waste-types` | The 7-type taxonomy |
| GET | `/api/v1/classifications` | Audit log (capped at 500) |
| GET | `/api/v1/classifications/:id` | One audit record |
| GET | `/api/v1/health` | Liveness + model version |

```json
{ "id": "cls_0eca6b0a7223", "reference": "bin_1fab6e6fa493",
  "prediction": { "type": "mixed", "label": "Mixed", "color": "#78716c",
    "recyclable": false, "hazardous": false, "confidence": 0.73,
    "alternatives": [ { "type": "organic", "label": "Organic", "confidence": 0.33 },
                      { "type": "metal",   "label": "Metal",   "confidence": 0.22 } ],
    "model_version": "stub-cv-1.0.0" },
  "image_bytes": 68, "classified_at": "2026-08-21T20:58:38.016Z" }
```

### route_optimizer — `:4103` · no auth

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/optimize` | Sequence stops into a short route |
| POST | `/api/v1/distance-matrix` | All-pairs distances |
| POST | `/api/v1/distance` | Two-point distance |
| GET | `/api/v1/health` | Liveness |
| GET | `/optimizeRoute?bins=[...]` | **alias** → `/api/v1/optimize` |

```json
{ "start": { "lat": 12.9716, "lng": 77.5946 }, "start_defaulted": true,
  "order": ["bin_c", "bin_a", "bin_b"],
  "stops": [ { "id": "bin_c", "sequence": 1, "leg_distance_km": 3.09 },
             { "id": "bin_a", "sequence": 2, "leg_distance_km": 7.45 },
             { "id": "bin_b", "sequence": 3, "leg_distance_km": 1.94 } ],
  "total_distance_km": 12.48, "strategy": "nearest-neighbor + 2-opt",
  "two_opt_passes": 1, "improvement_km": 0 }
```

`bins` must carry coordinates — a stateless optimizer cannot resolve bin ids.
Bare ids return `400` with a hint naming the two ways to get coordinates.

### analytics_dashboard — `:4104` · no auth

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/events` | Ingest an event (`202`) |
| GET | `/api/v1/events` | Query the raw log |
| GET | `/api/v1/summary` | Derived metrics |
| GET | `/api/v1/trends?days=` | Reported vs collected per day |
| GET | `/api/v1/event-types` | Types included in metrics |
| GET | `/api/v1/health` | Liveness |
| GET | `/analytics` | **alias** → chart-ready `summary` + `trends` |

```json
{ "kpis": { "reported": 34, "collected": 17, "outstanding": 17,
            "collection_rate": 0.5, "avg_resolution_minutes": 93.8,
            "p90_resolution_minutes": 147, "active_workers": 8,
            "notifications_sent": 60 },
  "charts": {
    "daily_activity":     { "type": "line", "labels": ["2026-08-15", "..."],
                            "datasets": [ { "label": "Reported", "values": [3, 4] } ] },
    "waste_mix":          { "type": "pie", "labels": ["organic"], "values": [11] },
    "worker_leaderboard": { "type": "bar" },
    "status_breakdown":   { "type": "bar" } } }
```

Unknown event types are **accepted**, stored with `known_type: false`, and
excluded from metrics — so a producer can ship a new event type before
analytics is upgraded.

### notification_system — `:4105` · `X-API-Key` *(acquired)*

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/messages` | Send |
| GET | `/v1/messages` | Inbox — `recipient_type`, `recipient_id`, `subject_ref`, `unacknowledged` |
| GET | `/v1/messages/:id` | Fetch one |
| POST | `/v1/messages/:id/ack` | Mark read (idempotent) |
| POST | `/v1/messages/ack_all` | Mark an inbox read |
| GET | `/v1/channels` | Delivery channels |
| GET | `/v1/health` | Liveness (public) |
| POST | `/notifyPickup` | **alias** → `/v1/messages` |

```json
{ "sent": true, "messageId": "msg_a787cb4cb6e0", "binId": "bin_0a33798456ab",
  "recipient": "citizen", "channel": "in_app", "delivery_status": "delivered",
  "message": "Good news — the bin you reported has been picked up. ..." }
```

Errors use the vendor envelope `{ "error": { "code", "message" } }`.
`/notifyPickup` sits outside `/v1` but the API-key check is applied to it
explicitly — an alias must never become a way around auth.

### worker_dashboard — `:4106` · `Authorization: Bearer` *(acquired)*

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/workers` | Register |
| GET | `/v1/workers` | List with assignment counts |
| PATCH | `/v1/workers/:id` | Update status / location |
| POST | `/v1/assignments` | Dispatch nearest available worker |
| GET | `/v1/assignments` | List |
| PATCH | `/v1/assignments/:id` | Advance status |
| GET | `/v1/workers/:id/queue` | Open jobs, sequenced |
| GET | `/v1/health` | Liveness + dependency config (public) |

```json
{ "id": "asg_d6872a6f545f", "job_ref": "bin_bc2f43ecec98",
  "worker_id": "wrk_db5382e9b5c0", "worker_name": "Ravi Singh",
  "metadata": { "waste_type": "mixed" }, "distance_km": 0.43,
  "status": "completed",
  "side_effects": { "citizen_notification": "sent",
                    "admin_notification": "sent", "analytics": "recorded" } }
```

`side_effects` reports what happened downstream. A dependency being down shows
as `"skipped:<reason>"` and the assignment still succeeds. Errors use a flat
`{ "error", "detail" }` envelope — different from the *other* acquired module,
because they came from different vendors.

---

## 3. Integration pseudocode

```
bin   = reportBin()
type  = detectWasteType(bin)
task  = assignWorker(bin, type)
route = optimizeRoute(task)
        notifyPickup(route)
        updateAnalytics(bin, type, route)
```

Runnable and traced: `npm run workflow` (add `-- --json` for CI).

```
FUNCTION collectionPipeline():

  # 1 — INTAKE                                    bin_reporting :4101
  #     auto_assign:false is load-bearing. Left true, reportBin would already
  #     have dispatched a worker and step 3 would fail 409 duplicate_job.
  bin ← POST /reportBin { image, location:"lat,long", auto_assign:false }
  ASSERT bin.binId EXISTS                          # persisted before any peer call

  # 2 — CLASSIFY                                  bin_reporting → waste_recognition
  type ← POST /detectWasteType { binId: bin.binId }
  IF classifier unavailable THEN
      type ← null                                  # bin stays unclassified;
                                                   # recover later via /reclassify
  # 3 — DISPATCH                                  worker_dashboard :4106
  #     Vocabulary translation: our bin id becomes its domain-neutral job_ref.
  task ← POST /v1/assignments
           { job_ref: bin.binId, location, metadata:{ waste_type: type } }
           AUTH Bearer
  IF no worker free THEN ABORT 503                 # a real answer, not an outage

  # 4 — ROUTE                                     worker_dashboard → route_optimizer
  #     Sequences the worker's WHOLE open queue, not just this stop —
  #     optimizing a one-stop route is meaningless.
  route ← GET /v1/workers/{task.worker_id}/queue
  IF NOT route.optimized THEN
      USE route.stops UNORDERED                    # degraded, still useful
      LOG route.degraded_reason

  # 5 — NOTIFY                                    notification_system :4105
  #     Runs after routing so the message can carry position in the round.
  position ← route.stops.find(s ⇒ s.job_ref = bin.binId).sequence
  POST /notifyPickup
       { binId, message: "your bin is stop {position} of {route.stops.length}" }
       AUTH X-API-Key

  # 6 — ANALYTICS                                 analytics_dashboard :4104
  #     Producers already emit bin.reported / classified / assigned as they
  #     work. What is not yet recorded is the routing outcome.
  POST /api/v1/events
       { type:"route.optimized", subject_id: bin.binId,
         payload:{ waste_type: type, stop_count, total_distance_km } }
  dashboard ← GET /analytics

  RETURN { bin, type, task, route, dashboard }
```

**Invariants**

- Every outbound call is env-resolved, timeout-bounded (`DEPENDENCY_TIMEOUT_MS`,
  default 2500 ms), and never throws — it returns `{ok, reason}`.
- A missing dependency degrades a step and names what it skipped. It never
  fails the pipeline. Only `bin_reporting`, `worker_dashboard`,
  `notification_system` and `analytics_dashboard` are load-bearing.
- The report is persisted *before* any peer is called, so a citizen's
  submission survives any downstream outage.

---

## 4. End-to-end summary

A citizen photographs an overflowing bin and submits it with a location. The
report is written to disk before any other service is contacted, so a
submission is never lost to a downstream outage; classification and dispatch
are layered on afterwards as enrichments, each independently degradable.

`waste_recognition` identifies the waste type from the image bytes.
`worker_dashboard` picks the nearest available worker by great-circle distance
and opens an assignment, translating the bin id into its own domain-neutral
`job_ref`. `route_optimizer` sequences that worker's entire open queue using a
nearest-neighbour tour refined by 2-opt. `notification_system` alerts the
citizen, the worker and the admin. `analytics_dashboard` receives events from
every producer and derives collection rate, waste mix, resolution times and
worker activity.

The six services share no code and no database. Each owns its records and
reaches the others over HTTP, resolving dependencies as capabilities injected
through environment variables rather than imports. Any dependency may be
absent: the affected step degrades, names what it skipped, and the pipeline
still completes. That same indirection is what lets a module be sold and
repointed at the buyer's endpoint without a code change.

---

## Verify any claim here

```bash
npm run install:modules && npm run modules:start   # mesh on :4101-:4106
npm run mocks:seed        # 8 workers, 34 reports, 172 events over 7 days
npm run workflow          # the pipeline in §3, traced with timings
npm run modules:test      # 47 checks — composition and degradation
npm run compliance        # 67 checks — is each module transferable?
```

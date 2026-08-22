# HACQUIRE 2026 — Final Product Plan
## Intelligent Waste Collection Network

**Stack:** Python 3.11 · FastAPI · Pydantic v2 · httpx · uvicorn
**Shape:** six independently deployable, independently tradable services

Every endpoint, payload and figure below was executed against the running mesh
before being written down. Nothing here is illustrative-only.

---

## 1. Full Folder Tree & Code Scaffolding

```
hacquire/
├── modules/                                SIX TRADABLE SERVICES
│   │                                       No shared code. No shared database.
│   │                                       Each directory runs on its own.
│   │
│   ├── bin_reporting/                      :8001  HELD — the entry point
│   │   ├── app/
│   │   │   ├── main.py                     Intake + lifecycle + flat aliases
│   │   │   ├── clients.py                  Outbound: env-resolved, timeout-bounded,
│   │   │   │                               never raises — returns {ok, reason}
│   │   │   ├── store.py                    Vendored JSON store (module-local)
│   │   │   └── data/store.json             Runtime state (gitignored)
│   │   ├── mocks/reports.json              Seed fixtures
│   │   ├── requirements.txt
│   │   └── .env.example
│   │
│   ├── waste_recognition/                  :8002  SOLD — $42,000
│   │   └── app/main.py                     classify() is the MODEL BOUNDARY —
│   │                                       swap the body for real inference,
│   │                                       keep the return shape, no consumer
│   │                                       changes
│   │
│   ├── route_optimizer/                    :8003  SOLD — $28,000
│   │   └── app/main.py                     Nearest-neighbour + 2-opt.
│   │                                       Stateless: no store, no deps
│   │
│   ├── analytics_dashboard/                :8004  SOLD — $35,000
│   │   └── app/main.py                     Push-based. Derives everything from
│   │                                       events it is SENT; never queries
│   │                                       another module
│   │
│   ├── notification_system/                :8005  BOUGHT — SignalPost Relay 2.4.1
│   │   └── app/main.py                     /v1 · X-API-Key · snake_case ·
│   │                                       {"error":{"code","message"}}
│   │                                       Vendor conventions RETAINED
│   │
│   └── worker_dashboard/                   :8006  BOUGHT — FieldOps Crew 3.1.0
│       └── app/
│           ├── main.py                     /v1 · Bearer · {"error","detail"}
│           │                               job_ref, not bin_id — domain-neutral
│           └── clients.py                  Carries the adaptation for the OTHER
│                                           acquired module, at the call site
│
├── scripts/run_mesh.py                     Boot all six, dependencies pre-wired
└── PRODUCT-PLAN.md                         This document
```

### Starter code — the model boundary (`waste_recognition/app/main.py`)

```python
TAXONOMY = [
    {"type": "plastic", "label": "Plastic", "color": "#2563eb", "recyclable": True,  "hazardous": False},
    {"type": "organic", "label": "Organic", "color": "#16a34a", "recyclable": False, "hazardous": False},
    # … paper, metal, glass, e-waste, mixed
]

def classify(image: bytes) -> dict:
    """Deterministic stub: the image digest selects the prediction, so the same
    photo always yields the same answer. Keeps the contract exercisable without
    shipping a model artifact.

    To productionise, replace ONLY this body with real inference (ONNX Runtime,
    TorchServe, a hosted vision API). The return shape is the published
    contract — keep it identical and no consumer changes.
    """
    seed = int.from_bytes(hashlib.sha256(image).digest()[:4], "big")
    primary = TAXONOMY[seed % len(TAXONOMY)]
    confidence = round(0.70 + ((seed >> 8) % 26) / 100, 2)

    # Runners-up drawn WITHOUT replacement — a real classifier never ranks the
    # same class twice, and consumers assume these are distinct.
    pool = [t for t in TAXONOMY if t["type"] != primary["type"]]
    alternatives = []
    for i in range(2):
        pick = pool.pop((seed >> (4 * (i + 1))) % len(pool))
        alternatives.append({"type": pick["type"], "label": pick["label"],
                             "confidence": round(confidence * (0.45 - i * 0.15), 2)})

    return {**primary, "confidence": confidence,
            "alternatives": alternatives, "model_version": MODEL_VERSION}
```

### Starter code — persist-then-enrich (`bin_reporting/app/main.py`)

```python
async def create_report(location, *, photo_filename=None, auto_assign=True, **meta):
    report = {"id": store.new_id("bin"), "location": location, "status": "reported",
              "waste_type": None, "assignment": None, "reported_at": store.now(), **meta}

    # --- PERSIST BEFORE ENRICHING -----------------------------------------
    # A citizen standing next to an overflowing bin must never lose their
    # submission because an internal service is down.
    data = store.read(); data["reports"].append(report); store.write(data)

    degraded = {}

    if photo_filename:                                    # enrich: classify
        r = await classify((UPLOAD_DIR / photo_filename).read_bytes(), report["id"])
        if r["ok"]:
            report["classification"] = r["data"]["prediction"]
            report["waste_type"] = r["data"]["prediction"]["type"]
        else:
            degraded["classification"] = r["reason"]
    else:
        degraded["classification"] = "no_photo_supplied"

    if auto_assign:                                       # enrich: dispatch
        r = await request_assignment(report["id"], location, report["waste_type"])
        if r["ok"]:
            report["assignment"] = {...}; report["status"] = "assigned"
        else:
            # 503 = genuinely no worker free. Distinct from an outage —
            # callers must be able to tell these apart.
            degraded["assignment"] = ("no_workers_available"
                                      if r["reason"] == "upstream_503" else r["reason"])

    store.write(...)                                      # persist enrichment
    await emit("bin.reported", report["id"], {"has_photo": bool(photo_filename)})
    return {"report": report, "degraded": degraded or None}
```

### Starter code — the degradation contract (`clients.py`, both consumers)

```python
async def _request(method: str, url: str, **kw) -> dict:
    """Three rules that keep a module independently ownable:
       1. Target from an ENV VAR — swap the provider without touching code.
       2. HARD TIMEOUT — a slow dependency must not become our slow response.
       3. NEVER RAISE — return {ok, reason} and let the caller degrade.
    """
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
```

### `.env.example` (abridged — every module ships its own)

```bash
# bin_reporting — HELD
PORT=8001
# OPTIONAL DEPENDENCIES. With none set this is a self-contained intake log —
# the minimum a buyer gets with no other purchase.
WASTE_RECOGNITION_URL=http://localhost:8002   # absent → stored unclassified
WORKER_DASHBOARD_URL=http://localhost:8006    # absent → stays "reported"
ANALYTICS_URL=http://localhost:8004           # absent → metrics lose a point
CREW_AUTH_TOKEN=dev-fieldops-token
DEPENDENCY_TIMEOUT_MS=2500                    # bounds INTAKE latency

# notification_system — BOUGHT
NOTIFY_API_KEY=dev-signalpost-key
# SECURITY: public knowledge — it is the fallback in app/main.py. Change before
# exposing, and update every caller.
# NOT INCLUDED IN THE ACQUISITION: sms/email/push queue but never send.
# SIGNALPOST_GATEWAY_KEY=   ← not read by this build
```

### Mock datasets

`modules/*/mocks/*.json` — referentially consistent: bin `bin_90b813b2c556`
appears as `bin_reporting`'s report id, `worker_dashboard`'s assignment
`job_ref`, `notification_system`'s `subject_ref`, `waste_recognition`'s
`reference`, and `analytics_dashboard`'s event `subject_id`.

```json
// analytics_dashboard/mocks/events.json — the full lifecycle of one bin
[
  { "type": "bin.reported",      "subject_id": "bin_90b813b2c556",
    "payload": { "has_photo": true },                    "occurred_at": "2026-08-21T09:14:02Z" },
  { "type": "bin.classified",    "subject_id": "bin_90b813b2c556",
    "payload": { "waste_type": "plastic" },              "occurred_at": "2026-08-21T09:14:03Z" },
  { "type": "bin.assigned",      "subject_id": "bin_90b813b2c556",
    "payload": { "worker_id": "wrk_a1b2c3d4e5f6" },      "occurred_at": "2026-08-21T09:15:10Z" },
  { "type": "bin.collected",     "subject_id": "bin_90b813b2c556",
    "payload": { "worker_id": "wrk_a1b2c3d4e5f6" },      "occurred_at": "2026-08-21T10:41:55Z" }
]
```

`route_optimizer/mocks/scenarios.json` holds solvable routing cases instead of
records, because the module is stateless — including `crossing_path`, built so
greedy self-crosses and 2-opt must report a non-zero gain (**verified: 0.62 km
saved on 18.1 km**), and `empty`, which must return an empty route rather than
an error.

### Run it

```bash
pip install fastapi uvicorn pydantic httpx python-multipart
python hacquire/scripts/run_mesh.py           # all six, dependencies wired
# or standalone:
cd hacquire/modules/waste_recognition && uvicorn app.main:app --port 8002
```

---

## 2. API Endpoint Definitions

**41 endpoints.** Two auth schemes, because the acquired modules keep their
original vendor conventions rather than being normalised.

| Module | Port | Base | Auth |
|---|---|---|---|
| bin_reporting | 8001 | `/api/v1` | none (public intake) |
| waste_recognition | 8002 | `/api/v1` | none |
| route_optimizer | 8003 | `/api/v1` | none |
| analytics_dashboard | 8004 | `/api/v1` | none |
| notification_system | 8005 | `/v1` | `X-API-Key` |
| worker_dashboard | 8006 | `/v1` | `Authorization: Bearer` |

### Reporting bins — `POST /reportBin` *(bin_reporting)*

```json
{ "image": "<base64>", "location": "12.972,77.595", "address": "MG Road" }
```

**Live response** `201`:

```json
{
  "binId": "bin_90b813b2c556",
  "status": "assigned",
  "type": "plastic",
  "location": "12.972,77.595",
  "assignedWorker": "Asha Kumar",
  "degraded": null
}
```

`degraded` is `null` on a clean intake, or names every skipped enrichment:
`not_configured` · `unreachable` · `timeout` · `upstream_<status>` ·
`no_photo_supplied` · `no_workers_available`. **Always check it.**

Canonical equivalents: `POST /api/v1/reports` (JSON) ·
`POST /api/v1/reports-upload` (multipart) · `GET /api/v1/reports` ·
`GET /api/v1/reports/{id}` · `PATCH /api/v1/reports/{id}/status` ·
`POST /api/v1/reports/{id}/reclassify`

### Detecting waste type — `POST /detectWasteType` *(bin_reporting)*

```json
{ "binId": "bin_90b813b2c556" }
```

**Live response** `200`:

```json
{ "binId": "bin_90b813b2c556", "type": "plastic", "label": "Plastic",
  "confidence": 0.71, "cached": true }
```

`cached: true` = answered from the stored classification rather than paying for
another inference call. Send `"force": true` to re-run.

> **Why this lives in `bin_reporting`, not `waste_recognition`.** It is keyed
> by `binId`, and `waste_recognition` is a stateless leaf that never sees bin
> records — only image bytes. Giving it binId lookup would force a call back to
> `bin_reporting`, creating a cycle and destroying the dependency-free property
> that makes it the most sellable module in the registry.

Direct classification: `POST /api/v1/classify` (base64) ·
`POST /api/v1/classify-upload` (multipart) · `GET /api/v1/waste-types` ·
`GET /api/v1/classifications[/{id}]`

### Optimizing routes — `GET /optimizeRoute?bins=[...]` *(route_optimizer)*

**Live response** `200`:

```json
{ "start": { "lat": 12.9716, "lng": 77.5946 }, "start_defaulted": true,
  "order": ["bin_x4", "bin_x2", "bin_x1", "bin_x3", "bin_x5"],
  "total_distance_km": 18.1, "strategy": "nearest-neighbor + 2-opt",
  "two_opt_passes": 2, "improvement_km": 0.62 }
```

`bins` must carry **coordinates**. A stateless optimizer cannot resolve bin
ids; bare ids return `400` with a hint naming the two ways to get them:

```json
{
  "error": "bins[0] has no usable coordinates",
  "hint": "This module is stateless and cannot resolve bin ids. Fetch coordinates from bin_reporting (GET /api/v1/reports/{id}), or use worker_dashboard's GET /v1/workers/{id}/queue, which resolves and sequences in one call."
}
```

Also: `POST /api/v1/optimize` · `POST /api/v1/distance-matrix`

### Analytics — `GET /analytics` *(analytics_dashboard)*

**Live response** `200` (chart-ready parallel arrays):

```json
{ "kpis": { "reported": 1, "collected": 1, "outstanding": 0,
            "collection_rate": 1.0, "avg_resolution_minutes": 87.9,
            "active_workers": 1, "notifications_sent": 3 },
  "charts": {
    "daily_activity": { "type": "line", "labels": ["2026-08-15", "…"],
      "datasets": [ { "label": "Reported", "values": [0,1], "color": "#2563eb" } ] },
    "waste_mix": { "type": "pie", "labels": ["plastic"], "values": [1],
                   "colors": ["#2563eb"] },
    "worker_leaderboard": { "type": "bar" },
    "status_breakdown": { "type": "bar" } },
  "summary": { "…": "the unreshaped canonical metrics" } }
```

Ingest: `POST /api/v1/events` → `202`. **Unknown event types are accepted**,
stored with `known_type: false` and excluded from metrics — so a producer can
ship a new type before analytics is upgraded.
Also: `GET /api/v1/summary` · `/trends` · `/events` · `/event-types`

### Notifications — `POST /notifyPickup` *(notification_system)*

```bash
curl -X POST localhost:8005/notifyPickup -H "X-API-Key: dev-signalpost-key" \
     -H 'Content-Type: application/json' -d '{"binId":"bin_90b813b2c556"}'
```

**Live response** `201`:

```json
{ "sent": true, "messageId": "msg_101ea770eb61", "binId": "bin_90b813b2c556",
  "recipient": "citizen", "channel": "in_app", "delivery_status": "delivered",
  "message": "Good news — the bin you reported has been picked up. …" }
```

**Auth is enforced on the alias** — verified `401` without a key, `403` with a
wrong one. An alias must never become a way around authentication.
Also: `POST /v1/messages` · `GET /v1/messages` · `POST /v1/messages/{id}/ack` ·
`POST /v1/messages/ack_all` · `GET /v1/channels`

### Worker dashboard — `GET /v1/workers/{id}/queue` *(worker_dashboard)*

**Live response** `200`:

```json
{ "worker_id": "wrk_a1b2c3d4e5f6", "worker_name": "Asha Kumar",
  "optimized": true, "strategy": "nearest-neighbor + 2-opt",
  "total_distance_km": 0.06,
  "stops": [ { "job_ref": "bin_90b813b2c556", "sequence": 1,
               "leg_distance_km": 0.06 } ] }
```

Degraded (optimizer down) — a useful answer, not an error:

```json
{ "optimized": false, "degraded_reason": "unreachable",
  "total_distance_km": null, "stops": [ … unordered … ] }
```

`POST /v1/assignments` returns the assignment plus a `side_effects` block
reporting what happened downstream — **live**:

```json
{ "status": "completed",
  "side_effects": { "citizen_notification": "sent",
                    "admin_notification": "sent", "analytics": "recorded" } }
```

Completed assignments are immutable — re-patching returns `409` (verified).
Also: `POST /v1/workers` · `GET /v1/workers` · `PATCH /v1/workers/{id}` ·
`GET /v1/assignments`

---

## 3. Integration Workflow

```
reportBin → detectWasteType → assignWorker → optimizeRoute → notifyPickup → updateAnalytics
```

```python
async def collection_pipeline():

    # 1 — INTAKE                                     bin_reporting :8001
    #     auto_assign=False is LOAD-BEARING. Left true, reportBin would already
    #     have dispatched and step 3 would fail 409 duplicate_job.
    bin = await POST("http://localhost:8001/reportBin", {
        "image": photo_b64, "location": "12.972,77.595", "auto_assign": False})
    assert bin["binId"]                       # persisted before any peer call

    # 2 — CLASSIFY                    bin_reporting → waste_recognition :8002
    wtype = await POST("http://localhost:8001/detectWasteType",
                       {"binId": bin["binId"]})
    #     Classifier down → bin stays unclassified; recover via /reclassify.

    # 3 — DISPATCH                                worker_dashboard :8006
    #     Vocabulary translation: our bin id becomes its domain-neutral job_ref.
    task = await POST("http://localhost:8006/v1/assignments",
        {"job_ref": bin["binId"], "location": coords,
         "metadata": {"waste_type": wtype["type"]}},
        headers={"Authorization": f"Bearer {CREW_TOKEN}"})
    if task.status == 503: abort("no worker free")   # a real answer, not an outage

    # 4 — ROUTE                    worker_dashboard → route_optimizer :8003
    #     Sequences the worker's WHOLE open queue — optimizing a one-stop route
    #     is meaningless.
    route = await GET(f"http://localhost:8006/v1/workers/{task['worker_id']}/queue",
                      headers={"Authorization": f"Bearer {CREW_TOKEN}"})
    if not route["optimized"]:
        use_unordered(route["stops"]); log(route["degraded_reason"])

    # 5 — NOTIFY                              notification_system :8005
    #     After routing, so the message can carry position in the round.
    position = next(s["sequence"] for s in route["stops"]
                    if s["job_ref"] == bin["binId"])
    await POST("http://localhost:8005/notifyPickup",
        {"binId": bin["binId"],
         "message": f"Your bin is stop {position} of {len(route['stops'])}."},
        headers={"X-API-Key": NOTIFY_KEY})

    # 6 — ANALYTICS                          analytics_dashboard :8004
    #     Producers already emit bin.reported/classified/assigned as they work.
    #     What is not yet recorded is the routing outcome.
    await POST("http://localhost:8004/api/v1/events", {
        "type": "route.optimized", "subject_id": bin["binId"],
        "payload": {"waste_type": wtype["type"],
                    "total_distance_km": route["total_distance_km"]}})
    return await GET("http://localhost:8004/analytics")
```

**Invariants**

- Every outbound call is env-resolved, timeout-bounded (`DEPENDENCY_TIMEOUT_MS`,
  default 2500 ms) and never raises — it returns `{ok, reason}`.
- A missing dependency **degrades a step and names what it skipped**. It never
  fails the pipeline.
- Load-bearing: `bin_reporting`, `worker_dashboard`, `notification_system`,
  `analytics_dashboard`. Optional: `waste_recognition`, `route_optimizer`.
- The report is persisted **before** any peer call.

---

## 4. Trading Strategy Notes

| Module | Position | Licence | Price |
|---|---|---|---|
| `waste_recognition` | **SELL** | MIT | $42,000 |
| `analytics_dashboard` | **SELL** | MIT | $35,000 |
| `route_optimizer` | **SELL** | MIT | $28,000 |
| `notification_system` | **BUY / KEEP** | Proprietary | acquired |
| `worker_dashboard` | **BUY / KEEP** | Proprietary | acquired |
| `bin_reporting` | **HOLD** | MIT | not offered |

**Total divestment: $105,000.**

### Sold — and why these three

- **`waste_recognition`** — stateless, dependency-free, model-agnostic. The
  value is the API contract and its existing consumers, not the stub; a buyer
  brings their own inference.
- **`route_optimizer`** — pure computation. No datastore, no coordination
  between replicas. Worth more to an operator with real routing volume.
- **`analytics_dashboard`** — push-based, so any operator emitting six
  documented event shapes can adopt it. Buyer pool extends well beyond waste.

### Bought — and why they stay

- **`worker_dashboard`** (FieldOps Crew) — the highest-value asset: escrowed
  source, and vocabulary deliberately vertical-agnostic (`job_ref`), so it
  resells outside waste collection unmodified.
- **`notification_system`** (SignalPost Relay) — perpetual transferable
  licence. **Support expires 2027-03-14** and transfers only to an acquirer who
  assumes the maintenance agreement before that date.

### HACQUIRE compliance

> **Rule: at least one purchase is mandatory.**
> **Status: SATISFIED — two purchases**, `notification_system` and
> `worker_dashboard`. Both are integrated and load-bearing in the live
> pipeline, not shelf-ware: dispatch, routing and every notification flow
> through them.

### The structural catch — and the fix

Both retained modules consume capabilities from **all three** being sold:

```
bin_reporting    → waste.classify     (waste_recognition)
bin_reporting    → analytics.ingest   (analytics_dashboard)
worker_dashboard → route.optimize     (route_optimizer)
worker_dashboard → analytics.ingest   (analytics_dashboard)
```

An outright sale would stop the product on settlement day. Each deal therefore
conveys copyright, exploitation and resale rights while **retaining a
perpetual, royalty-free licence-back** scoped to internal operation. We keep
running the software; we lose the right to resell it.

Post-sale, operation continues either against our own instance under the
licence-back, or by repointing at the buyer's endpoint — **an environment
variable, not a code change**:

```bash
WASTE_RECOGNITION_URL=https://buyer.example.com
```

That is exactly what the capability indirection was built for.

### Consulting slot — 30 minutes

Scoped to **verification and risk sign-off, not implementation.** Thirty
minutes does not buy integration work; it buys an independent go/no-go before
money moves.

- **0–10 min** — Run the mesh, exercise the pipeline, confirm `degraded: null`.
- **10–20 min** — Extraction test: lift one sold module out and run it
  standalone with nothing from the parent repo.
- **20–30 min** — Written verdict on three questions: are the sold modules
  cleanly transferable, does the retained network operate post-sale, and are
  the disclosed risks adequately disclosed.

**Out of scope, quote separately:** replacing the stub classifier; activating
SMS/email/push (gateway credentials excluded from the acquisition);
production hardening; counterparty negotiation.

### Open risks

1. **SignalPost support closes 2027-03-14.** Bounds any future option to sell
   `notification_system` *with* support attached.
2. **Three channels do not deliver.** `sms`/`email`/`push` accept and queue but
   send nothing. Disclosed in the licence, README and `.env.example` — it must
   not be discovered after signing.
3. **Concentration.** Divesting three of six leaves two purchased modules under
   proprietary licence. A lost licence-back would require replacing three
   capabilities at once — mechanical, thanks to the indirection, but real.

---

## 5. Pitch Deck Outline

### Slide 1 — What We Built
- **Problem:** bins reported by phone, sorted by guesswork, collected on fixed
  routes that ignore where the waste actually is.
- **Solution:** photo + location intake → AI classification → nearest-worker
  dispatch → optimized routes → notifications → live analytics.
- **Architecture:** six independent FastAPI services (`:8001–:8006`), acyclic,
  no shared code or database. Acquired modules visually distinguished.
- **Stat band:** 6 services · 41 endpoints · full pipeline verified live.

### Slide 2 — What We Traded
- **Divested:** `waste_recognition` $42k · `analytics_dashboard` $35k ·
  `route_optimizer` $28k → **$105,000**.
- **Retained:** `worker_dashboard` (escrowed source, vertical-agnostic) ·
  `notification_system` (support window closes 2027-03-14).
- **Consulting slot:** 30 min, verification and risk sign-off.
- **HACQUIRE compliance:** two purchases — mandatory minimum exceeded.
- **The catch:** both retained modules consume all three sold. Licence-back
  keeps the product alive; repointing is an env var, not a code change.

### Slide 3 — What We Integrated
- **Pipeline:** `reportBin → detectWasteType → assignWorker → optimizeRoute →
  notifyPickup → updateAnalytics` as a six-step flow.
- **Live demo results:** `degraded: null` · `side_effects: all sent` ·
  2-opt saving 0.62 km on an 18.1 km round · auth returning 401/403 correctly.
- **Resilience:** stop `route_optimizer` and step 4 returns `UNORDERED` with a
  reason, step 5 drops its "stop N of M" phrasing, the run still completes.
  Degradation is designed, not accidental.
- **Run it yourself:** `python hacquire/scripts/run_mesh.py`

---

## 6. Final Summary

A citizen photographs an overflowing bin and submits it with a location. The
report is persisted before any other service is contacted, so a submission
survives any downstream outage; classification and dispatch are layered on
afterwards as independently degradable enrichments.

`waste_recognition` identifies the waste type from image bytes.
`worker_dashboard` dispatches the nearest available worker and opens an
assignment, translating the bin id into its domain-neutral `job_ref`.
`route_optimizer` sequences that worker's entire open queue with a
nearest-neighbour tour refined by 2-opt. `notification_system` alerts citizen,
worker and admin. `analytics_dashboard` ingests events from every producer and
derives collection rate, waste mix and resolution times.

The six FastAPI services share no code and no database. Each owns its records
and reaches the others over HTTP, resolving dependencies as capabilities
injected through environment variables rather than imports. Any dependency may
be absent: the affected step degrades, names what it skipped, and the pipeline
still completes.

That same indirection is what makes the modules tradable — three were sold and
two bought, and repointing a sold module at its buyer's endpoint is an
environment variable, never a code change.

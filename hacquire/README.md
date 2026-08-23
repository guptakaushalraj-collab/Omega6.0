# HACQUIRE 2026 — Intelligent Waste Collection Network

Python / FastAPI. Six independent, individually tradable modules.

**[→ PRODUCT-PLAN.md](./PRODUCT-PLAN.md)** — the full submission: folder tree,
41 endpoints with sample JSON, integration pseudocode, trading strategy,
pitch outline, and end-to-end summary.

## Structure

```
hacquire/
├── main.py                 single-process app — six routers mounted in one FastAPI
├── run_network.py          six-process network — one service per port
├── requirements.txt        one dependency set for the whole network
├── .env.example            every knob, with working defaults
└── modules/
    ├── bin_reporting/bin_reporting.py
    ├── waste_recognition/waste_recognition.py
    ├── route_optimizer/route_optimizer.py
    ├── analytics_dashboard/analytics_dashboard.py
    ├── notification_system/notification_system.py
    └── worker_dashboard/worker_dashboard.py
```

**One module is one file, and every file exposes two things:**

| | | |
|---|---|---|
| `router` | the unit of **composition** | `app.include_router(router, prefix="/waste")` |
| `app` | the unit of **sale** | `uvicorn waste_recognition:app --port 8002` |

Datastore, outbound adapters and HTTP surface all live inside the file;
nothing is imported across a module boundary (verified — zero cross-module
imports, zero relative imports). Composition is not a licence to start
importing across the boundary: even inside one process the modules reach each
other over HTTP, which is what keeps each one sellable. Hand a buyer a single
`.py` and it runs.

Verified by doing exactly that — `route_optimizer.py` copied alone into an
empty directory outside the repo answered `GET /optimizeRoute` correctly.

## Run

```bash
pip install -r requirements.txt
```

**Single process** — everything behind one port, one `/docs`:

```bash
uvicorn main:app --reload           # http://localhost:8000
```

| | |
|---|---|
| `POST /bin/report` | report a bin — short form, `{status, binId, location}` |
| `POST /bin/reportBin` | report a bin — full form, returns the whole record |
| `POST /bin/detect` | `{binId}` → `{type}` — short form |
| `POST /bin/detectWasteType` | `{binId}` → `{type}` |
| `POST /waste/detect` | `{image_base64}` → `{type}` — the classifier itself |
| `GET  /route/optimizeRoute?bins=[...]` | ordered route |
| `GET  /analytics/analytics` | chart-ready data |
| `POST /notify/notifyPickup` | alert the citizen |
| `GET  /` | the registry and the full path map |

**Six processes** — one service per port, the shape the trading positions
assume:

```bash
python run_network.py               # all six, dependencies pre-wired
python run_network.py --reset       # wipe every datastore first
python run_network.py bin_reporting # just one
python run_network.py --list        # the registry, then exit
```

**One module, by hand** — no launcher, no package, no `PYTHONPATH`:

```bash
cd modules/waste_recognition
uvicorn waste_recognition:app --port 8002
```

### Which deployment, and what composition costs

Single-process is simpler to run and demo. It also means one process (a crash
or leak in any module takes down all six), one release and one dependency set
(the three SOLD modules can no longer be deployed, scaled or versioned by
their buyers independently), and prefixed paths (`POST /reportBin` becomes
`POST /bin/reportBin` — breaking for anyone already on the published API).

Because every module exposes both a `router` and an `app`, that choice is not
permanent: the same code runs either way, and the acquired modules keep their
own base paths, auth schemes and error envelopes underneath their prefix.

| Module | Port | Position |
|---|---|---|
| `bin_reporting` | 8001 | HELD |
| `waste_recognition` | 8002 | **SOLD** $42,000 |
| `route_optimizer` | 8003 | **SOLD** $28,000 |
| `analytics_dashboard` | 8004 | **SOLD** $35,000 |
| `notification_system` | 8005 | **BOUGHT** — SignalPost Relay 2.4.1 |
| `worker_dashboard` | 8006 | **BOUGHT** — FieldOps Crew 3.1.0 |

## Verify the pipeline

Distributed ports shown; under `main:app` use `localhost:8000` with the
prefixes above.

```bash
# 1. register a worker
curl -X POST localhost:8006/v1/workers \
  -H "Authorization: Bearer dev-fieldops-token" -H 'Content-Type: application/json' \
  -d '{"name":"Asha Kumar","location":{"lat":12.9716,"lng":77.5946}}'

# 2. report a bin — persists, classifies, dispatches
curl -X POST localhost:8001/reportBin -H 'Content-Type: application/json' \
  -d '{"image":"<base64>","location":"12.972,77.595","address":"MG Road"}'
# → {"binId":"bin_...","status":"assigned","type":"e-waste","degraded":null}

# 3. the worker's sequenced queue
curl -H "Authorization: Bearer dev-fieldops-token" \
  localhost:8006/v1/workers/<worker_id>/queue
# → {"optimized":true,"strategy":"nearest-neighbor + 2-opt","total_distance_km":14.76,...}

# 4. alert the citizen
curl -X POST localhost:8005/notifyPickup -H "X-API-Key: dev-signalpost-key" \
  -H 'Content-Type: application/json' -d '{"binId":"bin_..."}'

# 5. chart-ready analytics
curl localhost:8004/analytics
```

`degraded: null` means every enrichment succeeded. Anything else names what
was skipped and why.

## Design rules

1. **No shared code.** Each module vendors its own `Store` class. No module
   imports another's source — verified against real import statements.
2. **No shared database.** Each owns its records; cross-module data moves over
   HTTP only.
3. **Dependencies are capabilities, not module names.** Providers are injected
   as URLs at runtime, so a sold module can be repointed at its buyer's
   endpoint with an environment variable rather than a code change.
   *Verified:* our `route_optimizer` was stopped, a buyer-hosted copy started
   on another port, and `ROUTE_OPTIMIZER_URL` repointed — the sequenced queue
   kept working, no code touched.
4. **Degradation is mandatory.** Every outbound call is timeout-bounded and
   never raises; a missing dependency degrades a step and names what it
   skipped. It never fails the pipeline. *Verified:* with no routing provider
   reachable at all, the queue still returned all four stops with
   `optimized:false, degraded_reason:"unreachable"`.
5. **Acquired modules keep vendor conventions.** `notification_system` and
   `worker_dashboard` retain their original base paths, auth schemes, casing
   and error envelopes — normalising them would break existing SDKs and
   destroy resale value. Adaptation is carried at the call site.

   Their envelopes travel with the *route*, not the app: an app-level
   `@exception_handler` is left behind the moment a router is mounted into
   somebody else's FastAPI app, turning a documented 401 into a 500. A custom
   `APIRoute` class carries it instead. *Verified in both deployments:* 401
   missing / 403 wrong credentials, in `{"error":{"code","message"}}` for
   SignalPost and flat `{"error","detail"}` for FieldOps.

## Relationship to `../modules/`

This repository carries **two implementations of the same product**:

| | `hacquire/` (this tree) | `../modules/` |
|---|---|---|
| Stack | Python · FastAPI | Node.js · Express |
| Layout | one file per module, `router` + `app` | package per module |
| Ports | 8001–8006 | 4101–4106 |
| Status | HACQUIRE 2026 submission | Working reference, 47 integration + 67 compliance checks passing |

Same six modules, same capability contracts, same degradation rules, same
trading positions. The Node tree was built first, when the language was left
open; the Python tree is the submission now that FastAPI is the specified
stack. The Node tree is kept because it carries the passing test suites and
the compliance tooling (`npm run compliance`, `npm run extract`). Nothing in
this tree depends on it.

# HACQUIRE 2026 — Intelligent Waste Collection Network

Python / FastAPI. Six independent, individually tradable modules.

**[→ PRODUCT-PLAN.md](./PRODUCT-PLAN.md)** — the full submission: folder tree,
41 endpoints with sample JSON, integration pseudocode, trading strategy,
pitch outline, and end-to-end summary.

## Structure

```
hacquire/
├── main.py                 # launcher — boots the six as separate processes
├── requirements.txt        # one dependency set for the whole network
├── .env.example            # every knob, with working defaults
└── modules/
    ├── bin_reporting/bin_reporting.py
    ├── waste_recognition/waste_recognition.py
    ├── route_optimizer/route_optimizer.py
    ├── analytics_dashboard/analytics_dashboard.py
    ├── notification_system/notification_system.py
    └── worker_dashboard/worker_dashboard.py
```

**One module is one file.** Datastore, outbound adapters and HTTP surface all
live in it; nothing is imported across a module boundary (verified — zero
cross-module imports, zero relative imports). That is what keeps each one
sellable: hand a buyer a single `.py`, and it runs.

Verified by doing exactly that — `route_optimizer.py` copied alone into an
empty directory outside the repo answered `GET /optimizeRoute` correctly.

## Run

```bash
pip install -r requirements.txt

python main.py                  # all six, dependencies pre-wired
python main.py --reset          # wipe every datastore first
python main.py bin_reporting    # just one
python main.py --list           # the registry, then exit
```

Or run any module by hand — no launcher, no package, no `PYTHONPATH`:

```bash
cd modules/waste_recognition
uvicorn waste_recognition:app --port 8002
```

Interactive API docs come free with FastAPI: `http://localhost:8002/docs`.

| Module | Port | Position |
|---|---|---|
| `bin_reporting` | 8001 | HELD |
| `waste_recognition` | 8002 | **SOLD** $42,000 |
| `route_optimizer` | 8003 | **SOLD** $28,000 |
| `analytics_dashboard` | 8004 | **SOLD** $35,000 |
| `notification_system` | 8005 | **BOUGHT** — SignalPost Relay 2.4.1 |
| `worker_dashboard` | 8006 | **BOUGHT** — FieldOps Crew 3.1.0 |

## Verify the pipeline

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
# → {"optimized":true,"strategy":"nearest-neighbor + 2-opt","total_distance_km":18.71,...}

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

## Relationship to `../modules/`

This repository carries **two implementations of the same product**:

| | `hacquire/` (this tree) | `../modules/` |
|---|---|---|
| Stack | Python · FastAPI | Node.js · Express |
| Layout | one file per module | package per module |
| Ports | 8001–8006 | 4101–4106 |
| Status | HACQUIRE 2026 submission | Working reference, 47 integration + 67 compliance checks passing |

Same six modules, same capability contracts, same degradation rules, same
trading positions. The Node tree was built first, when the language was left
open; the Python tree is the submission now that FastAPI is the specified
stack. The Node tree is kept because it carries the passing test suites and
the compliance tooling (`npm run compliance`, `npm run extract`). Nothing in
this tree depends on it.

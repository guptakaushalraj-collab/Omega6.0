# HACQUIRE 2026 — Intelligent Waste Collection Network

Python / FastAPI implementation of the six-module tradable registry.

**[→ PRODUCT-PLAN.md](./PRODUCT-PLAN.md)** — the full submission: folder tree,
41 endpoints with sample JSON, integration pseudocode, trading strategy,
pitch outline, and end-to-end summary.

## Run

```bash
pip install fastapi uvicorn pydantic httpx python-multipart
python scripts/run_mesh.py            # all six, dependencies pre-wired
python scripts/run_mesh.py --reset    # wipe datastores first
```

| Module | Port | Position |
|---|---|---|
| `bin_reporting` | 8001 | HELD |
| `waste_recognition` | 8002 | **SOLD** $42,000 |
| `route_optimizer` | 8003 | **SOLD** $28,000 |
| `analytics_dashboard` | 8004 | **SOLD** $35,000 |
| `notification_system` | 8005 | **BOUGHT** — SignalPost Relay 2.4.1 |
| `worker_dashboard` | 8006 | **BOUGHT** — FieldOps Crew 3.1.0 |

Each module also runs standalone:

```bash
cd modules/waste_recognition
cp .env.example .env          # optional — every value has a working default
pip install -r requirements.txt
uvicorn app.main:app --port 8002
```

Interactive API docs are free with FastAPI: `http://localhost:8002/docs`.

## Verify the pipeline

```bash
# 1. register a worker
curl -X POST localhost:8006/v1/workers \
  -H "Authorization: Bearer dev-fieldops-token" -H 'Content-Type: application/json' \
  -d '{"name":"Asha Kumar","location":{"lat":12.9716,"lng":77.5946}}'

# 2. report a bin — persists, classifies, dispatches
curl -X POST localhost:8001/reportBin -H 'Content-Type: application/json' \
  -d '{"image":"<base64>","location":"12.972,77.595","address":"MG Road"}'
# → {"binId":"bin_...","status":"assigned","type":"plastic","degraded":null}

# 3. the worker's sequenced queue
curl -H "Authorization: Bearer dev-fieldops-token" \
  localhost:8006/v1/workers/<worker_id>/queue

# 4. alert the citizen
curl -X POST localhost:8005/notifyPickup -H "X-API-Key: dev-signalpost-key" \
  -H 'Content-Type: application/json' -d '{"binId":"bin_..."}'

# 5. chart-ready analytics
curl localhost:8004/analytics
```

`degraded: null` means every enrichment succeeded. Anything else names what
was skipped and why.

## Relationship to `../modules/`

This repository carries **two implementations of the same product**:

| | `hacquire/` (this tree) | `../modules/` |
|---|---|---|
| Stack | Python · FastAPI | Node.js · Express |
| Ports | 8001–8006 | 4101–4106 |
| Status | HACQUIRE 2026 submission | Working reference, 47 integration + 67 compliance checks passing |

They implement the same six modules, the same capability contracts, the same
degradation rules, and the same trading positions. The Node tree was built
first, when the language was left open; the Python tree is the submission
deliverable now that FastAPI is the specified stack.

Both are kept because the Node tree carries the passing test suites and the
compliance tooling (`npm run compliance`, `npm run extract`). Nothing in this
tree depends on it.

## Design rules (identical in both trees)

1. **No shared code.** Each module vendors its own `store.py`. No module
   imports another's source — verified.
2. **No shared database.** Each owns its records; cross-module data moves over
   HTTP only.
3. **Dependencies are capabilities, not module names.** Providers are injected
   as URLs at runtime, so a sold module can be repointed at its buyer's
   endpoint with an environment variable rather than a code change.
4. **Degradation is mandatory.** Every outbound call is timeout-bounded and
   never raises; a missing dependency degrades a step and names what it
   skipped. It never fails the pipeline.
5. **Acquired modules keep vendor conventions.** `notification_system` and
   `worker_dashboard` retain their original base paths, auth schemes, casing
   and error envelopes — normalising them would break existing SDKs and
   destroy resale value.

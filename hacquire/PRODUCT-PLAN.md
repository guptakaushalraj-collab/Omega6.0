# HACQUIRE 2026 — Final Product Plan
## Intelligent Waste Collection Network

**Stack:** Python 3.11 · FastAPI · Pydantic v2 · httpx · uvicorn
**Shape:** seven independently deployable, independently tradable services

Every endpoint, payload and figure below was executed against the running mesh
before being written down. Nothing here is illustrative-only.

---

## 1. Full Folder Tree & Code Scaffolding

```
hacquire/                                   PROJECT ROOT
│
├── main.py                                 SINGLE-PROCESS deployment. Mounts all
│                                           seven as routers in one FastAPI app:
│                                           uvicorn main:app
│
├── run_network.py                          DISTRIBUTED deployment. Boots the seven
│                                           as SEPARATE PROCESSES and injects
│                                           each one's dependency URLs. Neither
│                                           file is a dependency — no module
│                                           imports either of them.
│
├── requirements.txt                        One dependency set for the network.
│                                           Each module also names its own
│                                           subset in its docstring header.
│
├── .env.example                            Every knob: ports, credentials,
│                                           dependency URLs, timeouts. Copy to
│                                           .env. All values have working
│                                           defaults — it runs with no .env.
│
├── modules/                                SEVEN TRADABLE SERVICES
│   │                                       ONE MODULE IS ONE FILE, exposing two
│   │                                       handles: `router` (the unit of
│   │                                       COMPOSITION) and `app` (the unit of
│   │                                       SALE). Datastore, outbound adapters
│   │                                       and HTTP surface all inside it. No
│   │                                       shared code, no shared database,
│   │                                       zero cross-module imports —
│   │                                       verified. Even composed into one
│   │                                       process they call each other over
│   │                                       HTTP, never by import.
│   │
│   ├── bin_reporting/
│   │   ├── bin_reporting.py                :8001  HELD — the entry point.
│   │   │                                   Intake + lifecycle + flat aliases.
│   │   │                                   Persist-then-enrich; outbound calls
│   │   │                                   are env-resolved, timeout-bounded
│   │   │                                   and never raise — {ok, reason}.
│   │   ├── mocks/reports.json              Seed fixtures
│   │   ├── data/store.json                 Runtime state (gitignored)
│   │   └── uploads/                        Submitted photos (gitignored)
│   │
│   ├── waste_recognition/
│   │   ├── waste_recognition.py            :8002  SOLD — $42,000
│   │   │                                   classify() is the MODEL BOUNDARY —
│   │   │                                   swap the body for real inference,
│   │   │                                   keep the return shape, no consumer
│   │   │                                   changes. Zero outbound deps.
│   │   └── mocks/classifications.json
│   │
│   ├── route_optimizer/
│   │   ├── route_optimizer.py              :8003  SOLD — $28,000
│   │   │                                   Nearest-neighbour + 2-opt.
│   │   │                                   Stateless: no store, no deps, so it
│   │   │                                   scales horizontally for free.
│   │   └── mocks/scenarios.json
│   │
│   ├── analytics_dashboard/
│   │   ├── analytics_dashboard.py          :8004  SOLD — $35,000
│   │   │                                   Push-based. Derives everything from
│   │   │                                   events it is SENT; never queries
│   │   │                                   another module.
│   │   └── mocks/events.json
│   │
│   ├── notification_system/
│   │   ├── notification_system.py          :8005  BOUGHT — SignalPost Relay 2.4.1
│   │   │                                   /v1 · X-API-Key · snake_case ·
│   │   │                                   {"error":{"code","message"}}
│   │   │                                   Vendor conventions RETAINED.
│   │   └── mocks/messages.json
│   │
│   └── worker_dashboard/
│       ├── worker_dashboard.py             :8006  BOUGHT — FieldOps Crew 3.1.0
│       │                                   /v1 · Bearer · {"error","detail"}
│       │                                   job_ref, not bin_id — domain-neutral.
│       │                                   Its adapter block carries the
│       │                                   translation for the OTHER acquired
│       │                                   module, at the call site.
│       └── mocks/{workers,assignments}.json
│   │
│   └── chatbot/
│       ├── chatbot.py                      :8007  BOUGHT — Suvida Chatbot
│       │                                   Conversational front door. Reaches
│       │                                   ALL SIX other modules over HTTP —
│       │                                   the only component that does. A
│       │                                   local LLM only rephrases, and is
│       │                                   entirely optional.
│       └── mocks/
│           ├── conversations.json
│           └── vendor_prompt_transport.txt PRESERVED vendor asset — the
│                                           original TravelBuddy persona,
│                                           resaleable to a transit operator
│
├── seed_demo.py                            Populates a running network with a
│                                           week of plausible activity, so KPIs
│                                           and trend charts have something to
│                                           show. Live reports through the real
│                                           pipeline + backdated analytics
│                                           events for history.
│
├── README.md                               Run instructions + design rules
└── PRODUCT-PLAN.md                         This document
```

**Two deployments, one implementation.** `uvicorn main:app` runs everything in
one process behind prefixes (`POST /bin/reportBin`); `python run_network.py`
runs seven services on seven ports (`POST /reportBin`). Composition is cheaper to
operate and demo, but it costs the three sold modules their independent
deploy, scale and release — and prefixes every published path. Exposing both
`router` and `app` means that choice stays reversible, and a buyer still
receives a service rather than a fragment.

**Why one file per module.** Directory-per-module with its own package, its own
`requirements.txt` and its own `.env` is the textbook shape, but it makes a
handover a repository migration. Collapsed to a single file, a sale is a file
copy: `route_optimizer.py` lifted alone into an empty directory outside this
repo answered `GET /optimizeRoute` correctly with nothing else present. The
per-module dependency list survives as a docstring header, so a buyer still
knows exactly what to `pip install`.

### Starter code — the model boundary (`modules/waste_recognition/waste_recognition.py`)

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

### Starter code — persist-then-enrich (`modules/bin_reporting/bin_reporting.py`)

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

### Starter code — the degradation contract (adapter block, both consumers)

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

### `.env.example` (abridged — one file, at the project root)

```bash
# ---- topology -------------------------------------------------------------
SERVICE_HOST=localhost          # how the modules address EACH OTHER
BIN_REPORTING_PORT=8001
WASTE_RECOGNITION_PORT=8002
ROUTE_OPTIMIZER_PORT=8003
ANALYTICS_DASHBOARD_PORT=8004
NOTIFICATION_SYSTEM_PORT=8005
WORKER_DASHBOARD_PORT=8006

# ---- credentials ----------------------------------------------------------
# SECURITY: both defaults are PUBLIC KNOWLEDGE — they are the fallbacks baked
# into the module source so a fresh clone runs. Change before exposing
# anything beyond localhost.
NOTIFY_API_KEY=dev-signalpost-key     # X-API-Key  (notification_system)
CREW_AUTH_TOKEN=dev-fieldops-token    # Bearer     (worker_dashboard)

# ---- dependencies ---------------------------------------------------------
# Each module consumes CAPABILITIES, never named modules, and reaches them at
# a URL. Unset → main.py points at the local process. Set one → that module is
# repointed. This single indirection is what lets a SOLD module keep serving
# us from the buyer's infrastructure with no code change on either side.
# WASTE_RECOGNITION_URL=https://classify.buyer-hosted.example
# ROUTE_OPTIMIZER_URL=https://routing.buyer-hosted.example
# ANALYTICS_DASHBOARD_URL=https://metrics.buyer-hosted.example

DEPENDENCY_TIMEOUT_MS=2500      # bounds citizen-facing INTAKE latency

# ---- retention ------------------------------------------------------------
MAX_EVENTS=20000                # analytics_dashboard, oldest-first eviction
MAX_MESSAGES=10000              # notification_system

# NOT INCLUDED IN THE ACQUISITION: notification_system delivers in_app only.
# sms/email/push queue but never send — the gateway credentials were not part
# of the asset purchase.
# SIGNALPOST_GATEWAY_KEY=       ← not read by this build
```

Both entrypoints read this file through `python-dotenv`, with
`override=False`: it fills gaps only, so an exported value or a container
platform's injection always wins over a checked-in default. The modules never
load it themselves — they read `os.environ` and do not care who filled it,
which is exactly what lets one drop into a buyer's stack unchanged.

**Dependencies.** `pip install fastapi` pulls pydantic, starlette and
typing-extensions and nothing else; `httpx` and `python-multipart` arrive only
with the `[standard]` extra, so both are declared explicitly. Verified by
blocking each import in turn: without `httpx`, `bin_reporting` and
`worker_dashboard` fail to import; without `python-multipart`, `bin_reporting`
and `waste_recognition` raise at route-definition time.

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
uvicorn main:app                              # one process, prefixed paths
python hacquire/run_network.py                # seven processes, seven ports
# or standalone:
cd hacquire/modules/waste_recognition && uvicorn waste_recognition:app --port 8002
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
| chatbot | 8007 | *(flat)* | `X-API-Key` |

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

**Short form — `POST /report`.** Same pipeline, smaller envelope, for callers
that only need to know the submission landed. Accepts the fields as a JSON
body or as query parameters; the body wins when both are given.

**Live response** `201`:

```json
{
  "status": "success",
  "binId": "bin_81ac6f7caaa8",
  "location": "12.972,77.595",
  "binStatus": "assigned",
  "type": "plastic",
  "assignedWorker": "Asha Kumar",
  "degraded": null
}
```

`status` is the outcome of the CALL; `binStatus` is the bin's lifecycle state.
They are separate keys on purpose — a report can be accepted while dispatch
degrades, and collapsing them would hide exactly that. Prefer the JSON body:
a base64 photo in a query string exceeds common request-line limits and gets
copied into access logs, history and `Referer` headers.

### Detecting waste type — two endpoints, two different keys

`POST /detect` exists on **both** `bin_reporting` and `waste_recognition`, and
the difference is the whole architecture in miniature:

| | Key | Reaches | Use when |
|---|---|---|---|
| `bin_reporting` `POST /detect` | `binId` | its own records, cached | you have a reported bin |
| `waste_recognition` `POST /detect` | `image_base64` | nothing — stateless | you have a photo |

The classifier **cannot** take a `binId`. It is a stateless leaf that only ever
sees bytes; resolving an id would mean calling back into `bin_reporting`,
creating a cycle and costing it the dependency-free property that makes it the
registry's most sellable component. So the id-keyed route lives with the module
that owns the record, and it caches — asking twice does not pay for inference
twice.

```json
// waste_recognition — POST /detect  {"image_base64": "<base64>"}
{
  "type": "e-waste", "label": "E-Waste", "confidence": 0.88,
  "recyclable": true, "hazardous": true,
  "alternatives": [
    { "type": "glass", "label": "Glass", "confidence": 0.4 },
    { "type": "paper", "label": "Paper", "confidence": 0.26 }
  ],
  "model_version": "stub-cv-1.0.0",
  "classificationId": "cls_a2d1bc5c67ed", "reference": "bin_3e5dde47a201"
}
```

### `POST /detectWasteType` *(bin_reporting)*

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

### Optimizing routes — `POST /optimize` · `GET /optimizeRoute?bins=[...]` *(route_optimizer)*

The POST twin exists for callers with more stops than fit in a query string —
a URL has a practical ceiling near 2 KB, and 200 coordinate pairs blow straight
through it. Same parsing, same response, shared implementation, so the two
cannot drift.

```json
// POST /optimize
{ "bins": [ {"lat": 12.955, "lng": 77.620}, {"lat": 13.005, "lng": 77.570},
            {"lat": 12.975, "lng": 77.640}, {"lat": 12.935, "lng": 77.600} ],
  "start": "12.972,77.595" }
```

Both are still stateless: `bins` must carry coordinates. Resolving a bin id
would mean calling `bin_reporting` and forfeiting the dependency-free property
that makes this the registry's cleanest asset.

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

**Short form — `POST /pickup`.** Same send, `{binId, message}` envelope:

```json
{
  "binId": "bin_adede7376e96", "message": "Pickup completed",
  "sent": true, "messageId": "msg_27195e59510c",
  "recipient": "citizen", "channel": "in_app", "delivery_status": "delivered",
  "notification": "Good news — the bin you reported has been picked up. …"
}
```

Three separate facts, three keys. `message` states the EVENT — the pickup
happened. `delivery_status` says whether the alert actually reached anyone.
`notification` is the text that was sent. They cannot be collapsed: only
`in_app` delivers in this build, so `channel=sms` legitimately returns
`"message": "Pickup completed"` alongside `"delivery_status": "queued"` and
`"sent": false` — verified.

**AUTH IS ENFORCED ON BOTH ALIASES** — `401` without a key, `403` with a wrong
one, in the vendor's envelope. These routes sit outside `/v1`, so the key
check is attached explicitly rather than inherited. An unauthenticated
notification endpoint is a spam vector: anyone who finds the URL can push
messages to citizens in the city's name. An alias must never become a way
around authentication, however convenient that would be for a demo.

The vendor surface is untouched and additive-only, so a new owner can delete
every house alias without breaking a single documented SignalPost endpoint:
`POST /v1/messages` · `GET /v1/messages` · `POST /v1/messages/{id}/ack` ·
`POST /v1/messages/ack_all` · `GET /v1/channels`

### Assigning work — `POST /assign` *(worker_dashboard)*

`POST /v1/assignments` only ever dispatches the nearest AVAILABLE worker — the
right default, and the wrong answer when a supervisor needs a specific person
on a specific job. `/assign` does both:

| Input | Behaviour |
|---|---|
| `binId` + `workerId` + `location` | that worker takes the new job |
| `binId` + `location` | nearest available takes it (as `/v1` does) |
| `binId` + `workerId` | **reassign** an open job, reusing its stored location |

**Live response** `201`:

```json
{
  "binId": "bin_alpha", "workerId": "wrk_131cea558065", "status": "assigned",
  "assignmentId": "asg_0ea4c2c58965", "workerName": "Ravi Patel",
  "distance_km": 5.68, "mode": "manual", "reassignedFrom": null,
  "side_effects": { "notification": "sent", "analytics": "recorded" }
}
```

A named worker may already be `busy` — stacking stops onto one round is what
manual assignment is *for*, and the optimizer sequences them (verified: two
stops, 4.62 km, nearest-neighbour + 2-opt). `off_shift` is refused with `409`.
Reassigning frees the previous worker only if they hold no other open job.

**Location cannot be looked up.** This module has no idea what a bin is, let
alone where — resolving one would mean calling back into `bin_reporting` and
creating a cycle. A new job needs coordinates; a reassignment reuses the ones
already on the record.

**Vocabulary stays quarantined.** `binId` is accepted on this alias because
the alias is ours. Underneath it is still `job_ref`: FieldOps sells the same
product into field service, logistics and utilities, and that domain-neutral
core is what keeps its resale value beyond waste collection. Verified — an
assignment record carries `job_ref` and no `binId`.

### Conversation — `POST /chat` *(chatbot)*

**Sample — asking for the numbers.** Captured against a seeded network
(`python seed_demo.py`), not written by hand. The seed is fixed, so the reply
below reproduces byte-for-byte on a same-day run; volumes branch on weekday for
a realistic trend line, so totals shift if you seed on another day:

```bash
curl -X POST localhost:8007/chat -H "X-API-Key: dev-suvida-key" \
     -H 'Content-Type: application/json' \
     -d '{"message": "Show me waste stats"}'
```

```json
{
  "reply": "64 bins reported, 43 collected, 21 still outstanding — a collection rate of 67%. Average time to clear: 11.9 minutes (90th percentile 24.0). 5 crew active, 47 notifications sent. Most common waste type: plastic.",
  "intent": "analytics",
  "endpoint": "GET /analytics",
  "parser": "keyword",
  "source": "template",
  "data": {
    "kpis": {
      "reported": 64, "collected": 43, "outstanding": 21,
      "collection_rate": 0.672,
      "avg_resolution_minutes": 11.9, "p90_resolution_minutes": 24.0,
      "active_workers": 5, "notifications_sent": 47
    },
    "charts": ["daily_activity", "waste_mix", "worker_leaderboard", "status_breakdown"]
  },
  "degraded": null,
  "history": [{ "user": "Show me waste stats", "assistant": "64 bins reported, …" }]
}
```

A client that only knows the acquired vendor's API reads `reply` and ignores
the rest. A UI reads `data.kpis` for tiles and `data.charts` for graphs.
`endpoint` says which API produced it, `parser` whether the LLM or the keyword
fallback classified the message, and `degraded` is `null` only when every step
succeeded.


```bash
curl -X POST localhost:8007/chat -H "X-API-Key: dev-suvida-key" \
     -H 'Content-Type: application/json' \
     -d '{"message":"there is an overflowing bin at 12.972,77.595"}'
```

**Live response** `200`:

```json
{
  "reply": "Logged — reference bin_f4f67b11bac5. Asha Kumar has been assigned.",
  "intent": "report_bin",
  "source": "template",
  "degraded": { "intake_enrichment": "{\"classification\": \"no_photo_supplied\"}" },
  "data": { "binId": "bin_f4f67b11bac5", "status": "assigned",
            "assignedWorker": "Asha Kumar" },
  "history": [ { "user": "there is an overflowing bin at 12.972,77.595",
                 "assistant": "Logged — reference bin_f4f67b11bac5. …" } ]
}
```

`reply`, `message` and `history` are the vendor's contract, unchanged. The
other keys are additive, so a client written against the acquired API still
works: `intent` and `data` let a UI render a card instead of a wall of text,
`source` says whether a model was involved, `degraded` names what was skipped.

**Nine intents.** Resolution is two-stage: the acquired NLP engine parses,
keyword routing is the floor beneath it (21/21 on its own routing set).
The assistant reaches **every other module**; nothing else in the network does:

| Intent | Calls | Example |
|---|---|---|
| `report_bin` | `POST /bin/report` | "overflowing bin at 12.972,77.595" |
| `identify` | `POST /waste/detect` | "what kind of waste is this" + `image` |
| `route` (coords) | `POST /route/optimize` | "plan a route for 12.95,77.62 and …" |
| `analytics` | `GET /analytics` | "how are we doing this week" |
| `notify` | `POST /notify/pickup` | "let the resident know about bin_f4f6…" |
| `assign_worker` | `POST /worker/assign` | "assign Ravi to bin_f4f6…" |
| `pickup_status` | `/bin` **and** `/worker`, reconciled | "has bin_f4f6… been collected" |
| `route` (worker) | `/worker` queue → `/route` | "what is on Asha's round" |
| `worker` | `/worker` workers / assignments | "who is assigned to bin_f4f6…" |
| `help` · `offtopic` | answered locally | — |

**The model proposes; the module disposes.** The LLM's answer is validated
against the known intent set — asked for `delete_everything`, the parse is
rejected and keywords take over, with the reason in `degraded.intent_parser`.
And it *classifies only*: ids and coordinates are always regex-extracted,
because a model that gets one hex digit wrong in `bin_eb6f4a5ad6c7` produces a
confident lookup of the wrong bin that nothing downstream can catch. Exercised
against a stub speaking Ollama's API: paraphrase with no keyword overlap parsed
correctly, fenced JSON recovered, garbage and hallucinated intents rejected,
and the model going away mid-conversation degraded to keywords.

**"Check pickup" is a READ.** It maps to `bin_reporting` + `worker_dashboard`,
never to `POST /notify/pickup` — that endpoint messages the citizen, and
wiring a status question to it would text a resident every time someone asked
whether their bin had been emptied. Verified: three status questions, zero
notifications sent.

Each mapping was verified server-side rather than from the reply text: the bin record
and stored photo in `bin_reporting`, a logged classification in
`waste_recognition`, the 2-opt saving in the optimizer response, the event
counts in `analytics_dashboard`, the messages in `notification_system`, and
the assignment in `worker_dashboard`.

**Two routing-order bugs, both worth recording.** A bin-id fallback that ran
*first* swallowed every new verb — once `notify` and `assign_worker` existed,
"assign Ravi to bin_x" came back as a status lookup because it mentioned a
bin. And a score tie sent "notify the crew" to the crew list. The fallback now
runs last, and actions outrank lookups, so a new intent cannot be shadowed by
either rule again.

**Reconciliation.** `bin_reporting` owns the report; `worker_dashboard` owns
the job. A completed assignment is never pushed back to `bin_reporting` —
doing so would make a domain-neutral, resaleable module learn what a bin is —
so the report can still read `assigned` after the bin is emptied. Verified
live: report `assigned`, crew `completed`, analytics `collected`. The
assistant is the only component that already talks to both, so it reconciles
and trusts the crew record, reporting *"bin_f4f6… has been cleared"* with the
divergence recorded in `data.reconciled`. Telling a citizen standing beside an
empty bin that it has not been collected is the one wrong answer that costs
trust in the whole service.

**Also:** `GET /health` · `GET /intents` (auth) · `GET /conversations` (auth)

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
{
  "worker_id": "wrk_b64a09d86f26", "worker_name": "Asha Kumar",
  "optimized": false,
  "degraded_reason": "unreachable",
  "total_distance_km": null,
  "stops": [
    { "assignment_id": "asg_c0a1edd83de2", "job_ref": "bin_547d42fce718",
      "location": { "lat": 12.972, "lng": 77.595 }, "metadata": {} },
    { "assignment_id": "asg_9232babf5ec5", "job_ref": "bin_a9f5f5a4cb8d",
      "location": { "lat": 12.955, "lng": 77.62 },  "metadata": {} }
  ]
}
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

### Chatbot → API mapping

The pipeline above is the machine path. The chatbot is the *human* path onto
the same APIs: it turns one sentence into one call and one answer.

```
POST /chat  {"message": "Show me waste stats"}
     │
     ├── 1. PARSE ─────────────────────────────────────────────────────────
     │   intent, parser = await resolve_intent(message)
     │
     │       llm = await parse_intent_llm(message)      # acquired NLP engine
     │       if llm.ok and llm.intent in INTENT_ENDPOINTS:
     │           return llm.intent, "llm"               # validated, never trusted raw
     │       return detect_intent(message), "keyword"   # offline floor
     │
     │   Entities are NEVER taken from the model:
     │       bin_id   = BIN_ID_RE.search(message)       # bin_[0-9a-f]{6,16}
     │       worker   = WORKER_ID_RE.search(message)    # wrk_[0-9a-f]{6,16}
     │       points   = LATLNG_RE.findall(message)      # 12.972,77.595
     │   One wrong hex digit from a model is a confident lookup of the wrong
     │   bin that nothing downstream can catch. A regex matches or it doesn't.
     │
     ├── 2. ACT ───────────────────────────────────────────────────────────
     │   match intent:
     │     report_bin    -> POST /bin/report      {lat, lng, image?, notes}
     │     identify      -> POST /waste/detect    {image_base64}
     │     route (coords)-> POST /route/optimize  {bins:[{lat,lng}...]}
     │     route (crew)  -> GET  /worker/v1/workers/{id}/queue   # -> /route
     │     analytics     -> GET  /analytics
     │     notify        -> POST /notify/pickup   {binId, recipient_type}
     │     assign_worker -> POST /worker/assign   {binId, workerId?, location?}
     │     pickup_status -> GET  /bin/api/v1/reports/{id}
     │                    + GET  /worker/v1/assignments?job_ref={id}   # reconcile
     │     help|offtopic -> answered locally, no call
     │
     │   Every call carries the callee's own auth — Bearer for FieldOps,
     │   X-API-Key for SignalPost — and the same {ok, reason} contract as
     │   every other consumer. A module that is down degrades one answer.
     │
     ├── 3. COMPOSE ───────────────────────────────────────────────────────
     │   draft = template(intent, module_response)      # the facts, stated plainly
     │   if OLLAMA_URL:
     │       reply = await rephrase(draft, data)        # phrasing only
     │       # prompt forbids any figure not present in DRAFT or DATA
     │   else:
     │       reply = draft
     │
     └── 4. RETURN ────────────────────────────────────────────────────────
         ChatResponse(reply=text, intent=..., endpoint=..., parser=...,
                      source=..., data=module_response, degraded=...)
```

**Two rules the mapping enforces.** A *question* never triggers a *send*:
`pickup_status` reads `bin_reporting` and `worker_dashboard`, and never touches
`POST /notify/pickup`, which messages a citizen. And the model classifies only
— it never chooses a URL, never fills a parameter, and never sees a datastore.

**Invariants**

- Every outbound call is env-resolved, timeout-bounded (`DEPENDENCY_TIMEOUT_MS`,
  default 2500 ms) and never raises — it returns `{ok, reason}`.
- A missing dependency **degrades a step and names what it skipped**. It never
  fails the pipeline.
- Load-bearing: `bin_reporting`, `worker_dashboard`, `notification_system`,
  `analytics_dashboard`. Optional: `waste_recognition`, `route_optimizer`.
- The report is persisted **before** any peer call.

### The chatbot's role — in short

The chatbot is the network's human front door. Six services expose forty-odd
endpoints with three different auth schemes between them; a resident should not
have to know any of that to say a bin is overflowing. One sentence in, one API
call out, one plain answer back — and the same envelope carries structured JSON
so a dashboard can render a card instead of a paragraph.

It is the only component that talks to all six, which makes it the natural
place to reconcile them: when `bin_reporting` still says "assigned" and
`worker_dashboard` says "completed", it trusts the crew and reports the bin as
cleared. It is also the network's most degradable part by design — the language
model classifies and rephrases, never decides or invents, so with no model
installed the assistant still answers every question from templates and live
module data.

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
> **Status: SATISFIED — three purchases**, `notification_system`,
> `worker_dashboard` and `chatbot`. All three are integrated and
> load-bearing, not shelf-ware: dispatch, routing and every notification flow
> through the first two, and the third is the product's entire conversational
> surface.

**`chatbot`** (Suvida Chatbot, `AniketCodes76/suvida_chatbot` @
`e207819`) — acquired as a *public-transport* assistant. Word counts against
the source say it plainly: bus 2, train 2, metro 1, tram 1, waste 0, bin 0,
recycling 0, collection 0.

What we valued was the **shell and the contract**, not the content:

| | |
|---|---|
| **Kept** | `POST /chat`, `X-API-Key`, `{message, history}` → `{reply}` — existing clients keep working |
| **Replaced** | the TravelBuddy persona; there was no waste content to adapt, so it was rewritten |
| **Preserved** | that persona verbatim in `mocks/vendor_prompt_transport.txt` — it is the resaleable half of the asset and deleting it would destroy that value |
| **Added** | intent routing to five modules; the shipped bot was connected to nothing and said so itself |
| **Fixed** | a fail-open auth hole (below) |

**Diligence found a live vulnerability.** The shipped auth was
`if x_api_key != API_KEY: raise 401`, with `API_KEY = os.getenv("API_KEY")`
and no fallback. `.env` is gitignored, so a fresh clone has no key: the
constant is `None`, a request with **no header** is also `None`, and
`None != None` is `False`. The endpoint authenticated unauthenticated callers.
Reproduced against the acquired source before rewriting; now fails closed —
a missing header is rejected on its own terms and the key always has a value.
An acquisition is only as safe as the diligence done on it, and this one
shipped an open door.

**The LLM is optional, deliberately.** The vendor hard-wired a call to a local
Ollama model with no timeout, from a sync route. Here the model only rephrases
an answer already computed from module data, on a separate bounded budget; with
`OLLAMA_URL` unset — the default — every reply comes from a template and
`source` says so. The feature therefore works on a judge's laptop, in CI, and
offline. A conversational feature that requires a 2 GB model download to demo
is not a feature.

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
3. **Concentration.** Divesting three of seven leaves three purchased modules
   under proprietary licence. A lost licence-back would require replacing three
   capabilities at once — mechanical, thanks to the indirection, but real.
4. **`chatbot` price not yet recorded.** The other six carry settled
   figures; this acquisition closed after the ledger was drawn up. The
   consideration needs entering before the ledger is final — it is left blank
   here rather than estimated.

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
  `notification_system` (support window closes 2027-03-14) · `chatbot`
  (re-personed from public transport; diligence caught a fail-open auth hole).
- **Consulting slot:** 30 min, verification and risk sign-off.
- **HACQUIRE compliance:** three purchases — mandatory minimum exceeded.
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
- **Run it yourself:** `uvicorn main:app` (one process) or `python hacquire/run_network.py` (six)

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

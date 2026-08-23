# HACQUIRE 2026 — Intelligent Waste Collection Network

Python / FastAPI. Six independent, individually tradable modules.

**[→ CHATBOT-INTEGRATION.md](./CHATBOT-INTEGRATION.md)** — the chatbot
integration plan on its own: objective, intent→API map, pseudocode, starter
code, and the tradability evidence.

**[→ PRODUCT-PLAN.md](./PRODUCT-PLAN.md)** — the full submission: folder tree,
41 endpoints with sample JSON, integration pseudocode, trading strategy,
pitch outline, and end-to-end summary.

## Structure

```
hacquire/
├── main.py                 single-process app — seven routers in one FastAPI
├── run_network.py          seven-process network — one service per port
├── seed_demo.py            fills a running network with a week of activity
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
empty directory outside the repo answered `GET /optimizeRoute` correctly, and
`chatbot.py`, which consumes six capabilities, booted from one file with none
of them configured and answered every request by naming the capability it
lacked and the variable to set.

## Run

```bash
pip install -r requirements.txt
cp .env.example .env      # optional — every value has a working default
```

Seed it before demoing — on an empty store every KPI is zero, which is
technically correct and useless in a screenshot:

```bash
python run_network.py       # terminal 1
python seed_demo.py         # terminal 2 — a week of activity, ~60 bins
```

`.env` is read by both entrypoints via `python-dotenv`, and only fills gaps:
a value already exported in the shell, or injected by a container platform,
always wins over the file. Modules themselves never load it — they read
`os.environ` and do not care who filled it, which is what lets one drop into
a buyer's stack unchanged.

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
| `POST /route/optimize` · `GET /route/optimizeRoute?bins=[...]` | ordered route |
| `GET  /analytics/analytics` | chart-ready data |
| `POST /notify/pickup` | alert the citizen — short form |
| `POST /notify/notifyPickup` | alert the citizen — full form |
| `POST /worker/assign` | assign a worker to a bin — named or automatic |
| `POST /chat/chat` | talk to the network in plain language |
| `GET  /` | the registry and the full path map |

Every module also answers `GET /` with an index — name, version, trading
position, and its routes with the right prefixes for however it is running.
`/docs` is the interactive API browser.

**Seven processes** — one service per port, the shape the trading positions
assume:

```bash
python run_network.py               # all seven, dependencies pre-wired
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
| `chatbot` | 8007 | **BOUGHT** — Suvida Chatbot |

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

## Talking to it

`chatbot` is the conversational front door — report a bin, chase a
pickup, read the numbers, ask who is on a round.

```bash
curl -X POST localhost:8007/chat -H "X-API-Key: dev-suvida-key" \
     -H 'Content-Type: application/json' \
     -d '{"message":"there is an overflowing bin at 12.972,77.595"}'
# → "Logged — reference bin_f4f67b11bac5. Asha Kumar has been assigned."
```

It reaches **every other module** — the only component that does:

| You say | It calls |
|---|---|
| "overflowing bin at 12.972,77.595" *(+ optional `image`)* | `POST /bin/report` |
| "what kind of waste is this" *(+ `image`)* | `POST /waste/detect` |
| "plan a route for 12.95,77.62 and 13.00,77.57 …" | `POST /route/optimize` |
| "Show me waste stats" | `GET /analytics` |
| "let the resident know about bin_f4f6…" | `POST /notify/pickup` |
| "assign Ravi to bin_f4f6…" | `POST /worker/assign` |
| "has bin_f4f6… been collected" | `/bin` **and** `/worker`, reconciled |
| "what is on Asha's round" | `/worker` queue → `/route` |
| anything else | declines, and says what it does cover |

Nine intents. `GET /intents` returns the whole map as data. The keyword
fallback scores **21/21** on its routing set.

Every reply carries **both halves**: `reply` is the sentence, `data` is the
structured payload from whichever module answered, and `endpoint` names the
call that was made. The response is a typed `ChatResponse`, so the shape is
enforced at runtime and documented in OpenAPI rather than showing up as a bare
`object`.

**"Check pickup" is a read, not a send.** It maps to `bin_reporting` +
`worker_dashboard`, *never* to `POST /notify/pickup` — that endpoint messages
the citizen. Wiring a status question to it would text a resident every time
someone asked whether their bin had been emptied. Sending is its own intent,
reached only when the user actually asks for someone to be told. Verified:
three status questions in a row sent zero notifications.

**Sample.** Against a seeded network:

```
POST /chat  {"message": "Show me waste stats"}

{ "reply": "64 bins reported, 43 collected, 21 still outstanding — a collection
            rate of 67%. Average time to clear: 11.9 minutes (90th percentile
            24.0). 5 crew active, 47 notifications sent. Most common waste
            type: plastic.",
  "intent": "analytics", "endpoint": "GET /analytics",
  "parser": "keyword", "source": "template",
  "data": { "kpis": {...}, "charts": [...] }, "degraded": null }
```

### How a message is resolved

```
message ──▶ PARSE ──▶ ACT ──▶ RETURN
            │          │        │
            │          │        └─ {reply: text, intent, endpoint, data: json, …}
            │          └─ the one API this intent maps to (GET /intents lists them all)
            └─ acquired NLP engine, validated  ▸ keyword routing beneath it
```

**The model proposes; the module disposes.** The acquired NLP engine
classifies the message, and two rules make that safe in front of a live
system:

1. Its answer is **validated** against the known intent set. Asked to return
   `delete_everything`, the parse is rejected, keyword routing takes over, and
   `degraded.intent_parser` records why — verified.
2. It **classifies only**. Bin ids, worker ids and coordinates are always
   extracted by regex. A model that transcribes `bin_eb6f4a5ad6c7` with one
   hex digit wrong produces a confident lookup of the *wrong bin* and nothing
   downstream can tell; a regex either matches the real id or doesn't match.

**No LLM required.** With `OLLAMA_URL` unset — the default, and the normal case
on a judge's laptop — parsing falls to the keyword router, replies come from
templates, and `parser`/`source` say so. Set it and the model earns its keep on
paraphrase: *"my street is a tip and nobody has been round in a fortnight"* is
`report_bin` via the LLM, where keywords match "round" and answer `route` —
wrong, not merely vague. Either way the facts come from the modules; the model
is never the source of one.

**It tells the truth when things are down.** With `analytics_dashboard`
killed: *"The analytics service is not answering, so I have no figures to give
you. I would rather say that than guess."* With every other module killed, the
assistant still answers, still routes intents, and names what it could not
reach in `degraded`.

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
5. **An acquired module is re-personed, not re-plumbed.** `chatbot`
   was bought as a *public-transport* assistant (`AniketCodes76/suvida_chatbot`
   — bus 2, train 2, metro 1, waste 0). Its API contract is kept exactly
   (`POST /chat`, `X-API-Key`, `{message, history}` → `{reply}`); only the
   persona is replaced, and the original transport prompt is preserved in
   `modules/chatbot/mocks/vendor_prompt_transport.txt` because it is the
   part of that asset with resale value to a transit operator.

6. **A verb outranks a noun, and a fallback runs last.** Intent routing is
   keyword-scored, and two ordering bugs are worth remembering: a bin-id
   fallback that ran *first* swallowed every new verb ("assign Ravi to
   bin_x" came back as a status lookup), and a tie between `notify` and
   `worker` sent "notify the crew" to the crew list. The fallback now runs
   last and actions outrank lookups.

7. **Acquired modules keep vendor conventions.** `notification_system` and
   `worker_dashboard` retain their original base paths, auth schemes, casing
   and error envelopes — normalising them would break existing SDKs and
   destroy resale value. Adaptation is carried at the call site.

   Their envelopes travel with the *route*, not the app: an app-level
   `@exception_handler` is left behind the moment a router is mounted into
   somebody else's FastAPI app, turning a documented 401 into a 500. A custom
   `APIRoute` class carries it instead. *Verified in both deployments:* 401
   missing / 403 wrong credentials, in `{"error":{"code","message"}}` for
   SignalPost and flat `{"error","detail"}` for FieldOps.

8. **Inherited security defects are fixed at intake.** The acquired chatbot
   authenticated with `x_api_key != os.getenv("API_KEY")`. Unset env var →
   `None`; absent header → `None`; `None != None` is `False` — so a fresh
   clone, which has no `.env`, let *unauthenticated* callers through. Verified
   against the acquired source, then fixed to fail closed.

## Relationship to `../modules/`

This repository carries **two implementations of the same product**:

| | `hacquire/` (this tree) | `../modules/` |
|---|---|---|
| Stack | Python · FastAPI | Node.js · Express |
| Layout | one file per module, `router` + `app` | package per module |
| Ports | 8001–8007 | 4101–4106 |
| Status | HACQUIRE 2026 submission | Working reference, 47 integration + 67 compliance checks passing |

Same core six modules, same capability contracts, same degradation rules, same
trading positions. The Node tree was built first, when the language was left
open; the Python tree is the submission now that FastAPI is the specified
stack. The Node tree is kept because it carries the passing test suites and
the compliance tooling (`npm run compliance`, `npm run extract`). Nothing in
this tree depends on it.

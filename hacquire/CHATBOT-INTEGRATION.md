# Chatbot Integration Plan
## Suvida Chatbot → Intelligent Waste Collection Network · HACQUIRE 2026

Status: **implemented and verified**. Every figure below was executed against
the running network; nothing here is illustrative-only. Reproduce with
`python run_network.py`, `python seed_demo.py`.

---

## 1. Objective

The network is six services, ~45 endpoints, three auth schemes. A resident
should not need to know any of that to say a bin is overflowing.

The chatbot is the conversational interface: one sentence in, one API call
out, one plain answer back — with structured JSON in the same envelope so a
dashboard renders a card rather than a paragraph.

| Capability | Example |
|---|---|
| Report bins | *"there is an overflowing bin at 12.972,77.595"* |
| Check pickup status | *"has bin_fc89ba94f295 been collected"* |
| View analytics | *"Show me waste stats"* |
| Ask about routes | *"what is on Asha's round"* |
| Ask about assignments | *"who is assigned to bin_fc89ba94f295"* |

---

## 2. What was acquired

`AniketCodes76/suvida_chatbot` @ `e207819` — 2 files, ~130 lines: a FastAPI
shell around one local-LLM call, personed as **TravelBuddy, a public-transport
assistant**. Word counts against the source: bus 2, train 2, metro 1, tram 1,
waste 0, bin 0, recycling 0, collection 0.

| | |
|---|---|
| **Kept** | `POST /chat`, `X-API-Key`, `{message, history}` → `{reply}` |
| **Replaced** | the persona — no waste content existed to adapt |
| **Preserved** | that persona verbatim in `mocks/vendor_prompt_transport.txt`; it is the resaleable half of the asset |
| **Added** | intent routing to all six modules — the shipped bot was connected to nothing, and said so in its own prompt |
| **Fixed** | a fail-open auth hole (§6) |

---

## 3. Folder tree

```
hacquire/
├── main.py                     single-process: seven routers, one FastAPI app
├── run_network.py              distributed: seven processes, seven ports
├── seed_demo.py                a week of activity, so KPIs are not all zero
├── requirements.txt
├── .env.example
└── modules/
    ├── bin_reporting/          :8001  HELD
    ├── waste_recognition/      :8002  SOLD
    ├── route_optimizer/        :8003  SOLD
    ├── analytics_dashboard/    :8004  SOLD
    ├── notification_system/    :8005  BOUGHT — SignalPost Relay 2.4.1
    ├── worker_dashboard/       :8006  BOUGHT — FieldOps Crew 3.1.0
    └── chatbot/                :8007  BOUGHT — Suvida Chatbot
        ├── chatbot.py          the whole module: store, adapters, HTTP surface
        ├── LICENSE             chain of title, what transfers, defect disclosed
        ├── module.json         provides / consumes / required_dependencies: []
        └── mocks/
            ├── conversations.json
            └── vendor_prompt_transport.txt   preserved vendor asset
```

Four files, no repository. `chatbot.py` runs from an empty directory.

---

## 4. Intent → API mapping

Verified live, each row by calling it and then checking the target module's own
records — not by reading the reply text.

| Intent | Calls | Verified |
|---|---|---|
| `report_bin` | `POST /bin/report` | `bin_fc89ba94f295` created, photo stored |
| `identify` | `POST /waste/detect` | classified `e-waste`, record logged |
| `route` *(coords)* | `POST /route/optimize` | sequenced, 2-opt delta reported |
| `route` *(crew)* | `GET /worker/v1/workers/{id}/queue` → `/route` | 4 stops, 14.76 km |
| `analytics` | `GET /analytics` | 67 reported, live KPIs |
| `notify` | `POST /notify/pickup` | `msg_8ff10ee43c21` delivered |
| `assign_worker` | `POST /worker/assign` | Asha Kumar, crew record confirms |
| `pickup_status` | `GET /bin/.../reports/{id}` **+** `GET /worker/v1/assignments` | reconciled |
| `worker` | `GET /worker/v1/workers` | crew list |
| `help` · `offtopic` | answered locally | no call made |

### Two rules the mapping enforces

**A question never triggers a send.** `pickup_status` reads `bin_reporting` and
`worker_dashboard`; it never touches `POST /notify/pickup`, which messages a
citizen. Wiring a status question there would text a resident every time
someone asked whether their bin had been emptied. Verified: three status
questions, zero notifications sent.

**The model never picks a URL.** It classifies; the module maps and calls.

---

## 5. Integration pseudocode

```
POST /chat  {"message": "Show me waste stats"}
     │
     ├── 1. PARSE ───────────────────────────────────────────────────────
     │   llm = await parse_intent_llm(message)          # acquired NLP engine
     │   intent = llm.intent if llm.ok and llm.intent in INTENT_ENDPOINTS \
     │            else detect_intent(message)           # keyword floor
     │
     │   Entities are NEVER taken from the model:
     │       BIN_ID_RE  bin_[0-9a-f]{6,16}
     │       WORKER_ID_RE  wrk_[0-9a-f]{6,16}
     │       LATLNG_RE  12.972,77.595
     │
     ├── 2. ACT ─────────────────────────────────────────────────────────
     │   report_bin    -> POST /bin/report      {lat, lng, image?, notes}
     │   identify      -> POST /waste/detect    {image_base64}
     │   route (coords)-> POST /route/optimize  {bins:[{lat,lng}...]}
     │   route (crew)  -> GET  /worker/v1/workers/{id}/queue
     │   analytics     -> GET  /analytics
     │   notify        -> POST /notify/pickup   {binId, recipient_type}
     │   assign_worker -> POST /worker/assign   {binId, workerId?, location?}
     │   pickup_status -> GET  /bin/api/v1/reports/{id}
     │                  + GET  /worker/v1/assignments?job_ref={id}
     │
     │   Each call carries the callee's own auth (Bearer for FieldOps,
     │   X-API-Key for SignalPost) and the {ok, reason} contract.
     │
     ├── 3. COMPOSE ─────────────────────────────────────────────────────
     │   draft = template(intent, module_response)
     │   reply = await rephrase(draft, data) if OLLAMA_URL else draft
     │
     └── 4. RETURN ──────────────────────────────────────────────────────
         ChatResponse(reply, intent, endpoint, parser, source, data, degraded)
```

---

## 6. Starter code

Runnable as written — `pip install fastapi uvicorn httpx`, then
`uvicorn chatbot_min:app --port 8007`. Verified standalone with nothing
configured, and against a live `analytics_dashboard`.

```python
"""Minimal tradable chatbot module — the whole pattern in 60 lines.

    pip install fastapi uvicorn httpx
    uvicorn chatbot_min:app --port 8007
    curl -X POST localhost:8007/chat -H "X-API-Key: dev-suvida-key" \
         -H 'Content-Type: application/json' -d '{"message":"show me stats"}'
"""
import os
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel

API_KEY = os.getenv("CHAT_API_KEY", "dev-suvida-key")          # never None: fails closed
ANALYTICS_URL = os.getenv("ANALYTICS_URL", "")                 # capability, not a module
TIMEOUT_S = float(os.getenv("DEPENDENCY_TIMEOUT_MS", "2500")) / 1000

router = APIRouter()                                           # the unit of composition


def require_api_key(x_api_key: Optional[str] = Header(None)):
    if not x_api_key:                                          # reject BEFORE comparing
        raise HTTPException(401, "X-API-Key header is required.")
    if x_api_key != API_KEY:
        raise HTTPException(403, "Invalid API key")


async def call(method: str, url: str, **kw) -> dict:
    """Env-resolved, timeout-bounded, never raises."""
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_S) as c:
            r = await c.request(method, url, **kw)
            if r.status_code >= 400:
                return {"ok": False, "reason": f"upstream_{r.status_code}"}
            return {"ok": True, "data": r.json()}
    except Exception:
        return {"ok": False, "reason": "unreachable"}


class ChatRequest(BaseModel):
    message: str


class ChatResponse(BaseModel):
    reply: str
    intent: str
    endpoint: Optional[str] = None
    data: dict[str, Any] = {}
    degraded: Optional[dict[str, str]] = None


@router.post("/chat", response_model=ChatResponse)
async def chat(body: ChatRequest, _=Depends(require_api_key)):
    if not any(k in body.message.lower() for k in ("stat", "analytic", "how many")):
        return ChatResponse(reply="I can show you collection statistics.", intent="help")

    if not ANALYTICS_URL:                                      # unconfigured != outage
        return ChatResponse(reply="Not connected to analytics — set ANALYTICS_URL.",
                            intent="analytics", degraded={"analytics": "not_configured"})

    got = await call("GET", f"{ANALYTICS_URL}/analytics")
    if not got["ok"]:
        return ChatResponse(reply="Analytics is not answering just now.", intent="analytics",
                            endpoint="GET /analytics", degraded={"analytics": got["reason"]})

    k = got["data"]["kpis"]                                    # facts from the module
    return ChatResponse(
        reply=f"{k['reported']} bins reported, {k['collected']} collected, "
              f"{k['outstanding']} outstanding.",
        intent="analytics", endpoint="GET /analytics", data={"kpis": k})


app = FastAPI(title="chatbot")                                 # the unit of sale
app.include_router(router)
```

---

## 7. Why the router is not fifty lines

The obvious sketch of this module is a keyword `if/elif` over `requests.post`.
It was written and run against the live network on :8000. **All five branches
failed, and all five returned HTTP 200** with the error stringified into the
reply — the worst outcome, because a caller cannot tell success from failure.

| Sketch branch | Result | Cause |
|---|---|---|
| `report a bin` | `400` inside a 200 | `"lat,long"` placeholder is not coordinates |
| `check pickup` | `401` inside a 200 | no `X-API-Key` |
| `show analytics` | `404` inside a 200 | `/analytics/` — real path is `/analytics/analytics` |
| `optimize route` | `405` inside a 200 | `GET` against a `POST` endpoint |
| `assign worker` | `401` inside a 200 | no `Bearer` token |

Before any of that, `def chat(message: str)` makes `message` a **query
parameter**, so the documented body `{"message": "..."}` returns `422`. FastAPI
treats bare scalars on a POST as query params; only a Pydantic model becomes a
body.

Three failures are structural rather than typos:

**A status question sends a notification.** `check_pickup → POST /notify/pickup`
maps a read onto a write. Measured: the int `binId` 422s first, so nothing is
sent — but with a string id, `messages to the citizen: 0 → 1`. The collision is
real, gated behind a second bug. Every "has my bin been collected?" would text
a resident.

**Hardcoded URLs.** Five occurrences of `http://localhost:8000`. A module whose
targets are compiled in cannot be repointed at a buyer's host without a code
change — which is the whole basis of the licence-back structure. Targets belong
in the environment.

**Substring intent matching.** `"any update on the report I filed"` →
`report_bin`; `"the route is blocked, report it"` → `report_bin`;
`"has my bin been collected"` → `unknown`. The same class of bug as `"hi"`
matching inside `"this"`, found earlier in this module's own history.

Also: `requests` is synchronous with no timeout, so one hung peer pins a
threadpool worker indefinitely, and `response.json()` is unguarded — any
non-JSON error body raises. Both were fixed in the acquired code for the same
reasons.

**What the production router adds, and why.** Not ceremony: auth that fails
closed, env-resolved targets, bounded timeouts, `{ok, reason}` on every call,
word-boundary intent matching, regex entity extraction, read/write separation,
and a typed response. The `data`/`degraded` fields exist precisely so a
degraded call is machine-detectable rather than a sentence a caller has to
parse. The sketch's shape is right; each addition above is a specific failure
it was measured producing.

---

## 8. Sample endpoint

Captured against a seeded network, not written by hand:

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
  "data": { "kpis": { "reported": 64, "collected": 43, "outstanding": 21,
                      "collection_rate": 0.672, "avg_resolution_minutes": 11.9,
                      "p90_resolution_minutes": 24.0, "active_workers": 5,
                      "notifications_sent": 47 },
            "charts": ["daily_activity", "waste_mix", "worker_leaderboard",
                       "status_breakdown"] },
  "degraded": null,
  "history": [{ "user": "Show me waste stats", "assistant": "64 bins reported, …" }]
}
```

`reply` is the vendor contract — an existing client reads it and ignores the
rest. `data` drives a UI, `endpoint` names the API that answered, `parser` says
LLM or keyword, `degraded` is `null` only when every step succeeded.

---

## 9. The NLP engine, and its limits

The acquired LLM parses intent; keyword routing is the floor beneath it.

**The model proposes; the module disposes.** Its answer is validated against
the known intent set, and it classifies only — one wrong hex digit in
`bin_eb6f4a5ad6c7` is a confident lookup of the wrong bin that nothing
downstream can catch.

Exercised against a stub speaking Ollama's `/api/generate`:

| Case | Result |
|---|---|
| paraphrase, no keyword overlap | parsed correctly via LLM |
| fenced ```` ```json ```` output | recovered |
| prose instead of JSON | rejected → keywords |
| hallucinated `delete_everything` | rejected by validation |
| model killed mid-conversation | degraded to keywords, reason named |

With `OLLAMA_URL` unset — the default — everything still works from templates.
Set it and the model earns its keep: *"my street is a tip and nobody has been
round in a fortnight"* parses as `report_bin`, where keywords match "round" and
answer `route` — wrong, not merely vague.

### Inherited defect, fixed at intake

Shipped auth was `if x_api_key != API_KEY`, with `API_KEY = os.getenv("API_KEY")`
and no fallback. `.env` is gitignored, so a fresh clone has no key: the constant
is `None`, a request with **no header** is also `None`, and `None != None` is
`False`. **The endpoint authenticated unauthenticated callers.** Reproduced
against the acquired source before rewriting; now fails closed, and disclosed
in `LICENSE` for any onward sale.

---

## 10. Modularity — tradable and reusable

`chatbot.py` copied alone into an empty directory outside the repo, nothing
configured:

| Check | Result |
|---|---|
| Boots from one file | `{"ok": true, "module": "chatbot"}` |
| All four routes served | 10-intent map returned |
| Auth enforced | `401` with no key |
| Six unconfigured dependencies | each names its capability and env var |
| Cross-module imports | 0 (AST, all seven modules) |
| `required_dependencies` | `[]` |

Dependencies are **capabilities behind environment variables**, never imports,
so repointing at a buyer's host is configuration. Unconfigured reads
differently from an outage: *"no provider is configured. Point ANALYTICS_URL at
one"* — a new owner is told what to do, not that something is broken.

> **Known gap.** The other six Python modules still lack `LICENSE` and
> `module.json`. The Node reference tree has both plus a compliance checker;
> the Python tree does not. Same fix six times over.

---

## 11. Summary — the chatbot's role

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

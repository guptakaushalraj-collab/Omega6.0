"""chatbot — :8007 — BOUGHT (Suvida Chatbot, AniketCodes76/suvida_chatbot @ e207819)

ACQUIRED MODULE. Conversational front door to the network: report a bin, chase
a pickup, read the numbers, ask who is on a round — in plain language.

WHAT WE BOUGHT, AND WHAT WE KEPT
--------------------------------
The asset is 2 files, ~130 lines: a FastAPI shell wrapping one local-LLM call.
Its value to us is the SHELL and the CONTRACT, not the content.

  KEPT (the vendor's API — existing clients keep working):
    POST /chat · X-API-Key auth · {message, history} -> {reply}

  REPLACED (the persona — it was for a different industry):
    The shipped prompt is "TravelBuddy", a public-transport assistant. Counted
    against the source: bus 2, train 2, metro 1, tram 1 — and waste 0, bin 0,
    recycling 0, collection 0. There is no waste-collection content to adapt,
    so the prompt is rewritten rather than edited. The transport persona is
    preserved verbatim in mocks/vendor_prompt_transport.txt: it is the part of
    the asset with resale value to a transit operator, and deleting it outright
    would destroy that.

  ADDED (what makes it useful here — the actual integration):
    The shipped bot is connected to nothing. Its own prompt admits it: "You do
    NOT have guaranteed access to real-time transport information. Never
    invent..." A chatbot that cannot see the system is a demo, not a feature.
    This build routes intents to the five other modules over HTTP and answers
    from what they return.

  FIXED (a fail-open auth hole, verified before rewriting):
    Shipped code read `API_KEY = os.getenv("API_KEY")` and rejected on
    `x_api_key != API_KEY`. With API_KEY unset — the state of any fresh clone,
    since .env is gitignored — the constant is None, a request with NO header
    is also None, and None != None is False. The endpoint authenticated
    unauthenticated callers. Here the key falls back to a documented dev
    default and a missing header is rejected explicitly, so it fails CLOSED.

DEGRADES TWICE OVER
-------------------
1. No LLM required. Intent routing and every answer are deterministic; the
   model only rephrases. With Ollama absent — the normal case on a judge's
   laptop, and in CI — replies come from templates and `source` says
   "template". The feature works; it just sounds less chatty.
2. No module required. Each dependency is env-resolved, timeout-bounded and
   never raises; a module that is down is named in `degraded` and the reply
   says what it could not check rather than inventing an answer.

Run standalone:      uvicorn chatbot:app --port 8007
Needs:               fastapi  uvicorn  pydantic  httpx
Env:                 PORT, CHAT_API_KEY, OLLAMA_URL, OLLAMA_MODEL,
                     BIN_REPORTING_URL, ANALYTICS_URL, WORKER_DASHBOARD_URL,
                     CREW_AUTH_TOKEN, DEPENDENCY_TIMEOUT_MS, LLM_TIMEOUT_MS
"""
import json
import os
import re
import secrets
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, FastAPI, Header, Request, Response
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from pydantic import BaseModel, Field

APP_VERSION = "1.0.0"
VENDOR = "Suvida Chatbot"

# The vendor read os.getenv("API_KEY") with no fallback, which is what made the
# check fail open. A documented dev default keeps a fresh clone runnable AND
# makes the comparison meaningful.
API_KEY = os.getenv("CHAT_API_KEY") or os.getenv("API_KEY") or "dev-suvida-key"

MAX_MESSAGE_CHARS = 2000
MAX_HISTORY_TURNS = 12


# ---------------------------------------------------------------------------
# VENDORED DATASTORE
#
# This class is COPIED into every module that needs it, never imported across
# module boundaries. ~40 duplicated lines is the deliberate price of being able
# to hand a buyer this single file and have it run with no shared package to
# untangle. Swap the body for a real database client; no route changes.
# ---------------------------------------------------------------------------
class Store:
    def __init__(self, empty: dict, filename: str = "store.json"):
        self._empty = empty
        self._path = Path(__file__).resolve().parent / "data" / filename
        self._lock = threading.Lock()
        self._path.parent.mkdir(parents=True, exist_ok=True)
        if not self._path.exists():
            self._write_unlocked(empty)

    def _write_unlocked(self, data: dict) -> None:
        # Write-then-rename: a crash mid-write leaves the previous file intact
        # rather than a truncated one.
        tmp = self._path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2))
        tmp.replace(self._path)

    def read(self) -> dict:
        with self._lock:
            try:
                return json.loads(self._path.read_text())
            except (FileNotFoundError, json.JSONDecodeError):
                return json.loads(json.dumps(self._empty))

    def write(self, data: dict) -> None:
        with self._lock:
            self._write_unlocked(data)

    def reset(self) -> None:
        self.write(json.loads(json.dumps(self._empty)))

    @staticmethod
    def new_id(prefix: str) -> str:
        return f"{prefix}_{secrets.token_hex(6)}"

    @staticmethod
    def now() -> str:
        return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


# ---------------------------------------------------------------------------
# OUTBOUND ADAPTERS
#
# Same three rules as every consumer in the registry: targets from env vars,
# hard timeout, never raise — return {"ok": bool, ...} and let the caller
# degrade. The chatbot is the most visible module in the network, so it is the
# one that must NEVER show a stack trace to a member of the public.
# ---------------------------------------------------------------------------
BIN_REPORTING_URL = os.getenv("BIN_REPORTING_URL", "")
WASTE_RECOGNITION_URL = os.getenv("WASTE_RECOGNITION_URL", "")
ROUTE_OPTIMIZER_URL = os.getenv("ROUTE_OPTIMIZER_URL", "")
ANALYTICS_URL = os.getenv("ANALYTICS_URL", "")
NOTIFICATION_URL = os.getenv("NOTIFICATION_URL", "")
NOTIFY_API_KEY = os.getenv("NOTIFY_API_KEY", "dev-signalpost-key")
WORKER_DASHBOARD_URL = os.getenv("WORKER_DASHBOARD_URL", "")
CREW_AUTH_TOKEN = os.getenv("CREW_AUTH_TOKEN", "dev-fieldops-token")
TIMEOUT_S = float(os.getenv("DEPENDENCY_TIMEOUT_MS", "2500")) / 1000

# The LLM is held to a SEPARATE, longer budget. Token generation is slow by
# nature, and a person waiting on a chat reply tolerates more latency than the
# intake API does — but it is still bounded, because an unbounded generate call
# is how a chat endpoint hangs forever.
OLLAMA_URL = os.getenv("OLLAMA_URL", "")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:3b")
LLM_TIMEOUT_S = float(os.getenv("LLM_TIMEOUT_MS", "20000")) / 1000


async def _request(method: str, url: str, timeout: float = None, **kw) -> dict:
    try:
        async with httpx.AsyncClient(timeout=timeout or TIMEOUT_S) as client:
            r = await client.request(method, url, **kw)
            if r.status_code >= 400:
                return {"ok": False, "reason": f"upstream_{r.status_code}"}
            return {"ok": True, "data": r.json()}
    except httpx.TimeoutException:
        return {"ok": False, "reason": "timeout"}
    except Exception:
        return {"ok": False, "reason": "unreachable"}


def _crew_headers() -> dict:
    return {"Authorization": f"Bearer {CREW_AUTH_TOKEN}"}   # FieldOps' scheme


async def report_bin(location: dict, notes: Optional[str],
                     image: Optional[str] = None) -> dict:
    """-> bin_reporting POST /report"""
    if not BIN_REPORTING_URL:
        return {"ok": False, "reason": "not_configured"}
    return await _request("POST", f"{BIN_REPORTING_URL}/report",
                          json={"lat": location["lat"], "lng": location["lng"],
                                "image": image, "notes": notes,
                                "reporter_name": "Chat user"})


async def detect_waste(image_base64: str, reference: Optional[str] = None) -> dict:
    """-> waste_recognition POST /detect.

    Image-keyed, because that module is a stateless leaf that never sees bin
    records. For a bin id the caller wants bin_reporting POST /detect instead,
    which owns the record and caches.
    """
    if not WASTE_RECOGNITION_URL:
        return {"ok": False, "reason": "not_configured"}
    return await _request("POST", f"{WASTE_RECOGNITION_URL}/detect",
                          json={"image_base64": image_base64, "reference": reference})


async def optimize_stops(bins: list, start: Optional[dict] = None) -> dict:
    """-> route_optimizer POST /optimize"""
    if not ROUTE_OPTIMIZER_URL:
        return {"ok": False, "reason": "not_configured"}
    payload: dict[str, Any] = {"bins": bins}
    if start:
        payload["start"] = start
    return await _request("POST", f"{ROUTE_OPTIMIZER_URL}/optimize", json=payload)


async def notify_pickup(bin_id: str, recipient_type: str = "citizen",
                        message: Optional[str] = None) -> dict:
    """-> notification_system POST /pickup, with SignalPost's X-API-Key."""
    if not NOTIFICATION_URL:
        return {"ok": False, "reason": "not_configured"}
    return await _request("POST", f"{NOTIFICATION_URL}/pickup",
                          headers={"X-API-Key": NOTIFY_API_KEY},
                          json={"binId": bin_id, "recipient_type": recipient_type,
                                "message": message})


async def assign_worker(bin_id: str, worker_id: Optional[str] = None,
                        location: Optional[dict] = None) -> dict:
    """-> worker_dashboard POST /assign, with FieldOps' Bearer token."""
    if not WORKER_DASHBOARD_URL:
        return {"ok": False, "reason": "not_configured"}
    payload: dict[str, Any] = {"binId": bin_id}
    if worker_id:
        payload["workerId"] = worker_id
    if location:
        payload["location"] = location
    return await _request("POST", f"{WORKER_DASHBOARD_URL}/assign",
                          headers=_crew_headers(), json=payload)


async def get_report(bin_id: str) -> dict:
    if not BIN_REPORTING_URL:
        return {"ok": False, "reason": "not_configured"}
    return await _request("GET", f"{BIN_REPORTING_URL}/api/v1/reports/{bin_id}")


async def recent_reports(limit: int = 5) -> dict:
    if not BIN_REPORTING_URL:
        return {"ok": False, "reason": "not_configured"}
    return await _request("GET", f"{BIN_REPORTING_URL}/api/v1/reports",
                          params={"limit": limit})


async def get_analytics() -> dict:
    if not ANALYTICS_URL:
        return {"ok": False, "reason": "not_configured"}
    return await _request("GET", f"{ANALYTICS_URL}/analytics")


async def list_workers() -> dict:
    if not WORKER_DASHBOARD_URL:
        return {"ok": False, "reason": "not_configured"}
    return await _request("GET", f"{WORKER_DASHBOARD_URL}/v1/workers",
                          headers=_crew_headers())


async def worker_queue(worker_id: str) -> dict:
    if not WORKER_DASHBOARD_URL:
        return {"ok": False, "reason": "not_configured"}
    return await _request("GET", f"{WORKER_DASHBOARD_URL}/v1/workers/{worker_id}/queue",
                          headers=_crew_headers())


async def assignments_for(job_ref: str) -> dict:
    if not WORKER_DASHBOARD_URL:
        return {"ok": False, "reason": "not_configured"}
    return await _request("GET", f"{WORKER_DASHBOARD_URL}/v1/assignments",
                          headers=_crew_headers(), params={"job_ref": job_ref})


async def rephrase(persona_prompt: str) -> dict:
    """Optional. Ollama, exactly as the vendor called it, but with a timeout.

    Shipped code used `requests.post(url, json=data)` with no timeout, from a
    sync route — one hung generate call pinned a threadpool worker for as long
    as the model felt like taking. httpx + an explicit budget, and the caller
    falls back to the template on any failure.
    """
    if not OLLAMA_URL:
        return {"ok": False, "reason": "not_configured"}
    result = await _request("POST", f"{OLLAMA_URL}/api/generate",
                            timeout=LLM_TIMEOUT_S,
                            json={"model": OLLAMA_MODEL, "prompt": persona_prompt,
                                  "stream": False})
    if not result["ok"]:
        return result
    text = (result["data"] or {}).get("response")
    if not isinstance(text, str) or not text.strip():
        # Shipped code did result["response"] unguarded — a KeyError 500 on any
        # Ollama error payload.
        return {"ok": False, "reason": "empty_completion"}
    return {"ok": True, "data": text.strip()}


def dependency_config() -> dict:
    return {
        "bin_reporting": BIN_REPORTING_URL or None,
        "waste_recognition": WASTE_RECOGNITION_URL or None,
        "route_optimizer": ROUTE_OPTIMIZER_URL or None,
        "analytics_dashboard": ANALYTICS_URL or None,
        "notification_system": NOTIFICATION_URL or None,
        "worker_dashboard": WORKER_DASHBOARD_URL or None,
        "llm": OLLAMA_URL or None,
        "llm_model": OLLAMA_MODEL if OLLAMA_URL else None,
        "timeout_ms": int(TIMEOUT_S * 1000),
        "llm_timeout_ms": int(LLM_TIMEOUT_S * 1000),
    }


# ---------------------------------------------------------------------------
# INTENT ROUTING — DETERMINISTIC, AND DELIBERATELY SO
#
# The obvious design is to let the model decide what the user wants and call
# tools itself. Rejected: it makes every answer depend on a 3B model being
# installed, and makes "report my bin" occasionally silently fail to file
# anything. Keyword routing is dull and it is RIGHT every time, offline, in
# CI, and on a laptop with no GPU.
#
# The model's job is narrowed to what models are good at: phrasing. The facts
# come from the modules.
# ---------------------------------------------------------------------------
BIN_ID_RE = re.compile(r"\bbin_[0-9a-f]{6,16}\b", re.I)
WORKER_ID_RE = re.compile(r"\bwrk_[0-9a-f]{6,16}\b", re.I)
# "12.972,77.595" or "12.972, 77.595" or "at 12.972 77.595"
LATLNG_RE = re.compile(r"(-?\d{1,3}\.\d+)\s*[, ]\s*(-?\d{1,3}\.\d+)")

INTENTS = {
    "report_bin":    ("report", "overflowing", "overflow", "full bin", "bin is full",
                      "spilling", "rubbish", "garbage", "trash", "dump", "log a bin"),
    "pickup_status": ("status", "picked up", "pickup", "collected", "cleared",
                      "when will", "has my", "any update", "chase"),
    "analytics":     ("analytics", "stats", "statistics", "how many", "numbers",
                      "dashboard", "metrics", "performance", "collection rate",
                      "outstanding", "summary", "how are we", "how did we",
                      "how is it going", "progress", "this week", "today",
                      "so far", "figures"),
    "route":         ("route", "round", "queue", "stops", "itinerary", "sequence",
                      "optimi"),
    "worker":        ("worker", "crew", "staff", "who is", "who's", "assigned to",
                      "assignment", "collector"),
    "assign_worker": ("assign", "put", "send", "give it to", "reassign",
                      "dispatch", "hand it to"),
    "notify":        ("notify", "tell the", "let them know", "let the", "alert",
                      "message the", "send an alert", "inform", "know about"),
    "identify":      ("what kind", "what type", "identify", "classify",
                      "what waste", "recognise", "recognize"),
    "help":          ("help", "what can you", "hi", "hello", "hey", "start", "menu"),
}

# Waste-domain scope. The vendor's off-topic guard is kept, re-aimed: an
# assistant that answers anything is a liability on a council's website.
SCOPE_HINT = ("bins", "pickups", "collection routes", "crew assignments",
              "and the collection numbers")


# THE MAP. One place that says which API each intent reaches, so the routing
# table is a fact in the code rather than a claim in a README. Surfaced on
# GET /intents and echoed on every reply as `endpoint`.
#
# NOTE ON "check pickup". A status question is a READ — it goes to
# bin_reporting and worker_dashboard. It must NOT go to /notify/pickup, which
# SENDS an alert: mapping it there would message a resident every time someone
# asked whether their bin had been collected. Sending is its own intent
# (`notify`), reached only when the user actually asks for someone to be told.
INTENT_ENDPOINTS = {
    "report_bin":    "POST /bin/report",
    "identify":      "POST /waste/detect",
    "route":         "POST /route/optimize · GET /worker/v1/workers/{id}/queue",
    "analytics":     "GET /analytics",
    "notify":        "POST /notify/pickup",
    "assign_worker": "POST /worker/assign",
    "pickup_status": "GET /bin/api/v1/reports/{id} · GET /worker/v1/assignments",
    "worker":        "GET /worker/v1/workers · GET /worker/v1/assignments",
    "help":          None,
    "offtopic":      None,
}

# Actions before lookups; `help` last so a greeting never outranks a real ask.
INTENT_PRIORITY = ("report_bin", "assign_worker", "notify", "identify",
                   "pickup_status", "analytics", "route", "worker", "help")


def _matches(keyword: str, text: str) -> bool:
    """Word-aware keyword match.

    NOT a substring test. `"hi" in "how are we doing this week"` is True —
    "this" contains "hi" — which routed a plain analytics question to the help
    menu. Found by running the help text's own documented example against it.

    Short keywords (greetings) must match a whole word. Longer ones anchor at a
    word start only, so they still work as stems: "optimi" catches optimise and
    optimizing, "report" catches reported and reporting.
    """
    pattern = rf"\b{re.escape(keyword)}\b" if len(keyword) <= 3 else rf"\b{re.escape(keyword)}"
    return re.search(pattern, text) is not None


def detect_intent(message: str) -> str:
    text = message.lower()
    scores = {name: sum(1 for kw in kws if _matches(kw, text))
              for name, kws in INTENTS.items()}
    # On a tie the VERB beats the NOUN. "notify the crew about bin_x" scores
    # once for notify and once for crew; it is a request to send something, not
    # a question about the crew. Actions are therefore ranked ahead of lookups.
    top = max(scores.values())
    best = next(name for name in INTENT_PRIORITY if scores[name] == top)

    if top == 0:
        # Nothing asked for explicitly. A bare bin id is almost always "what is
        # happening with this one".
        #
        # This test runs LAST, not first. Run first — against a hardcoded list
        # of intents allowed to override it — it swallowed every new verb: once
        # `notify` and `assign_worker` existed, "assign Ravi to bin_x" and
        # "alert the supervisor about bin_x" both came back as status lookups,
        # because they mentioned a bin. Scoring first and falling back second
        # means a new intent can never be shadowed by this rule again.
        return "pickup_status" if BIN_ID_RE.search(message) else "offtopic"

    return best


def extract_locations(message: str) -> list[dict]:
    """Every coordinate pair in the message, in order."""
    out = []
    for lat, lng in LATLNG_RE.findall(message):
        lat, lng = float(lat), float(lng)
        if abs(lat) <= 90 and abs(lng) <= 180:
            out.append({"lat": lat, "lng": lng})
    return out


def extract_location(message: str) -> Optional[dict]:
    m = LATLNG_RE.search(message)
    if not m:
        return None
    lat, lng = float(m.group(1)), float(m.group(2))
    if abs(lat) > 90 or abs(lng) > 180:
        return None
    return {"lat": lat, "lng": lng}


def _km(value) -> str:
    return f"{value} km" if value is not None else "an unknown distance"


def _plural(n: int, word: str) -> str:
    return word if n == 1 else word + "s"


# Env var to set, per capability — named in the reply so a new owner is told
# what to do rather than what is broken.
CAPABILITY_ENV = {
    "bin_reporting": "BIN_REPORTING_URL", "waste_recognition": "WASTE_RECOGNITION_URL",
    "route_optimizer": "ROUTE_OPTIMIZER_URL", "analytics_dashboard": "ANALYTICS_URL",
    "notification_system": "NOTIFICATION_URL", "worker_dashboard": "WORKER_DASHBOARD_URL",
}


def _unavailable(module: str, human: str, reason: str) -> str:
    """Phrase a missing dependency.

    NOT CONFIGURED IS NOT AN OUTAGE. A buyer running this module on its own has
    wired nothing up yet; telling them the service "is not answering" sends
    them hunting for a fault that does not exist. Name the variable instead.
    """
    if reason == "not_configured":
        return (f"I am not connected to {human} yet — no provider is configured. "
                f"Point {CAPABILITY_ENV.get(module, 'the relevant URL')} at one "
                f"and I will start answering these.")
    return f"{human[0].upper()}{human[1:]} is not answering just now."


PARSER_PROMPT = """You classify messages sent to a city waste-collection assistant.

Reply with ONE line of JSON and nothing else:
{{"intent": "<name>"}}

Valid intents, and what each means:
  report_bin     the user is telling us about a bin that needs emptying
  pickup_status  the user is ASKING whether a bin has been dealt with
  analytics      the user wants figures, totals, rates or performance
  route          the user wants a round, a sequence of stops, or a plan
  worker         the user is asking who someone is or who has a job
  assign_worker  the user wants a named person PUT ON a job
  notify         the user wants someone TOLD or ALERTED about a bin
  identify       the user wants to know what kind of waste something is
  help           a greeting, or asking what you can do
  offtopic       anything unrelated to waste collection

Two distinctions that matter:
  "has bin_x been collected"  -> pickup_status   (a question)
  "tell the resident bin_x is done" -> notify    (a request to send)
  "who has bin_x"             -> worker          (a question)
  "put Asha on bin_x"         -> assign_worker   (a request to change)

Choose exactly one. Output only the JSON object.

MESSAGE:
{message}"""


async def parse_intent_llm(message: str) -> dict:
    """Ask the acquired NLP engine what the user meant.

    THE MODEL PROPOSES; THE MODULE DISPOSES. Two rules make this safe enough to
    put in front of a live system:

      1. The answer is VALIDATED against INTENTS. A model that invents
         "delete_everything", returns prose, or wanders off the schema is
         treated as a failed parse, not as an instruction.
      2. It classifies ONLY. It never extracts ids or coordinates — those stay
         with the regexes. A model that transcribes bin_eb6f4a5ad6c7 with one
         hex digit wrong produces a confident lookup of the wrong bin, and
         nothing downstream can tell. Regex either matches the real id or does
         not match at all.

    Any failure returns {"ok": False} and the caller falls back to keyword
    routing, so the assistant is never worse off for having tried.
    """
    if not OLLAMA_URL:
        return {"ok": False, "reason": "not_configured"}
    result = await _request("POST", f"{OLLAMA_URL}/api/generate",
                            timeout=LLM_TIMEOUT_S,
                            json={"model": OLLAMA_MODEL, "stream": False,
                                  "format": "json",
                                  "prompt": PARSER_PROMPT.format(message=message)})
    if not result["ok"]:
        return result
    raw = (result["data"] or {}).get("response")
    if not isinstance(raw, str):
        return {"ok": False, "reason": "empty_completion"}
    # Small models like to wrap JSON in prose or a fenced block. Take the first
    # object rather than insisting the whole reply parses.
    match = re.search(r"\{.*?\}", raw, re.S)
    if not match:
        return {"ok": False, "reason": "unparseable"}
    try:
        parsed = json.loads(match.group(0))
    except json.JSONDecodeError:
        return {"ok": False, "reason": "unparseable"}
    intent = parsed.get("intent")
    if intent not in INTENT_ENDPOINTS:
        # Includes None, a hallucinated name, and anything non-string.
        return {"ok": False, "reason": f"invalid_intent:{str(intent)[:24]}"}
    return {"ok": True, "intent": intent}


async def resolve_intent(message: str, image: Optional[str]) -> tuple[str, str, Optional[str]]:
    """(intent, parser, degraded_reason).

    The acquired NLP engine first, keyword routing as the floor. Ordering is
    deliberate: the model handles paraphrase the keyword table will never
    cover — "my street is a tip and nobody has been round in a fortnight" — and
    the keyword table handles the model being absent, slow or wrong, which on a
    laptop with no Ollama is every single request.
    """
    fallback = detect_intent(message)
    if not OLLAMA_URL:
        return fallback, "keyword", None

    parsed = await parse_intent_llm(message)
    if parsed["ok"]:
        return parsed["intent"], "llm", None
    return fallback, "keyword", parsed["reason"]


async def handle(message: str, image: Optional[str] = None,
                 intent: Optional[str] = None) -> dict:
    """Route one message. Returns {intent, reply, data, degraded}.

    Every branch answers from module data or says plainly that it could not
    reach the module. Nothing here guesses at a figure — the vendor's own
    "never invent" rule, kept, and now enforceable because real numbers exist.
    """
    intent = intent or detect_intent(message)
    # A photo with no obvious question is a report if it carries a location,
    # and an identification request otherwise.
    if image and intent == "offtopic":
        intent = "report_bin" if extract_location(message) else "identify"
    degraded: dict[str, str] = {}
    data: dict[str, Any] = {}

    # ---------------------------------------------------------- report a bin
    if intent == "report_bin":
        location = extract_location(message)
        if location is None:
            return {"intent": "report_bin", "data": {"awaiting": "location"},
                    "degraded": None,
                    "reply": ("I can log that. Whereabouts is the bin? Send me "
                              'coordinates as "lat,lng" — for example '
                              '"there is an overflowing bin at 12.972,77.595".')}
        result = await report_bin(location, notes=message[:200], image=image)
        if not result["ok"]:
            degraded["bin_reporting"] = result["reason"]
            return {"intent": intent, "data": data, "degraded": degraded,
                    "reply": _unavailable("bin_reporting", "bin reporting", result["reason"])
                              + " Nothing was lost on your side."}
        d = result["data"]
        data = d
        bits = [f"Logged — reference {d['binId']}."]
        if d.get("type"):
            bits.append(f"It looks like {d['type']} waste.")
        if d.get("assignedWorker"):
            bits.append(f"{d['assignedWorker']} has been assigned.")
        elif (d.get("degraded") or {}).get("assignment") == "no_workers_available":
            bits.append("Every crew is out on a round, so it is queued for the "
                        "next one free.")
        if d.get("degraded"):
            degraded["intake_enrichment"] = json.dumps(d["degraded"])
        return {"intent": intent, "data": data, "degraded": degraded or None,
                "reply": " ".join(bits)}

    # -------------------------------------------------------- pickup status
    if intent == "pickup_status":
        match = BIN_ID_RE.search(message)
        if not match:
            recent = await recent_reports(5)
            if not recent["ok"]:
                degraded["bin_reporting"] = recent["reason"]
                return {"intent": intent, "data": data, "degraded": degraded,
                        "reply": _unavailable("bin_reporting", "bin reporting",
                                              recent["reason"])}
            reports = recent["data"]["reports"]
            data = {"recent": reports}
            if not reports:
                return {"intent": intent, "data": data, "degraded": None,
                        "reply": "Nothing has been reported yet."}
            lines = [f"  {r['id']} — {r['status']}" + (f" ({r['waste_type']})" if r.get("waste_type") else "")
                     for r in reports]
            return {"intent": intent, "data": data, "degraded": None,
                    "reply": "Which one? The most recent reports are:\n" + "\n".join(lines)}

        bin_id = match.group(0)
        report = await get_report(bin_id)
        if not report["ok"]:
            if report["reason"] == "upstream_404":
                return {"intent": intent, "data": data, "degraded": None,
                        "reply": f"I have no record of {bin_id}. Could it be a typo?"}
            degraded["bin_reporting"] = report["reason"]
            return {"intent": intent, "data": data, "degraded": degraded,
                    "reply": _unavailable("bin_reporting", "bin reporting",
                                          report["reason"])}
        r = report["data"]
        data = {"report": r}

        # RECONCILE TWO SOURCES OF TRUTH.
        #
        # bin_reporting owns the report; worker_dashboard owns the JOB. When a
        # crew completes an assignment, worker_dashboard notifies and emits to
        # analytics — but it never tells bin_reporting, because it is
        # domain-neutral and calling back into our intake module would create a
        # cycle and teach a resaleable module what a bin is. So the report can
        # legitimately still read "assigned" after the bin has been emptied.
        #
        # Reconciling belongs HERE. The assistant is the aggregator; it is the
        # only component that already talks to both, and answering "not yet"
        # to someone standing next to an empty bin is the one wrong answer that
        # loses a citizen's trust in the whole service.
        status = r["status"]
        crew_view = await assignments_for(bin_id)
        if crew_view["ok"]:
            live = next((a for a in crew_view["data"]["assignments"]), None)
            if live:
                data["assignment"] = live
                if live["status"] == "completed" and status != "cleared":
                    status = "cleared"
                    data["reconciled"] = {"report_status": r["status"],
                                          "crew_status": live["status"],
                                          "trusted": "worker_dashboard"}
                elif live["status"] == "in_progress" and status == "assigned":
                    status = "in_progress"
        else:
            degraded["worker_dashboard"] = crew_view["reason"]

        phrasing = {
            "reported": "logged and waiting to be assigned",
            "assigned": "assigned to a crew",
            "in_progress": "being collected now",
            "cleared": "been cleared",
        }.get(status, status)
        bits = [f"{bin_id} has {phrasing}." if status == "cleared"
                else f"{bin_id} is {phrasing}."]
        if r.get("waste_type"):
            bits.append(f"Recorded as {r['waste_type']}.")
        worker_name = ((data.get("assignment") or {}).get("worker_name")
                       or (r.get("assignment") or {}).get("worker_name"))
        if worker_name:
            bits.append(f"{worker_name} {'cleared' if status == 'cleared' else 'is handling'} it.")
        completed_at = (data.get("assignment") or {}).get("completed_at") or r.get("cleared_at")
        if status == "cleared" and completed_at:
            bits.append(f"Completed at {completed_at}.")
        return {"intent": intent, "data": data, "degraded": degraded or None,
                "reply": " ".join(bits)}

    # ------------------------------------------------------------ analytics
    if intent == "analytics":
        result = await get_analytics()
        if not result["ok"]:
            degraded["analytics_dashboard"] = result["reason"]
            return {"intent": intent, "data": data, "degraded": degraded,
                    "reply": _unavailable("analytics_dashboard", "the analytics service",
                                          result["reason"])
                              + " I would rather say that than guess at figures."}
        k = result["data"]["kpis"]
        data = {"kpis": k, "charts": list(result["data"]["charts"])}
        mix = result["data"]["charts"]["waste_mix"]
        top = f" Most common waste type: {mix['labels'][0]}." if mix["labels"] else ""
        return {"intent": intent, "data": data, "degraded": None,
                "reply": (f"{k['reported']} {_plural(k['reported'], 'bin')} reported, "
                          f"{k['collected']} collected, "
                          f"{k['outstanding']} still outstanding — a collection rate of "
                          f"{round(k['collection_rate'] * 100)}%. "
                          f"Average time to clear: {k['avg_resolution_minutes']} minutes "
                          f"(90th percentile {k['p90_resolution_minutes']}). "
                          f"{k['active_workers']} crew active, "
                          f"{k['notifications_sent']} "
                          f"{_plural(k['notifications_sent'], 'notification')} sent.{top}")}

    # ------------------------------------- classify a photo (waste_recognition)
    if intent == "identify":
        if not image:
            return {"intent": intent, "data": {"awaiting": "image"}, "degraded": None,
                    "reply": ("Send me a photo of it and I will tell you what kind "
                              "of waste it is. Attach it as `image` on your message.")}
        result = await detect_waste(image)
        if not result["ok"]:
            degraded["waste_recognition"] = result["reason"]
            return {"intent": intent, "data": data, "degraded": degraded,
                    "reply": _unavailable("waste_recognition", "the waste classifier",
                                          result["reason"])}
        d = result["data"]
        data = d
        alts = ", ".join(a["label"] for a in d.get("alternatives", [])) or "nothing else"
        return {"intent": intent, "data": data, "degraded": None,
                "reply": (f"That looks like {d['label'].lower()} — "
                          f"{round(d['confidence'] * 100)}% confident. "
                          f"{'Recyclable.' if d['recyclable'] else 'Not recyclable.'}"
                          f"{' Handle as hazardous.' if d['hazardous'] else ''} "
                          f"Next most likely: {alts}.")}

    # -------------------------------------- notify someone (notification_system)
    if intent == "notify":
        match = BIN_ID_RE.search(message)
        if not match:
            return {"intent": intent, "data": {"awaiting": "bin_id"}, "degraded": None,
                    "reply": ("Which bin should I send the alert about? Give me its "
                              "reference, like bin_1a2b3c4d5e6f.")}
        who = "worker" if "worker" in message.lower() or "crew" in message.lower() else (
              "admin" if "admin" in message.lower() or "supervisor" in message.lower()
              else "citizen")
        result = await notify_pickup(match.group(0), recipient_type=who)
        if not result["ok"]:
            degraded["notification_system"] = result["reason"]
            return {"intent": intent, "data": data, "degraded": degraded,
                    "reply": _unavailable("notification_system", "the notification service",
                                          result["reason"]) + " Nothing was sent."}
        d = result["data"]
        data = d
        delivered = d.get("delivery_status") == "delivered"
        return {"intent": intent, "data": data, "degraded": None,
                "reply": (f"{'Sent' if delivered else 'Queued'} to the {d['recipient']} "
                          f"for {d['binId']} — reference {d['messageId']}."
                          + ("" if delivered else
                             f" Only in-app delivers on this build, so it is sitting as "
                             f"{d['delivery_status']}."))}

    # ------------------------------------------ assign a worker (worker_dashboard)
    if intent == "assign_worker":
        bin_match = BIN_ID_RE.search(message)
        if not bin_match:
            return {"intent": intent, "data": {"awaiting": "bin_id"}, "degraded": None,
                    "reply": ("Which bin? Give me its reference — for example "
                              '"assign Asha to bin_1a2b3c4d5e6f".')}
        bin_id = bin_match.group(0)

        # Resolve a name to an id: people say "Asha", not "wrk_5959cf3464df".
        worker_id = None
        wid_match = WORKER_ID_RE.search(message)
        if wid_match:
            worker_id = wid_match.group(0)
        else:
            crew = await list_workers()
            if crew["ok"]:
                named = next((w for w in crew["data"]["workers"]
                              if w["name"].split()[0].lower() in message.lower()), None)
                worker_id = named["id"] if named else None
            else:
                degraded["worker_dashboard"] = crew["reason"]

        result = await assign_worker(bin_id, worker_id, extract_location(message))
        if not result["ok"]:
            degraded["worker_dashboard"] = result["reason"]
            hint = ""
            if result["reason"] == "upstream_400":
                # The optimizer cannot resolve a bin id to coordinates, and nor
                # can the crew system — a brand-new job needs a location.
                hint = (" If this bin has not been reported yet I need its "
                        'coordinates too, as "lat,lng".')
            elif result["reason"] == "upstream_409":
                hint = " It may already be assigned to them."
            return {"intent": intent, "data": data, "degraded": degraded,
                    "reply": f"I could not make that assignment.{hint}"}
        d = result["data"]
        data = d
        moved = f" Taken off {d['reassignedFrom']}." if d.get("reassignedFrom") else ""
        return {"intent": intent, "data": data, "degraded": degraded or None,
                "reply": (f"{d['workerName']} now has {d['binId']} — {d['status']}, "
                          f"{_km(d.get('distance_km'))} away ({d['mode']}).{moved}")}

    # ------------------------------------------------------ routes / workers
    if intent == "route" and len(extract_locations(message)) >= 2:
        # Coordinates in hand: plan them directly rather than going via a crew
        # round. This is the only path that touches route_optimizer without
        # worker_dashboard in the middle.
        points = extract_locations(message)
        result = await optimize_stops(points)
        if not result["ok"]:
            degraded["route_optimizer"] = result["reason"]
            return {"intent": "route", "data": {"points": points}, "degraded": degraded,
                    "reply": _unavailable("route_optimizer", "the route planner",
                                          result["reason"])}
        d = result["data"]
        data = d
        lines = [f"  {s['sequence']}. {s['location']['lat']},{s['location']['lng']} "
                 f"— {_km(s['leg_distance_km'])}" for s in d["stops"]]
        saved = (f" 2-opt saved {d['improvement_km']} km over the greedy order."
                 if d.get("improvement_km") else "")
        return {"intent": "route", "data": data, "degraded": None,
                "reply": (f"Best order for those {len(points)} stops — "
                          f"{_km(d['total_distance_km'])} total.{saved}\n" + "\n".join(lines))}

    if intent in ("route", "worker"):
        workers = await list_workers()
        if not workers["ok"]:
            degraded["worker_dashboard"] = workers["reason"]
            return {"intent": intent, "data": data, "degraded": degraded,
                    "reply": _unavailable("worker_dashboard", "the crew system",
                                          workers["reason"])}
        crew = workers["data"]["workers"]
        data = {"workers": crew}
        if not crew:
            return {"intent": intent, "data": data, "degraded": None,
                    "reply": "No crew are registered yet."}

        wid_match = WORKER_ID_RE.search(message)
        named = next((w for w in crew if w["id"] == wid_match.group(0)), None) if wid_match else None
        if named is None:
            named = next((w for w in crew if w["name"].split()[0].lower() in message.lower()), None)

        if intent == "worker" and named is None:
            bin_match = BIN_ID_RE.search(message)
            if bin_match:
                found = await assignments_for(bin_match.group(0))
                if not found["ok"]:
                    degraded["worker_dashboard"] = found["reason"]
                    return {"intent": intent, "data": data, "degraded": degraded,
                            "reply": "I cannot reach the crew system to check that."}
                items = found["data"]["assignments"]
                data = {"assignments": items}
                if not items:
                    return {"intent": intent, "data": data, "degraded": None,
                            "reply": f"Nobody is assigned to {bin_match.group(0)} yet."}
                a = items[0]
                return {"intent": intent, "data": data, "degraded": None,
                        "reply": (f"{a['worker_name']} has {a['job_ref']} — "
                                  f"{a['status']}, {_km(a.get('distance_km'))} away.")}
            lines = [f"  {w['name']} ({w['id']}) — {w['status']}, "
                     f"{w['open_assignments']} open / {w['completed_assignments']} done"
                     for w in crew]
            return {"intent": intent, "data": data, "degraded": None,
                    "reply": "Here is the crew:\n" + "\n".join(lines)}

        target = named or crew[0]
        queue = await worker_queue(target["id"])
        if not queue["ok"]:
            degraded["worker_dashboard"] = queue["reason"]
            return {"intent": intent, "data": data, "degraded": degraded,
                    "reply": f"I found {target['name']}, but could not load their round."}
        q = queue["data"]
        data = {"queue": q}
        if not q["stops"]:
            return {"intent": intent, "data": data, "degraded": None,
                    "reply": f"{target['name']} has no open stops right now."}
        if not q["optimized"]:
            # Honest about a degraded upstream rather than presenting an
            # arbitrary order as a planned route.
            degraded["route_optimizer"] = q.get("degraded_reason", "unavailable")
            return {"intent": intent, "data": data, "degraded": degraded,
                    "reply": (f"{target['name']} has {len(q['stops'])} "
                              f"{_plural(len(q['stops']), 'stop')}, but the "
                              "route planner is down so I cannot give you them in "
                              "order — the list is unsequenced.")}
        lines = [f"  {s['sequence']}. {s['job_ref']} — {_km(s.get('leg_distance_km'))}"
                 for s in q["stops"]]
        return {"intent": intent, "data": data, "degraded": None,
                "reply": (f"{target['name']}'s round: {len(q['stops'])} "
                          f"{_plural(len(q['stops']), 'stop')} over "
                          f"{_km(q['total_distance_km'])}, sequenced by "
                          f"{q['strategy']}.\n" + "\n".join(lines))}

    # ----------------------------------------------------------- help / else
    if intent == "help":
        return {"intent": intent, "data": {}, "degraded": None,
                "reply": ("I can help you with four things:\n"
                          '  · report a bin — "overflowing bin at 12.972,77.595"\n'
                          '  · check a pickup — "what is happening with bin_1a2b3c4d5e6f"\n'
                          '  · see the numbers — "how are we doing this week"\n'
                          '  · crews and routes — "what is on Asha\'s round"\n'
                          '  · assign or notify — "assign Asha to bin_1a2b3c4d5e6f"')}

    return {"intent": "offtopic", "data": {}, "degraded": None,
            "reply": (f"I look after {', '.join(SCOPE_HINT[:-1])} {SCOPE_HINT[-1]}. "
                      "What would you like to know?")}


# ---------------------------------------------------------------------------
# PERSONA — replaces the vendor's TravelBuddy prompt.
#
# The model is given the ANSWER and asked to say it nicely. It is never the
# source of a fact. The vendor's "never invent" rule is kept and tightened,
# because now there is real data to be faithful to.
# ---------------------------------------------------------------------------
PERSONA = """You are the assistant for a city waste collection service.

You have already been given the correct answer in DRAFT, computed from live
system data in DATA. Your only job is to say it back to the user warmly and
clearly, in at most three short sentences.

HARD RULES:
- Every number, id, name and status in your reply must appear in DATA or
  DRAFT. Invent nothing. If DRAFT says something could not be checked, say
  that plainly — do not fill the gap.
- Do not add advice, pleasantries about the weather, or offers you cannot
  fulfil.
- Keep every reference id exactly as written (for example bin_1a2b3c4d5e6f).
- Plain language. No markdown, no bullet characters, no emoji.

DATA:
{data}

DRAFT:
{draft}

CONVERSATION SO FAR:
{history}

USER MESSAGE:
{message}

Rewrite DRAFT as your reply."""


app_store = Store({"conversations": []})


def fail(status: int, code: str, message: str) -> JSONResponse:
    """Vendor-shaped error envelope, matching the shipped {"detail": ...}
    convention that its existing clients parse."""
    return JSONResponse(status_code=status, content={"detail": message, "code": code})


class AuthError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status, self.code, self.message = status, code, message


class SuvidaRoute(APIRoute):
    """Carries the error envelope with the route, so it survives being mounted
    into another app — same reason as the other two acquired modules."""

    def get_route_handler(self):
        original = super().get_route_handler()

        async def handler(request: Request) -> Response:
            try:
                return await original(request)
            except AuthError as exc:
                return fail(exc.status, exc.code, exc.message)

        return handler


router = APIRouter(route_class=SuvidaRoute)


def require_api_key(x_api_key: Optional[str] = Header(None)):
    """FAILS CLOSED. The shipped check did not.

    Original: `if x_api_key != API_KEY: raise 401`, with
    `API_KEY = os.getenv("API_KEY")` and no fallback. Unset env var -> None;
    absent header -> None; None != None is False -> the request was let
    through. Verified against the acquired source before rewriting.

    A missing header is now rejected on its own terms, before any comparison,
    and the key itself always has a value.
    """
    if not x_api_key:
        raise AuthError(401, "missing_api_key", "X-API-Key header is required.")
    if not secrets.compare_digest(x_api_key, API_KEY):
        raise AuthError(403, "invalid_api_key", "Invalid API key")
    return x_api_key


class ChatResponse(BaseModel):
    """The structured half of every answer.

    `reply` is the vendor's contract and the human-readable half; everything
    else is machine-readable, so a UI can render a card, a chart or a map
    instead of a paragraph, and a caller can see exactly what happened.

    Typed rather than a bare dict so the shape is enforced at runtime and shows
    up in OpenAPI — an untyped response documents as "object" and tells an
    integrator nothing.
    """
    reply: str = Field(..., description="Human-readable answer (vendor contract)")
    intent: str = Field(..., description="Resolved intent")
    endpoint: Optional[str] = Field(None, description="The API this intent maps to")
    parser: str = Field(..., description='"llm" (acquired NLP engine) or "keyword" (fallback)')
    source: str = Field(..., description='"llm" if the model phrased the reply, else "template"')
    data: dict[str, Any] = Field(default_factory=dict,
                                 description="Structured payload from the module that answered")
    degraded: Optional[dict[str, str]] = Field(
        None, description="What was skipped and why; null when everything succeeded")
    history: list = Field(default_factory=list)


class ChatRequest(BaseModel):
    """The vendor's request shape, plus one additive optional field.

    `image` lets a citizen attach a photo to a report or ask what something is,
    which is what reaches waste_recognition. A client written against the
    acquired API never sends it and is unaffected.
    """
    message: str
    history: list = Field(default_factory=list)
    image: Optional[str] = Field(None, description="base64 photo, optional")


@router.get("/health")
def health():
    return {"ok": True, "module": "chatbot", "version": APP_VERSION,
            "vendor": VENDOR, "llm_required": False,
            "dependencies": dependency_config()}


@router.get("/intents")
def intents(_=Depends(require_api_key)):
    """The routing table, as data.

    Returns each intent with the API it maps to, so a UI can render chips and
    an integrator can see the wiring without reading the source.
    """
    return {"parser": "llm+keyword" if OLLAMA_URL else "keyword",
            "map": INTENT_ENDPOINTS,
            "intents": sorted(INTENT_ENDPOINTS),
            "examples": {
                "report_bin": "overflowing bin at 12.972,77.595",
                "pickup_status": "what is happening with bin_1a2b3c4d5e6f",
                "analytics": "how are we doing this week",
                "route": "what is on Asha's round",
                "worker": "who is assigned to bin_1a2b3c4d5e6f",
                "assign_worker": "assign Asha to bin_1a2b3c4d5e6f",
                "notify": "let the resident know about bin_1a2b3c4d5e6f",
                "identify": "what kind of waste is this (with image)",
            }}


@router.post("/chat", response_model=ChatResponse,
             response_model_exclude_none=False)
async def chat(request: ChatRequest, _=Depends(require_api_key)):
    """Talk to the network. The vendor's contract: {message, history} -> {reply}.

    Extra keys are additive — `intent`, `data`, `source` and `degraded` let a
    UI render a card instead of a wall of text, and let a caller see which
    module answered and what was skipped. A client written against the
    original API can ignore all of them and read `reply`.
    """
    message = (request.message or "").strip()
    if not message:
        return fail(400, "empty_message", "message must not be empty.")
    if len(message) > MAX_MESSAGE_CHARS:
        return fail(413, "message_too_long",
                    f"message exceeds {MAX_MESSAGE_CHARS} characters.")

    history = request.history[-MAX_HISTORY_TURNS:] if request.history else []

    # 1. PARSE — the acquired NLP engine, validated, keyword routing beneath it.
    intent, parser, parse_failure = await resolve_intent(message, request.image)

    # 2. ACT — map the intent to an API call and run it.
    outcome = await handle(message, request.image, intent)
    draft = outcome["reply"]
    degraded = dict(outcome["degraded"] or {})
    if parse_failure:
        degraded["intent_parser"] = parse_failure

    # --- optional: let the model say it more naturally --------------------
    source = "template"
    reply = draft
    if OLLAMA_URL:
        polished = await rephrase(PERSONA.format(
            data=json.dumps(outcome["data"], default=str)[:4000],
            draft=draft,
            history=json.dumps(history, default=str)[:2000],
            message=message))
        if polished["ok"]:
            reply, source = polished["data"], "llm"
        else:
            # The answer still stands; only its phrasing was skipped.
            degraded["llm"] = polished["reason"]

    record = {"id": app_store.new_id("cnv"), "message": message,
              "intent": outcome["intent"], "parser": parser, "source": source,
              "degraded": degraded or None, "at": app_store.now()}
    data = app_store.read()
    data["conversations"].insert(0, record)
    data["conversations"] = data["conversations"][:500]
    app_store.write(data)

    # 3. RETURN — text for a person, JSON for a program, in one envelope.
    return ChatResponse(
        reply=reply,
        intent=outcome["intent"],
        endpoint=INTENT_ENDPOINTS.get(outcome["intent"]),
        parser=parser,
        source=source,
        data=outcome["data"],
        degraded=degraded or None,
        history=history + [{"user": message, "assistant": reply}],
    )


@router.get("/conversations")
def conversations(limit: int = 50, _=Depends(require_api_key)):
    """Capped audit log — which intents people actually use, and what degraded."""
    return {"conversations": app_store.read()["conversations"][:min(limit, 500)]}


@router.get("/", include_in_schema=False)
def index(request: Request):
    """Root index.

    Exists because a bare `GET /` otherwise returns {"detail": "Not Found"} —
    the first thing anyone does with a new service is open its root in a
    browser, and a bare 404 tells them nothing about whether the thing is even
    running.

    Route list is derived from `router.routes`, not hand-written, so it cannot
    drift as routes are added. `mounted_at` comes from the request path, so the
    links are correct whether this runs standalone on its own port or behind a
    prefix inside the composed app.
    """
    base = request.url.path.rstrip("/")
    paths = sorted({r.path for r in router.routes
                     if getattr(r, "path", None) and r.path != "/"})
    return {
        "module": "chatbot",
        "version": APP_VERSION,
        "position": "BOUGHT — Suvida Chatbot",
        "status": "running",
        "docs": "/docs",
        "openapi": "/openapi.json",
        "mounted_at": base or "/",
        "routes": [base + p for p in paths],
    }


# --------------------------------------------------------------- packaging
# TWO DEPLOYMENT SHAPES, ONE IMPLEMENTATION.
#
#   router — mount into any FastAPI app:
#              app.include_router(router, prefix="/chat")
#   app    — run this module as its own service:
#              uvicorn chatbot:app --port 8007
app = FastAPI(title=f"{VENDOR} — waste collection assistant", version=APP_VERSION)
app.include_router(router)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8007)))

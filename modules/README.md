# Tradable Module Registry

Six independently owned, independently deployable modules. Each one can be
sold, licensed, or transferred to another operator without touching the other
five — that is the design constraint everything below follows from.

| Module | Port | Origin | Base path | Auth |
|---|---|---|---|---|
| [`bin_reporting`](./bin_reporting) | 4101 | in-house | `/api/v1` | none (public intake) |
| [`waste_recognition`](./waste_recognition) | 4102 | in-house | `/api/v1` | none |
| [`route_optimizer`](./route_optimizer) | 4103 | in-house | `/api/v1` | none |
| [`analytics_dashboard`](./analytics_dashboard) | 4104 | in-house | `/api/v1` | none |
| [`notification_system`](./notification_system) | 4105 | **acquired** | `/v1` | `X-API-Key` |
| [`worker_dashboard`](./worker_dashboard) | 4106 | **acquired** | `/v1` | `Authorization: Bearer` |

## What "tradable" enforces

**1. No shared code.** No module imports from another module's source tree, and
there is no common library. Each vendors its own datastore, its own HTTP
helper, its own geo math. This duplicates perhaps 60 lines across the registry
— that is the deliberate price of being able to hand any single directory to a
buyer and have it work.

**2. No shared database.** Each module owns its own `src/data/*.json` store and
is the sole writer of its own records. Cross-module data is fetched over HTTP,
never read from another module's disk.

**3. Dependencies are capabilities, not module names.** A module declares what
it *needs* (`waste.classify`), not who provides it. The provider is injected as
a URL at runtime:

```bash
WASTE_RECOGNITION_URL=http://localhost:4102   # swap for any conforming vendor
```

Sell `waste_recognition` to a competitor and point the env var at their
hosted endpoint — `bin_reporting` neither knows nor cares.

**4. Degradation is mandatory, not optional.** Every outbound call has a
timeout and a defined fallback. If `waste_recognition` is down, a bin still
gets reported and is marked `unclassified` for later backfill. A module whose
dependency is unavailable must degrade, never fail. This is what makes the
modules genuinely separable rather than a distributed monolith.

**5. Every module ships its own contract.** `module.json` (commercial +
technical manifest), `openapi.yaml` (API contract), `README.md` (integration
docs), and `samples/` (real request/response pairs) live inside each directory.

## The acquired modules

`notification_system` and `worker_dashboard` were acquired rather than built
in-house, and they are deliberately **not** normalized to match the other four.
They keep their original vendor conventions:

- `/v1` base path instead of `/api/v1`
- `snake_case` JSON instead of `camelCase`
- their own auth schemes (API key; bearer token)
- their own error envelope shape

This is what integrating a purchased component actually looks like. Rewriting
their surface to match house style would destroy the property that makes them
tradable — a buyer expects the API they bought, and the upstream vendor's
own docs and client SDKs must keep working. The adaptation cost is carried at
the call site (see `bin_reporting/src/clients.js`), which is the correct place
for it. Each acquired module's provenance, license terms and transfer rights
are recorded in its `module.json` under `provenance`.

## Dependency graph

```
      bin_reporting (4101)
        │      │        │
 classify│  emit│        │request assignment
        ▼      ▼        ▼
 waste_      analytics_  worker_dashboard (4106) ──notify──▶ notification_system (4105)
 recognition  dashboard        │
 (4102)       (4104)           └──optimize──▶ route_optimizer (4103)
```

Acyclic. `waste_recognition`, `route_optimizer`, `analytics_dashboard` and
`notification_system` are leaves with zero outbound dependencies — the four
most readily sold standalone.

## Running

Each module runs on its own:

```bash
cd modules/waste_recognition
cp .env.example .env          # optional — defaults work as-is
npm install
npm start                     # :4102, fully functional alone
```

Or run the whole mesh:

```bash
npm run install:modules       # from repo root — installs all six
npm run modules:start         # :4101-:4106, dependencies pre-wired
npm run modules:test          # 34-check integration suite
```

## Flat alias API

Alongside the canonical REST routes, five flat verb-style endpoints are
available. They are **additive aliases, not replacements** — each calls the
same underlying function as its canonical counterpart, so the two surfaces
cannot drift apart.

| Endpoint | Module | Port | Canonical equivalent |
|---|---|---|---|
| `POST /reportBin` | `bin_reporting` | 4101 | `POST /api/v1/reports` |
| `POST /detectWasteType` | `bin_reporting` | 4101 | `POST /api/v1/reports/:id/reclassify` |
| `GET /optimizeRoute?bins=[...]` | `route_optimizer` | 4103 | `POST /api/v1/optimize` |
| `GET /analytics` | `analytics_dashboard` | 4104 | `GET /api/v1/summary` + `/trends` |
| `POST /notifyPickup` | `notification_system` | 4105 | `POST /v1/messages` |

```bash
curl -X POST http://localhost:4101/reportBin -H 'Content-Type: application/json' \
  -d '{"image":"<base64>","location":"12.972,77.595"}'
# -> { "binId": "bin_...", "type": "plastic", "status": "assigned", ... }

curl -X POST http://localhost:4101/detectWasteType -H 'Content-Type: application/json' \
  -d '{"binId":"bin_..."}'                         # -> { "type": "plastic", ... }

curl -G http://localhost:4103/optimizeRoute \
  --data-urlencode 'bins=[{"lat":12.97,"lng":77.64},{"lat":12.96,"lng":77.63}]'

curl http://localhost:4104/analytics                # -> chart-ready series

curl -X POST http://localhost:4105/notifyPickup -H 'X-API-Key: dev-signalpost-key' \
  -H 'Content-Type: application/json' -d '{"binId":"bin_..."}'
```

Three placement decisions are worth knowing, because each was forced by the
architecture rather than chosen for convenience:

**`/detectWasteType` lives on `bin_reporting`, not `waste_recognition`.** It
is keyed by `binId`, and `waste_recognition` is a stateless leaf that never
sees bin records — only raw image bytes. Giving it binId lookup would force it
to call `bin_reporting`, creating a cycle
(`bin_reporting → waste_recognition → bin_reporting`) and destroying the
dependency-free property that makes it the registry's most sellable module.
`bin_reporting` owns bin records and already calls the classifier, so
resolving `binId → photo → type` belongs there.

**`/optimizeRoute` needs coordinates, not bin ids.** The same statelessness
means it cannot turn `"bin_1fab6e"` into a location. Passing bare ids returns
`400` with a hint naming the two ways to get coordinates — fetch them from
`bin_reporting`, or use `worker_dashboard`'s `GET /v1/workers/:id/queue`,
which resolves and sequences in one call. `bins` accepts `{lat,lng}`,
`{location:{...}}`, or the compact `"lat,long"` string.

**`/notifyPickup` is still authenticated.** It sits at the root path, outside
the `/v1` prefix its API-key gate covers, so the same check is applied to it
explicitly. An unauthenticated notification endpoint is a spam vector, and an
alias must never become a way around auth — there is a test asserting it
returns `401` without a key.

Everything else about the aliases is convenience: `"lat,long"` string parsing,
base64 image intake (a `data:` URL prefix is tolerated), `binId` promoted to
the top level of the `/reportBin` response since that is what a caller needs
next, chart-ready parallel `labels`/`values` arrays from `/analytics`, and a
composed default message from `/notifyPickup`.

## Configuration

Every module carries a `.env.example` documenting exactly the variables it
reads — nothing aspirational. Copy it to `.env` and edit; each module loads
its own file via Node's built-in `process.loadEnvFile` (no dependency added).

**Real environment variables take precedence over `.env`**, so container and
CI configuration always wins over a stray local file. Every variable has a
working default, so `.env` is optional for local development.

Two secrets are shared between a service and its callers and must match on
both sides:

| Secret | Owned by | Read by |
|---|---|---|
| `NOTIFY_API_KEY` | `notification_system` | `worker_dashboard` |
| `CREW_AUTH_TOKEN` | `worker_dashboard` | `bin_reporting` |

> The committed defaults (`dev-signalpost-key`, `dev-fieldops-token`) are
> **public knowledge** — they are the fallbacks baked into the source. Change
> both before running anywhere you do not fully control.

Real `.env` files are gitignored at every depth; `.env.example` files are
tracked.

## Mock datasets

A coherent seven-day dataset spanning all six modules — 8 workers, 34 bin
reports across 12 Bengaluru neighbourhoods, and the matching assignments,
notifications, classifications and events.

```bash
npm run mocks:seed        # load fixtures into every module's store
npm run mocks:reset       # empty every store
npm run mocks:generate    # regenerate the fixtures themselves
```

Modules re-read their store per request, so seeding takes effect immediately
with no restart.

**Referential integrity is the point.** A bin id minted by the generator
appears as `bin_reporting`'s report id, `worker_dashboard`'s assignment
`job_ref`, `notification_system`'s `subject_ref`, `waste_recognition`'s
`reference`, and `analytics_dashboard`'s event `subject_id`. Six
hand-written fixture files would drift apart within a week and make
cross-module testing worthless, so `scripts/generate-mocks.js` derives all of
them from one pass.

Generation is deterministic (fixed PRNG seed), so regenerating produces
byte-identical files and fixtures diff cleanly.

The lifecycle mix deliberately exercises every path a consumer hits: ~50%
cleared (drives resolution-time metrics), plus in-progress, assigned, and
still-reported bins (the backlog case). Seeding rebases every timestamp onto
the current date — fixtures are generated against a fixed anchor for stable
diffs, and without rebasing the seven-day trend window would render empty.

`route_optimizer` holds no state, so instead of records its
`mocks/scenarios.json` carries five solvable routing scenarios — including
`crossing_path`, built so greedy nearest-neighbor self-crosses and 2-opt
reports a non-zero `improvement_km`, and `empty`, which must return an empty
route rather than an error.

Seeding writes to the store files directly rather than through the REST APIs,
because the APIs correctly stamp timestamps as *now* and would collapse the
week-long dataset onto today. It is therefore a fixture loader, not a
demonstration that the APIs work — `npm run modules:test` is what exercises
those.

## Manifest schema

Every `module.json` carries both halves of a trade — what the software does,
and what is being bought:

```jsonc
{
  "module": "bin_reporting",
  "version": "1.0.0",
  "provenance": {
    "origin": "in-house" | "acquired",
    "owner": "...",
    "license": "...",
    "transferable": true,
    // acquired modules add: acquired_from, acquisition_date,
    // original_product, support_contract_expires
  },
  "trade": {
    "status": "available" | "not_for_sale",
    "pricing": { "model": "...", "currency": "USD", "monthly": 0 },
    "sla": { "uptime": "...", "p95_latency_ms": 0 }
  },
  "interface": {
    "protocol": "REST/HTTP",
    "base_path": "...", "default_port": 0, "auth": "...",
    "openapi": "./openapi.yaml"
  },
  "provides": ["capability.name"],
  "requires": [ { "capability": "...", "env": "...", "optional": true,
                  "degradation": "what happens when absent" } ],
  "owns_data": ["record types this module is sole writer of"]
}
```

## Relationship to `backend/`

`backend/` remains the integrated reference implementation — a single process
covering all six concerns, and still the fastest way to demo the product. The
`modules/` tree is the same capability set decomposed along ownership lines so
the pieces can be traded individually. They are alternative packagings of one
product, not two competing codebases; run whichever fits the situation.

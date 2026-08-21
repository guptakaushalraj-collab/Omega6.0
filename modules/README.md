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
npm install
npm start                     # :4102, fully functional alone
```

Or run the whole mesh:

```bash
npm install          # from repo root — installs all six
npm run modules:start
npm run modules:test          # end-to-end integration check
```

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

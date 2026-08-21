# Module Trading Ledger

Positions taken on the six modules in the registry, the reasoning behind
each, and the engineering consequences.

Machine-readable equivalents live in each module's `module.json` under
`trade`. This file is the narrative; those are the record of truth.

Verify the whole registry is transferable at any time with:

```bash
npm run compliance
```

---

## Positions

| Module | Position | Licence | Notes |
|---|---|---|---|
| `waste_recognition` | **SELL** — $42,000 | MIT | Stateless, dependency-free |
| `route_optimizer` | **SELL** — $28,000 | MIT | Pure computation, no state |
| `analytics_dashboard` | **SELL** — $35,000 | MIT | Push-based, vertical-agnostic |
| `notification_system` | **BUY / KEEP** | Proprietary | Acquired 2026-03-14 |
| `worker_dashboard` | **BUY / KEEP** | Proprietary | Acquired 2025-11-02 |
| `bin_reporting` | **HOLD** | MIT | Not offered — see below |

Total asking price on the divestment: **$105,000**.

> **Counterparties are not yet named.** No buyer had been agreed when this
> ledger was written, so `settlement.counterparty` is `null` in all three
> sold manifests and must be completed at signing. Everything else — terms,
> what conveys, the licence-back — is settled.

---

## The decision that keeps the product alive

Both retained modules consume capabilities from all three being sold:

```
bin_reporting     → waste.classify    (waste_recognition)
bin_reporting     → analytics.ingest  (analytics_dashboard)
worker_dashboard  → route.optimize    (route_optimizer)
worker_dashboard  → analytics.ingest  (analytics_dashboard)
```

An outright sale with no continued-use right would stop the product on
settlement day. So each sale conveys the copyright, the right to exploit and
the right to resell — while **retaining a perpetual, royalty-free
licence-back** scoped to internal operation of this network. We keep running
the software; we do not keep the right to resell it.

That is the ordinary arrangement when divesting a component you still
consume, and it costs the buyer little: our internal usage is not the market
they are buying into.

Post-sale, operation continues one of two ways, **with no code change either
way**:

1. Keep running our own instance under the licence-back.
2. Repoint the consumer's capability variable at the buyer's hosted endpoint:
   ```bash
   WASTE_RECOGNITION_URL=https://buyer.example.com
   ```

This is the property the architecture was built for. Dependencies were always
declared as *capabilities* resolved from environment variables, never as
module names bound at import time — precisely so ownership could change
without the code noticing.

---

## Why these three

**`waste_recognition`** — no state beyond a capped audit log, no outbound
dependencies, and model-agnostic. The value is in the API contract and
integration surface, not the stub classifier, so a buyer brings their own
inference and gets an interface that already has consumers. Cleanest asset to
separate.

**`route_optimizer`** — pure computation. No datastore, no dependencies, no
coordination needed between replicas, so it scales horizontally for free. It
is worth more to an operator with real routing volume than to us at our
current scale.

**`analytics_dashboard`** — push-based: it derives everything from events it
is sent and never reads another system's database. Any operator willing to
emit six documented event shapes can adopt it, which puts the buyer pool well
beyond waste collection.

## Why `bin_reporting` is not offered

It is the citizen-facing entry point and the orchestrator. Selling it would
be selling the product, not a component. It also owns the bin records the
whole network is about.

## Why the acquired two are kept

**`worker_dashboard`** is the highest-value asset here: the only one with a
source-escrow agreement, and the only one whose vocabulary is deliberately
vertical-agnostic (`job_ref`, not `bin_id`), so it resells outside waste
collection without modification. Keeping it keeps that optionality.

**`notification_system`** carries a live deadline — see below.

---

## Open risks

### SignalPost support window closes 2027-03-14

`notification_system`'s vendor support transfers to an acquirer **only if
they assume the SignalPost maintenance agreement before that date**. After
it, the software transfers as-is with no vendor support path and no successor
agreement on the original terms.

Since the decision is to keep the module, the exposure is our own support
continuity rather than a transfer risk — but the date still bounds any future
option to sell it with support attached. `npm run compliance` prints a live
countdown.

### Three delivery channels do not work

`notification_system` accepts `sms`, `email` and `push`, records them as
`queued`, and sends nothing. The gateway credentials were excluded from the
original acquisition. Only `in_app` delivers.

This is disclosed in the module's `LICENSE`, its `README`, and any generated
`HANDOVER.md`. It must not be discovered by a counterparty after signing.

### Concentration risk after the sale

Divesting three of six leaves the network owning `bin_reporting` outright and
operating two purchased modules under proprietary licences. If a licence-back
were ever lost or a vendor relationship soured, three capabilities would need
replacing at once. The capability indirection makes replacement mechanical
rather than architectural, but the exposure is real and worth revisiting
before any further divestment.

---

## Compliance

Every module must be extractable as its own repository before it can be
traded. That is enforced mechanically, not asserted:

```bash
npm run compliance                                    # 67 checks, all six modules
node scripts/extract-module.js waste_recognition /tmp/wr
```

The checker covers three groups:

- **Isolation** — no imports from sibling modules, no shared datastore, no
  filesystem paths escaping the module directory, outbound targets resolved
  only from the environment.
- **Artefacts** — `package.json`, `LICENSE`, `README.md`, `module.json`,
  `.env.example` and `.gitignore` all present inside the directory.
- **Legal** — provenance recorded, the declared licence matching the actual
  `LICENSE` file, transferability declared, and restrictions surfaced with a
  countdown rather than buried in a footnote.

Extraction copies source, contract, docs, licence, mocks and samples; it
excludes `node_modules`, runtime state, uploaded files and any real `.env` —
a buyer must never inherit our secrets. It writes a `HANDOVER.md` generated
from the module's own manifest, so commercial terms travel with the code
instead of living in an email thread, and initialises a git repo with one
commit.

Verified end to end: `waste_recognition` was extracted to a temporary
directory outside this repo, installed, started on an unrelated port, and
classified an image correctly with nothing from the parent project present.

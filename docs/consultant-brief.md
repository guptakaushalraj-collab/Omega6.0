# Integration Consultant — 30-Minute Engagement

**Scope:** one 30-minute session · **Deliverable:** a signed-off integration
verdict on the divestment

---

## Read this first: what 30 minutes actually buys

Thirty minutes is enough for a **verification and risk review**, not
implementation. The integration work is already done and machine-checked; what
has *not* happened is an independent party confirming it before money changes
hands.

So this engagement is deliberately scoped to: run the checks, interrogate the
two things that could go wrong, and give a go/no-go. Anyone promising to
*build* integration in half an hour is mis-scoping the job — say so and
rebook.

Everything below is runnable. Nothing requires reading the codebase.

---

## Pre-session (client responsibility, ~5 min before the call)

The consultant should arrive to a working environment, not spend their half
hour on `npm install`.

```bash
git clone <repo> && cd Omega6.0
npm run install:modules      # ~30s
npm run modules:start        # leave running in a second shell
npm run mocks:seed
```

Confirm all six report healthy before the session starts.

---

## Minutes 0–5 — Establish the baseline

```bash
npm run compliance
```

**Expect:** 67 checks across 6 modules, 0 blocking, 1 advisory.

The advisory is the SignalPost support window (2027-03-14) and is expected —
confirm the consultant sees it and understands it is disclosed, not hidden.

```bash
npm run modules:test
```

**Expect:** 47 passed, 0 failed. This covers composition, auth enforcement,
and degradation.

*Consultant's job here:* confirm the checks are real rather than
self-certifying. Spot-check one assertion in `scripts/compliance-check.js`
against the module it claims to verify.

---

## Minutes 5–15 — Question 1: does the asset actually separate?

The whole sale depends on a buyer being able to lift one directory out and run
it. Test it, do not take it on trust:

```bash
node scripts/extract-module.js waste_recognition /tmp/audit-wr
cd /tmp/audit-wr && npm install && PORT=9999 npm start &
curl localhost:9999/api/v1/health
```

**Expect:** it serves, with nothing from the parent repo present.

*Consultant's job:* verify the extraction excluded what it should.

```bash
cd /tmp/audit-wr && git ls-files | grep -E '\.env$|src/data|uploads/[^.]'
```

**Expect:** no output. A real `.env`, runtime state, or uploaded files
reaching a buyer would be a data-protection incident, not a tidiness problem.

---

## Minutes 15–25 — Question 2: does the product survive the sale?

This is the commercially decisive one. Both retained modules consume
capabilities from all three being sold. If divestment breaks the product,
the deal is wrong regardless of price.

Simulate it — the sold modules move to "buyer-hosted" ports, reachable only
through environment variables:

```bash
# Sold modules, as if now hosted by the buyer
(cd modules/waste_recognition   && PORT=7002 npm start &)
(cd modules/route_optimizer     && PORT=7003 npm start &)
(cd modules/analytics_dashboard && PORT=7004 npm start &)

# Retained modules, pointed only at those external endpoints
(cd modules/notification_system && PORT=4105 npm start &)
(cd modules/worker_dashboard    && PORT=4106 \
   ROUTE_OPTIMIZER_URL=http://localhost:7003 \
   NOTIFICATION_URL=http://localhost:4105 \
   ANALYTICS_URL=http://localhost:7004 npm start &)
(cd modules/bin_reporting       && PORT=4101 \
   WASTE_RECOGNITION_URL=http://localhost:7002 \
   WORKER_DASHBOARD_URL=http://localhost:4106 \
   ANALYTICS_URL=http://localhost:7004 npm start &)
```

Then run a real report through it:

```bash
curl -X POST localhost:4101/reportBin -H 'Content-Type: application/json' \
  -d '{"image":"<base64>","location":"12.972,77.595"}'
```

**Expect:** `"degraded": null`, a populated `type`, and an assigned worker —
meaning classification and dispatch both completed through externally-hosted
services, with **no code change**, only environment variables.

*Consultant's job:* confirm no source file was edited to make this work. That
is the entire premise of the architecture; if it needed a code change, the
modules are not really separable.

---

## Minutes 25–30 — Verdict and risk sign-off

Three questions to answer on the record:

1. **Are the three sold modules cleanly transferable?** Evidence: compliance
   check, extraction test, standalone run.
2. **Does the retained network operate post-sale?** Evidence: the repoint test
   above.
3. **Are the disclosed risks adequately disclosed?** Specifically:
   - SignalPost support expiring **2027-03-14** (`notification_system`)
   - `sms` / `email` / `push` accept and queue but **never deliver** —
     gateway credentials excluded from the original acquisition
   - Concentration: three of six divested; a lost licence-back would require
     replacing three capabilities at once

A written go/no-go against those three is the deliverable.

---

## Out of scope — quote separately

Do not attempt these in the session:

- Replacing the stub classifier with a real vision model (`waste_recognition`)
- Activating the SMS/email/push channels (needs a provider integration and
  commercial terms)
- Production hardening: rate limiting on the public intake, object storage for
  photos, moving off the JSON datastores
- Negotiating counterparty terms — `settlement.counterparty` is deliberately
  `null` in all three sold manifests pending signature

---

## Reference

| | |
|---|---|
| Positions and rationale | [`TRADING.md`](../TRADING.md) |
| Registry architecture | [`modules/README.md`](../modules/README.md) |
| Per-module terms | `modules/<name>/module.json`, `modules/<name>/LICENSE` |
| Compliance checker | `scripts/compliance-check.js` |
| Extraction tool | `scripts/extract-module.js` |
| End-to-end workflow | `npm run workflow` |

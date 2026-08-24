# Architecture

## Shape

```
Browser                                  Server
┌────────────────────────────┐          ┌──────────────────────────┐
│  React + MUI               │          │  Express                 │
│    reads ↓  writes ↓       │          │    routes/  (thin)       │
│  IndexedDB mirror          │          │    services/ (logic)     │
│    + operation queue       │  ──────▶ │    /api/sync             │
│                            │  ◀────── │                          │
│  Service worker            │          │  SQLite                  │
│    shell + API GET cache   │          │    holdings = a VIEW     │
└────────────────────────────┘          └──────────────────────────┘
```

The arrow between them is the only place connectivity matters. Everything left
of it works with the network off.

## Layers

**`backend/src/routes/`** — HTTP only: parse, validate, delegate, choose a status
code. No business logic, so the same operations are reachable from both REST and
the sync queue without duplication.

**`backend/src/services/`** — the logic.

- `repository.js` — data access. Every mutation writes its `change_log` entry in
  the same transaction as the row itself.
- `valuation.js` — position and portfolio maths, free of Express and of
  `better-sqlite3` specifics.
- `sync.js` — queue reconciliation, idempotency, per-operation isolation.
- `validate.js` — shared by the routes and the queue, so both reject the same
  input with the same message.

**`frontend/src/offline/`** — the local-first data layer: `local.js` (mirror),
`queue.js` (durable writes), `syncEngine.js` (push/pull), `DataProvider.jsx`
(React binding), `portfolio.js` (client-side maths).

**`database/`** — numbered SQL migrations plus a runner that records applied
files in `schema_migrations`, so migrating is idempotent and safe on every boot.

## Why holdings are a view

A materialised `holdings` table would need updating on every transaction write,
including writes arriving out of order from an offline queue. A view is computed
on read from the transactions that define it, so it cannot drift. The cost is
recomputation per query, which is nothing at this scale.

The client cannot use that view — it has no SQL — so `frontend/src/offline/portfolio.js`
implements the same maths in JavaScript. Two implementations of one formula drift
silently, so `tests/backend/parity.test.js` asserts they agree, field by field,
on shared fixtures. Change one and the test tells you to change the other.

## Data flow: recording a trade offline

1. `TransactionDialog` calls `saveTransaction()`.
2. `DataProvider.mutate()` writes the row to IndexedDB and enqueues a
   `transaction.upsert` operation with a client-minted `op_id`.
3. `refresh()` re-reads the mirror; the dashboard re-renders with the new
   position. **The user's work is done at this point.**
4. When online, `syncEngine.push()` posts the queue. Applied operations are
   dropped from it; rejected ones are flagged for repair.
5. `syncEngine.pull()` refreshes the mirror if the server's `seq` has moved, then
   re-applies anything still queued on top.

## Testing

| Suite | Runner | Covers |
| --- | --- | --- |
| `tests/backend/repository.test.js` | `node:test` | Data access, soft deletes, last-writer-wins, change log |
| `tests/backend/sync.test.js` | `node:test` | Idempotency, partial success, validation, snapshots |
| `tests/backend/api.test.js` | `node:test` + supertest | HTTP contract, status codes, SPA-fallback boundary |
| `tests/backend/parity.test.js` | `node:test` | Server SQL vs client JS valuation agreement |
| `tests/frontend/portfolio.test.js` | Vitest | Position maths, fees, dividends, unpriced positions |
| `tests/frontend/offline.test.js` | Vitest + fake-indexeddb | Queue durability, push/pull, re-apply after snapshot |
| `tests/frontend/components.test.jsx` | Vitest + RTL | Rendering, missing-value display, formatters |

Backend tests run against a migrated in-memory SQLite database, one per test, so
ordering never matters. Frontend offline tests use a real IndexedDB
implementation rather than a mock — the storage semantics are the thing under
test.

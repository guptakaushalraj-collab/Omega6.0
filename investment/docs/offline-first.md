# Offline-first design

The goal is narrow and testable: **every action the user can take must complete
with the network off, and nothing they did offline may be lost or duplicated
when it comes back.** Everything below follows from that.

## Why not just cache API responses?

A service worker cache makes an app *offline-tolerant*: reads keep working,
writes fail. That is the wrong shape for a portfolio tracker, where the whole
point is recording trades as they happen. So the service worker here only
handles loading the app; the data layer is local-first on its own terms.

## The three pieces

### 1. The mirror (`frontend/src/offline/local.js`)

IndexedDB holds portfolios, assets, transactions and prices. **The UI reads only
from the mirror.** There is no `fetch` in any component or page — the dashboard
computes positions from IndexedDB whether or not the network is up.

This is the load-bearing decision. If some screens read from the network and
others from a cache, "offline" becomes a state with its own bugs. Here it isn't
a state at all: the read path is identical either way, and connectivity only
affects how fresh the mirror is.

### 2. The queue (`frontend/src/offline/queue.js`)

Every mutation does two things, in order:

1. writes to the mirror, so the UI updates instantly;
2. appends an operation to a durable IndexedDB queue.

Each operation carries a **client-minted `op_id`** (a UUID) and, for new rows, a
client-minted record id. Ids cannot come from the server, because there may not
be one for hours.

A rejected operation is **kept and flagged**, never dropped. Silently discarding
a user's trade because the server disliked it is data loss; retrying it forever
is an infinite loop. Flagged operations stop being re-sent and surface in the
header so the user can repair them.

### 3. Reconciliation (`POST /api/sync`)

The client posts its queue. The server applies each operation inside its own
`SAVEPOINT` and returns a per-operation result.

Two properties matter:

**Idempotency.** `sync_ops` is a ledger of applied `op_id`s. A replay returns the
original result instead of re-applying. This is not a theoretical concern: a
request can succeed server-side and still fail to deliver its response, and the
client — correctly — retries. Without the ledger, a flaky reconnect double-books
trades.

**Partial success.** One malformed operation in a week-old queue must not block
the other ninety-nine. Each operation is isolated, and the endpoint answers
`207` when any were rejected, so the client knows to read every result rather
than treating the batch as one outcome.

### Push before pull

`sync()` pushes, then pulls. Pulling first would briefly show the pre-write
server view and then flip back. Pushing first means the snapshot we pull already
contains our own writes, so the mirror lands in one consistent state.

### Re-applying the queue after a pull

A pull replaces the mirror wholesale. Anything still queued was, by definition,
not in that snapshot — so `reapplyQueue()` puts local edits back on top
immediately afterwards. Without it, a sync visibly reverts the user's un-synced
work for the seconds until the queue drains. This is the single most jarring bug
in an offline-first UI, and `tests/frontend/offline.test.js` guards both the
upsert and delete cases.

## Conflict resolution

**Last-writer-wins on `updated_at`**, per row. A stale queued edit from a device
that was offline for a week does not clobber a newer edit made elsewhere.

This is a deliberate simplification, and it has a real cost: two devices editing
the same transaction concurrently means one edit is discarded, with no merge and
no prompt. That is acceptable here because transactions are append-mostly and
rarely co-edited. It would not be acceptable for, say, a shared notes field —
that would need per-field merging or CRDTs.

Two cases get special handling:

- **Assets** deduplicate on `symbol`, not id. Two devices adding "AAPL" offline
  mint different ids; without this they would converge on two asset rows and
  split the position in half.
- **Deletes** are soft (`deleted_at`). A hard delete is invisible to a client
  that has been offline since before it happened — it would resurrect the row on
  its next push.

## Catching up on other devices' writes

`change_log` is an append-only feed with a monotonic `seq`, written in the same
transaction as the row it describes — so a client can never see a write with no
matching log entry.

`GET /api/sync/changes?since=N` returns the entries after `N`. The client uses it
only to decide *whether* to pull: if the server's `seq` matches its own, there is
nothing to do. When it has moved, the client re-fetches the whole snapshot
rather than hydrating each changed id. For a dataset this size that is one
request either way and far less code to get wrong. A larger dataset would want
entity-level hydration, and the change log already carries what that needs.

## The service worker

`frontend/public/sw.js` uses two strategies, because the shell and the API have
opposite requirements:

- **Shell** (HTML/JS/CSS): cache-first, so a cold start with no network boots.
- **API GETs**: network-first with a cache fallback, so an online user always
  sees fresh data and an offline user sees the last successful response instead
  of a browser error page.

Navigations fall back to the cached `index.html`, so a deep link like
`/transactions` still boots offline instead of 404-ing on the SPA route.

The worker never replays writes. It has no access to op ids or per-operation
results, so a Background Sync handler there could only guess. Instead the `sync`
event posts a message to the page, which drains the queue with the full context.

It is registered only in production builds: a cache-first shell would serve stale
modules over Vite's HMR in development.

## Same-origin deployment

`npm start` serves `frontend/dist` and `/api` from one origin. A service worker
can only control pages within its own scope, so splitting the client onto a
different host would leave the app permanently online-only. The `Dockerfile`
packages both together for exactly this reason.

## What is deliberately not here

- **Authentication.** Single-user by design. Multi-user sync needs the queue
  scoped per account and the change log filtered by ownership.
- **Live market data.** See the README — a quote feed cannot be a dependency of
  an offline-first app, so prices are entered by hand.
- **Background push.** The app syncs on load, on `online`, on a 30-second timer,
  and on demand. Server-initiated push would need a Web Push subscription and a
  key pair to manage.

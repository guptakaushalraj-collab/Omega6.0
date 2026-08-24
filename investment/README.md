# Offline-First Investment Manager

A portfolio tracker that keeps working when the network does not. Every read is
served from a local IndexedDB mirror and every write is applied locally first,
then replayed to the server when connectivity returns — so recording a trade on
a train with no signal behaves exactly like recording one at a desk.

- **Frontend** — React 18 + Material UI 6, Vite, a hand-rolled service worker
- **Backend** — Node.js + Express
- **Database** — SQLite (`better-sqlite3`)

## Quick start

```bash
npm install          # installs the frontend and backend workspaces
npm run db:reset     # creates the SQLite file, migrates it, loads demo data
npm run dev          # API on :4000, UI on :5173
```

Open <http://localhost:5173>. To try the offline behaviour, open DevTools →
Network → *Offline*, record a few transactions, then go back online and watch
the queue drain from the status chip in the header.

Configuration lives in `.env` — copy `.env.example` to get started. Every value
has a working default, so the app runs with no `.env` at all.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Runs the API and the Vite dev server together |
| `npm run build` | Builds the production frontend into `frontend/dist` |
| `npm start` | Serves the API *and* the built frontend on one origin |
| `npm run db:migrate` | Applies pending migrations |
| `npm run db:seed` | Loads demo portfolios, trades and prices |
| `npm run db:reset` | Deletes the database file, re-migrates, re-seeds |
| `npm run lint` | ESLint across the whole repo |
| `npm test` | Backend (`node:test`) and frontend (Vitest) suites |

## Layout

```
frontend/    React + MUI client; src/offline/ holds the local-first data layer
backend/     Express API; routes/ are thin, services/ hold the logic
database/    Migrations, seeds, and the migration runner
tests/       backend/ (node:test + supertest), frontend/ (Vitest + RTL)
docs/        Architecture, API reference, and the offline design notes
```

## How offline-first works here

Three pieces, described in full in [`docs/offline-first.md`](docs/offline-first.md):

1. **The mirror.** `frontend/src/offline/local.js` keeps portfolios, assets,
   transactions and prices in IndexedDB. The UI reads only from here — there is
   no code path where losing the network changes the data source.
2. **The queue.** `frontend/src/offline/queue.js` records every mutation with a
   client-minted `op_id` and applies it to the mirror immediately. The network
   is a background detail the user never waits on.
3. **Reconciliation.** `POST /api/sync` replays a queue. Because replays overlap
   in practice — a request can succeed server-side and still fail to deliver its
   response — every operation is applied at most once, keyed on its `op_id`.
   Rejected operations are kept and flagged rather than silently dropped.

The service worker (`frontend/public/sw.js`) is the fourth piece, and it only
handles *loading* the app: cache-first for the shell so a cold start with no
network still boots, network-first for API GETs. It deliberately does not
replay writes — the queue owns that.

## Data model

`portfolios`, `assets`, `transactions` and `prices` are tables; **holdings are a
SQL view** derived from transactions, so a position can never drift out of sync
with the trades behind it. Rows carry `updated_at` and a soft `deleted_at`:
last-writer-wins needs a timestamp, and a hard delete would be invisible to a
client that has been offline since before it happened.

The same maths exists twice — in SQL for the server and in JavaScript for the
offline client. `tests/backend/parity.test.js` pins the two together against
shared fixtures, because a portfolio that reads differently online and offline
destroys trust in the numbers.

## Prices

There is no market-data vendor. Prices are entered by hand on the Prices tab and
stored locally first. An offline-first app cannot depend on a live quote feed,
and a stale mark the user entered themselves is more honest than one silently
fetched last week. Positions with no price are reported but excluded from
totals, and the dashboard says so rather than quietly understating the value.

## Deployment

`npm start` serves the built frontend and the API from one origin, which is what
the service worker's scope requires. The `Dockerfile` packages that as a single
image; the database is a volume at `/data`, and migrations run on boot.

```bash
docker build -t investment-manager .
docker run -p 4000:4000 -v investment-data:/data investment-manager
```

CI (`.github/workflows/ci.yml`) runs lint, both test suites on Node 20 and 22, a
production build, and an API smoke test. CD (`.github/workflows/cd.yml`)
publishes the image to GHCR and then boots it to confirm it actually starts.

## License

[MIT](LICENSE)

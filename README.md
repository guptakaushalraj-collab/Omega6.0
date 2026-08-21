# Intelligent Waste Collection Network

A smart waste management platform built for a hackathon. Citizens report
overflowing bins with a photo and location, an AI classifier tags the waste
type, the nearest available worker is auto-assigned, routes are optimized
across a worker's stops, notifications fire at each stage, and admins get a
live analytics dashboard.

## Features

- **Report bins** — photo + geolocation (or manual lat/lng) submission.
- **Waste type recognition** — every uploaded photo is classified into
  plastic / organic / paper / metal / glass / e-waste / mixed.
- **Task assignment** — the closest available worker is assigned automatically
  (or in bulk via "Auto-assign" on the admin dashboard).
- **Route optimization** — each worker's pending stops are ordered with a
  nearest-neighbor heuristic starting from their current location.
- **Notifications** — in-app alerts for admins, workers, and citizens when a
  bin is reported, assigned, and cleared.
- **Analytics dashboard** — totals, waste-type breakdown, worker leaderboard,
  and average resolution time.

## Stack

- **Backend**: Node.js + Express, JSON-file datastore (`backend/src/db.js`) —
  zero setup, easy to read, and swappable for Postgres/Mongo later without
  touching any route logic.
- **Frontend**: React + Vite, React Router, no CSS framework — a small
  hand-rolled design system in `frontend/src/index.css`. Maps are rendered as
  a dependency-free inline SVG scatter plot (`MiniMap.jsx`) so nothing needs a
  tile-server connection.

### About the "AI" waste classifier

`backend/src/services/classifier.js` is a deterministic stub: it hashes the
uploaded photo's bytes to pick a waste type and confidence score, so the same
photo always gets the same answer. This is intentional — it lets the full
report → classify → assign → collect pipeline be demoed end to end without
needing a trained model or a paid vision API. Swap the body of
`classifyWaste()` for a real model (e.g. a fine-tuned MobileNet served via
TensorFlow.js, or a cloud vision API) — the function signature and return
shape (`{ type, label, confidence, source }`) are the integration point.

## Two packagings

The same capability set ships two ways — pick whichever fits the situation.

| | `backend/` + `frontend/` | `modules/` |
|---|---|---|
| Shape | One Express process + React UI | Six independent services |
| Use it for | Demos, single-operator deployment | Selling, licensing or transferring capabilities individually |
| Datastore | One shared JSON store | One per module, sole-writer |
| Coupling | Direct function calls | HTTP, with declared capabilities and graceful degradation |

These are alternative packagings of one product, not two competing codebases.
See [`modules/README.md`](./modules/README.md) for the tradable-module
registry, its manifest schema, and the rules that keep the six separable.

```bash
npm run install:modules   # install all six
npm run modules:start     # run the mesh on :4101-:4106
npm run modules:test      # 47-check integration suite
npm run mocks:seed        # load the 7-day mock dataset
npm run workflow          # traced end-to-end collection pipeline
```

The workflow runs the full sequence one visible step at a time —
`reportBin → detectWasteType → assignWorker → optimizeRoute → notifyPickup →
updateAnalytics` — printing each call, result and timing. See
[`modules/README.md`](./modules/README.md#end-to-end-workflow).

## Trading position

Three modules are being divested and two purchased components retained — see
[`TRADING.md`](./TRADING.md) for positions, rationale and open risks, and
[`docs/consultant-brief.md`](./docs/consultant-brief.md) for the 30-minute
integration review that signs it off.

```bash
npm run compliance                                  # 67 checks: is each module transferable?
npm run extract waste_recognition /tmp/wr           # lift one out as its own repo
```

Every module carries its own `LICENSE` — MIT for the four in-house, proprietary
for the two acquired, each with its real transfer terms.

## Getting started

Requires Node.js 18+.

```bash
# 1. Backend
cd backend
npm install
npm run seed      # creates a few demo workers
npm run dev        # http://localhost:4000

# 2. Frontend (separate terminal)
cd frontend
npm install
npm run dev        # http://localhost:5173
```

Open http://localhost:5173. The Vite dev server proxies `/api` and
`/uploads` to the backend on port 4000 (see `frontend/vite.config.js`), so no
CORS setup is needed in development.

## Project structure

```
backend/
  src/
    server.js              Express app entry
    db.js                  JSON-file datastore
    seed.js                Seeds demo workers
    routes/                bins, workers, tasks, notifications, analytics
    services/
      classifier.js        Waste-type recognizer (stub, swappable)
      assignmentService.js Nearest-worker auto-assignment
      routeOptimizer.js    Nearest-neighbor route ordering
      notificationService.js  In-app notification store
    middleware/upload.js    Multer photo upload handling
frontend/
  src/
    pages/                 ReportBin, WorkerDashboard, AdminDashboard, NotificationsPage
    components/            NavBar, MiniMap, StatCard, StatusBadge, Toast
    api.js                 Fetch wrapper for the backend API
modules/                   Six independently tradable services — see modules/README.md
  bin_reporting/           :4101  in-house
  waste_recognition/       :4102  in-house
  route_optimizer/         :4103  in-house
  analytics_dashboard/     :4104  in-house
  notification_system/     :4105  acquired (SignalPost Relay)
  worker_dashboard/        :4106  acquired (FieldOps Crew)
scripts/
  modules.js               Install / run the whole module mesh
  workflow.js              Traced end-to-end collection pipeline
  integration-test.js      47-check composition + degradation suite
  generate-mocks.js        Build the coherent 7-day mock dataset
  seed-mocks.js            Load mocks into every module's store
  capture-samples.js       Regenerate every samples/ dir from live responses
```

## API overview (integrated `backend/`)

Each module publishes its own contract separately — see its `openapi.yaml`.

| Method | Path                          | Purpose                              |
|--------|-------------------------------|---------------------------------------|
| POST   | `/api/bins`                   | Report a bin (multipart: photo, lat, lng, address, notes, autoAssign) |
| GET    | `/api/bins`                   | List bins (optional `?status=`)       |
| POST   | `/api/tasks/assign/:binId`    | Assign nearest worker to a bin        |
| POST   | `/api/tasks/assign-all`       | Assign all pending bins               |
| PATCH  | `/api/tasks/:id`               | Update task status (`in_progress`/`completed`) |
| GET    | `/api/workers/:id/route`       | Optimized route for a worker's stops  |
| GET    | `/api/notifications?role=`     | List notifications for a role         |
| GET    | `/api/analytics/summary`       | Dashboard summary stats               |

## Notes on scope

This is a hackathon-grade prototype: the datastore is a single JSON file
(fine for a demo, not for concurrent production traffic), and notifications
are in-app only (no email/SMS/push integration). Both are isolated behind
small modules (`db.js`, `notificationService.js`) specifically so they're
easy to swap out later.

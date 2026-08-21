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
```

## API overview

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

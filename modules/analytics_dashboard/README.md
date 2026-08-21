# analytics_dashboard

Ingests operational events and derives collection metrics: waste mix,
resolution times, worker activity, daily trends.

- **Port** 4104 · **Base path** `/api/v1` · **Auth** none
- **Origin** in-house (MIT, transferable)
- **Dependencies** none — push-based, never reads another module's database

## Run

```bash
npm install
npm start                  # :4104
MAX_EVENTS=100000 npm start
```

## Design: push, not pull

This module derives everything from events it is **sent**. It never queries
another module's API or reads another module's disk. That inversion is what
makes it independently ownable: an operator running a completely different
reporting stack can adopt it by emitting the documented event shapes, and
selling it transfers no coupling to the rest of the network.

## Endpoints

### `POST /api/v1/events`

```bash
curl -X POST http://localhost:4104/api/v1/events \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "bin.collected",
    "subject_id": "bin_1fab6e6f",
    "source": "worker_dashboard",
    "payload": { "worker_id": "wrk_88a1", "waste_type": "plastic" }
  }'
```

Returns `202 { "accepted": true, "id": "evt_...", "known_type": true }`.

`occurred_at` defaults to now — set it explicitly when backfilling.
`subject_id` should be the bin id; it is what pairs a `bin.reported` with its
later `bin.collected` to derive resolution time.

**Unknown event types are accepted, not rejected.** They are stored with
`known_type: false` and excluded from derived metrics. This means a producer
can ship a new event type before the analytics module is upgraded, without
taking `400`s in production.

Types included in derived metrics (`GET /api/v1/event-types`):

| Type | `payload` fields used |
|---|---|
| `bin.reported` | — |
| `bin.classified` | `waste_type` |
| `bin.assigned` | `worker_id` |
| `bin.collected` | `worker_id` |
| `notification.sent` | — |
| `route.optimized` | — |

### `GET /api/v1/summary`

See [`samples/response-summary.json`](./samples/response-summary.json).

```json
{
  "totals": { "events": 42, "reported": 12, "collected": 9, "outstanding": 3,
              "notifications_sent": 18, "routes_optimized": 4 },
  "collection_rate": 0.75,
  "resolution_minutes": { "samples": 9, "mean": 47.2, "p50": 41.0, "p90": 88.0 },
  "event_counts": { "bin.reported": 12, "...": 0 },
  "waste_mix": [ { "type": "plastic", "count": 5, "share": 0.417 } ],
  "worker_activity": [ { "worker_id": "wrk_88a1", "assigned": 4, "collected": 4 } ]
}
```

Resolution time counts only bins that were both reported *and* collected —
outstanding bins are excluded rather than counted as zero, so the mean is
not silently deflated by a backlog.

### `GET /api/v1/trends?days=7`

Reported vs collected per day, oldest first. `days` clamps to 1–90.

### `GET /api/v1/events?type=&subject_id=&limit=`

Raw log, newest first, `limit` capped at 1000. Useful for auditing a specific
bin's lifecycle: `?subject_id=bin_1fab6e6f`.

### `GET /api/v1/health`

## Retention

The log retains the most recent `MAX_EVENTS` (default 20,000) and evicts
oldest-first. This bounds disk on a buyer's host. It also means **derived
metrics drift as old events age out** — once eviction begins, `totals.reported`
reflects the retention window, not all time. For durable history, raise
`MAX_EVENTS`, or mirror the event stream into a warehouse and treat this
module as the live operational view.

## Notes for a buyer

The event contract is the entire integration surface — six event types, three
payload fields. Any system that can POST JSON can feed it. The derived metrics
in `src/metrics.js` are plain functions over an event array with no I/O, so
they are straightforward to extend or unit-test against fixtures.

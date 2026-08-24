# API reference

Base URL: `http://localhost:4000`. All bodies are JSON.

## Health

### `GET /api/health`

```json
{ "status": "ok", "database": "ok", "time": "2026-08-24T19:00:00.000Z" }
```

Returns `503` with `"status": "degraded"` if the database is unreachable. Kept
cheap and free of any table dependency — the client probes it before draining
its queue.

## Portfolios

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/portfolios` | `{ portfolios: [...] }` |
| `POST` | `/api/portfolios` | `{ name, base_currency? }` → `201` |
| `GET` | `/api/portfolios/:id` | `404` if unknown |
| `PUT` | `/api/portfolios/:id` | Full replace |
| `DELETE` | `/api/portfolios/:id` | Soft delete, `204` |
| `GET` | `/api/portfolios/:id/holdings` | Positions, summary and allocation |

`GET /api/portfolios/:id/holdings`:

```json
{
  "holdings": [
    {
      "symbol": "VTI", "asset_class": "etf", "quantity": 40,
      "cost_basis": 10736, "price": 291.66, "market_value": 11666.4,
      "unrealized_gain": 930.4, "unrealized_gain_pct": 0.0866
    }
  ],
  "summary": { "market_value": 31583.5, "unpriced_positions": 0, "...": "..." },
  "allocation": [{ "asset_class": "etf", "market_value": 16872.9, "weight": 0.534 }]
}
```

A position with no known price reports `price: null` and `market_value: null`,
and is counted in `summary.unpriced_positions` but excluded from the totals.

## Assets and prices

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/assets` | `{ assets, prices }` — prices are the latest per asset |
| `POST` | `/api/assets` | `{ symbol, name?, asset_class?, currency? }` |
| `POST` | `/api/assets/:id/prices` | `{ close, as_of? }`, defaults to today |

Assets deduplicate on `symbol` (upper-cased), not on id.

## Transactions

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/transactions?portfolio_id=&limit=` | Newest first |
| `POST` | `/api/transactions` | See body below |
| `PUT` | `/api/transactions/:id` | Full replace |
| `DELETE` | `/api/transactions/:id` | Soft delete, `204` |

```json
{
  "portfolio_id": "pf_demo_core",
  "asset_id": "as_vti",
  "type": "buy",
  "quantity": 40,
  "price": 268.4,
  "fee": 0,
  "traded_at": "2026-01-06T14:30:00.000Z",
  "note": "Opening position"
}
```

`type` is one of `buy`, `sell`, `dividend`. Validation is shared with the sync
queue, so a trade rejected while queued reports the same reason it would have
online.

## Sync

### `GET /api/sync/snapshot`

Everything a freshly installed client needs to work offline: portfolios, assets,
transactions, latest prices, and the current `seq`.

### `GET /api/sync/changes?since=N`

```json
{ "since": 4, "seq": 6, "changes": [{ "seq": 5, "entity": "transaction", "entity_id": "tx_…", "op": "upsert" }] }
```

Clients use this to decide whether a pull is needed at all: if `seq` equals what
they hold, there is nothing to fetch.

### `POST /api/sync`

Replays a queue of client operations.

```json
{
  "client_id": "client_9f2…",
  "operations": [
    { "op_id": "8c1e…", "type": "transaction.upsert", "payload": { "...": "..." } }
  ]
}
```

Supported `type` values: `portfolio.upsert`, `portfolio.delete`, `asset.upsert`,
`transaction.upsert`, `transaction.delete`, `price.upsert`.

Response:

```json
{
  "applied": 1, "duplicates": 0, "rejected": 1, "seq": 12,
  "results": [
    { "op_id": "8c1e…", "status": "applied", "duplicate": false, "result": { "id": "tx_…" } },
    { "op_id": "3a7b…", "status": "rejected", "duplicate": false, "error": "asset_id is required" }
  ]
}
```

| Status | Meaning |
| --- | --- |
| `200` | Every operation applied (some may be duplicates) |
| `207` | At least one operation was rejected — read `results` |
| `400` | The envelope itself was malformed (no `client_id`, `operations` not an array) |

**Idempotency.** Each `op_id` is applied at most once. Replaying a batch returns
`duplicate: true` with the original result and changes nothing — a redelivered
queue never double-books a trade.

**Partial success.** Operations are isolated from each other, so one bad entry
in a long queue does not block the rest. A rejected operation is *not* recorded
as applied, so the client can fix it and retry under the same `op_id`.

## Errors

Every error is JSON: `{ "error": "..." }`. Unknown `/api/*` paths return a JSON
`404` and never the SPA shell, so the client's JSON parsing path stays valid.

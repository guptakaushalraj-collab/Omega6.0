# notification_system  *(acquired)*

Multi-channel message delivery with per-recipient inboxes, read receipts and
delivery status.

- **Port** 4105 · **Base path** `/v1` · **Auth** `X-API-Key`
- **Origin** **acquired** from SignalPost Messaging Inc., 2026-03-14
- **Product** SignalPost Relay API v2.4.1
- **Licence** Proprietary — perpetual, transferable with written notice
- **Support contract** expires 2027-03-14
- **Dependencies** none

## Why this module looks different

This was **bought, not built**. It keeps SignalPost's original API
conventions, which differ from the in-house modules:

| | in-house modules | this module |
|---|---|---|
| Base path | `/api/v1` | `/v1` |
| Field case | `camelCase` | `snake_case` |
| Auth | none | `X-API-Key` |
| Error shape | `{ "error": "msg" }` | `{ "error": { "code", "message" } }` |

These differences are **deliberate and load-bearing**. Existing SignalPost
client SDKs and the vendor's published documentation must keep working, and a
future buyer expects the API they purchased. Normalizing it to house style
would break both and destroy the property that makes it independently
sellable. The adaptation cost is paid at the call site — see
`worker_dashboard/src/clients.js` for how a consumer wraps it.

## Run

```bash
npm install
npm start                              # :4105, key defaults to dev-signalpost-key
NOTIFY_API_KEY=your-key npm start
```

## Authentication

Every endpoint except `/v1/health` requires the key:

```bash
curl -H "X-API-Key: dev-signalpost-key" http://localhost:4105/v1/messages
```

`401 missing_api_key` if absent, `403 invalid_api_key` if wrong.

> The default `dev-signalpost-key` is a development convenience. Set
> `NOTIFY_API_KEY` before exposing this service anywhere real.

## Endpoints

### `POST /v1/messages`

```bash
curl -X POST http://localhost:4105/v1/messages \
  -H "X-API-Key: dev-signalpost-key" \
  -H 'Content-Type: application/json' \
  -d '{
    "recipient_type": "worker",
    "recipient_id": "wrk_88a1",
    "channel": "in_app",
    "body": "New pickup assigned 2.1 km away.",
    "subject_ref": "bin_1fab6e6f"
  }'
```

`201` — see [`samples/response-message.json`](./samples/response-message.json):

```json
{
  "id": "msg_4c1e7a09bb32",
  "recipient_type": "worker",
  "recipient_id": "wrk_88a1",
  "channel": "in_app",
  "body": "New pickup assigned 2.1 km away.",
  "subject_ref": "bin_1fab6e6f",
  "metadata": {},
  "delivery_status": "delivered",
  "acknowledged": false,
  "created_at": "2026-08-21T13:52:07.881Z",
  "acknowledged_at": null
}
```

`subject_ref` is an opaque correlation id (use the bin id) — filterable on
list. `recipient_type` is free-form; the network uses `worker`, `admin`,
`citizen`.

Errors: `400 missing_recipient_type` / `missing_body` · `422 body_too_long`
(>1000 chars) / `unsupported_channel`.

### `GET /v1/messages`

Filters: `recipient_type`, `recipient_id`, `subject_ref`,
`unacknowledged=true`, `limit` (≤500).

```bash
curl -H "X-API-Key: dev-signalpost-key" \
  "http://localhost:4105/v1/messages?recipient_id=wrk_88a1&unacknowledged=true"
```

Returns `{ "count": 3, "messages": [...] }` — note the envelope, another
SignalPost convention the in-house modules do not share.

### `POST /v1/messages/:id/ack` · `POST /v1/messages/ack_all`

Mark read. `ack` is idempotent — re-acknowledging preserves the original
`acknowledged_at`. `ack_all` takes `{ recipient_type?, recipient_id? }` (at
least one required) and returns `{ "acknowledged": n }`.

### `GET /v1/channels` · `GET /v1/messages/:id` · `GET /v1/health`

## Known limitation: only `in_app` actually delivers

`sms`, `email` and `push` are **accepted and recorded with
`delivery_status: "queued"`, but nothing sends them.** The SignalPost gateway
credentials that fulfil those channels were *not* included in the
acquisition — only the relay software was.

To activate them you need either a commercial agreement with SignalPost, or
your own provider (Twilio, SES, FCM) wired into the send path in
`src/server.js`. Until then, treat `queued` as "recorded, not sent" and do not
rely on those channels for anything operationally important. `in_app` is fully
functional and is what the rest of the network uses.

## Retention

Retains the most recent `MAX_MESSAGES` (default 10,000), oldest evicted
first. Raise it or mirror to your own store if you need durable message
history for compliance.

## Notes for a buyer

Resale is permitted under the original perpetual licence. The **support
contract transfers only if you assume the SignalPost maintenance agreement
before 2027-03-14** — after that date you acquire the software as-is with no
vendor support path. Factor that into timing.

No outbound dependencies, so it lifts out cleanly. The main integration work
for a buyer is the channel gap above.

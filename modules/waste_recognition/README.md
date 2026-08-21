# waste_recognition

Classifies waste type from a bin photograph. Returns a labelled prediction, a
confidence score, and two runners-up.

- **Port** 4102 · **Base path** `/api/v1` · **Auth** none
- **Origin** in-house (MIT, transferable)
- **Dependencies** none — this module runs entirely standalone

## Run

```bash
npm install
npm start           # :4102
PORT=9002 npm start # any port
```

## Endpoints

### `POST /api/v1/classify`

Accepts an image two ways — pick whichever suits your caller.

**Multipart** (browsers, form posts):

```bash
curl -X POST http://localhost:4102/api/v1/classify \
  -F "photo=@bin.jpg" \
  -F "reference=bin_1fab6e6f"
```

**Base64 JSON** (server-to-server):

```bash
curl -X POST http://localhost:4102/api/v1/classify \
  -H 'Content-Type: application/json' \
  -d '{"image_base64":"iVBORw0KGgo...","reference":"bin_1fab6e6f"}'
```

`reference` is an opaque caller-supplied string echoed back on the record —
use it to correlate a classification with your own entity id. It is never
interpreted.

Response `200` — see [`samples/response-classify.json`](./samples/response-classify.json):

```json
{
  "id": "cls_9f2c1a7b3d45",
  "reference": "bin_1fab6e6f",
  "prediction": {
    "type": "plastic",
    "label": "Plastic",
    "color": "#2563eb",
    "recyclable": true,
    "hazardous": false,
    "confidence": 0.86,
    "alternatives": [
      { "type": "paper", "label": "Paper", "confidence": 0.39 },
      { "type": "glass", "label": "Glass", "confidence": 0.26 }
    ],
    "model_version": "stub-cv-1.0.0"
  },
  "image_bytes": 48213,
  "classified_at": "2026-08-21T13:40:11.204Z"
}
```

Errors: `400` no image or malformed base64 · `413` over 8 MB · `422` unreadable image.

### `GET /api/v1/waste-types`

The full taxonomy, including `recyclable` and `hazardous` flags. Fetch this
rather than hardcoding types — the taxonomy may gain entries in a minor
release. See [`samples/response-waste-types.json`](./samples/response-waste-types.json).

### `GET /api/v1/classifications` · `GET /api/v1/classifications/:id`

Audit trail of recent predictions, newest first. `?limit=` caps at 500. The
log is capped at 500 records and evicts oldest-first, so it is suitable for
spot-checking accuracy, not for durable analytics — mirror records into your
own store if you need history.

### `GET /api/v1/health`

`{ "ok": true, "module": "waste_recognition", "model_version": "..." }`

## About the model

`src/classifier.js` ships a **deterministic stub**, not a trained model. It
hashes the image bytes to select a prediction, so identical input always
produces identical output. This keeps the API contract and every downstream
integration fully exercisable without a model artifact or a GPU.

To productionize, replace only the block marked
`---- replace from here for a real model ----`. Keep the return shape
identical and no consumer needs to change — that shape is the published
contract, not an implementation detail.

## Notes for a buyer

Stateless apart from a capped audit log, and dependency-free, so this is the
most readily separable module in the registry: point it at a host, supply a
model, and it serves. Sizing is CPU/GPU-bound on inference; the Express layer
itself is negligible. If you swap in a real model, revisit the
`p95_latency_ms: 120` SLA in `module.json` — the stub is far faster than any
real network will be.

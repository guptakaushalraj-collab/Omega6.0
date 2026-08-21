# Sample requests — `POST /api/v1/reports`

## Multipart (with photo — enables classification)

```bash
curl -X POST http://localhost:4101/api/v1/reports \
  -F "photo=@bin.jpg" \
  -F "lat=12.972" \
  -F "lng=77.595" \
  -F "address=MG Road bus stop" \
  -F "reporter_name=Asha" \
  -F "auto_assign=true"
```

## JSON (no photo — classification is skipped)

```bash
curl -X POST http://localhost:4101/api/v1/reports \
  -H 'Content-Type: application/json' \
  -d @request-report.json
```

- `response-report.json` — fully enriched intake (`degraded: null`)
- `response-report-degraded.json` — intake with enrichments skipped; note the
  `degraded` object names each one and why

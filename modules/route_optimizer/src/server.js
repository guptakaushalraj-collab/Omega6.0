// Load this module's .env before anything reads process.env.
import "./env.js";
import express from "express";
import cors from "cors";
import { optimizeRoute, distanceMatrix, haversineKm } from "./optimize.js";

const app = express();
const PORT = process.env.PORT || 4103;
const MAX_STOPS = 200;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/v1/health", (_req, res) =>
  res.json({ ok: true, module: "route_optimizer", version: "1.0.0" })
);

function validPoint(p) {
  return (
    p &&
    typeof p === "object" &&
    Number.isFinite(Number(p.lat)) &&
    Number.isFinite(Number(p.lng)) &&
    Math.abs(Number(p.lat)) <= 90 &&
    Math.abs(Number(p.lng)) <= 180
  );
}

const normalize = (p) => ({ lat: Number(p.lat), lng: Number(p.lng) });

app.post("/api/v1/optimize", (req, res) => {
  const { start, stops, refine } = req.body || {};

  if (!validPoint(start)) {
    return res.status(400).json({ error: "start must be {lat, lng} within valid ranges" });
  }
  if (!Array.isArray(stops)) {
    return res.status(400).json({ error: "stops must be an array" });
  }
  if (stops.length > MAX_STOPS) {
    return res.status(413).json({ error: `stops exceeds the ${MAX_STOPS}-stop limit` });
  }

  const badIndex = stops.findIndex((s) => !validPoint(s?.location));
  if (badIndex !== -1) {
    return res
      .status(400)
      .json({ error: `stops[${badIndex}].location must be {lat, lng} within valid ranges` });
  }

  const result = optimizeRoute(
    normalize(start),
    stops.map((s) => ({ ...s, location: normalize(s.location) })),
    { refine: refine !== false }
  );

  res.json(result);
});

app.post("/api/v1/distance-matrix", (req, res) => {
  const { points } = req.body || {};
  if (!Array.isArray(points) || points.length === 0) {
    return res.status(400).json({ error: "points must be a non-empty array" });
  }
  if (points.length > MAX_STOPS) {
    return res.status(413).json({ error: `points exceeds the ${MAX_STOPS}-point limit` });
  }
  const bad = points.findIndex((p) => !validPoint(p));
  if (bad !== -1) {
    return res.status(400).json({ error: `points[${bad}] must be {lat, lng} within valid ranges` });
  }

  const normalized = points.map(normalize);
  res.json({
    unit: "km",
    points: normalized.length,
    matrix: distanceMatrix(normalized),
  });
});

app.post("/api/v1/distance", (req, res) => {
  const { from, to } = req.body || {};
  if (!validPoint(from) || !validPoint(to)) {
    return res.status(400).json({ error: "from and to must both be {lat, lng}" });
  }
  res.json({
    unit: "km",
    distance_km: Number(haversineKm(normalize(from), normalize(to)).toFixed(3)),
  });
});

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Internal error" });
});

app.listen(PORT, () => console.log(`[route_optimizer] listening on :${PORT}`));

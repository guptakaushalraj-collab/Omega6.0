/**
 * Flat verb-style alias endpoint.
 *
 *   GET /optimizeRoute?bins=[...]  ->  ordered route
 *
 * Additive alias over the canonical POST /api/v1/optimize. Both call the same
 * optimizeRoute() function, so they cannot drift.
 *
 * Note on bin IDs: this module is a STATELESS leaf — it holds no records and
 * has no dependencies, which is precisely what makes it the registry's most
 * readily separable module. It therefore cannot resolve a bare bin id like
 * "bin_1fab6e" to a coordinate; doing so would require calling bin_reporting
 * and forfeit that property. `bins` must carry coordinates. The error message
 * on a bare-id array points the caller at the two ways to get them.
 */
import { Router } from "express";
import { optimizeRoute } from "./optimize.js";

export const compatRouter = Router();

const DEFAULT_START = { lat: 12.9716, lng: 77.5946 }; // Bengaluru city centre

const validPoint = (p) =>
  p &&
  Number.isFinite(Number(p.lat)) &&
  Number.isFinite(Number(p.lng)) &&
  Math.abs(Number(p.lat)) <= 90 &&
  Math.abs(Number(p.lng)) <= 180;

function parseLocationString(value) {
  if (typeof value !== "string") return null;
  const parts = value.split(",");
  if (parts.length !== 2) return null;
  const lat = Number(parts[0].trim());
  const lng = Number(parts[1].trim());
  return validPoint({ lat, lng }) ? { lat, lng } : null;
}

/**
 * Normalizes one entry of the `bins` array into a stop.
 * Accepts several shapes so callers are not forced to reshape their data:
 *   "12.97,77.59"
 *   { lat, lng }
 *   { id?, location: {lat,lng} }
 *   { id?, location: "12.97,77.59" }
 */
function toStop(entry, index) {
  if (typeof entry === "string") {
    const loc = parseLocationString(entry);
    return loc ? { id: `stop_${index + 1}`, location: loc } : null;
  }
  if (entry && typeof entry === "object") {
    if (validPoint(entry)) {
      return {
        ...entry,
        id: entry.id ?? entry.binId ?? `stop_${index + 1}`,
        location: { lat: Number(entry.lat), lng: Number(entry.lng) },
      };
    }
    if (typeof entry.location === "string") {
      const loc = parseLocationString(entry.location);
      return loc ? { ...entry, id: entry.id ?? entry.binId ?? `stop_${index + 1}`, location: loc } : null;
    }
    if (validPoint(entry.location)) {
      return {
        ...entry,
        id: entry.id ?? entry.binId ?? `stop_${index + 1}`,
        location: { lat: Number(entry.location.lat), lng: Number(entry.location.lng) },
      };
    }
  }
  return null;
}

compatRouter.get("/optimizeRoute", (req, res) => {
  const raw = req.query.bins;

  if (raw === undefined) {
    return res.status(400).json({
      error: "bins query parameter is required",
      hint: 'bins=[{"lat":12.97,"lng":77.59},...] or bins=["12.97,77.59",...]',
    });
  }

  // `bins` arrives as a JSON string in the query. Express also parses
  // bins[]=a&bins[]=b into an array, so tolerate both.
  let parsed;
  if (Array.isArray(raw)) {
    parsed = raw;
  } else {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return res.status(400).json({
        error: "bins must be a JSON array",
        hint: 'e.g. bins=[{"lat":12.97,"lng":77.59}]  (remember to URL-encode)',
      });
    }
  }

  if (!Array.isArray(parsed)) {
    return res.status(400).json({ error: "bins must be a JSON array" });
  }
  if (parsed.length > 200) {
    return res.status(413).json({ error: "bins exceeds the 200-stop limit" });
  }

  const stops = [];
  for (const [i, entry] of parsed.entries()) {
    const stop = toStop(entry, i);
    if (!stop) {
      // A bare string id is the most likely mistake — name the fix explicitly.
      const looksLikeBareId = typeof entry === "string" || typeof entry?.binId === "string";
      return res.status(400).json({
        error: `bins[${i}] has no usable coordinates`,
        hint: looksLikeBareId
          ? "This module is stateless and cannot resolve bin ids. Fetch coordinates from bin_reporting (GET /api/v1/reports/:id), or use worker_dashboard's GET /v1/workers/:id/queue, which resolves and sequences in one call."
          : 'Each entry needs {lat,lng}, {location:{lat,lng}} or "lat,long".',
      });
    }
    stops.push(stop);
  }

  // Optional start; defaults to the city centre so the endpoint is usable
  // with nothing but `bins`, as specified.
  let start = DEFAULT_START;
  let startDefaulted = true;
  if (req.query.start) {
    const parsedStart =
      parseLocationString(req.query.start) ||
      (() => {
        try {
          const o = JSON.parse(req.query.start);
          return validPoint(o) ? { lat: Number(o.lat), lng: Number(o.lng) } : null;
        } catch {
          return null;
        }
      })();
    if (!parsedStart) {
      return res.status(400).json({ error: 'start must be "lat,long" or {"lat":..,"lng":..}' });
    }
    start = parsedStart;
    startDefaulted = false;
  }

  const result = optimizeRoute(start, stops, { refine: req.query.refine !== "false" });

  res.json({
    start,
    start_defaulted: startDefaulted,
    order: result.stops.map((s) => s.id),
    ...result,
  });
});

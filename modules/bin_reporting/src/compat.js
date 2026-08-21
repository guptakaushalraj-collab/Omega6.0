/**
 * Flat verb-style alias endpoints.
 *
 *   POST /reportBin        { image, location: "lat,long" }  -> { binId, ... }
 *   POST /detectWasteType  { binId }                        -> { type }
 *
 * These are ADDITIVE aliases over the canonical `/api/v1` REST routes, not
 * replacements. Both surfaces call the same functions in intake.js, so they
 * cannot drift apart. The canonical routes stay because the frontend, the
 * OpenAPI contract, the integration suite and worker_dashboard's callbacks
 * all depend on them.
 *
 * Why /detectWasteType lives HERE and not in waste_recognition:
 * it is keyed by `binId`, and waste_recognition is a stateless leaf that
 * never sees bin records — only raw image bytes. Giving it binId lookup would
 * force it to call bin_reporting, creating a cycle
 * (bin_reporting -> waste_recognition -> bin_reporting) and destroying the
 * dependency-free property that makes it the registry's most sellable module.
 * bin_reporting owns bin records and already calls the classifier, so
 * resolving binId -> photo -> type belongs here.
 */
import { Router } from "express";
import { store } from "./store.js";
import {
  createReport,
  reclassifyReport,
  parseLocationString,
  storeBase64Image,
  validPoint,
} from "./intake.js";

export const compatRouter = Router();

/**
 * POST /reportBin
 * Body: { image: "<base64>", location: "12.972,77.595" }
 *
 * `location` is the compact "lat,long" STRING form. The canonical route takes
 * separate numeric lat/lng; both are accepted here so existing callers of
 * either shape work.
 */
compatRouter.post("/reportBin", async (req, res) => {
  const body = req.body || {};

  // Accept "lat,long" string, or {lat,lng} object, or separate fields.
  let location = null;
  if (typeof body.location === "string") {
    location = parseLocationString(body.location);
    if (!location) {
      return res.status(400).json({
        error: 'location must be "lat,long" — e.g. "12.972,77.595"',
      });
    }
  } else if (body.location && validPoint(body.location)) {
    location = { lat: Number(body.location.lat), lng: Number(body.location.lng) };
  } else if (validPoint({ lat: body.lat, lng: body.lng })) {
    location = { lat: Number(body.lat), lng: Number(body.lng) };
  }

  if (!location) {
    return res.status(400).json({
      error: 'location is required, as "lat,long" or { "lat": .., "lng": .. }',
    });
  }

  let photoFilename = null;
  if (body.image) {
    try {
      photoFilename = storeBase64Image(body.image);
    } catch (err) {
      return res.status(400).json({ error: `image: ${err.message}` });
    }
  }

  const { report, degraded } = await createReport({
    location,
    address: body.address || null,
    notes: body.notes || null,
    reporterName: body.reporter_name || body.reporterName || "Anonymous",
    photoFilename,
    autoAssign: body.auto_assign === undefined ? true : String(body.auto_assign) !== "false",
  });

  // Flat response shape: binId promoted to the top level, since that is what
  // a caller needs next (to pass into /detectWasteType or /notifyPickup).
  res.status(201).json({
    binId: report.id,
    status: report.status,
    type: report.waste_type,
    location: `${report.location.lat},${report.location.lng}`,
    assignedWorker: report.assignment?.worker_name ?? null,
    degraded,
    report,
  });
});

/**
 * POST /detectWasteType
 * Body: { binId }  ->  { binId, type, label, confidence }
 *
 * Re-runs classification on the bin's stored photo. Useful both as the
 * spec'd endpoint and as the backfill path after a classifier outage.
 */
compatRouter.post("/detectWasteType", async (req, res) => {
  const binId = req.body?.binId ?? req.body?.bin_id;
  if (!binId) {
    return res.status(400).json({ error: "binId is required" });
  }

  // If the bin is already classified, answer from the stored record rather
  // than paying for another inference call.
  const existing = store.read().reports.find((r) => r.id === String(binId));
  if (existing?.classification && req.body?.force !== true) {
    return res.json({
      binId: existing.id,
      type: existing.classification.type,
      label: existing.classification.label,
      confidence: existing.classification.confidence,
      cached: true,
    });
  }

  const result = await reclassifyReport(String(binId));

  if (result.ok) {
    return res.json({
      binId: result.report.id,
      type: result.report.classification.type,
      label: result.report.classification.label,
      confidence: result.report.classification.confidence,
      cached: false,
    });
  }

  switch (result.code) {
    case "not_found":
      return res.status(404).json({ error: `No bin with id ${binId}` });
    case "no_photo":
      return res
        .status(422)
        .json({ error: "Bin has no photo — waste type cannot be detected" });
    case "photo_gone":
      return res.status(410).json({ error: "Stored photo is no longer available" });
    default:
      return res
        .status(503)
        .json({ error: "Classifier unavailable", reason: result.reason });
  }
});

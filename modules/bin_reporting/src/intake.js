import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { store } from "./store.js";
import { classify, requestAssignment, emit } from "./clients.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UPLOAD_DIR = path.join(__dirname, "..", "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const newId = (p) => `${p}_${crypto.randomBytes(6).toString("hex")}`;

export const validPoint = (p) =>
  p &&
  Number.isFinite(Number(p.lat)) &&
  Number.isFinite(Number(p.lng)) &&
  Math.abs(Number(p.lat)) <= 90 &&
  Math.abs(Number(p.lng)) <= 180;

/**
 * Parses the `"lat,long"` string form used by the flat alias API.
 * Returns null on anything malformed — callers decide the status code.
 */
export function parseLocationString(value) {
  if (typeof value !== "string") return null;
  const parts = value.split(",");
  if (parts.length !== 2) return null;
  const lat = Number(parts[0].trim());
  const lng = Number(parts[1].trim());
  if (!validPoint({ lat, lng })) return null;
  return { lat, lng };
}

/** Writes a base64 image to the upload dir. Returns the stored filename. */
export function storeBase64Image(base64, ext = ".jpg") {
  // Tolerate a data: URL prefix — browsers produce those from canvas/FileReader.
  const cleaned = String(base64).replace(/^data:image\/[a-zA-Z+]+;base64,/, "");
  const buffer = Buffer.from(cleaned, "base64");
  if (buffer.length === 0) throw new Error("image is empty or not valid base64");
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error("image exceeds 8 MB");

  const filename = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), buffer);
  return filename;
}

/**
 * The intake pipeline: persist first, then enrich.
 *
 * The report is written to disk BEFORE any dependency is called, so a
 * citizen's submission is never lost to a downstream outage. Classification
 * and dispatch are enrichments layered on afterwards, each independently
 * degradable.
 *
 * Shared by the canonical POST /api/v1/reports route and the flat
 * POST /reportBin alias so the two can never drift apart.
 *
 * @returns {{report: object, degraded: object|null}}
 */
export async function createReport({
  location,
  address = null,
  notes = null,
  reporterName = "Anonymous",
  photoFilename = null,
  autoAssign = true,
}) {
  const report = {
    id: newId("bin"),
    location: { lat: Number(location.lat), lng: Number(location.lng) },
    address,
    notes,
    reporter_name: reporterName,
    photo_url: photoFilename ? `/uploads/${photoFilename}` : null,
    waste_type: null,
    classification: null,
    status: "reported",
    assignment: null,
    reported_at: new Date().toISOString(),
    cleared_at: null,
  };

  // --- persist before enriching --------------------------------------------
  const data = store.read();
  data.reports.push(report);
  store.write(data);

  const degraded = {};

  // --- enrich: classify -----------------------------------------------------
  if (photoFilename) {
    const filePath = path.join(UPLOAD_DIR, photoFilename);
    const result = await classify(fs.readFileSync(filePath), report.id);
    if (result.ok) {
      report.classification = result.data.prediction;
      report.waste_type = result.data.prediction.type;
    } else {
      degraded.classification = result.reason;
    }
  } else {
    degraded.classification = "no_photo_supplied";
  }

  // --- enrich: dispatch -----------------------------------------------------
  if (autoAssign) {
    const result = await requestAssignment({
      binId: report.id,
      location: report.location,
      wasteType: report.waste_type,
    });
    if (result.ok) {
      report.assignment = {
        assignment_id: result.data.id,
        worker_id: result.data.worker_id,
        worker_name: result.data.worker_name,
        distance_km: result.data.distance_km,
      };
      report.status = "assigned";
    } else {
      // 503 = genuinely no worker free; distinct from an outage.
      degraded.assignment =
        result.reason === "upstream_503" ? "no_workers_available" : result.reason;
    }
  }

  // --- persist enrichment ---------------------------------------------------
  const after = store.read();
  const idx = after.reports.findIndex((r) => r.id === report.id);
  if (idx !== -1) after.reports[idx] = report;
  store.write(after);

  // --- fire-and-forget analytics -------------------------------------------
  await Promise.all([
    emit("bin.reported", report.id, { has_photo: Boolean(photoFilename) }),
    report.waste_type
      ? emit("bin.classified", report.id, { waste_type: report.waste_type })
      : Promise.resolve(),
  ]);

  return { report, degraded: Object.keys(degraded).length ? degraded : null };
}

/**
 * Re-runs classification on a stored report's photo.
 * Shared by POST /api/v1/reports/:id/reclassify and POST /detectWasteType.
 *
 * @returns {{ok: true, report} | {ok: false, code: string}}
 */
export async function reclassifyReport(binId) {
  const data = store.read();
  const report = data.reports.find((r) => r.id === binId);
  if (!report) return { ok: false, code: "not_found" };
  if (!report.photo_url) return { ok: false, code: "no_photo" };

  const filePath = path.join(UPLOAD_DIR, path.basename(report.photo_url));
  if (!fs.existsSync(filePath)) return { ok: false, code: "photo_gone" };

  const result = await classify(fs.readFileSync(filePath), report.id);
  if (!result.ok) return { ok: false, code: "classifier_unavailable", reason: result.reason };

  report.classification = result.data.prediction;
  report.waste_type = result.data.prediction.type;
  store.write(data);

  await emit("bin.classified", report.id, { waste_type: report.waste_type });
  return { ok: true, report };
}

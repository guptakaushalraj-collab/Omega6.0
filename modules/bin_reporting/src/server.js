import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import { store } from "./store.js";
import { classify, requestAssignment, emit, dependencyConfig } from "./clients.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, "..", "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
const PORT = process.env.PORT || 4101;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use("/uploads", express.static(UPLOAD_DIR));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || ".jpg";
      cb(null, `${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`);
    },
  }),
  limits: { fileSize: MAX_IMAGE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image uploads are accepted"));
    }
    cb(null, true);
  },
});

const id = (p) => `${p}_${crypto.randomBytes(6).toString("hex")}`;
const validPoint = (p) =>
  p &&
  Number.isFinite(Number(p.lat)) &&
  Number.isFinite(Number(p.lng)) &&
  Math.abs(Number(p.lat)) <= 90 &&
  Math.abs(Number(p.lng)) <= 180;

app.get("/api/v1/health", (_req, res) =>
  res.json({
    ok: true,
    module: "bin_reporting",
    version: "1.0.0",
    dependencies: dependencyConfig(),
  })
);

/**
 * Intake. Accepts multipart (photo + fields) or plain JSON.
 *
 * The pipeline is: persist first, then enrich. The report is written to disk
 * before any dependency is called, so a citizen's submission is never lost to
 * a downstream outage — classification and dispatch are enrichments layered
 * on afterwards, each independently degradable.
 */
app.post("/api/v1/reports", upload.single("photo"), async (req, res) => {
  const body = req.body || {};
  const lat = body.lat ?? body.location?.lat;
  const lng = body.lng ?? body.location?.lng;

  if (!validPoint({ lat, lng })) {
    return res.status(400).json({
      error: "lat and lng are required and must be valid coordinates",
    });
  }

  const autoAssign = body.auto_assign === undefined ? true : String(body.auto_assign) !== "false";

  const report = {
    id: id("bin"),
    location: { lat: Number(lat), lng: Number(lng) },
    address: body.address || null,
    notes: body.notes || null,
    reporter_name: body.reporter_name || "Anonymous",
    photo_url: req.file ? `/uploads/${req.file.filename}` : null,
    waste_type: null,
    classification: null,
    status: "reported",
    assignment: null,
    reported_at: new Date().toISOString(),
    cleared_at: null,
  };

  // --- persist before enriching -------------------------------------------
  const data = store.read();
  data.reports.push(report);
  store.write(data);

  const degraded = {};

  // --- enrich: classify ----------------------------------------------------
  if (req.file) {
    const result = await classify(fs.readFileSync(req.file.path), report.id);
    if (result.ok) {
      report.classification = result.data.prediction;
      report.waste_type = result.data.prediction.type;
    } else {
      degraded.classification = result.reason;
    }
  } else {
    degraded.classification = "no_photo_supplied";
  }

  // --- enrich: dispatch ----------------------------------------------------
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

  // --- persist enrichment --------------------------------------------------
  const after = store.read();
  const idx = after.reports.findIndex((r) => r.id === report.id);
  if (idx !== -1) after.reports[idx] = report;
  store.write(after);

  // --- fire-and-forget analytics ------------------------------------------
  await Promise.all([
    emit("bin.reported", report.id, { has_photo: Boolean(req.file) }),
    report.waste_type
      ? emit("bin.classified", report.id, { waste_type: report.waste_type })
      : Promise.resolve(),
  ]);

  res.status(201).json({
    report,
    degraded: Object.keys(degraded).length ? degraded : null,
  });
});

app.get("/api/v1/reports", (req, res) => {
  const { status, waste_type } = req.query;
  const limit = Math.min(Number(req.query.limit) || 100, 500);

  let list = store.read().reports;
  if (status) list = list.filter((r) => r.status === status);
  if (waste_type) list = list.filter((r) => r.waste_type === waste_type);

  res.json({ count: list.length, reports: list.slice().reverse().slice(0, limit) });
});

app.get("/api/v1/reports/:id", (req, res) => {
  const found = store.read().reports.find((r) => r.id === req.params.id);
  if (!found) return res.status(404).json({ error: "Report not found" });
  res.json(found);
});

/**
 * Backfill a classification that was skipped because waste_recognition was
 * unavailable at intake. This is the recovery path that makes degrading on
 * classification safe rather than lossy.
 */
app.post("/api/v1/reports/:id/reclassify", async (req, res) => {
  const data = store.read();
  const report = data.reports.find((r) => r.id === req.params.id);
  if (!report) return res.status(404).json({ error: "Report not found" });
  if (!report.photo_url) {
    return res.status(422).json({ error: "Report has no photo to classify" });
  }

  const filePath = path.join(UPLOAD_DIR, path.basename(report.photo_url));
  if (!fs.existsSync(filePath)) {
    return res.status(410).json({ error: "Stored photo is no longer available" });
  }

  const result = await classify(fs.readFileSync(filePath), report.id);
  if (!result.ok) {
    return res.status(503).json({ error: "Classifier unavailable", reason: result.reason });
  }

  report.classification = result.data.prediction;
  report.waste_type = result.data.prediction.type;
  store.write(data);

  await emit("bin.classified", report.id, { waste_type: report.waste_type });
  res.json(report);
});

/**
 * Status transitions. `cleared` is normally driven by worker_dashboard
 * completing the assignment; this endpoint exists for manual correction and
 * for operators running bin_reporting without a dispatch module.
 */
app.patch("/api/v1/reports/:id/status", async (req, res) => {
  const { status } = req.body || {};
  if (!["reported", "assigned", "in_progress", "cleared"].includes(status)) {
    return res.status(422).json({
      error: "status must be reported, assigned, in_progress or cleared",
    });
  }

  const data = store.read();
  const report = data.reports.find((r) => r.id === req.params.id);
  if (!report) return res.status(404).json({ error: "Report not found" });

  report.status = status;
  report.cleared_at = status === "cleared" ? new Date().toISOString() : null;
  store.write(data);

  if (status === "cleared") {
    await emit("bin.collected", report.id, {
      worker_id: report.assignment?.worker_id || null,
    });
  }

  res.json(report);
});

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: `Photo exceeds ${MAX_IMAGE_BYTES} bytes` });
  }
  console.error(err);
  res.status(500).json({ error: err.message || "Internal error" });
});

app.listen(PORT, () => console.log(`[bin_reporting] listening on :${PORT}`));

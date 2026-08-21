// Load this module's .env before anything reads process.env.
import "./env.js";
import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import path from "node:path";
import multer from "multer";
import { store } from "./store.js";
import { emit, dependencyConfig } from "./clients.js";
import {
  createReport,
  reclassifyReport,
  validPoint,
  UPLOAD_DIR,
  MAX_IMAGE_BYTES,
} from "./intake.js";
import { compatRouter } from "./compat.js";

const app = express();
const PORT = process.env.PORT || 4101;

app.use(cors());
app.use(express.json({ limit: "12mb" })); // base64 images inflate ~33%
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
 * The persist-then-enrich pipeline lives in intake.js, shared with the flat
 * POST /reportBin alias so the two cannot drift.
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

  const { report, degraded } = await createReport({
    location: { lat, lng },
    address: body.address || null,
    notes: body.notes || null,
    reporterName: body.reporter_name || "Anonymous",
    photoFilename: req.file ? req.file.filename : null,
    autoAssign: body.auto_assign === undefined ? true : String(body.auto_assign) !== "false",
  });

  res.status(201).json({ report, degraded });
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
  const result = await reclassifyReport(req.params.id);

  if (result.ok) return res.json(result.report);

  switch (result.code) {
    case "not_found":
      return res.status(404).json({ error: "Report not found" });
    case "no_photo":
      return res.status(422).json({ error: "Report has no photo to classify" });
    case "photo_gone":
      return res.status(410).json({ error: "Stored photo is no longer available" });
    default:
      return res
        .status(503)
        .json({ error: "Classifier unavailable", reason: result.reason });
  }
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

// Flat verb-style alias endpoints (POST /reportBin, POST /detectWasteType).
// Mounted at the root, alongside — never replacing — the canonical routes above.
app.use(compatRouter);

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: `Photo exceeds ${MAX_IMAGE_BYTES} bytes` });
  }
  console.error(err);
  res.status(500).json({ error: err.message || "Internal error" });
});

app.listen(PORT, () => console.log(`[bin_reporting] listening on :${PORT}`));

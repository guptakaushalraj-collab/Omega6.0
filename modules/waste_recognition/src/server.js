import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import multer from "multer";
import { store } from "./store.js";
import { classify, TAXONOMY, MODEL_VERSION } from "./classifier.js";

const app = express();
const PORT = process.env.PORT || 4102;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

app.use(cors());
app.use(express.json({ limit: "12mb" })); // base64 inflates ~33%

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES },
});

const id = (p) => `${p}_${crypto.randomBytes(6).toString("hex")}`;

app.get("/api/v1/health", (_req, res) =>
  res.json({ ok: true, module: "waste_recognition", version: "1.0.0", model_version: MODEL_VERSION })
);

app.get("/api/v1/waste-types", (_req, res) => res.json(TAXONOMY));

/**
 * Accepts an image either as multipart (`photo`) or as base64 JSON
 * (`image_base64`). Two intake shapes because integrators arrive with
 * different constraints — browsers post files, server-side callers usually
 * already hold bytes.
 */
app.post("/api/v1/classify", upload.single("photo"), (req, res) => {
  let buffer = null;

  if (req.file) {
    buffer = req.file.buffer;
  } else if (req.body?.image_base64) {
    try {
      buffer = Buffer.from(String(req.body.image_base64), "base64");
    } catch {
      return res.status(400).json({ error: "image_base64 is not valid base64" });
    }
  }

  if (!buffer || buffer.length === 0) {
    return res.status(400).json({
      error: "No image supplied. Send multipart field 'photo' or JSON field 'image_base64'.",
    });
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    return res.status(413).json({ error: `Image exceeds ${MAX_IMAGE_BYTES} bytes` });
  }

  let prediction;
  try {
    prediction = classify(buffer);
  } catch (err) {
    return res.status(422).json({ error: err.message });
  }

  const record = {
    id: id("cls"),
    reference: req.body?.reference || null,
    prediction,
    image_bytes: buffer.length,
    classified_at: new Date().toISOString(),
  };

  // Audit trail is capped — this module is sold on per-request pricing and
  // must not accumulate unbounded disk on a buyer's host.
  const data = store.read();
  data.classifications.unshift(record);
  data.classifications = data.classifications.slice(0, 500);
  store.write(data);

  res.status(200).json(record);
});

app.get("/api/v1/classifications", (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  res.json(store.read().classifications.slice(0, limit));
});

app.get("/api/v1/classifications/:id", (req, res) => {
  const found = store.read().classifications.find((c) => c.id === req.params.id);
  if (!found) return res.status(404).json({ error: "Classification not found" });
  res.json(found);
});

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: `Image exceeds ${MAX_IMAGE_BYTES} bytes` });
  }
  console.error(err);
  res.status(500).json({ error: err.message || "Internal error" });
});

app.listen(PORT, () => console.log(`[waste_recognition] listening on :${PORT}`));

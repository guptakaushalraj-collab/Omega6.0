/**
 * SignalPost Relay API — acquired 2026-03-14 from SignalPost Messaging Inc.
 *
 * Conventions below (/v1 base path, X-API-Key auth, snake_case fields, the
 * { error: { code, message } } envelope) are the ORIGINAL vendor conventions
 * and are retained deliberately. Existing SignalPost client SDKs and the
 * vendor's published documentation must keep working, and a future buyer
 * expects the API they purchased. Do not "normalize" this to house style.
 */
// Load this module's .env before anything reads process.env.
import "./env.js";
import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import { store } from "./store.js";
import { compatRouter } from "./compat.js";

const app = express();
const PORT = process.env.PORT || 4105;
const API_KEY = process.env.NOTIFY_API_KEY || "dev-signalpost-key";
const MAX_MESSAGES = Number(process.env.MAX_MESSAGES || 10000);
const MAX_BODY_CHARS = 1000;

const CHANNELS = ["in_app", "sms", "email", "push"];

app.use(cors());
app.use(express.json({ limit: "512kb" }));

const id = (p) => `${p}_${crypto.randomBytes(6).toString("hex")}`;

// Vendor error envelope — differs from the in-house modules' { error: "..." }.
function fail(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

app.get("/v1/health", (_req, res) =>
  res.json({ ok: true, service: "signalpost-relay", version: "2.4.1" })
);

// API-key gate. Named so the flat alias below can reuse the identical check
// rather than re-implementing (or worse, skipping) it.
function requireApiKey(req, res, next) {
  const supplied = req.get("X-API-Key");
  if (!supplied) {
    return fail(res, 401, "missing_api_key", "X-API-Key header is required.");
  }
  if (supplied !== API_KEY) {
    return fail(res, 403, "invalid_api_key", "The supplied API key was not recognised.");
  }
  next();
}

// Health is public; every other /v1 route requires the key.
app.use("/v1", (req, res, next) => {
  if (req.path === "/health") return next();
  requireApiKey(req, res, next);
});

// Flat verb-style alias (POST /notifyPickup) at the ROOT path, as specified.
// Because it sits outside /v1 it does not inherit the gate above, so the same
// check is applied explicitly — an unauthenticated notification endpoint is a
// spam vector, and the alias must not become a way around auth.
app.use(requireApiKey, compatRouter);

app.get("/v1/channels", (_req, res) => res.json({ channels: CHANNELS }));

app.post("/v1/messages", (req, res) => {
  const { recipient_type, recipient_id, body, channel, subject_ref, metadata } = req.body || {};

  if (!recipient_type || typeof recipient_type !== "string") {
    return fail(res, 400, "missing_recipient_type", "recipient_type is required (e.g. worker, admin, citizen).");
  }
  if (!body || typeof body !== "string" || body.trim() === "") {
    return fail(res, 400, "missing_body", "body is required and must be a non-empty string.");
  }
  if (body.length > MAX_BODY_CHARS) {
    return fail(res, 422, "body_too_long", `body exceeds ${MAX_BODY_CHARS} characters.`);
  }

  const ch = channel || "in_app";
  if (!CHANNELS.includes(ch)) {
    return fail(res, 422, "unsupported_channel", `channel must be one of: ${CHANNELS.join(", ")}.`);
  }

  const message = {
    id: id("msg"),
    recipient_type,
    recipient_id: recipient_id || null,
    channel: ch,
    body: body.trim(),
    subject_ref: subject_ref || null,
    metadata: metadata && typeof metadata === "object" ? metadata : {},
    // Only in_app is actually delivered by this build. The other channels are
    // accepted and recorded as queued — the SignalPost gateway credentials
    // that fulfil them were NOT part of the acquisition. See README.
    delivery_status: ch === "in_app" ? "delivered" : "queued",
    acknowledged: false,
    created_at: new Date().toISOString(),
    acknowledged_at: null,
  };

  const data = store.read();
  data.messages.unshift(message);
  if (data.messages.length > MAX_MESSAGES) {
    data.messages = data.messages.slice(0, MAX_MESSAGES);
  }
  store.write(data);

  res.status(201).json(message);
});

app.get("/v1/messages", (req, res) => {
  const { recipient_type, recipient_id, unacknowledged, subject_ref } = req.query;
  const limit = Math.min(Number(req.query.limit) || 100, 500);

  let list = store.read().messages;
  if (recipient_type) list = list.filter((m) => m.recipient_type === recipient_type);
  if (recipient_id) list = list.filter((m) => m.recipient_id === recipient_id);
  if (subject_ref) list = list.filter((m) => m.subject_ref === subject_ref);
  if (unacknowledged === "true") list = list.filter((m) => !m.acknowledged);

  res.json({ count: list.length, messages: list.slice(0, limit) });
});

app.get("/v1/messages/:id", (req, res) => {
  const found = store.read().messages.find((m) => m.id === req.params.id);
  if (!found) return fail(res, 404, "message_not_found", "No message with that id.");
  res.json(found);
});

app.post("/v1/messages/:id/ack", (req, res) => {
  const data = store.read();
  const msg = data.messages.find((m) => m.id === req.params.id);
  if (!msg) return fail(res, 404, "message_not_found", "No message with that id.");

  if (!msg.acknowledged) {
    msg.acknowledged = true;
    msg.acknowledged_at = new Date().toISOString();
    store.write(data);
  }
  res.json(msg);
});

app.post("/v1/messages/ack_all", (req, res) => {
  const { recipient_type, recipient_id } = req.body || {};
  if (!recipient_type && !recipient_id) {
    return fail(res, 400, "missing_selector", "Supply recipient_type and/or recipient_id.");
  }

  const data = store.read();
  const now = new Date().toISOString();
  let acked = 0;

  for (const m of data.messages) {
    if (recipient_type && m.recipient_type !== recipient_type) continue;
    if (recipient_id && m.recipient_id !== recipient_id) continue;
    if (m.acknowledged) continue;
    m.acknowledged = true;
    m.acknowledged_at = now;
    acked += 1;
  }
  store.write(data);

  res.json({ acknowledged: acked });
});

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  fail(res, 500, "internal_error", err.message || "Internal error");
});

app.listen(PORT, () =>
  console.log(`[notification_system] SignalPost Relay 2.4.1 listening on :${PORT}`)
);

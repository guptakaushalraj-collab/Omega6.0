// Load this module's .env before anything reads process.env.
import "./env.js";
import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import { store } from "./store.js";
import { summarize, trend, EVENT_TYPES } from "./metrics.js";

const app = express();
const PORT = process.env.PORT || 4104;
const MAX_EVENTS = Number(process.env.MAX_EVENTS || 20000);

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const id = (p) => `${p}_${crypto.randomBytes(6).toString("hex")}`;

app.get("/api/v1/health", (_req, res) =>
  res.json({ ok: true, module: "analytics_dashboard", version: "1.0.0" })
);

app.get("/api/v1/event-types", (_req, res) => res.json(EVENT_TYPES));

/**
 * Ingest one event. Accepts unknown `type` values (stored, but excluded from
 * derived metrics) so a producer rolling out a new event type never gets
 * 400s from an analytics module that has not been upgraded yet.
 */
app.post("/api/v1/events", (req, res) => {
  const { type, subject_id, payload, occurred_at, source } = req.body || {};

  if (!type || typeof type !== "string") {
    return res.status(400).json({ error: "type is required and must be a string" });
  }

  let when = occurred_at || new Date().toISOString();
  if (Number.isNaN(new Date(when).getTime())) {
    return res.status(400).json({ error: "occurred_at must be an ISO-8601 timestamp" });
  }

  const event = {
    id: id("evt"),
    type,
    subject_id: subject_id || null,
    source: source || null,
    payload: payload && typeof payload === "object" ? payload : {},
    occurred_at: new Date(when).toISOString(),
    received_at: new Date().toISOString(),
    known_type: EVENT_TYPES.includes(type),
  };

  const data = store.read();
  data.events.push(event);
  if (data.events.length > MAX_EVENTS) {
    data.events = data.events.slice(-MAX_EVENTS); // evict oldest
  }
  store.write(data);

  res.status(202).json({ accepted: true, id: event.id, known_type: event.known_type });
});

app.get("/api/v1/events", (req, res) => {
  const { type, subject_id } = req.query;
  const limit = Math.min(Number(req.query.limit) || 100, 1000);

  let events = store.read().events;
  if (type) events = events.filter((e) => e.type === type);
  if (subject_id) events = events.filter((e) => e.subject_id === subject_id);

  res.json(events.slice(-limit).reverse());
});

app.get("/api/v1/summary", (_req, res) => res.json(summarize(store.read().events)));

app.get("/api/v1/trends", (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 90);
  res.json({ days, series: trend(store.read().events, days) });
});

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Internal error" });
});

app.listen(PORT, () => console.log(`[analytics_dashboard] listening on :${PORT}`));

/**
 * FieldOps Crew API — acquired 2025-11-02 from FieldOps Software Ltd.
 *
 * Retains FieldOps conventions (/v1 base path, Bearer token auth, snake_case
 * fields). Not normalized to house style — see README for why.
 */
// Load this module's .env before anything reads process.env.
import "./env.js";
import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import { store } from "./store.js";
import { optimizeRoute, notify, emit, dependencyConfig } from "./clients.js";

const app = express();
const PORT = process.env.PORT || 4106;
const AUTH_TOKEN = process.env.CREW_AUTH_TOKEN || "dev-fieldops-token";

app.use(cors());
app.use(express.json({ limit: "512kb" }));

const id = (p) => `${p}_${crypto.randomBytes(6).toString("hex")}`;

// FieldOps error envelope: flat { error, detail }.
const fail = (res, status, error, detail) => res.status(status).json({ error, detail });

const EARTH_R = 6371;
const toRad = (d) => (d * Math.PI) / 180;
function haversineKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

const validPoint = (p) =>
  p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng));

app.get("/v1/health", (_req, res) =>
  res.json({
    ok: true,
    service: "fieldops-crew",
    version: "3.1.0",
    dependencies: dependencyConfig(),
  })
);

// Bearer gate. Health is public.
app.use("/v1", (req, res, next) => {
  if (req.path === "/health") return next();
  const header = req.get("Authorization") || "";
  const [scheme, token] = header.split(" ");
  if (!header) return fail(res, 401, "unauthorized", "Authorization header is required.");
  if (scheme !== "Bearer" || !token) {
    return fail(res, 401, "unauthorized", "Expected 'Authorization: Bearer <token>'.");
  }
  if (token !== AUTH_TOKEN) return fail(res, 403, "forbidden", "Token not recognised.");
  next();
});

/* ---------------------------------- workers -------------------------------- */

app.post("/v1/workers", (req, res) => {
  const { name, phone, location } = req.body || {};
  if (!name || typeof name !== "string") {
    return fail(res, 400, "invalid_request", "name is required.");
  }
  if (!validPoint(location)) {
    return fail(res, 400, "invalid_request", "location must be { lat, lng }.");
  }

  const data = store.read();
  const worker = {
    id: id("wrk"),
    name,
    phone: phone || null,
    location: { lat: Number(location.lat), lng: Number(location.lng) },
    status: "available",
    created_at: new Date().toISOString(),
  };
  data.workers.push(worker);
  store.write(data);
  res.status(201).json(worker);
});

app.get("/v1/workers", (req, res) => {
  const data = store.read();
  const { status } = req.query;

  let workers = data.workers;
  if (status) workers = workers.filter((w) => w.status === status);

  res.json({
    count: workers.length,
    workers: workers.map((w) => ({
      ...w,
      open_assignments: data.assignments.filter(
        (a) => a.worker_id === w.id && a.status !== "completed"
      ).length,
      completed_assignments: data.assignments.filter(
        (a) => a.worker_id === w.id && a.status === "completed"
      ).length,
    })),
  });
});

app.patch("/v1/workers/:id", (req, res) => {
  const { status, location } = req.body || {};
  const data = store.read();
  const worker = data.workers.find((w) => w.id === req.params.id);
  if (!worker) return fail(res, 404, "not_found", "No worker with that id.");

  if (status) {
    if (!["available", "busy", "off_shift"].includes(status)) {
      return fail(res, 422, "invalid_status", "status must be available, busy or off_shift.");
    }
    worker.status = status;
  }
  if (location !== undefined) {
    if (!validPoint(location)) return fail(res, 400, "invalid_request", "location must be { lat, lng }.");
    worker.location = { lat: Number(location.lat), lng: Number(location.lng) };
  }
  store.write(data);
  res.json(worker);
});

/* -------------------------------- assignments ------------------------------ */

/**
 * Assign the nearest available worker to a job.
 *
 * Notification and analytics are fire-and-forget: if either is down the
 * assignment still stands and is returned normally, with the failure surfaced
 * in `side_effects` so the caller can see what did not happen.
 */
app.post("/v1/assignments", async (req, res) => {
  const { job_ref, location, metadata } = req.body || {};
  if (!job_ref) return fail(res, 400, "invalid_request", "job_ref is required.");
  if (!validPoint(location)) {
    return fail(res, 400, "invalid_request", "location must be { lat, lng }.");
  }

  const data = store.read();
  if (data.assignments.some((a) => a.job_ref === job_ref && a.status !== "completed")) {
    return fail(res, 409, "duplicate_job", `job_ref ${job_ref} already has an open assignment.`);
  }

  const available = data.workers.filter((w) => w.status === "available");
  if (available.length === 0) {
    return fail(res, 503, "no_workers_available", "No available worker to assign.");
  }

  const target = { lat: Number(location.lat), lng: Number(location.lng) };
  let nearest = available[0];
  let nearestKm = haversineKm(target, nearest.location);
  for (const w of available.slice(1)) {
    const d = haversineKm(target, w.location);
    if (d < nearestKm) {
      nearest = w;
      nearestKm = d;
    }
  }

  const assignment = {
    id: id("asg"),
    job_ref,
    worker_id: nearest.id,
    worker_name: nearest.name,
    location: target,
    metadata: metadata && typeof metadata === "object" ? metadata : {},
    distance_km: Number(nearestKm.toFixed(2)),
    status: "assigned",
    assigned_at: new Date().toISOString(),
    started_at: null,
    completed_at: null,
  };

  nearest.status = "busy";
  data.assignments.push(assignment);
  store.write(data);

  const [notified, emitted] = await Promise.all([
    notify({
      recipientType: "worker",
      recipientId: nearest.id,
      body: `New pickup assigned, ${assignment.distance_km} km away.`,
      subjectRef: job_ref,
    }),
    emit("bin.assigned", job_ref, {
      worker_id: nearest.id,
      distance_km: assignment.distance_km,
    }),
  ]);

  // The sender reports delivery, not the notification module — that keeps
  // notification_system a dependency-free leaf (and more readily sold alone).
  if (notified.ok) {
    await emit("notification.sent", job_ref, { recipient_type: "worker", trigger: "assigned" });
  }

  res.status(201).json({
    ...assignment,
    side_effects: {
      notification: notified.ok ? "sent" : `skipped:${notified.reason}`,
      analytics: emitted.ok ? "recorded" : `skipped:${emitted.reason}`,
    },
  });
});

app.get("/v1/assignments", (req, res) => {
  const { worker_id, status, job_ref } = req.query;
  let list = store.read().assignments;
  if (worker_id) list = list.filter((a) => a.worker_id === worker_id);
  if (status) list = list.filter((a) => a.status === status);
  if (job_ref) list = list.filter((a) => a.job_ref === job_ref);
  res.json({ count: list.length, assignments: list.slice().reverse() });
});

app.patch("/v1/assignments/:id", async (req, res) => {
  const { status } = req.body || {};
  if (!["assigned", "in_progress", "completed"].includes(status)) {
    return fail(res, 422, "invalid_status", "status must be assigned, in_progress or completed.");
  }

  const data = store.read();
  const assignment = data.assignments.find((a) => a.id === req.params.id);
  if (!assignment) return fail(res, 404, "not_found", "No assignment with that id.");

  if (assignment.status === "completed") {
    return fail(res, 409, "already_completed", "Completed assignments are immutable.");
  }

  assignment.status = status;
  const worker = data.workers.find((w) => w.id === assignment.worker_id);

  if (status === "in_progress") {
    assignment.started_at = new Date().toISOString();
  }
  if (status === "completed") {
    assignment.completed_at = new Date().toISOString();
    // Free the worker only if this was their last open job.
    const stillOpen = data.assignments.some(
      (a) => a.worker_id === assignment.worker_id && a.id !== assignment.id && a.status !== "completed"
    );
    if (worker && !stillOpen) worker.status = "available";
  }

  // Persist BEFORE side effects: the notification client writes nothing here,
  // but keeping the order explicit avoids a later refactor reintroducing a
  // lost-update race between this write and a dependency's callback.
  store.write(data);

  const side_effects = {};
  if (status === "completed") {
    const [citizenMsg, adminMsg, emitted] = await Promise.all([
      notify({
        recipientType: "citizen",
        body: "The bin you reported has been cleared. Thanks for helping keep the city clean!",
        subjectRef: assignment.job_ref,
      }),
      notify({
        recipientType: "admin",
        body: `${assignment.worker_name} cleared ${assignment.job_ref}.`,
        subjectRef: assignment.job_ref,
      }),
      emit("bin.collected", assignment.job_ref, { worker_id: assignment.worker_id }),
    ]);
    side_effects.citizen_notification = citizenMsg.ok ? "sent" : `skipped:${citizenMsg.reason}`;
    side_effects.admin_notification = adminMsg.ok ? "sent" : `skipped:${adminMsg.reason}`;
    side_effects.analytics = emitted.ok ? "recorded" : `skipped:${emitted.reason}`;

    // One event per delivered message, so analytics can count notifications
    // without notification_system needing an outbound dependency of its own.
    await Promise.all(
      [
        citizenMsg.ok ? "citizen" : null,
        adminMsg.ok ? "admin" : null,
      ]
        .filter(Boolean)
        .map((recipient) =>
          emit("notification.sent", assignment.job_ref, {
            recipient_type: recipient,
            trigger: "completed",
          })
        )
    );
  }

  res.json({ ...assignment, side_effects });
});

/**
 * A worker's open jobs, sequenced into a route.
 *
 * Degradation: if route_optimizer is unreachable the stops are returned
 * unordered with `optimized: false`, so the worker still sees their queue.
 */
app.get("/v1/workers/:id/queue", async (req, res) => {
  const data = store.read();
  const worker = data.workers.find((w) => w.id === req.params.id);
  if (!worker) return fail(res, 404, "not_found", "No worker with that id.");

  const open = data.assignments.filter(
    (a) => a.worker_id === worker.id && a.status !== "completed"
  );

  const stops = open.map((a) => ({
    assignment_id: a.id,
    job_ref: a.job_ref,
    location: a.location,
    metadata: a.metadata,
  }));

  if (stops.length === 0) {
    return res.json({
      worker_id: worker.id,
      worker_name: worker.name,
      optimized: true,
      total_distance_km: 0,
      stops: [],
    });
  }

  const result = await optimizeRoute(worker.location, stops);

  if (!result.ok) {
    return res.json({
      worker_id: worker.id,
      worker_name: worker.name,
      optimized: false,
      degraded_reason: result.reason,
      total_distance_km: null,
      stops,
    });
  }

  emit("route.optimized", worker.id, { stop_count: stops.length }).catch(() => {});

  res.json({
    worker_id: worker.id,
    worker_name: worker.name,
    optimized: true,
    strategy: result.data.strategy,
    total_distance_km: result.data.total_distance_km,
    stops: result.data.stops,
  });
});

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  fail(res, 500, "internal_error", err.message || "Internal error");
});

app.listen(PORT, () =>
  console.log(`[worker_dashboard] FieldOps Crew 3.1.0 listening on :${PORT}`)
);

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";
import cors from "cors";
import { UPLOAD_DIR } from "./middleware/upload.js";
import { binsRouter } from "./routes/bins.js";
import { workersRouter } from "./routes/workers.js";
import { tasksRouter } from "./routes/tasks.js";
import { notificationsRouter } from "./routes/notifications.js";
import { analyticsRouter } from "./routes/analytics.js";

const app = express();
const PORT = process.env.PORT || 4000;
// 0.0.0.0 so the process is reachable from outside the host. Default to
// localhost: a service that binds every interface the moment it starts is how
// a dev box ends up on the public internet by accident. Opt in explicitly.
const HOST = process.env.HOST || "127.0.0.1";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FRONTEND_DIST = process.env.FRONTEND_DIST || join(ROOT, "frontend", "dist");

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(UPLOAD_DIR));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use("/api/bins", binsRouter);
app.use("/api/workers", workersRouter);
app.use("/api/tasks", tasksRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/analytics", analyticsRouter);

// ---------------------------------------------------------------- frontend
// Serve the built React app from the SAME origin as the API.
//
// The Vite dev server proxies /api -> :4000, but that proxy exists only in dev
// config. A production build requests /api/... from whatever host serves the
// HTML, so unless one process serves both, the deployed site 404s on every
// call. Serving dist here means no reverse proxy and no CORS to configure.
//
// Absent (nobody ran `npm run build`) the API still works — the message says
// what to do rather than 404ing silently.
if (existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
  // SPA fallback: React Router owns the client-side paths, so any non-/api GET
  // that is not a real file must return index.html. Without this, a refresh on
  // /worker or a shared deep link 404s.
  app.get(/^\/(?!api\/|uploads\/).*/, (_req, res) => {
    res.sendFile(join(FRONTEND_DIST, "index.html"));
  });
} else {
  app.get("/", (_req, res) => {
    res.status(503).json({
      error: "Frontend not built",
      detail: "Run `npm --prefix frontend install && npm --prefix frontend run build`, then restart.",
      api: "/api/health",
    });
  });
}

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Internal server error" });
});

app.listen(PORT, HOST, () => {
  const site = existsSync(FRONTEND_DIST) ? "site + API" : "API only (frontend not built)";
  console.log(`Waste Collection Network — ${site} on http://${HOST}:${PORT}`);
  if (HOST === "127.0.0.1") {
    console.log("Bound to localhost. Set HOST=0.0.0.0 to accept remote connections.");
  }
});

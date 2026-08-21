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

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(UPLOAD_DIR));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use("/api/bins", binsRouter);
app.use("/api/workers", workersRouter);
app.use("/api/tasks", tasksRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/analytics", analyticsRouter);

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`Waste Collection Network API listening on http://localhost:${PORT}`);
});

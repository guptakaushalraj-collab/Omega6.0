import { Router } from "express";
import { db } from "../db.js";
import { generateId } from "../utils/idGen.js";
import { optimizeRoute } from "../services/routeOptimizer.js";

export const workersRouter = Router();

workersRouter.get("/", (_req, res) => {
  const data = db.read();
  const withCounts = data.workers.map((w) => ({
    ...w,
    completedTasks: data.tasks.filter((t) => t.workerId === w.id && t.status === "completed").length,
    activeTasks: data.tasks.filter((t) => t.workerId === w.id && t.status !== "completed").length,
  }));
  res.json(withCounts);
});

workersRouter.post("/", (req, res) => {
  const { name, phone, lat, lng } = req.body;
  if (!name || lat === undefined || lng === undefined) {
    return res.status(400).json({ error: "name, lat and lng are required" });
  }
  const data = db.read();
  const worker = {
    id: generateId("worker"),
    name,
    phone: phone || null,
    location: { lat: Number(lat), lng: Number(lng) },
    status: "available",
    createdAt: new Date().toISOString(),
  };
  data.workers.push(worker);
  db.write(data);
  res.status(201).json(worker);
});

// Returns this worker's pending/assigned stops in an optimized visiting
// order, starting from their current location.
workersRouter.get("/:id/route", (req, res) => {
  const data = db.read();
  const worker = data.workers.find((w) => w.id === req.params.id);
  if (!worker) return res.status(404).json({ error: "Worker not found" });

  const tasks = data.tasks.filter(
    (t) => t.workerId === worker.id && t.status !== "completed"
  );
  const stops = tasks
    .map((t) => {
      const bin = data.bins.find((b) => b.id === t.binId);
      if (!bin) return null;
      return { taskId: t.id, binId: bin.id, location: bin.location, wasteType: bin.wasteType, address: bin.address };
    })
    .filter(Boolean);

  const route = optimizeRoute(worker.location, stops);
  res.json(route);
});

workersRouter.patch("/:id", (req, res) => {
  const { status, lat, lng } = req.body;
  const data = db.read();
  const worker = data.workers.find((w) => w.id === req.params.id);
  if (!worker) return res.status(404).json({ error: "Worker not found" });
  if (status) worker.status = status;
  if (lat !== undefined && lng !== undefined) {
    worker.location = { lat: Number(lat), lng: Number(lng) };
  }
  db.write(data);
  res.json(worker);
});

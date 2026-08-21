import { Router } from "express";
import { db } from "../db.js";
import { assignNearestWorker, assignAllPending } from "../services/assignmentService.js";
import { pushNotification } from "../services/notificationService.js";

export const tasksRouter = Router();

tasksRouter.get("/", (req, res) => {
  const { workerId, status } = req.query;
  const data = db.read();
  let tasks = data.tasks;
  if (workerId) tasks = tasks.filter((t) => t.workerId === workerId);
  if (status) tasks = tasks.filter((t) => t.status === status);
  res.json(tasks.slice().reverse());
});

tasksRouter.post("/assign/:binId", (req, res) => {
  try {
    const task = assignNearestWorker(req.params.binId);
    res.status(201).json(task);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

tasksRouter.post("/assign-all", (_req, res) => {
  res.json(assignAllPending());
});

tasksRouter.patch("/:id", (req, res) => {
  const { status } = req.body;
  if (!["assigned", "in_progress", "completed"].includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }

  const data = db.read();
  const task = data.tasks.find((t) => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found" });

  const bin = data.bins.find((b) => b.id === task.binId);
  const worker = data.workers.find((w) => w.id === task.workerId);

  task.status = status;
  if (status === "in_progress") {
    task.startedAt = new Date().toISOString();
    if (bin) bin.status = "in_progress";
  }
  if (status === "completed") {
    task.completedAt = new Date().toISOString();
    if (bin) {
      bin.status = "cleared";
      bin.clearedAt = task.completedAt;
    }
    if (worker) worker.status = "available";
  }

  // Persist the task/bin/worker mutation before pushing notifications —
  // pushNotification does its own read-modify-write cycle against the file,
  // so writing `data` after it would clobber the notification it just added.
  db.write(data);

  if (status === "completed") {
    pushNotification({
      role: "admin",
      message: `Bin ${task.binId} cleared by ${worker?.name ?? "worker"}.`,
      binId: task.binId,
    });
    pushNotification({
      role: "citizen",
      message: `Your reported bin has been cleared. Thanks for helping keep the city clean!`,
      binId: task.binId,
    });
  }

  res.json(task);
});

import { Router } from "express";
import { db } from "../db.js";
import { WASTE_TYPES } from "../services/classifier.js";

export const analyticsRouter = Router();

function dayKey(isoString) {
  return isoString.slice(0, 10);
}

analyticsRouter.get("/summary", (_req, res) => {
  const data = db.read();
  const { bins, tasks, workers } = data;

  const totalReported = bins.length;
  const totalCleared = bins.filter((b) => b.status === "cleared").length;
  const totalPending = bins.filter((b) => b.status === "reported").length;
  const totalInProgress = bins.filter((b) =>
    ["assigned", "in_progress"].includes(b.status)
  ).length;

  const wasteTypeBreakdown = WASTE_TYPES.map((wt) => ({
    type: wt.key,
    label: wt.label,
    color: wt.binColor,
    count: bins.filter((b) => b.wasteType?.type === wt.key).length,
  })).filter((row) => row.count > 0);

  const completedTasks = tasks.filter((t) => t.status === "completed" && t.completedAt);
  const avgResolutionMinutes =
    completedTasks.length > 0
      ? Math.round(
          completedTasks.reduce((sum, t) => {
            const bin = bins.find((b) => b.id === t.binId);
            if (!bin) return sum;
            const minutes =
              (new Date(t.completedAt) - new Date(bin.reportedAt)) / 60000;
            return sum + minutes;
          }, 0) / completedTasks.length
        )
      : 0;

  const workerLeaderboard = workers
    .map((w) => ({
      id: w.id,
      name: w.name,
      completed: tasks.filter((t) => t.workerId === w.id && t.status === "completed").length,
      active: tasks.filter((t) => t.workerId === w.id && t.status !== "completed").length,
      status: w.status,
    }))
    .sort((a, b) => b.completed - a.completed);

  // Reports-per-day for the last 7 days, oldest first.
  const trend = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = dayKey(d.toISOString());
    trend.push({
      date: key,
      reported: bins.filter((b) => dayKey(b.reportedAt) === key).length,
      cleared: bins.filter((b) => b.clearedAt && dayKey(b.clearedAt) === key).length,
    });
  }

  res.json({
    totals: {
      reported: totalReported,
      cleared: totalCleared,
      pending: totalPending,
      inProgress: totalInProgress,
      workers: workers.length,
      availableWorkers: workers.filter((w) => w.status === "available").length,
    },
    avgResolutionMinutes,
    wasteTypeBreakdown,
    workerLeaderboard,
    trend,
  });
});

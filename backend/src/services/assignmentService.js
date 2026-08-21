import { db } from "../db.js";
import { generateId } from "../utils/idGen.js";
import { haversineDistanceKm } from "../utils/geo.js";
import { pushNotification } from "./notificationService.js";

// Picks the closest available worker to a bin and creates a task for them.
// Real-world version would also weigh current workload, shift hours, and
// vehicle capacity — the distance-only heuristic keeps the demo legible.
export function assignNearestWorker(binId) {
  const data = db.read();
  const bin = data.bins.find((b) => b.id === binId);
  if (!bin) throw new Error("Bin not found");
  if (bin.status !== "reported") {
    throw new Error(`Bin ${binId} is already ${bin.status}`);
  }

  const availableWorkers = data.workers.filter((w) => w.status === "available");
  if (availableWorkers.length === 0) {
    throw new Error("No available workers to assign");
  }

  let nearest = availableWorkers[0];
  let nearestDist = haversineDistanceKm(bin.location, nearest.location);
  for (const worker of availableWorkers.slice(1)) {
    const dist = haversineDistanceKm(bin.location, worker.location);
    if (dist < nearestDist) {
      nearest = worker;
      nearestDist = dist;
    }
  }

  const task = {
    id: generateId("task"),
    binId: bin.id,
    workerId: nearest.id,
    status: "assigned",
    distanceKm: Number(nearestDist.toFixed(2)),
    assignedAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
  };

  bin.status = "assigned";
  bin.assignedWorkerId = nearest.id;
  bin.taskId = task.id;
  nearest.status = "busy";

  data.tasks.push(task);
  db.write(data);

  pushNotification({
    role: "worker",
    workerId: nearest.id,
    message: `New pickup assigned: ${bin.wasteType?.label ?? "waste"} bin at (${bin.location.lat.toFixed(
      3
    )}, ${bin.location.lng.toFixed(3)}), ${task.distanceKm} km away.`,
    binId: bin.id,
  });
  pushNotification({
    role: "admin",
    message: `Bin ${bin.id} assigned to ${nearest.name}.`,
    binId: bin.id,
  });

  return task;
}

// Runs assignment for every currently unassigned ("reported") bin, in the
// order they were reported. Used by the admin "Auto-assign all" action.
export function assignAllPending() {
  const data = db.read();
  const pendingBinIds = data.bins
    .filter((b) => b.status === "reported")
    .map((b) => b.id);

  const results = [];
  for (const binId of pendingBinIds) {
    try {
      results.push({ binId, task: assignNearestWorker(binId) });
    } catch (err) {
      results.push({ binId, error: err.message });
    }
  }
  return results;
}

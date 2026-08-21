import { useEffect, useState, useCallback } from "react";
import { api } from "../api.js";
import StatusBadge from "../components/StatusBadge.jsx";
import MiniMap from "../components/MiniMap.jsx";
import Toast from "../components/Toast.jsx";

export default function WorkerDashboard() {
  const [workers, setWorkers] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [route, setRoute] = useState(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);

  const loadWorkers = useCallback(async () => {
    const data = await api.getWorkers();
    setWorkers(data);
    if (!selectedId && data.length > 0) setSelectedId(data[0].id);
    return data;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadRoute = useCallback(async (workerId) => {
    if (!workerId) return;
    setLoading(true);
    try {
      const data = await api.getWorkerRoute(workerId);
      setRoute(data);
    } catch (err) {
      setToast({ type: "error", message: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWorkers();
  }, [loadWorkers]);

  useEffect(() => {
    if (selectedId) loadRoute(selectedId);
  }, [selectedId, loadRoute]);

  async function completeStop(taskId) {
    try {
      await api.updateTaskStatus(taskId, "completed");
      setToast({ type: "success", message: "Marked as cleared. Notification sent." });
      await loadWorkers();
      await loadRoute(selectedId);
    } catch (err) {
      setToast({ type: "error", message: err.message });
    }
  }

  async function startStop(taskId) {
    try {
      await api.updateTaskStatus(taskId, "in_progress");
      await loadRoute(selectedId);
    } catch (err) {
      setToast({ type: "error", message: err.message });
    }
  }

  const selectedWorker = workers.find((w) => w.id === selectedId);

  return (
    <div>
      <div className="page-header">
        <h1>Worker Dashboard</h1>
        <p>Pick a worker to see their optimized collection route for the day.</p>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <label>Worker</label>
        <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
          {workers.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} — {w.status} ({w.activeTasks} active, {w.completedTasks} done)
            </option>
          ))}
        </select>
        {selectedWorker && (
          <div style={{ marginTop: 10 }}>
            <StatusBadge status={selectedWorker.status} />
          </div>
        )}
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h2 className="section-title">
            Optimized Route {route && `— ${route.totalDistanceKm} km total`}
          </h2>
          {loading && <p>Loading route…</p>}
          {!loading && route?.stops.length === 0 && (
            <div className="empty-state">No pending stops. Nice work! 🎉</div>
          )}
          {!loading && route?.stops.length > 0 && (
            <div className="list-gap">
              {route.stops.map((stop, i) => (
                <div className="route-stop" key={stop.taskId}>
                  <div className="num">{i + 1}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>
                      {stop.wasteType?.label ?? "Waste"} bin{stop.address ? ` — ${stop.address}` : ""}
                    </div>
                    <div className="meta">
                      {stop.legDistanceKm} km from previous stop · {stop.location.lat.toFixed(4)}, {stop.location.lng.toFixed(4)}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="secondary" onClick={() => startStop(stop.taskId)}>
                      Start
                    </button>
                    <button onClick={() => completeStop(stop.taskId)}>Clear</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h2 className="section-title">Route Map</h2>
          <MiniMap
            bins={route?.stops.map((s) => ({ id: s.binId, location: s.location, wasteType: s.wasteType })) || []}
            workers={selectedWorker ? [selectedWorker] : []}
            routeOrder={route?.stops.map((s) => s.binId) || []}
          />
          <p className="meta" style={{ marginTop: 10 }}>
            🟩 worker · colored dots = bins · dashed line = suggested visiting order
          </p>
        </div>
      </div>

      <Toast message={toast?.message} type={toast?.type} onClose={() => setToast(null)} />
    </div>
  );
}

import { useEffect, useState, useCallback } from "react";
import { api } from "../api.js";
import StatCard from "../components/StatCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import MiniMap from "../components/MiniMap.jsx";
import Toast from "../components/Toast.jsx";

export default function AdminDashboard() {
  const [summary, setSummary] = useState(null);
  const [bins, setBins] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [toast, setToast] = useState(null);
  const [newWorker, setNewWorker] = useState({ name: "", lat: "", lng: "" });
  const [assigning, setAssigning] = useState(false);

  const loadAll = useCallback(async () => {
    const [s, b, w] = await Promise.all([
      api.getAnalyticsSummary(),
      api.getBins(),
      api.getWorkers(),
    ]);
    setSummary(s);
    setBins(b);
    setWorkers(w);
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  async function handleAutoAssign() {
    setAssigning(true);
    try {
      const results = await api.assignAllPending();
      const assigned = results.filter((r) => r.task).length;
      setToast({ type: "success", message: `Assigned ${assigned} of ${results.length} pending bin(s).` });
      await loadAll();
    } catch (err) {
      setToast({ type: "error", message: err.message });
    } finally {
      setAssigning(false);
    }
  }

  async function handleAddWorker(e) {
    e.preventDefault();
    try {
      await api.addWorker({
        name: newWorker.name,
        lat: Number(newWorker.lat),
        lng: Number(newWorker.lng),
      });
      setNewWorker({ name: "", lat: "", lng: "" });
      setToast({ type: "success", message: "Worker added." });
      await loadAll();
    } catch (err) {
      setToast({ type: "error", message: err.message });
    }
  }

  if (!summary) return <p>Loading analytics…</p>;

  const maxCount = Math.max(1, ...summary.wasteTypeBreakdown.map((w) => w.count));

  return (
    <div>
      <div className="page-header">
        <h1>Admin Dashboard</h1>
        <p>City-wide view of waste reports, workers, and collection performance.</p>
      </div>

      <div className="grid cols-4" style={{ marginBottom: 20 }}>
        <StatCard label="Reported" value={summary.totals.reported} />
        <StatCard label="Pending" value={summary.totals.pending} />
        <StatCard label="In Progress" value={summary.totals.inProgress} />
        <StatCard label="Cleared" value={summary.totals.cleared} />
        <StatCard label="Workers" value={summary.totals.workers} hint={`${summary.totals.availableWorkers} available`} />
        <StatCard label="Avg Resolution" value={`${summary.avgResolutionMinutes}m`} />
      </div>

      <div className="grid cols-2" style={{ marginBottom: 20 }}>
        <div className="card">
          <h2 className="section-title">Waste Type Breakdown</h2>
          {summary.wasteTypeBreakdown.length === 0 && <p className="meta">No data yet.</p>}
          <div className="list-gap">
            {summary.wasteTypeBreakdown.map((row) => (
              <div key={row.type}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", marginBottom: 4 }}>
                  <span>{row.label}</span>
                  <span>{row.count}</span>
                </div>
                <div style={{ background: "#eef1ef", borderRadius: 6, height: 8 }}>
                  <div
                    style={{
                      width: `${(row.count / maxCount) * 100}%`,
                      background: row.color,
                      height: 8,
                      borderRadius: 6,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>

          <h2 className="section-title" style={{ marginTop: 22 }}>Worker Leaderboard</h2>
          <table>
            <thead>
              <tr><th>Worker</th><th>Completed</th><th>Active</th><th>Status</th></tr>
            </thead>
            <tbody>
              {summary.workerLeaderboard.map((w) => (
                <tr key={w.id}>
                  <td>{w.name}</td>
                  <td>{w.completed}</td>
                  <td>{w.active}</td>
                  <td><StatusBadge status={w.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2 className="section-title">City Map</h2>
          <MiniMap bins={bins} workers={workers} />
          <div style={{ marginTop: 16 }}>
            <button onClick={handleAutoAssign} disabled={assigning || summary.totals.pending === 0}>
              {assigning ? "Assigning…" : `Auto-assign ${summary.totals.pending} pending bin(s)`}
            </button>
          </div>

          <h2 className="section-title" style={{ marginTop: 22 }}>Add Worker</h2>
          <form className="stack" onSubmit={handleAddWorker}>
            <input
              type="text"
              placeholder="Name"
              value={newWorker.name}
              onChange={(e) => setNewWorker((n) => ({ ...n, name: e.target.value }))}
              required
            />
            <div className="row">
              <input
                type="number"
                step="any"
                placeholder="Latitude"
                value={newWorker.lat}
                onChange={(e) => setNewWorker((n) => ({ ...n, lat: e.target.value }))}
                required
              />
              <input
                type="number"
                step="any"
                placeholder="Longitude"
                value={newWorker.lng}
                onChange={(e) => setNewWorker((n) => ({ ...n, lng: e.target.value }))}
                required
              />
            </div>
            <button type="submit" className="secondary">Add Worker</button>
          </form>
        </div>
      </div>

      <div className="card">
        <h2 className="section-title">Recent Reports</h2>
        {bins.length === 0 ? (
          <div className="empty-state">No bins reported yet.</div>
        ) : (
          <table>
            <thead>
              <tr><th>Bin</th><th>Waste Type</th><th>Location</th><th>Status</th><th>Reported</th></tr>
            </thead>
            <tbody>
              {bins.slice(0, 15).map((bin) => (
                <tr key={bin.id}>
                  <td><code>{bin.id.slice(0, 12)}</code></td>
                  <td>
                    <span className="dot" style={{ background: bin.wasteType?.binColor }} /> {bin.wasteType?.label}
                  </td>
                  <td>{bin.address || `${bin.location.lat.toFixed(3)}, ${bin.location.lng.toFixed(3)}`}</td>
                  <td><StatusBadge status={bin.status} /></td>
                  <td>{new Date(bin.reportedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Toast message={toast?.message} type={toast?.type} onClose={() => setToast(null)} />
    </div>
  );
}

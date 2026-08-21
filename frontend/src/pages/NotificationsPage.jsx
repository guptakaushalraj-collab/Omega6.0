import { useEffect, useState, useCallback } from "react";
import { api } from "../api.js";

const ROLES = [
  { key: "admin", label: "Admin" },
  { key: "worker", label: "Worker" },
  { key: "citizen", label: "Citizen" },
];

export default function NotificationsPage() {
  const [role, setRole] = useState("admin");
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (r) => {
    setLoading(true);
    try {
      const data = await api.getNotifications({ role: r });
      setNotifications(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(role);
  }, [role, load]);

  async function markRead(id) {
    await api.markNotificationRead(id);
    load(role);
  }

  async function markAllRead() {
    await api.markAllNotificationsRead({ role });
    load(role);
  }

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div>
      <div className="page-header">
        <h1>Notifications</h1>
        <p>Alerts fire when bins are reported, assigned, and cleared.</p>
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
          <div className="pill-select">
            {ROLES.map((r) => (
              <button
                key={r.key}
                className={role === r.key ? "" : "ghost"}
                onClick={() => setRole(r.key)}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button className="secondary" onClick={markAllRead} disabled={unreadCount === 0}>
            Mark all read ({unreadCount})
          </button>
        </div>

        {loading && <p>Loading…</p>}
        {!loading && notifications.length === 0 && (
          <div className="empty-state">No notifications for this role yet.</div>
        )}
        <div className="list-gap">
          {notifications.map((n) => (
            <div key={n.id} className={`notif-item ${n.read ? "" : "unread"}`}>
              <div>
                <div>{n.message}</div>
                <div className="meta">{new Date(n.createdAt).toLocaleString()}</div>
              </div>
              {!n.read && (
                <button className="ghost" onClick={() => markRead(n.id)}>
                  Mark read
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

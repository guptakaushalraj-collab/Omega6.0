const BASE = "/api";

async function handle(res) {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

export const api = {
  getWasteTypes: () => fetch(`${BASE}/bins/waste-types`).then(handle),

  getBins: (status) =>
    fetch(`${BASE}/bins${status ? `?status=${status}` : ""}`).then(handle),

  reportBin: (formData) =>
    fetch(`${BASE}/bins`, { method: "POST", body: formData }).then(handle),

  getWorkers: () => fetch(`${BASE}/workers`).then(handle),

  addWorker: (worker) =>
    fetch(`${BASE}/workers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(worker),
    }).then(handle),

  getWorkerRoute: (workerId) =>
    fetch(`${BASE}/workers/${workerId}/route`).then(handle),

  getTasks: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return fetch(`${BASE}/tasks${qs ? `?${qs}` : ""}`).then(handle);
  },

  assignTask: (binId) =>
    fetch(`${BASE}/tasks/assign/${binId}`, { method: "POST" }).then(handle),

  assignAllPending: () =>
    fetch(`${BASE}/tasks/assign-all`, { method: "POST" }).then(handle),

  updateTaskStatus: (taskId, status) =>
    fetch(`${BASE}/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }).then(handle),

  getNotifications: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return fetch(`${BASE}/notifications${qs ? `?${qs}` : ""}`).then(handle);
  },

  markNotificationRead: (id) =>
    fetch(`${BASE}/notifications/${id}/read`, { method: "PATCH" }).then(handle),

  markAllNotificationsRead: (params = {}) =>
    fetch(`${BASE}/notifications/read-all`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    }).then(handle),

  getAnalyticsSummary: () => fetch(`${BASE}/analytics/summary`).then(handle),
};

const BASE = import.meta.env?.VITE_API_BASE_URL ?? '';

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

async function request(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  // 207 is a *successful* partial sync, not a failure — the caller inspects
  // per-operation results.
  if (!response.ok && response.status !== 207) {
    throw new ApiError(body?.error || `HTTP ${response.status}`, response.status, body);
  }
  return body;
}

export const api = {
  health: () => request('/api/health'),
  snapshot: () => request('/api/sync/snapshot'),
  changes: (since = 0) => request(`/api/sync/changes?since=${encodeURIComponent(since)}`),
  push: (clientId, operations) =>
    request('/api/sync', {
      method: 'POST',
      body: JSON.stringify({ client_id: clientId, operations }),
    }),
};

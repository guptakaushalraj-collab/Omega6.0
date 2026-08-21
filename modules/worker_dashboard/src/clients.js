/**
 * Outbound adapters to other modules.
 *
 * Every call here follows three rules that keep this module independently
 * ownable:
 *
 *   1. Target resolved from an env var, never hardcoded. Swap the provider
 *      without touching code.
 *   2. Hard timeout on every request. A slow dependency must not become our
 *      slow response.
 *   3. Never throw. Each returns a { ok, ... } result and the caller degrades.
 *      A dependency being down degrades a feature; it never fails the request.
 *
 * Note the adaptation cost of the OTHER acquired module living here: the
 * notification client below translates our vocabulary into SignalPost's
 * (X-API-Key, recipient_type/body/subject_ref). That translation belongs at
 * the call site, not inside the module we bought.
 */

const ROUTE_OPTIMIZER_URL = process.env.ROUTE_OPTIMIZER_URL || "";
const NOTIFICATION_URL = process.env.NOTIFICATION_URL || "";
const NOTIFY_API_KEY = process.env.NOTIFY_API_KEY || "dev-signalpost-key";
const ANALYTICS_URL = process.env.ANALYTICS_URL || "";

const TIMEOUT_MS = Number(process.env.DEPENDENCY_TIMEOUT_MS || 2500);

async function request(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) {
      return { ok: false, reason: `upstream_${res.status}` };
    }
    return { ok: true, data: await res.json() };
  } catch (err) {
    return { ok: false, reason: err.name === "AbortError" ? "timeout" : "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sequence a worker's stops. Degradation: caller falls back to unordered
 * stops, so a worker still sees their queue when the optimizer is down.
 */
export async function optimizeRoute(start, stops) {
  if (!ROUTE_OPTIMIZER_URL) return { ok: false, reason: "not_configured" };
  return request(`${ROUTE_OPTIMIZER_URL}/api/v1/optimize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ start, stops }),
  });
}

/**
 * Send a notification via the acquired SignalPost relay. Degradation: the
 * assignment still stands; only the alert is lost.
 */
export async function notify({ recipientType, recipientId, body, subjectRef }) {
  if (!NOTIFICATION_URL) return { ok: false, reason: "not_configured" };
  return request(`${NOTIFICATION_URL}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": NOTIFY_API_KEY, // SignalPost's scheme, not ours
    },
    body: JSON.stringify({
      recipient_type: recipientType,
      recipient_id: recipientId,
      body,
      subject_ref: subjectRef,
      channel: "in_app",
    }),
  });
}

/** Emit an analytics event. Degradation: metrics lose a data point. */
export async function emit(type, subjectId, payload = {}) {
  if (!ANALYTICS_URL) return { ok: false, reason: "not_configured" };
  return request(`${ANALYTICS_URL}/api/v1/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, subject_id: subjectId, source: "worker_dashboard", payload }),
  });
}

export const dependencyConfig = () => ({
  route_optimizer: ROUTE_OPTIMIZER_URL || null,
  notification_system: NOTIFICATION_URL || null,
  analytics_dashboard: ANALYTICS_URL || null,
  timeout_ms: TIMEOUT_MS,
});

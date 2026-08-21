/**
 * Outbound adapters to other modules.
 *
 * Rules, identical in spirit to every other module's client layer:
 *   1. Target from an env var — the provider is swappable at deploy time.
 *   2. Hard timeout on every call.
 *   3. Never throw; return { ok, ... } and let the caller degrade.
 *
 * The worker_dashboard adapter below carries the adaptation cost for that
 * acquired module: Bearer auth, snake_case, and its domain-neutral vocabulary
 * (our bin id becomes its `job_ref`). Keeping that translation here is what
 * lets the purchased module stay unmodified and therefore resaleable.
 */

const WASTE_RECOGNITION_URL = process.env.WASTE_RECOGNITION_URL || "";
const WORKER_DASHBOARD_URL = process.env.WORKER_DASHBOARD_URL || "";
const CREW_AUTH_TOKEN = process.env.CREW_AUTH_TOKEN || "dev-fieldops-token";
const ANALYTICS_URL = process.env.ANALYTICS_URL || "";

const TIMEOUT_MS = Number(process.env.DEPENDENCY_TIMEOUT_MS || 2500);

async function request(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      return { ok: false, reason: `upstream_${res.status}`, body };
    }
    return { ok: true, data: body };
  } catch (err) {
    return { ok: false, reason: err.name === "AbortError" ? "timeout" : "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Classify a photo. Degradation: the bin is stored `unclassified` and can be
 * backfilled later via POST /api/v1/reports/:id/reclassify.
 */
export async function classify(imageBuffer, reference) {
  if (!WASTE_RECOGNITION_URL) return { ok: false, reason: "not_configured" };
  return request(`${WASTE_RECOGNITION_URL}/api/v1/classify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image_base64: imageBuffer.toString("base64"),
      reference,
    }),
  });
}

/**
 * Request dispatch from the acquired FieldOps module. Note the vocabulary
 * translation: our bin id is its job_ref.
 */
export async function requestAssignment({ binId, location, wasteType }) {
  if (!WORKER_DASHBOARD_URL) return { ok: false, reason: "not_configured" };
  return request(`${WORKER_DASHBOARD_URL}/v1/assignments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CREW_AUTH_TOKEN}`, // FieldOps' scheme, not ours
    },
    body: JSON.stringify({
      job_ref: binId,
      location,
      metadata: { waste_type: wasteType || null },
    }),
  });
}

/** Emit an analytics event. Degradation: metrics lose a data point. */
export async function emit(type, subjectId, payload = {}) {
  if (!ANALYTICS_URL) return { ok: false, reason: "not_configured" };
  return request(`${ANALYTICS_URL}/api/v1/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, subject_id: subjectId, source: "bin_reporting", payload }),
  });
}

export const dependencyConfig = () => ({
  waste_recognition: WASTE_RECOGNITION_URL || null,
  worker_dashboard: WORKER_DASHBOARD_URL || null,
  analytics_dashboard: ANALYTICS_URL || null,
  timeout_ms: TIMEOUT_MS,
});

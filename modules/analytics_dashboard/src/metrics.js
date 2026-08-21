// Metric derivation over the raw event log.
//
// This module never reads another module's database. It knows only the
// events it has been sent, which is what lets it be operated (or sold)
// independently of the systems it measures.

export const EVENT_TYPES = [
  "bin.reported",
  "bin.classified",
  "bin.assigned",
  "bin.collected",
  "notification.sent",
  "route.optimized",
];

const dayKey = (iso) => iso.slice(0, 10);

/**
 * Pairs each collected bin with its report event to derive resolution time.
 * Bins reported but never collected are excluded rather than counted as zero.
 */
function resolutionTimes(events) {
  const reportedAt = new Map();
  for (const e of events) {
    if (e.type === "bin.reported" && e.subject_id) {
      reportedAt.set(e.subject_id, e.occurred_at);
    }
  }

  const minutes = [];
  for (const e of events) {
    if (e.type !== "bin.collected" || !e.subject_id) continue;
    const start = reportedAt.get(e.subject_id);
    if (!start) continue;
    const delta = (new Date(e.occurred_at) - new Date(start)) / 60000;
    if (Number.isFinite(delta) && delta >= 0) minutes.push(delta);
  }
  return minutes;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

export function summarize(events) {
  const counts = Object.fromEntries(EVENT_TYPES.map((t) => [t, 0]));
  for (const e of events) {
    if (counts[e.type] !== undefined) counts[e.type] += 1;
  }

  // Waste-type mix, taken from classification events.
  const byType = new Map();
  for (const e of events) {
    if (e.type !== "bin.classified") continue;
    const t = e.payload?.waste_type;
    if (!t) continue;
    byType.set(t, (byType.get(t) || 0) + 1);
  }
  const total = [...byType.values()].reduce((a, b) => a + b, 0);
  const waste_mix = [...byType.entries()]
    .map(([type, count]) => ({
      type,
      count,
      share: total ? Number((count / total).toFixed(3)) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  // Per-worker collection counts, from assignment/collection events.
  const byWorker = new Map();
  for (const e of events) {
    const w = e.payload?.worker_id;
    if (!w) continue;
    const row = byWorker.get(w) || { worker_id: w, assigned: 0, collected: 0 };
    if (e.type === "bin.assigned") row.assigned += 1;
    if (e.type === "bin.collected") row.collected += 1;
    byWorker.set(w, row);
  }
  const worker_activity = [...byWorker.values()].sort((a, b) => b.collected - a.collected);

  const res = resolutionTimes(events).sort((a, b) => a - b);
  const mean = res.length ? res.reduce((a, b) => a + b, 0) / res.length : 0;

  const reported = counts["bin.reported"];
  const collected = counts["bin.collected"];

  return {
    totals: {
      events: events.length,
      reported,
      collected,
      outstanding: Math.max(0, reported - collected),
      notifications_sent: counts["notification.sent"],
      routes_optimized: counts["route.optimized"],
    },
    collection_rate: reported ? Number((collected / reported).toFixed(3)) : 0,
    resolution_minutes: {
      samples: res.length,
      mean: Number(mean.toFixed(1)),
      p50: Number(percentile(res, 50).toFixed(1)),
      p90: Number(percentile(res, 90).toFixed(1)),
    },
    event_counts: counts,
    waste_mix,
    worker_activity,
  };
}

export function trend(events, days = 7) {
  const out = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = dayKey(d.toISOString());
    out.push({
      date: key,
      reported: events.filter((e) => e.type === "bin.reported" && dayKey(e.occurred_at) === key).length,
      collected: events.filter((e) => e.type === "bin.collected" && dayKey(e.occurred_at) === key).length,
    });
  }
  return out;
}

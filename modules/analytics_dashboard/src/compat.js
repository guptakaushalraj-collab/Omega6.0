/**
 * Flat verb-style alias endpoint.
 *
 *   GET /analytics  ->  chart-ready data
 *
 * Additive alias over the canonical GET /api/v1/summary and /api/v1/trends.
 *
 * The spec calls for "charts data", so this endpoint reshapes the same
 * derived metrics into series a charting library can consume directly —
 * parallel `labels` / `values` arrays plus a `colors` array, rather than the
 * array-of-objects the canonical endpoints return. That saves every frontend
 * writing the same `.map()` boilerplate, and keeps chart colours consistent
 * across clients by deciding them server-side.
 *
 * `kpis` and `charts` are the whole payload a dashboard needs in one request.
 */
import { Router } from "express";
import { store } from "./store.js";
import { summarize, trend } from "./metrics.js";

export const compatRouter = Router();

// Kept in step with waste_recognition's taxonomy. Duplicated deliberately:
// importing across module boundaries is exactly what the registry forbids,
// and an unknown type simply falls back to grey.
const TYPE_COLORS = {
  plastic: "#2563eb",
  organic: "#16a34a",
  paper: "#ca8a04",
  metal: "#64748b",
  glass: "#0d9488",
  "e-waste": "#7c3aed",
  mixed: "#78716c",
};

compatRouter.get("/analytics", (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 90);
  const events = store.read().events;

  const summary = summarize(events);
  const series = trend(events, days);

  res.json({
    generated_at: new Date().toISOString(),
    window_days: days,

    // Headline figures for stat tiles.
    kpis: {
      reported: summary.totals.reported,
      collected: summary.totals.collected,
      outstanding: summary.totals.outstanding,
      collection_rate: summary.collection_rate,
      avg_resolution_minutes: summary.resolution_minutes.mean,
      p90_resolution_minutes: summary.resolution_minutes.p90,
      active_workers: summary.worker_activity.length,
      notifications_sent: summary.totals.notifications_sent,
    },

    charts: {
      // Line/area: reported vs collected per day.
      daily_activity: {
        type: "line",
        labels: series.map((d) => d.date),
        datasets: [
          { label: "Reported", values: series.map((d) => d.reported), color: "#2563eb" },
          { label: "Collected", values: series.map((d) => d.collected), color: "#16a34a" },
        ],
      },

      // Pie/donut: share of each waste type.
      waste_mix: {
        type: "pie",
        labels: summary.waste_mix.map((w) => w.type),
        values: summary.waste_mix.map((w) => w.count),
        colors: summary.waste_mix.map((w) => TYPE_COLORS[w.type] || "#78716c"),
        shares: summary.waste_mix.map((w) => w.share),
      },

      // Horizontal bar: per-worker collections, already sorted desc.
      worker_leaderboard: {
        type: "bar",
        labels: summary.worker_activity.map((w) => w.worker_id),
        datasets: [
          {
            label: "Collected",
            values: summary.worker_activity.map((w) => w.collected),
            color: "#16a34a",
          },
          {
            label: "Assigned",
            values: summary.worker_activity.map((w) => w.assigned),
            color: "#94a3b8",
          },
        ],
      },

      // Bar: how the bin backlog splits right now.
      status_breakdown: {
        type: "bar",
        labels: ["Collected", "Outstanding"],
        values: [summary.totals.collected, summary.totals.outstanding],
        colors: ["#16a34a", "#ca8a04"],
      },
    },

    // The unreshaped metrics, so a caller needing detail does not have to
    // make a second request to /api/v1/summary.
    summary,
  });
});

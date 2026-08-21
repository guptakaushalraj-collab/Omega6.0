#!/usr/bin/env node
/**
 * Loads the mock dataset into every module's datastore.
 *
 * Writes DIRECTLY to each module's store file rather than going through the
 * REST APIs, for one reason: the fixtures carry backdated timestamps spanning
 * a week, and the APIs (correctly) stamp `created_at`/`reported_at` as now.
 * Posting them would collapse the whole dataset onto today and flatten every
 * trend. Direct writes preserve the time dimension the fixtures exist for.
 *
 * Because it bypasses the APIs, this is a TEST fixture loader, not a
 * demonstration that the APIs work — scripts/integration-test.js is what
 * exercises those.
 *
 * Usage:
 *   node scripts/seed-mocks.js           # load fixtures
 *   node scripts/seed-mocks.js --reset   # wipe every store, load nothing
 *
 * Modules re-read their store on each request, so seeding takes effect
 * immediately with no restart. If a module is mid-write the seed can be
 * clobbered, so prefer seeding while the mesh is idle.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULES = path.join(__dirname, "..", "modules");

const EMPTY = {
  bin_reporting: { reports: [] },
  waste_recognition: { classifications: [] },
  route_optimizer: null, // stateless — no store
  analytics_dashboard: { events: [] },
  notification_system: { messages: [] },
  worker_dashboard: { workers: [], assignments: [] },
};

const storePath = (m) => path.join(MODULES, m, "src", "data", "store.json");
const mockPath = (m, f) => path.join(MODULES, m, "mocks", f);

function writeStore(module, data) {
  const p = storePath(module);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`);
}

const readMock = (m, f) => JSON.parse(fs.readFileSync(mockPath(m, f), "utf-8"));

/* ------------------------------------------------------------- rebasing */

/**
 * Fixtures are generated against a fixed anchor date so they diff cleanly.
 * That makes them age: analytics_dashboard's trend window is relative to
 * today, so a stale anchor produces an empty chart and the dataset looks
 * broken. Shifting every timestamp by a constant offset preserves the
 * dataset's internal shape — relative ordering, resolution times, which day
 * each event lands on — while placing it in the present.
 */
const TS_FIELDS = [
  "created_at", "acknowledged_at", "reported_at", "cleared_at",
  "assigned_at", "started_at", "completed_at", "occurred_at",
  "received_at", "classified_at",
];

function computeOffset() {
  // Anchor on the newest timestamp in the event stream, and shift it to ~1h
  // ago so "today" has visible activity without any future-dated records.
  const events = readMock("analytics_dashboard", "events.json");
  const newest = Math.max(...events.map((e) => new Date(e.occurred_at).getTime()));
  return Date.now() - 3600_000 - newest;
}

function rebase(obj, offsetMs) {
  if (Array.isArray(obj)) return obj.map((o) => rebase(o, offsetMs));
  if (obj === null || typeof obj !== "object") return obj;

  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (TS_FIELDS.includes(k) && typeof v === "string") {
      const t = new Date(v).getTime();
      out[k] = Number.isNaN(t) ? v : new Date(t + offsetMs).toISOString();
    } else if (v && typeof v === "object") {
      out[k] = rebase(v, offsetMs);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/* ---------------------------------------------------------------- reset */

if (process.argv.includes("--reset")) {
  for (const [module, empty] of Object.entries(EMPTY)) {
    if (!empty) continue;
    writeStore(module, empty);
    console.log(`  reset ${module}`);
  }
  console.log("\nAll stores emptied.");
  process.exit(0);
}

/* ----------------------------------------------------------------- seed */

const offset = computeOffset();
const days = Math.round(offset / 86400000);
console.log(
  `Seeding mock dataset (timestamps rebased ${days >= 0 ? "+" : ""}${days}d to land in the present)\n`
);

const reports = rebase(readMock("bin_reporting", "reports.json"), offset);
writeStore("bin_reporting", { reports });
console.log(`  bin_reporting        ${reports.length} reports`);

const classifications = rebase(readMock("waste_recognition", "classifications.json"), offset);
writeStore("waste_recognition", { classifications });
console.log(`  waste_recognition    ${classifications.length} classifications`);

const workers = rebase(readMock("worker_dashboard", "workers.json"), offset);
const assignments = rebase(readMock("worker_dashboard", "assignments.json"), offset);
writeStore("worker_dashboard", { workers, assignments });
console.log(`  worker_dashboard     ${workers.length} workers, ${assignments.length} assignments`);

const messages = rebase(readMock("notification_system", "messages.json"), offset);
writeStore("notification_system", { messages });
console.log(`  notification_system  ${messages.length} messages`);

// analytics events need the `id`/`received_at`/`known_type` fields the ingest
// endpoint would normally add — the fixtures store only the wire shape.
const KNOWN = [
  "bin.reported", "bin.classified", "bin.assigned",
  "bin.collected", "notification.sent", "route.optimized",
];
const events = rebase(readMock("analytics_dashboard", "events.json"), offset).map((e, i) => ({
  id: `evt_seed${String(i).padStart(6, "0")}`,
  ...e,
  payload: e.payload || {},
  received_at: e.occurred_at,
  known_type: KNOWN.includes(e.type),
}));
writeStore("analytics_dashboard", { events });
console.log(`  analytics_dashboard  ${events.length} events`);

console.log(`
  route_optimizer      (stateless — see modules/route_optimizer/mocks/scenarios.json)

Seeded. Modules re-read their store per request, so no restart is needed.
`);

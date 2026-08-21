#!/usr/bin/env node
/**
 * Generates the mock dataset shared across all six modules.
 *
 * The whole point is REFERENTIAL INTEGRITY: a bin id minted here appears as
 * bin_reporting's report id, worker_dashboard's assignment `job_ref`,
 * notification_system's `subject_ref`, waste_recognition's `reference`, and
 * analytics_dashboard's event `subject_id`. Hand-writing six fixture files
 * separately would drift within a week and make cross-module testing useless.
 *
 * Deterministic: a fixed PRNG seed means regenerating produces byte-identical
 * files, so fixtures diff cleanly and tests are reproducible. Timestamps are
 * anchored to a fixed date for the same reason — see ANCHOR below.
 *
 * Run: node scripts/generate-mocks.js
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULES = path.join(__dirname, "..", "modules");

/* ----------------------------------------------------------- determinism */

// mulberry32 — small, fast, seedable. Reproducibility matters more than
// statistical quality for fixtures.
function makeRng(seed) {
  let a = seed;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = makeRng(20260821);

const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const between = (lo, hi) => lo + rng() * (hi - lo);
const intBetween = (lo, hi) => Math.floor(between(lo, hi + 1));

// Deterministic hex ids — NOT crypto.randomBytes, which would change every run.
function hexId(prefix, n) {
  let s = "";
  for (let i = 0; i < 12; i += 1) s += "0123456789abcdef"[Math.floor(rng() * 16)];
  return `${prefix}_${s}`;
}

/**
 * Timestamps are anchored to a FIXED date rather than "now".
 *
 * Trade-off: fixtures stay byte-stable across regenerations and diff cleanly,
 * but they age — analytics_dashboard's 7-day trend window is relative to the
 * current date, so a stale anchor yields an empty trend chart. seed-mocks.js
 * therefore rebases every timestamp onto the seeding date at load time. This
 * anchor only fixes the SHAPE of the week (which day each event falls on).
 */
const ANCHOR = new Date("2026-08-21T09:00:00.000Z");
const DAY_MS = 86400000;

function at(daysAgo, hour, minute = 0) {
  const d = new Date(ANCHOR.getTime() - daysAgo * DAY_MS);
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString();
}

/* ------------------------------------------------------------------ data */

// Bengaluru — the demo city used throughout the project.
const NEIGHBOURHOODS = [
  { name: "MG Road", lat: 12.9752, lng: 77.6068 },
  { name: "Indiranagar 100ft Rd", lat: 12.9719, lng: 77.6412 },
  { name: "Koramangala 5th Block", lat: 12.9345, lng: 77.6266 },
  { name: "Jayanagar 4th Block", lat: 12.9250, lng: 77.5838 },
  { name: "Malleshwaram 8th Cross", lat: 13.0055, lng: 77.5692 },
  { name: "Whitefield Main Rd", lat: 12.9698, lng: 77.7500 },
  { name: "HSR Layout Sector 2", lat: 12.9116, lng: 77.6474 },
  { name: "Basavanagudi Bull Temple Rd", lat: 12.9422, lng: 77.5760 },
  { name: "Rajajinagar 1st Block", lat: 12.9910, lng: 77.5550 },
  { name: "Electronic City Phase 1", lat: 12.8452, lng: 77.6602 },
  { name: "Yeshwanthpur Market", lat: 13.0234, lng: 77.5540 },
  { name: "BTM Layout 2nd Stage", lat: 12.9166, lng: 77.6101 },
];

const WORKER_NAMES = [
  "Asha Kumar", "Ravi Singh", "Meera Nair", "Farhan Ali",
  "Divya Rao", "Suresh Babu", "Lakshmi Menon", "Imran Sheikh",
];

// Weighted so the mix looks like real municipal collection rather than a
// uniform distribution — plastic and organic dominate.
const WASTE_WEIGHTS = [
  ["plastic", 0.30], ["organic", 0.26], ["mixed", 0.16],
  ["paper", 0.12], ["glass", 0.08], ["metal", 0.05], ["e-waste", 0.03],
];

const WASTE_META = {
  plastic: { label: "Plastic", color: "#2563eb", recyclable: true, hazardous: false },
  organic: { label: "Organic", color: "#16a34a", recyclable: false, hazardous: false },
  paper: { label: "Paper", color: "#ca8a04", recyclable: true, hazardous: false },
  metal: { label: "Metal", color: "#64748b", recyclable: true, hazardous: false },
  glass: { label: "Glass", color: "#0d9488", recyclable: true, hazardous: false },
  "e-waste": { label: "E-Waste", color: "#7c3aed", recyclable: true, hazardous: true },
  mixed: { label: "Mixed", color: "#78716c", recyclable: false, hazardous: false },
};

function pickWaste() {
  const r = rng();
  let acc = 0;
  for (const [type, w] of WASTE_WEIGHTS) {
    acc += w;
    if (r <= acc) return type;
  }
  return "mixed";
}

const REPORTERS = [
  "Anonymous", "Anonymous", "Anonymous",
  "Priya S", "Karthik R", "Anjali M", "Vikram J", "Nisha P",
];

/* -------------------------------------------------------------- generate */

const workers = WORKER_NAMES.map((name, i) => {
  const base = NEIGHBOURHOODS[i % NEIGHBOURHOODS.length];
  return {
    id: hexId("wrk"),
    name,
    phone: `+9198${String(45000000 + intBetween(0, 4999999)).slice(0, 8)}`,
    location: {
      lat: Number((base.lat + between(-0.004, 0.004)).toFixed(6)),
      lng: Number((base.lng + between(-0.004, 0.004)).toFixed(6)),
    },
    status: "available",
    created_at: at(7, 6, i * 3),
  };
});

const reports = [];
const assignments = [];
const messages = [];
const events = [];
const classifications = [];

/**
 * Lifecycle mix, chosen to exercise every code path a consumer will hit:
 *   ~68% cleared        (complete happy path, drives resolution-time metrics)
 *   ~12% in_progress    (worker en route)
 *   ~10% assigned       (dispatched, not started)
 *   ~10% reported       (awaiting dispatch — exercises the backlog case)
 */
function pickStatus() {
  const r = rng();
  if (r < 0.68) return "cleared";
  if (r < 0.80) return "in_progress";
  if (r < 0.90) return "assigned";
  return "reported";
}

// Spread across 7 days; more recent days carry slightly more reports, which is
// what a growing service actually looks like.
const PER_DAY = [3, 4, 4, 5, 5, 6, 7]; // index 0 = 6 days ago

let workerCursor = 0;

for (let dayIdx = 0; dayIdx < PER_DAY.length; dayIdx += 1) {
  const daysAgo = 6 - dayIdx;

  for (let n = 0; n < PER_DAY[dayIdx]; n += 1) {
    const hood = pick(NEIGHBOURHOODS);
    const wasteType = pickWaste();
    const meta = WASTE_META[wasteType];
    const status = daysAgo === 0 ? (rng() < 0.5 ? "reported" : "assigned") : pickStatus();

    const reportHour = intBetween(6, 19);
    const reportMin = intBetween(0, 59);
    const reportedAt = at(daysAgo, reportHour, reportMin);
    const binId = hexId("bin");
    const hasPhoto = rng() < 0.85;

    const confidence = Number(between(0.7, 0.96).toFixed(2));
    const classification = hasPhoto
      ? {
          type: wasteType,
          label: meta.label,
          color: meta.color,
          recyclable: meta.recyclable,
          hazardous: meta.hazardous,
          confidence,
          alternatives: [],
          model_version: "stub-cv-1.0.0",
        }
      : null;

    const report = {
      id: binId,
      location: {
        lat: Number((hood.lat + between(-0.003, 0.003)).toFixed(6)),
        lng: Number((hood.lng + between(-0.003, 0.003)).toFixed(6)),
      },
      address: hood.name,
      notes: rng() < 0.3 ? pick([
        "Overflowing onto the footpath.",
        "Been like this for two days.",
        "Strong smell, needs urgent pickup.",
        "Stray dogs getting into it.",
        "Blocking the pedestrian crossing.",
      ]) : null,
      reporter_name: pick(REPORTERS),
      photo_url: hasPhoto ? `/uploads/mock-${binId.slice(4, 12)}.jpg` : null,
      waste_type: hasPhoto ? wasteType : null,
      classification,
      status,
      assignment: null,
      reported_at: reportedAt,
      cleared_at: null,
    };

    events.push({
      type: "bin.reported",
      subject_id: binId,
      source: "bin_reporting",
      payload: { has_photo: hasPhoto },
      occurred_at: reportedAt,
    });

    if (hasPhoto) {
      classifications.push({
        id: hexId("cls"),
        reference: binId,
        prediction: classification,
        image_bytes: intBetween(38000, 240000),
        classified_at: new Date(new Date(reportedAt).getTime() + 1200).toISOString(),
      });
      events.push({
        type: "bin.classified",
        subject_id: binId,
        source: "bin_reporting",
        payload: { waste_type: wasteType },
        occurred_at: new Date(new Date(reportedAt).getTime() + 1500).toISOString(),
      });
    }

    // Anything past "reported" has an assignment.
    if (status !== "reported") {
      const worker = workers[workerCursor % workers.length];
      workerCursor += 1;

      const assignedAt = new Date(
        new Date(reportedAt).getTime() + intBetween(60, 900) * 1000
      ).toISOString();
      const distanceKm = Number(between(0.3, 6.4).toFixed(2));
      const assignmentId = hexId("asg");

      const assignment = {
        id: assignmentId,
        job_ref: binId,
        worker_id: worker.id,
        worker_name: worker.name,
        location: report.location,
        metadata: { waste_type: report.waste_type },
        distance_km: distanceKm,
        status: status === "cleared" ? "completed" : status,
        assigned_at: assignedAt,
        started_at: null,
        completed_at: null,
      };

      report.assignment = {
        assignment_id: assignmentId,
        worker_id: worker.id,
        worker_name: worker.name,
        distance_km: distanceKm,
      };

      events.push({
        type: "bin.assigned",
        subject_id: binId,
        source: "worker_dashboard",
        payload: { worker_id: worker.id, distance_km: distanceKm },
        occurred_at: assignedAt,
      });

      messages.push({
        id: hexId("msg"),
        recipient_type: "worker",
        recipient_id: worker.id,
        channel: "in_app",
        body: `New pickup assigned, ${distanceKm} km away.`,
        subject_ref: binId,
        metadata: {},
        delivery_status: "delivered",
        acknowledged: status !== "assigned",
        created_at: assignedAt,
        acknowledged_at:
          status !== "assigned"
            ? new Date(new Date(assignedAt).getTime() + intBetween(30, 600) * 1000).toISOString()
            : null,
      });
      events.push({
        type: "notification.sent",
        subject_id: binId,
        source: "worker_dashboard",
        payload: { recipient_type: "worker", trigger: "assigned" },
        occurred_at: assignedAt,
      });

      if (status === "in_progress" || status === "cleared") {
        assignment.started_at = new Date(
          new Date(assignedAt).getTime() + intBetween(120, 1800) * 1000
        ).toISOString();
      }

      if (status === "cleared") {
        // 20-180 min end-to-end, the realistic municipal range.
        const completedAt = new Date(
          new Date(reportedAt).getTime() + intBetween(20, 180) * 60000
        ).toISOString();
        assignment.completed_at = completedAt;
        report.cleared_at = completedAt;

        events.push({
          type: "bin.collected",
          subject_id: binId,
          source: "worker_dashboard",
          payload: { worker_id: worker.id },
          occurred_at: completedAt,
        });

        for (const recipient of ["citizen", "admin"]) {
          messages.push({
            id: hexId("msg"),
            recipient_type: recipient,
            recipient_id: null,
            channel: "in_app",
            body:
              recipient === "citizen"
                ? "The bin you reported has been cleared. Thanks for helping keep the city clean!"
                : `${worker.name} cleared ${binId}.`,
            subject_ref: binId,
            metadata: {},
            delivery_status: "delivered",
            acknowledged: rng() < 0.55,
            created_at: completedAt,
            acknowledged_at: null,
          });
          events.push({
            type: "notification.sent",
            subject_id: binId,
            source: "worker_dashboard",
            payload: { recipient_type: recipient, trigger: "completed" },
            occurred_at: completedAt,
          });
        }
      } else {
        // Still open — the worker is occupied.
        worker.status = "busy";
      }

      assignments.push(assignment);
    }

    reports.push(report);
  }
}

// A few route optimizations, as worker_dashboard would have emitted.
for (const worker of workers.slice(0, 5)) {
  events.push({
    type: "route.optimized",
    subject_id: worker.id,
    source: "worker_dashboard",
    payload: { stop_count: intBetween(2, 6) },
    occurred_at: at(intBetween(0, 5), intBetween(7, 17)),
  });
}

events.sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at));
messages.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

/* ------------------------------------------------------------------ write */

function write(module, name, data) {
  const dir = path.join(MODULES, module, "mocks");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), `${JSON.stringify(data, null, 2)}\n`);
  const count = Array.isArray(data) ? data.length : Object.keys(data).length;
  console.log(`  ${module}/mocks/${name}  (${count} records)`);
}

console.log("Generating coherent mock dataset...\n");

write("bin_reporting", "reports.json", reports);
write("waste_recognition", "classifications.json", classifications);
write("worker_dashboard", "workers.json", workers);
write("worker_dashboard", "assignments.json", assignments);
write("notification_system", "messages.json", messages);
write("analytics_dashboard", "events.json", events);

// route_optimizer holds no state, so its fixture is a set of solvable
// scenarios rather than records to load.
write("route_optimizer", "scenarios.json", [
  {
    name: "single_stop",
    description: "Degenerate case — one stop, no ordering decision to make.",
    request: {
      start: { lat: 12.9716, lng: 77.5946 },
      stops: [{ id: "bin_single", location: { lat: 12.9752, lng: 77.6068 } }],
    },
  },
  {
    name: "typical_round",
    description: "Six stops across central Bengaluru — a normal morning round.",
    request: {
      start: { lat: 12.9716, lng: 77.5946 },
      stops: NEIGHBOURHOODS.slice(0, 6).map((h, i) => ({
        id: `bin_round_${i + 1}`,
        address: h.name,
        location: { lat: h.lat, lng: h.lng },
      })),
    },
  },
  {
    name: "crossing_path",
    description:
      "Stops ordered so greedy nearest-neighbor produces a self-crossing tour. 2-opt should report a non-zero improvement_km here.",
    request: {
      start: { lat: 12.9716, lng: 77.5946 },
      stops: [
        { id: "bin_x1", location: { lat: 12.9910, lng: 77.5550 } },
        { id: "bin_x2", location: { lat: 12.9250, lng: 77.5838 } },
        { id: "bin_x3", location: { lat: 13.0055, lng: 77.5692 } },
        { id: "bin_x4", location: { lat: 12.9422, lng: 77.5760 } },
        { id: "bin_x5", location: { lat: 13.0234, lng: 77.5540 } },
      ],
    },
  },
  {
    name: "wide_spread",
    description: "Far-flung stops — Electronic City to Yeshwanthpur, ~30 km apart.",
    request: {
      start: { lat: 12.9716, lng: 77.5946 },
      stops: [
        { id: "bin_w1", address: "Electronic City Phase 1", location: { lat: 12.8452, lng: 77.6602 } },
        { id: "bin_w2", address: "Whitefield Main Rd", location: { lat: 12.9698, lng: 77.75 } },
        { id: "bin_w3", address: "Yeshwanthpur Market", location: { lat: 13.0234, lng: 77.554 } },
      ],
    },
  },
  {
    name: "empty",
    description: "No stops — must return an empty route, not an error.",
    request: { start: { lat: 12.9716, lng: 77.5946 }, stops: [] },
  },
]);

const cleared = reports.filter((r) => r.status === "cleared").length;
console.log(`
Dataset summary
  workers          ${workers.length}
  reports          ${reports.length}  (${cleared} cleared, ${reports.length - cleared} open)
  assignments      ${assignments.length}
  messages         ${messages.length}
  events           ${events.length}
  classifications  ${classifications.length}
  span             7 days ending ${ANCHOR.toISOString().slice(0, 10)}
`);

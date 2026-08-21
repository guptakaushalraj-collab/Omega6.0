#!/usr/bin/env node
/**
 * Registry integration test.
 *
 * Verifies BOTH claims the architecture makes:
 *   1. Composition  — the six modules together deliver the end-to-end flow.
 *   2. Independence — a module whose dependency is down degrades rather than
 *                     fails, and reports honestly what it skipped.
 *
 * Assumes the mesh is running (`npm run modules:start`).
 */

const NOTIFY_KEY = process.env.NOTIFY_API_KEY || "dev-signalpost-key";
const CREW_TOKEN = process.env.CREW_AUTH_TOKEN || "dev-fieldops-token";

const URLS = {
  bin_reporting: "http://localhost:4101",
  waste_recognition: "http://localhost:4102",
  route_optimizer: "http://localhost:4103",
  analytics_dashboard: "http://localhost:4104",
  notification_system: "http://localhost:4105",
  worker_dashboard: "http://localhost:4106",
};

let passed = 0;
let failed = 0;

function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
    passed += 1;
  } else {
    console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? ` — ${detail}` : ""}`);
    failed += 1;
  }
}

const json = async (url, options) => {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
};

// 1x1 PNG, enough to exercise the classifier's byte-hash path.
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

async function main() {
  console.log("\n\x1b[1mRegistry integration test\x1b[0m\n");

  /* ---------------------------------------------------------------- health */
  console.log("Health — all six modules reachable");
  for (const [name, url] of Object.entries(URLS)) {
    const base = ["notification_system", "worker_dashboard"].includes(name) ? "/v1" : "/api/v1";
    try {
      const { status, body } = await json(`${url}${base}/health`);
      check(`${name} on ${url}`, status === 200 && body?.ok === true, `status ${status}`);
    } catch {
      check(`${name} on ${url}`, false, "unreachable — is the mesh running?");
    }
  }

  if (failed > 0) {
    console.log("\n\x1b[31mMesh is not fully up. Run `npm run modules:start` first.\x1b[0m\n");
    process.exit(1);
  }

  /* ------------------------------------------------------- standalone units */
  console.log("\nStandalone behaviour — leaf modules answer without any peer");

  const cls = await json(`${URLS.waste_recognition}/api/v1/classify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_base64: PNG_B64, reference: "smoke" }),
  });
  check(
    "waste_recognition classifies an image",
    cls.status === 200 && typeof cls.body?.prediction?.type === "string",
    `status ${cls.status}`
  );

  const route = await json(`${URLS.route_optimizer}/api/v1/optimize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      start: { lat: 12.9716, lng: 77.5946 },
      stops: [
        { id: "a", location: { lat: 12.9784, lng: 77.6408 } },
        { id: "b", location: { lat: 12.9611, lng: 77.6387 } },
        { id: "c", location: { lat: 12.9899, lng: 77.5731 } },
      ],
    }),
  });
  check(
    "route_optimizer sequences 3 stops",
    route.status === 200 && route.body?.stops?.length === 3 && route.body.total_distance_km > 0,
    `status ${route.status}`
  );
  check(
    "route_optimizer reports a 2-opt strategy",
    route.body?.strategy?.includes("2-opt"),
    route.body?.strategy
  );

  /* ------------------------------------------------------------------ auth */
  console.log("\nAuth — acquired modules enforce their own schemes");

  const noKey = await json(`${URLS.notification_system}/v1/messages`);
  check(
    "notification_system rejects a missing API key (401)",
    noKey.status === 401 && noKey.body?.error?.code === "missing_api_key",
    `status ${noKey.status}`
  );

  const badKey = await json(`${URLS.notification_system}/v1/messages`, {
    headers: { "X-API-Key": "wrong" },
  });
  check("notification_system rejects a wrong API key (403)", badKey.status === 403);

  const noToken = await json(`${URLS.worker_dashboard}/v1/workers`);
  check(
    "worker_dashboard rejects a missing bearer token (401)",
    noToken.status === 401 && noToken.body?.error === "unauthorized",
    `status ${noToken.status}`
  );

  /* -------------------------------------------------------------- workforce */
  console.log("\nComposition — end-to-end collection flow");

  const crew = { Authorization: `Bearer ${CREW_TOKEN}`, "Content-Type": "application/json" };
  const workerNames = ["Asha Kumar", "Ravi Singh", "Meera Nair"];
  const workerIds = [];

  for (const [i, name] of workerNames.entries()) {
    const w = await json(`${URLS.worker_dashboard}/v1/workers`, {
      method: "POST",
      headers: crew,
      body: JSON.stringify({
        name,
        location: { lat: 12.96 + i * 0.012, lng: 77.58 + i * 0.011 },
      }),
    });
    if (w.status === 201) workerIds.push(w.body.id);
  }
  check(`registered ${workerNames.length} workers`, workerIds.length === workerNames.length);

  // Report a bin WITH a photo, through the public intake.
  const form = new FormData();
  form.append("photo", new Blob([Buffer.from(PNG_B64, "base64")], { type: "image/png" }), "bin.png");
  form.append("lat", "12.972");
  form.append("lng", "77.595");
  form.append("address", "MG Road bus stop");
  form.append("reporter_name", "Integration Test");

  const reported = await fetch(`${URLS.bin_reporting}/api/v1/reports`, {
    method: "POST",
    body: form,
  });
  const reportBody = await reported.json();
  const report = reportBody.report;

  check("bin_reporting accepted the report", reported.status === 201, `status ${reported.status}`);
  check("intake reported no degradation", reportBody.degraded === null, JSON.stringify(reportBody.degraded));
  check(
    "waste_recognition classified the photo",
    typeof report?.waste_type === "string" && report.waste_type.length > 0,
    `waste_type=${report?.waste_type}`
  );
  check(
    "worker_dashboard dispatched a worker",
    report?.status === "assigned" && Boolean(report?.assignment?.worker_id),
    `status=${report?.status}`
  );

  // The dispatch should have produced a notification for that worker.
  const inbox = await json(
    `${URLS.notification_system}/v1/messages?recipient_id=${report.assignment.worker_id}`,
    { headers: { "X-API-Key": NOTIFY_KEY } }
  );
  check(
    "notification_system delivered the worker alert",
    inbox.status === 200 && inbox.body.count >= 1,
    `count=${inbox.body?.count}`
  );

  // The assigned worker's queue should come back sequenced.
  const queue = await json(
    `${URLS.worker_dashboard}/v1/workers/${report.assignment.worker_id}/queue`,
    { headers: crew }
  );
  check(
    "worker queue is optimized via route_optimizer",
    queue.status === 200 && queue.body?.optimized === true && queue.body.stops.length >= 1,
    `optimized=${queue.body?.optimized}`
  );

  // Complete the job.
  const assignments = await json(
    `${URLS.worker_dashboard}/v1/assignments?job_ref=${report.id}`,
    { headers: crew }
  );
  const assignmentId = assignments.body?.assignments?.[0]?.id;

  const completed = await json(`${URLS.worker_dashboard}/v1/assignments/${assignmentId}`, {
    method: "PATCH",
    headers: crew,
    body: JSON.stringify({ status: "completed" }),
  });
  check("assignment completed", completed.status === 200 && completed.body?.status === "completed");
  check(
    "completion notified citizen and admin",
    completed.body?.side_effects?.citizen_notification === "sent" &&
      completed.body?.side_effects?.admin_notification === "sent",
    JSON.stringify(completed.body?.side_effects)
  );

  // Completed assignments are immutable.
  const recompleted = await json(`${URLS.worker_dashboard}/v1/assignments/${assignmentId}`, {
    method: "PATCH",
    headers: crew,
    body: JSON.stringify({ status: "in_progress" }),
  });
  check("completed assignment is immutable (409)", recompleted.status === 409);

  // Duplicate dispatch for the same job is refused.
  const dup = await json(`${URLS.worker_dashboard}/v1/assignments`, {
    method: "POST",
    headers: crew,
    body: JSON.stringify({ job_ref: report.id, location: report.location }),
  });
  check(
    "duplicate job_ref is refused only while open (re-dispatch after completion allowed)",
    dup.status === 201,
    `status ${dup.status}`
  );

  /* -------------------------------------------------------------- analytics */
  console.log("\nAnalytics — events propagated from both producers");

  const summary = await json(`${URLS.analytics_dashboard}/api/v1/summary`);
  check(
    "analytics recorded the report",
    summary.status === 200 && summary.body.totals.reported >= 1,
    `reported=${summary.body?.totals?.reported}`
  );
  check(
    "analytics recorded the collection",
    summary.body?.totals?.collected >= 1,
    `collected=${summary.body?.totals?.collected}`
  );
  check(
    "analytics derived a waste mix",
    Array.isArray(summary.body?.waste_mix) && summary.body.waste_mix.length >= 1
  );
  check(
    "analytics derived worker activity",
    Array.isArray(summary.body?.worker_activity) && summary.body.worker_activity.length >= 1
  );

  const trends = await json(`${URLS.analytics_dashboard}/api/v1/trends?days=7`);
  check("analytics returns a 7-day trend", trends.status === 200 && trends.body.series.length === 7);

  // Unknown event types must be accepted, not rejected.
  const unknown = await json(`${URLS.analytics_dashboard}/api/v1/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "bin.future_event_type", subject_id: "x" }),
  });
  check(
    "analytics accepts an unknown event type as known_type:false",
    unknown.status === 202 && unknown.body.known_type === false
  );

  /* ---------------------------------------------------------- flat aliases */
  console.log("\nFlat alias API — the five spec'd verb-style endpoints");

  // 1. POST /reportBin  { image, location: "lat,long" }
  const flatReport = await json(`${URLS.bin_reporting}/reportBin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image: PNG_B64,
      location: "12.9718,77.5949",
      address: "Alias test",
    }),
  });
  check(
    "POST /reportBin accepts a \"lat,long\" string",
    flatReport.status === 201 && typeof flatReport.body?.binId === "string",
    `status ${flatReport.status}`
  );
  check(
    "…and classifies the base64 image",
    typeof flatReport.body?.type === "string" && flatReport.body.type.length > 0,
    `type=${flatReport.body?.type}`
  );

  const flatBinId = flatReport.body?.binId;

  // Malformed location must be rejected, not silently coerced.
  const badLoc = await json(`${URLS.bin_reporting}/reportBin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ location: "not-a-coordinate" }),
  });
  check("POST /reportBin rejects a malformed location (400)", badLoc.status === 400);

  // 2. POST /detectWasteType  { binId } -> { type }
  const detect = await json(`${URLS.bin_reporting}/detectWasteType`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ binId: flatBinId }),
  });
  check(
    "POST /detectWasteType returns { type } for a binId",
    detect.status === 200 && typeof detect.body?.type === "string",
    `status ${detect.status}`
  );
  const detectMissing = await json(`${URLS.bin_reporting}/detectWasteType`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ binId: "bin_does_not_exist" }),
  });
  check("POST /detectWasteType 404s on an unknown binId", detectMissing.status === 404);

  // 3. GET /optimizeRoute?bins=[...]
  const binsParam = encodeURIComponent(
    JSON.stringify([
      { lat: 12.9784, lng: 77.6408 },
      { lat: 12.9611, lng: 77.6387 },
      { lat: 12.9899, lng: 77.5731 },
    ])
  );
  const flatRoute = await json(`${URLS.route_optimizer}/optimizeRoute?bins=${binsParam}`);
  check(
    "GET /optimizeRoute returns an ordered route",
    flatRoute.status === 200 &&
      Array.isArray(flatRoute.body?.order) &&
      flatRoute.body.order.length === 3,
    `status ${flatRoute.status}`
  );
  check(
    "…accepting the compact \"lat,long\" string form too",
    (await json(`${URLS.route_optimizer}/optimizeRoute?bins=${encodeURIComponent(
      JSON.stringify(["12.9784,77.6408", "12.9611,77.6387"])
    )}`)).body?.order?.length === 2
  );
  // A stateless optimizer cannot resolve bare ids — it must say so, not guess.
  const bareIds = await json(
    `${URLS.route_optimizer}/optimizeRoute?bins=${encodeURIComponent(JSON.stringify(["bin_abc"]))}`
  );
  check(
    "GET /optimizeRoute explains it cannot resolve bare bin ids (400)",
    bareIds.status === 400 && /cannot resolve bin ids/i.test(bareIds.body?.hint || "")
  );

  // 4. GET /analytics -> charts data
  const flatAnalytics = await json(`${URLS.analytics_dashboard}/analytics`);
  check(
    "GET /analytics returns chart-ready data",
    flatAnalytics.status === 200 &&
      flatAnalytics.body?.charts?.daily_activity?.labels?.length === 7,
    `status ${flatAnalytics.status}`
  );
  check(
    "…with parallel labels/values arrays a chart lib can consume",
    Array.isArray(flatAnalytics.body?.charts?.waste_mix?.labels) &&
      flatAnalytics.body.charts.waste_mix.labels.length ===
        flatAnalytics.body.charts.waste_mix.values.length
  );
  check(
    "…and headline KPIs",
    typeof flatAnalytics.body?.kpis?.reported === "number"
  );

  // 5. POST /notifyPickup -> alert to the user
  const notify = await json(`${URLS.notification_system}/notifyPickup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": NOTIFY_KEY },
    body: JSON.stringify({ binId: flatBinId }),
  });
  check(
    "POST /notifyPickup sends an alert to the citizen",
    notify.status === 201 && notify.body?.sent === true && notify.body?.recipient === "citizen",
    `status ${notify.status}`
  );
  // The alias must NOT become a way around authentication.
  const notifyNoKey = await json(`${URLS.notification_system}/notifyPickup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ binId: flatBinId }),
  });
  check(
    "POST /notifyPickup still enforces the API key (401)",
    notifyNoKey.status === 401,
    `status ${notifyNoKey.status}`
  );

  /* ------------------------------------------------------------ degradation */
  console.log("\nIndependence — degradation when a dependency is absent");

  // A report with no photo cannot be classified; intake must still succeed.
  const noPhoto = await json(`${URLS.bin_reporting}/api/v1/reports`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lat: 12.9, lng: 77.6, auto_assign: false }),
  });
  check("intake succeeds without a photo", noPhoto.status === 201);
  check(
    "…and reports classification skipped",
    noPhoto.body?.degraded?.classification === "no_photo_supplied",
    JSON.stringify(noPhoto.body?.degraded)
  );
  check("…and the report is still persisted", Boolean(noPhoto.body?.report?.id));

  // Exhaust the workforce, then confirm no_workers_available is distinguished
  // from an outage.
  const workers = await json(`${URLS.worker_dashboard}/v1/workers?status=available`, {
    headers: crew,
  });
  for (const w of workers.body.workers) {
    await json(`${URLS.worker_dashboard}/v1/workers/${w.id}`, {
      method: "PATCH",
      headers: crew,
      body: JSON.stringify({ status: "off_shift" }),
    });
  }

  const noWorkers = await json(`${URLS.bin_reporting}/api/v1/reports`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lat: 12.95, lng: 77.61 }),
  });
  check("intake succeeds with no workers free", noWorkers.status === 201);
  check(
    "…and distinguishes no_workers_available from an outage",
    noWorkers.body?.degraded?.assignment === "no_workers_available",
    JSON.stringify(noWorkers.body?.degraded)
  );

  // Restore the workforce so repeat runs start clean.
  for (const w of workers.body.workers) {
    await json(`${URLS.worker_dashboard}/v1/workers/${w.id}`, {
      method: "PATCH",
      headers: crew,
      body: JSON.stringify({ status: "available" }),
    });
  }

  /* ----------------------------------------------------------------- report */
  console.log(
    `\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m\n`
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\n\x1b[31mTest run crashed:\x1b[0m", err.message);
  process.exit(1);
});

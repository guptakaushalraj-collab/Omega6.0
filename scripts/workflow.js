#!/usr/bin/env node
/**
 * End-to-end collection workflow — a runnable, traced implementation of:
 *
 *     bin   = reportBin()
 *     type  = detectWasteType(bin)
 *     task  = assignWorker(bin, type)
 *     route = optimizeRoute(task)
 *             notifyPickup(route)
 *             updateAnalytics(bin, type, route)
 *
 * Each step below is a named function matching that pseudocode exactly, so
 * the pipeline can be read, traced and demoed one stage at a time. In normal
 * operation these stages are FUSED — POST /reportBin internally classifies,
 * dispatches, notifies and emits analytics in a single call, which is the
 * right behaviour for a citizen tapping "submit" but hides the machinery.
 * This script pulls them apart.
 *
 * ONE NON-OBVIOUS DETAIL: step 1 passes auto_assign=false. Without it,
 * reportBin() would already have dispatched a worker, and step 3 would fail
 * with 409 duplicate_job — worker_dashboard refuses a second open assignment
 * for the same bin. Suppressing the fused dispatch is what lets assignWorker()
 * genuinely own that step.
 *
 * Usage:
 *   npm run modules:start        # in another shell
 *   npm run workflow
 *   npm run workflow -- --json   # machine-readable result only
 */

const JSON_ONLY = process.argv.includes("--json");

const URLS = {
  bin_reporting: process.env.BIN_REPORTING_URL || "http://localhost:4101",
  waste_recognition: process.env.WASTE_RECOGNITION_URL || "http://localhost:4102",
  route_optimizer: process.env.ROUTE_OPTIMIZER_URL || "http://localhost:4103",
  analytics_dashboard: process.env.ANALYTICS_URL || "http://localhost:4104",
  notification_system: process.env.NOTIFICATION_URL || "http://localhost:4105",
  worker_dashboard: process.env.WORKER_DASHBOARD_URL || "http://localhost:4106",
};

const NOTIFY_KEY = process.env.NOTIFY_API_KEY || "dev-signalpost-key";
const CREW_TOKEN = process.env.CREW_AUTH_TOKEN || "dev-fieldops-token";

const crew = { Authorization: `Bearer ${CREW_TOKEN}`, "Content-Type": "application/json" };
const notifyKey = { "X-API-Key": NOTIFY_KEY, "Content-Type": "application/json" };

// 1x1 PNG — enough to exercise the classifier's byte-hash path.
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

/* ----------------------------------------------------------------- output */

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

const log = (...a) => {
  if (!JSON_ONLY) console.log(...a);
};

let stepNo = 0;
const trace = [];

function stepHeader(signature, call) {
  stepNo += 1;
  log(`\n${C.bold(`${stepNo}. ${signature}`)}`);
  log(`   ${C.dim(call)}`);
}

function stepResult(ms, summary, warn = null) {
  log(`   ${C.green("→")} ${summary} ${C.dim(`(${ms}ms)`)}`);
  if (warn) log(`   ${C.yellow("!")} ${warn}`);
}

class StepError extends Error {
  constructor(step, detail) {
    super(`${step}: ${detail}`);
    this.step = step;
  }
}

async function call(url, options = {}) {
  const started = Date.now();
  let res;
  try {
    res = await fetch(url, options);
  } catch (err) {
    throw new StepError("network", `${url} unreachable (${err.message})`);
  }
  const body = await res.json().catch(() => null);
  return { status: res.status, body, ms: Date.now() - started };
}

/* ------------------------------------------------------- workflow steps */

/**
 * bin = reportBin()
 *
 * auto_assign:false — see the header note. Dispatch is step 3's job.
 */
async function reportBin() {
  stepHeader("bin = reportBin()", `POST ${URLS.bin_reporting}/reportBin`);

  const { status, body, ms } = await call(`${URLS.bin_reporting}/reportBin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image: PNG_B64,
      location: "12.9718,77.5949",
      address: "MG Road bus stop",
      reporter_name: "Workflow demo",
      auto_assign: false,
    }),
  });

  if (status !== 201) {
    throw new StepError("reportBin", `expected 201, got ${status} — ${JSON.stringify(body)}`);
  }

  // Classification is skipped only if the classifier is down; that is a
  // degradation, not a failure, and step 2 will surface it.
  const warn = body.degraded?.classification
    ? `classification at intake: ${body.degraded.classification}`
    : null;

  stepResult(ms, `binId=${C.cyan(body.binId)} status=${body.status}`, warn);
  trace.push({ step: "reportBin", ms, binId: body.binId, degraded: body.degraded });
  return body;
}

/**
 * type = detectWasteType(bin)
 *
 * Returns the stored classification when one exists (cached:true) rather than
 * paying for a second inference call — reportBin already classified the photo
 * at intake. Pass force:true to genuinely re-run the model.
 */
async function detectWasteType(bin) {
  stepHeader(
    "type = detectWasteType(bin)",
    `POST ${URLS.bin_reporting}/detectWasteType  { binId: "${bin.binId}" }`
  );

  const { status, body, ms } = await call(`${URLS.bin_reporting}/detectWasteType`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ binId: bin.binId }),
  });

  if (status !== 200) {
    throw new StepError("detectWasteType", `expected 200, got ${status} — ${JSON.stringify(body)}`);
  }

  stepResult(
    ms,
    `type=${C.cyan(body.type)} confidence=${body.confidence}`,
    body.cached ? "served from the stored classification (reportBin already ran the model)" : null
  );
  trace.push({ step: "detectWasteType", ms, type: body.type, cached: body.cached });
  return body;
}

/**
 * task = assignWorker(bin, type)
 *
 * worker_dashboard picks the nearest AVAILABLE worker. Note the vocabulary
 * translation: our bin id becomes its domain-neutral `job_ref`, and the waste
 * type rides along in `metadata` — that module has no concept of waste.
 */
async function assignWorker(bin, type) {
  stepHeader(
    "task = assignWorker(bin, type)",
    `POST ${URLS.worker_dashboard}/v1/assignments  { job_ref, location, metadata }`
  );

  const { status, body, ms } = await call(`${URLS.worker_dashboard}/v1/assignments`, {
    method: "POST",
    headers: crew,
    body: JSON.stringify({
      job_ref: bin.binId,
      location: {
        lat: Number(bin.location.split(",")[0]),
        lng: Number(bin.location.split(",")[1]),
      },
      metadata: { waste_type: type.type },
    }),
  });

  if (status === 503) {
    throw new StepError(
      "assignWorker",
      "no workers available — every worker is busy or off-shift. " +
        "Free one with:  curl -X PATCH .../v1/workers/<id> -d '{\"status\":\"available\"}'"
    );
  }
  if (status !== 201) {
    throw new StepError("assignWorker", `expected 201, got ${status} — ${JSON.stringify(body)}`);
  }

  // side_effects reports what the module did downstream, including anything
  // it could not do because a dependency was unavailable.
  const skipped = Object.entries(body.side_effects || {})
    .filter(([, v]) => String(v).startsWith("skipped"))
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");

  stepResult(
    ms,
    `worker=${C.cyan(body.worker_name)} distance=${body.distance_km}km assignment=${body.id}`,
    skipped || null
  );
  trace.push({
    step: "assignWorker",
    ms,
    assignmentId: body.id,
    workerId: body.worker_id,
    sideEffects: body.side_effects,
  });
  return body;
}

/**
 * route = optimizeRoute(task)
 *
 * Sequences the assigned worker's ENTIRE open queue, not just this one stop.
 * Optimizing a single-stop route is meaningless; the operationally useful
 * question is "given this new job, what order should this worker drive?".
 *
 * Uses worker_dashboard's queue endpoint, which resolves job_refs to
 * coordinates and calls route_optimizer in one hop — route_optimizer is
 * stateless and cannot resolve bin ids itself.
 */
async function optimizeRoute(task) {
  stepHeader(
    "route = optimizeRoute(task)",
    `GET ${URLS.worker_dashboard}/v1/workers/${task.worker_id}/queue  → route_optimizer`
  );

  const { status, body, ms } = await call(
    `${URLS.worker_dashboard}/v1/workers/${task.worker_id}/queue`,
    { headers: crew }
  );

  if (status !== 200) {
    throw new StepError("optimizeRoute", `expected 200, got ${status} — ${JSON.stringify(body)}`);
  }

  // Degrades rather than fails when route_optimizer is unreachable: the
  // worker still gets their stops, just unordered.
  if (!body.optimized) {
    stepResult(
      ms,
      `${body.stops.length} stop(s), ${C.yellow("UNORDERED")}`,
      `route_optimizer unavailable (${body.degraded_reason}) — stops returned in arbitrary order`
    );
    trace.push({ step: "optimizeRoute", ms, optimized: false, reason: body.degraded_reason });
    return body;
  }

  stepResult(
    ms,
    `${body.stops.length} stop(s), ${C.cyan(`${body.total_distance_km}km`)} via ${body.strategy}`
  );
  for (const s of body.stops) {
    log(`     ${C.dim(`${s.sequence}. ${s.job_ref}  ${s.leg_distance_km}km`)}`);
  }
  trace.push({
    step: "optimizeRoute",
    ms,
    optimized: true,
    stops: body.stops.length,
    totalKm: body.total_distance_km,
  });
  return body;
}

/**
 * notifyPickup(route)
 *
 * Alerts the citizen who reported the bin. Runs after routing so the message
 * can carry the worker's position in the round — "you are stop 2 of 5" is
 * more useful than a bare acknowledgement.
 */
async function notifyPickup(route, bin) {
  stepHeader(
    "notifyPickup(route)",
    `POST ${URLS.notification_system}/notifyPickup  { binId }`
  );

  const stop = route.stops.find((s) => s.job_ref === bin.binId);
  const position = stop?.sequence;
  const message =
    position && route.optimized
      ? `A collection worker is on the way — your bin is stop ${position} of ${route.stops.length} on today's round.`
      : "A collection worker has been assigned to the bin you reported.";

  const { status, body, ms } = await call(`${URLS.notification_system}/notifyPickup`, {
    method: "POST",
    headers: notifyKey,
    body: JSON.stringify({ binId: bin.binId, message }),
  });

  if (status !== 201) {
    throw new StepError("notifyPickup", `expected 201, got ${status} — ${JSON.stringify(body)}`);
  }

  stepResult(
    ms,
    `sent=${body.sent} to ${C.cyan(body.recipient)} via ${body.channel} (${body.messageId})`
  );
  log(`     ${C.dim(`"${body.message}"`)}`);
  trace.push({ step: "notifyPickup", ms, messageId: body.messageId, sent: body.sent });
  return body;
}

/**
 * updateAnalytics(bin, type, route)
 *
 * The modules already emit bin.reported / bin.classified / bin.assigned
 * themselves as they work — analytics is push-based and never polls. What is
 * NOT yet recorded is the routing outcome, so that is what this step emits.
 * It then reads the dashboard back to confirm the run landed.
 */
async function updateAnalytics(bin, type, route) {
  stepHeader(
    "updateAnalytics(bin, type, route)",
    `POST ${URLS.analytics_dashboard}/api/v1/events  →  GET /analytics`
  );

  const emit = await call(`${URLS.analytics_dashboard}/api/v1/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "route.optimized",
      subject_id: bin.binId,
      source: "workflow",
      payload: {
        waste_type: type.type,
        stop_count: route.stops?.length ?? 0,
        total_distance_km: route.total_distance_km ?? null,
        optimized: Boolean(route.optimized),
      },
    }),
  });

  if (emit.status !== 202) {
    throw new StepError("updateAnalytics", `event ingest returned ${emit.status}`);
  }

  const dash = await call(`${URLS.analytics_dashboard}/analytics`);
  if (dash.status !== 200) {
    throw new StepError("updateAnalytics", `dashboard read returned ${dash.status}`);
  }

  const k = dash.body.kpis;
  stepResult(
    emit.ms + dash.ms,
    `event recorded; dashboard now reported=${C.cyan(k.reported)} ` +
      `collected=${k.collected} outstanding=${k.outstanding}`
  );
  log(
    `     ${C.dim(
      `charts: ${Object.keys(dash.body.charts).join(", ")}`
    )}`
  );
  trace.push({ step: "updateAnalytics", ms: emit.ms + dash.ms, kpis: k });
  return dash.body;
}

/* ------------------------------------------------------------- preflight */

/**
 * Only some modules are load-bearing for this pipeline.
 *
 * The optional two are the ones the architecture itself declares optional —
 * their absence degrades a step rather than failing it. Refusing to run
 * without them would contradict the degradation guarantee the whole system is
 * built on, so preflight warns and proceeds instead.
 */
const REQUIRED = {
  bin_reporting: "steps 1-2 (report, detect)",
  worker_dashboard: "steps 3-4 (assign, route)",
  notification_system: "step 5 (notify)",
  analytics_dashboard: "step 6 (analytics)",
};
const OPTIONAL = {
  waste_recognition: "classification falls back to unclassified",
  route_optimizer: "route returned unordered",
};

async function preflight() {
  const checks = await Promise.all(
    Object.entries(URLS).map(async ([name, url]) => {
      const base = ["notification_system", "worker_dashboard"].includes(name) ? "/v1" : "/api/v1";
      try {
        const res = await fetch(`${url}${base}/health`);
        return { name, url, ok: res.ok };
      } catch {
        return { name, url, ok: false };
      }
    })
  );

  const down = checks.filter((c) => !c.ok);
  const missingRequired = down.filter((d) => REQUIRED[d.name]);
  const missingOptional = down.filter((d) => OPTIONAL[d.name]);

  if (missingRequired.length > 0) {
    console.error(C.red("\nRequired modules are not running:\n"));
    for (const d of missingRequired) {
      console.error(`  ✗ ${d.name} (${d.url})  — needed for ${REQUIRED[d.name]}`);
    }
    console.error(`\nStart the mesh with:  ${C.bold("npm run modules:start")}\n`);
    process.exit(1);
  }

  for (const d of missingOptional) {
    log(
      `   ${C.yellow("!")} ${d.name} is down — proceeding; ${C.dim(OPTIONAL[d.name])}`
    );
  }
}

/**
 * The workflow needs one available worker. On a freshly seeded dataset every
 * worker is busy, which would fail step 3 for an uninteresting reason — so
 * free one first and say so, rather than dying on a fixture artefact.
 */
async function ensureWorkerAvailable() {
  const { body } = await call(`${URLS.worker_dashboard}/v1/workers?status=available`, {
    headers: crew,
  });
  if ((body?.count ?? 0) > 0) return;

  const all = await call(`${URLS.worker_dashboard}/v1/workers`, { headers: crew });
  const candidate = all.body?.workers?.[0];

  if (!candidate) {
    // No workers at all — register one so the demo can proceed.
    await call(`${URLS.worker_dashboard}/v1/workers`, {
      method: "POST",
      headers: crew,
      body: JSON.stringify({
        name: "Workflow Demo Worker",
        location: { lat: 12.9716, lng: 77.5946 },
      }),
    });
    log(C.dim("   (no workers registered — created one for this run)"));
    return;
  }

  await call(`${URLS.worker_dashboard}/v1/workers/${candidate.id}`, {
    method: "PATCH",
    headers: crew,
    body: JSON.stringify({ status: "available" }),
  });
  log(C.dim(`   (all workers were busy — freed ${candidate.name} for this run)`));
}

/* ------------------------------------------------------------------ main */

async function main() {
  log(C.bold("\nIntelligent Waste Collection Network — end-to-end workflow\n"));
  log(
    C.dim(
      "  bin   = reportBin()\n" +
        "  type  = detectWasteType(bin)\n" +
        "  task  = assignWorker(bin, type)\n" +
        "  route = optimizeRoute(task)\n" +
        "          notifyPickup(route)\n" +
        "          updateAnalytics(bin, type, route)"
    )
  );

  await preflight();
  await ensureWorkerAvailable();

  const started = Date.now();

  const bin = await reportBin();
  const type = await detectWasteType(bin);
  const task = await assignWorker(bin, type);
  const route = await optimizeRoute(task);
  const alert = await notifyPickup(route, bin);
  const analytics = await updateAnalytics(bin, type, route);

  const totalMs = Date.now() - started;

  log(`\n${C.green(C.bold("✓ workflow complete"))} ${C.dim(`in ${totalMs}ms`)}`);
  log(
    C.dim(
      `  ${bin.binId} · ${type.type} · ${task.worker_name} · ` +
        `${route.optimized ? `${route.total_distance_km}km` : "unordered"} · ${alert.messageId}`
    )
  );
  log("");

  if (JSON_ONLY) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          total_ms: totalMs,
          bin_id: bin.binId,
          waste_type: type.type,
          assignment_id: task.id,
          worker: task.worker_name,
          route: {
            optimized: Boolean(route.optimized),
            stops: route.stops?.length ?? 0,
            total_distance_km: route.total_distance_km ?? null,
          },
          message_id: alert.messageId,
          kpis: analytics.kpis,
          trace,
        },
        null,
        2
      )
    );
  }
}

main().catch((err) => {
  const label = err instanceof StepError ? `step "${err.step}"` : "workflow";
  console.error(`\n${C.red(`✗ ${label} failed`)}\n  ${err.message}\n`);
  if (JSON_ONLY) {
    console.log(JSON.stringify({ ok: false, failed_step: err.step ?? null, error: err.message }, null, 2));
  }
  process.exit(1);
});

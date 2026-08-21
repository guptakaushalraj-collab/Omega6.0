#!/usr/bin/env node
/**
 * Regenerates every module's samples/ directory from LIVE responses against a
 * running mesh, so the documented payloads can never drift from what the code
 * actually returns.
 *
 * Usage: npm run modules:start, then `node scripts/capture-samples.js`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULES = path.join(__dirname, "..", "modules");

const NK = process.env.NOTIFY_API_KEY || "dev-signalpost-key";
const CT = process.env.CREW_AUTH_TOKEN || "dev-fieldops-token";
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const crew = { Authorization: `Bearer ${CT}`, "Content-Type": "application/json" };
const notifyKey = { "X-API-Key": NK };

const get = async (url, headers = {}) => (await fetch(url, { headers })).json();
const post = async (url, body, headers = {}) =>
  (
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    })
  ).json();

function write(module, name, data) {
  const dir = path.join(MODULES, module, "samples");
  fs.mkdirSync(dir, { recursive: true });
  const body = typeof data === "string" ? data : `${JSON.stringify(data, null, 2)}\n`;
  fs.writeFileSync(path.join(dir, name), body);
  console.log(`  ${module}/samples/${name}`);
}

async function main() {
  console.log("Capturing samples from the live mesh...\n");

  /* ------------------------------------------------------ waste_recognition */
  const classifyReq = { image_base64: PNG_B64, reference: "bin_1fab6e6fa493" };
  write("waste_recognition", "request-classify.json", classifyReq);
  write(
    "waste_recognition",
    "response-classify.json",
    await post("http://localhost:4102/api/v1/classify", classifyReq)
  );
  write(
    "waste_recognition",
    "response-waste-types.json",
    await get("http://localhost:4102/api/v1/waste-types")
  );

  /* -------------------------------------------------------- route_optimizer */
  const optimizeReq = {
    start: { lat: 12.9716, lng: 77.5946 },
    stops: [
      { id: "bin_a", waste_type: "plastic", location: { lat: 12.9784, lng: 77.6408 } },
      { id: "bin_b", waste_type: "organic", location: { lat: 12.9611, lng: 77.6387 } },
      { id: "bin_c", waste_type: "paper", location: { lat: 12.9899, lng: 77.5731 } },
    ],
    refine: true,
  };
  write("route_optimizer", "request-optimize.json", optimizeReq);
  write(
    "route_optimizer",
    "response-optimize.json",
    await post("http://localhost:4103/api/v1/optimize", optimizeReq)
  );
  write(
    "route_optimizer",
    "response-distance-matrix.json",
    await post("http://localhost:4103/api/v1/distance-matrix", {
      points: optimizeReq.stops.map((s) => s.location),
    })
  );

  /* --------------------------------------------------------- worker seeding */
  const seed = [
    { name: "Asha Kumar", location: { lat: 12.96, lng: 77.58 } },
    { name: "Ravi Singh", location: { lat: 12.972, lng: 77.591 } },
    { name: "Meera Nair", location: { lat: 12.985, lng: 77.602 } },
  ];
  for (const w of seed) await post("http://localhost:4106/v1/workers", w, crew);

  /* ------------------------------------------- bin_reporting (drives mesh) */
  const form = new FormData();
  form.append("photo", new Blob([Buffer.from(PNG_B64, "base64")], { type: "image/png" }), "bin.png");
  form.append("lat", "12.972");
  form.append("lng", "77.595");
  form.append("address", "MG Road bus stop");
  form.append("reporter_name", "Asha");

  const reported = await (
    await fetch("http://localhost:4101/api/v1/reports", { method: "POST", body: form })
  ).json();
  write("bin_reporting", "response-report.json", reported);

  write("bin_reporting", "request-report.json", {
    _comment: "JSON intake variant. For the multipart form (with photo) see request-report.md.",
    lat: 12.972,
    lng: 77.595,
    address: "MG Road bus stop",
    notes: "Overflowing since yesterday",
    reporter_name: "Asha",
    auto_assign: true,
  });

  // A degraded intake: no photo, dispatch suppressed.
  write(
    "bin_reporting",
    "response-report-degraded.json",
    await post("http://localhost:4101/api/v1/reports", {
      lat: 12.9,
      lng: 77.6,
      address: "Cubbon Park gate",
      auto_assign: false,
    })
  );

  write("bin_reporting", "request-report.md", `# Sample requests — \`POST /api/v1/reports\`

## Multipart (with photo — enables classification)

\`\`\`bash
curl -X POST http://localhost:4101/api/v1/reports \\
  -F "photo=@bin.jpg" \\
  -F "lat=12.972" \\
  -F "lng=77.595" \\
  -F "address=MG Road bus stop" \\
  -F "reporter_name=Asha" \\
  -F "auto_assign=true"
\`\`\`

## JSON (no photo — classification is skipped)

\`\`\`bash
curl -X POST http://localhost:4101/api/v1/reports \\
  -H 'Content-Type: application/json' \\
  -d @request-report.json
\`\`\`

- \`response-report.json\` — fully enriched intake (\`degraded: null\`)
- \`response-report-degraded.json\` — intake with enrichments skipped; note the
  \`degraded\` object names each one and why
`);

  const binId = reported.report.id;
  const workerId = reported.report.assignment?.worker_id;

  /* ---------------------------------------------------------- worker_dashboard */
  write("worker_dashboard", "request-assignment.json", {
    job_ref: binId,
    location: { lat: 12.972, lng: 77.595 },
    metadata: { waste_type: reported.report.waste_type },
  });
  write(
    "worker_dashboard",
    "response-workers.json",
    await get("http://localhost:4106/v1/workers", crew)
  );
  write(
    "worker_dashboard",
    "response-queue.json",
    await get(`http://localhost:4106/v1/workers/${workerId}/queue`, crew)
  );

  const assignments = await get(
    `http://localhost:4106/v1/assignments?job_ref=${binId}`,
    crew
  );
  const assignmentId = assignments.assignments[0].id;
  const completed = await (
    await fetch(`http://localhost:4106/v1/assignments/${assignmentId}`, {
      method: "PATCH",
      headers: crew,
      body: JSON.stringify({ status: "completed" }),
    })
  ).json();
  write("worker_dashboard", "response-assignment.json", completed);

  /* -------------------------------------------------------- notification_system */
  write("notification_system", "request-message.json", {
    recipient_type: "worker",
    recipient_id: workerId,
    channel: "in_app",
    body: "New pickup assigned, 0.43 km away.",
    subject_ref: binId,
    metadata: { priority: "normal" },
  });
  const messages = await get("http://localhost:4105/v1/messages?limit=5", notifyKey);
  write("notification_system", "response-messages.json", messages);
  write("notification_system", "response-message.json", messages.messages[0]);
  write(
    "notification_system",
    "response-channels.json",
    await get("http://localhost:4105/v1/channels", notifyKey)
  );

  /* -------------------------------------------------------- analytics_dashboard */
  write("analytics_dashboard", "request-event.json", {
    type: "bin.collected",
    subject_id: binId,
    source: "worker_dashboard",
    payload: { worker_id: workerId, waste_type: reported.report.waste_type },
  });
  write(
    "analytics_dashboard",
    "response-summary.json",
    await get("http://localhost:4104/api/v1/summary")
  );
  write(
    "analytics_dashboard",
    "response-trends.json",
    await get("http://localhost:4104/api/v1/trends?days=7")
  );
  write(
    "analytics_dashboard",
    "response-events.json",
    await get("http://localhost:4104/api/v1/events?limit=6")
  );

  console.log("\nDone.");
}

main().catch((e) => {
  console.error("Capture failed:", e.message);
  process.exit(1);
});

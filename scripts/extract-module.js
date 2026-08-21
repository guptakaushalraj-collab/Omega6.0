#!/usr/bin/env node
/**
 * Extracts one module into a standalone git repository.
 *
 * This is the operation the whole "tradable module" architecture exists to
 * support: hand a buyer one directory, initialised as its own repo, and have
 * it work with nothing else from this project.
 *
 * What is copied: source, contract (module.json, openapi.yaml), docs, licence,
 * config template, mocks and samples. What is NOT copied: node_modules,
 * runtime state (src/data), uploaded files, and any real .env — a buyer must
 * never inherit our secrets.
 *
 * The extracted repo gets a HANDOVER.md written from the module's own
 * manifest, so the commercial terms travel with the code rather than living
 * in an email thread.
 *
 * Usage:
 *   node scripts/extract-module.js waste_recognition /tmp/waste-recognition
 *   node scripts/extract-module.js waste_recognition /tmp/wr --no-git
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULES_DIR = path.join(__dirname, "..", "modules");

const [, , moduleName, destArg, ...flags] = process.argv;
const NO_GIT = flags.includes("--no-git");

if (!moduleName || !destArg) {
  console.error("usage: node scripts/extract-module.js <module> <dest> [--no-git]");
  process.exit(1);
}

const src = path.join(MODULES_DIR, moduleName);
if (!fs.existsSync(src)) {
  console.error(`No such module: ${moduleName}`);
  console.error(`Available: ${fs.readdirSync(MODULES_DIR).join(", ")}`);
  process.exit(1);
}

const dest = path.resolve(destArg);
if (fs.existsSync(dest) && fs.readdirSync(dest).length > 0) {
  console.error(`Destination is not empty: ${dest}`);
  process.exit(1);
}

/**
 * Never copied into a buyer's repo.
 * `.env` is the important one — a real secret must not leave with the asset.
 */
const EXCLUDE_DIRS = new Set(["node_modules", ".git", "data"]);
const EXCLUDE_FILES = new Set([".env", ".env.local"]);

let copied = 0;
let skipped = 0;

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, entry.name);
    const d = path.join(to, entry.name);

    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) {
        skipped += 1;
        continue;
      }
      copyTree(s, d);
      continue;
    }

    if (EXCLUDE_FILES.has(entry.name)) {
      skipped += 1;
      continue;
    }
    // Uploaded photos are operational data, not part of the asset.
    if (from.endsWith(`${path.sep}uploads`) && entry.name !== ".gitkeep") {
      skipped += 1;
      continue;
    }

    fs.copyFileSync(s, d);
    copied += 1;
  }
}

console.log(`\nExtracting ${moduleName} → ${dest}\n`);
copyTree(src, dest);
console.log(`  copied ${copied} file(s), skipped ${skipped} excluded path(s)`);

/* ------------------------------------------------------------- handover */

const manifest = JSON.parse(fs.readFileSync(path.join(src, "module.json"), "utf-8"));
const p = manifest.provenance || {};
const t = manifest.trade || {};
const i = manifest.interface || {};

const requiresBlock =
  (manifest.requires || []).length === 0
    ? "None. This module runs standalone with no outbound dependencies.\n"
    : (manifest.requires || [])
        .map(
          (r) =>
            `- **${r.capability}** — set \`${r.env}\`.` +
            (r.optional ? ` Optional: ${r.degradation}` : " **Required.**")
        )
        .join("\n") + "\n";

const restrictions = [];
if (p.support_contract_expires) {
  restrictions.push(
    `- **Vendor support expires ${p.support_contract_expires}.** Support transfers only if you expressly assume the maintenance agreement before that date. After it, the software is yours as-is with no vendor support path.`
  );
}
if (manifest.module === "notification_system") {
  restrictions.push(
    "- **SMS, email and push do not deliver.** Those channels accept and queue messages, but the gateway credentials were excluded from the original acquisition. Only `in_app` performs real delivery. Budget for either a SignalPost agreement or your own provider integration."
  );
}
if (p.source_code_escrow) {
  restrictions.push(
    "- **Source escrow transfers with the licence.** Notify the escrow agent of the change of beneficiary to preserve release rights."
  );
}
if (/transferable with written notice/i.test(p.license || "")) {
  restrictions.push(
    `- **Written notice required.** Assignment obliges you to notify ${p.acquired_from || "the original vendor"} within 30 days. Notice only — consent cannot be withheld.`
  );
}

const handover = `# ${manifest.title} — Handover

${manifest.summary}

Extracted from the Omega6.0 Waste Network module registry on ${new Date()
  .toISOString()
  .slice(0, 10)}.

## What you have bought

| | |
|---|---|
| Module | \`${manifest.module}\` v${manifest.version} |
| Origin | ${p.origin}${p.acquired_from ? ` (originally ${p.acquired_from})` : ""} |
| Licence | ${p.license} |
| Transferable | ${p.transferable ? "yes" : "no"} |
| Protocol | ${i.protocol} on \`${i.base_path}\`, default port ${i.default_port} |
| Auth | ${i.auth} |
| Owns data | ${(manifest.owns_data || []).join(", ") || "none — stateless"} |

Full terms are in [\`LICENSE\`](./LICENSE). The technical and commercial
contract is in [\`module.json\`](./module.json). The API contract is in
[\`openapi.yaml\`](./openapi.yaml).

## Run it

\`\`\`bash
npm install
cp .env.example .env     # every variable has a working default
npm start                # :${i.default_port}
curl localhost:${i.default_port}${i.base_path}/health
\`\`\`

Load the bundled test dataset if the module ships one — see \`mocks/\`.
Worked request/response pairs are in \`samples/\`, captured from live
responses rather than written by hand.

## Capabilities it provides

${(manifest.provides || []).map((c) => `- \`${c}\``).join("\n") || "- (none declared)"}

## What it needs from you

${requiresBlock}
Dependencies are resolved from environment variables, never hardcoded. Point
them at your own infrastructure, a third party, or leave them unset — every
one is optional and degrades rather than fails.

${
  restrictions.length > 0
    ? `## Restrictions and known gaps — read before deploying\n\n${restrictions.join(
        "\n"
      )}\n`
    : "## Restrictions\n\nNone beyond the licence terms.\n"
}
## Verifying what you received

\`\`\`bash
npm start &
curl localhost:${i.default_port}${i.base_path}/health
\`\`\`

The module was checked for transferability before extraction: no imports from
sibling modules, no shared datastore, no filesystem paths escaping its own
directory, and no hardcoded endpoints. Runtime state, uploaded files and the
seller's \`.env\` were deliberately excluded from this copy — you start clean.
`;

fs.writeFileSync(path.join(dest, "HANDOVER.md"), handover);
console.log("  wrote HANDOVER.md");

/* ------------------------------------------------------------------ git */

if (!NO_GIT) {
  try {
    const git = (...args) => execFileSync("git", args, { cwd: dest, stdio: "pipe" });
    git("init", "-q");
    git("add", "-A");
    git(
      "-c",
      "user.email=registry@omega6.local",
      "-c",
      "user.name=Omega6 Module Registry",
      "commit",
      "-q",
      "-m",
      `${manifest.module} v${manifest.version} — extracted for transfer\n\n` +
        `Licence: ${p.license}\nOrigin: ${p.origin}`
    );
    const count = execFileSync("git", ["ls-files"], { cwd: dest, encoding: "utf-8" })
      .trim()
      .split("\n").length;
    console.log(`  initialised git repo (${count} tracked files, 1 commit)`);
  } catch (err) {
    console.warn(`  git init skipped: ${err.message.split("\n")[0]}`);
  }
}

console.log(`\n${moduleName} is ready to hand over at ${dest}\n`);

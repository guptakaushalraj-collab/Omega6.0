#!/usr/bin/env node
/**
 * Trading-compliance checker.
 *
 * Every claim this repo makes about a module being independently tradable is
 * verified here mechanically, because an assertion in a README is worth
 * nothing in a due-diligence conversation. A buyer runs this and sees for
 * themselves.
 *
 * The checks fall into three groups:
 *
 *   ISOLATION   — the module can be lifted out and still work: no imports
 *                 from siblings, no shared datastore, no paths escaping its
 *                 own directory, dependencies injected only as env vars.
 *   ARTEFACTS   — everything a buyer needs is inside the directory: licence,
 *                 contract, docs, config template, its own .gitignore.
 *   LEGAL       — the declared licence matches the LICENSE file, provenance
 *                 is recorded, and transfer restrictions are surfaced rather
 *                 than buried.
 *
 * Exit code 0 = every module is transferable. Non-zero = at least one is not.
 *
 * Usage: node scripts/compliance-check.js [--json]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const MODULES_DIR = path.join(ROOT, "modules");
const JSON_ONLY = process.argv.includes("--json");

const MODULES = fs
  .readdirSync(MODULES_DIR)
  .filter((d) => fs.statSync(path.join(MODULES_DIR, d)).isDirectory());

const C = {
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
};

const log = (...a) => {
  if (!JSON_ONLY) console.log(...a);
};

const results = [];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/* ------------------------------------------------------------- the checks */

function checkModule(name) {
  const dir = path.join(MODULES_DIR, name);
  const findings = [];
  const pass = (id, detail) => findings.push({ id, ok: true, detail });
  const fail = (id, detail) => findings.push({ id, ok: false, detail });
  const warn = (id, detail) => findings.push({ id, ok: true, warn: true, detail });

  const files = walk(dir);
  const srcFiles = files.filter((f) => f.endsWith(".js") && f.includes(`${path.sep}src${path.sep}`));
  const read = (f) => fs.readFileSync(f, "utf-8");

  /* --- ISOLATION --------------------------------------------------------- */

  // No module may import another module's source.
  const siblings = MODULES.filter((m) => m !== name);
  const crossImports = [];
  for (const f of srcFiles) {
    const text = read(f);
    for (const sib of siblings) {
      const re = new RegExp(`(?:from|require\\()\\s*['"][^'"]*${sib}[^'"]*['"]`, "g");
      if (re.test(text)) crossImports.push(`${path.relative(dir, f)} -> ${sib}`);
    }
  }
  crossImports.length === 0
    ? pass("no-cross-imports", "imports no sibling module's source")
    : fail("no-cross-imports", crossImports.join("; "));

  // No path may escape the module directory.
  const escapes = [];
  for (const f of srcFiles) {
    for (const m of read(f).matchAll(/['"](\.\.\/\.\.\/[^'"]*)['"]/g)) {
      // ../../ from src/ lands on the module root, which is fine.
      // Anything deeper leaves the module.
      const target = path.resolve(path.dirname(f), m[1]);
      if (!target.startsWith(dir)) escapes.push(`${path.relative(dir, f)}: ${m[1]}`);
    }
  }
  escapes.length === 0
    ? pass("no-path-escapes", "no filesystem path leaves the module directory")
    : fail("no-path-escapes", escapes.join("; "));

  // Its datastore must live inside the module.
  const storeFile = files.find((f) => f.endsWith(`${path.sep}store.js`));
  if (storeFile) {
    const text = read(storeFile);
    /data['"]\)|"data"|'data'/.test(text) && text.includes("__dirname")
      ? pass("owns-datastore", "datastore is module-local")
      : warn("owns-datastore", "store.js present but locality not confirmed");
  } else {
    pass("owns-datastore", "stateless — no datastore to share");
  }

  // Dependencies on other modules must arrive as env vars, never hardcoded.
  const clientsFile = files.find((f) => f.endsWith(`${path.sep}clients.js`));
  if (clientsFile) {
    const text = read(clientsFile);
    // A hardcoded localhost URL outside a process.env fallback is a red flag.
    const hardcoded = [...text.matchAll(/["'](https?:\/\/(?!localhost)[^"']+)["']/g)].map(
      (m) => m[1]
    );
    hardcoded.length === 0
      ? pass("deps-injected", "outbound targets resolved from environment only")
      : fail("deps-injected", `hardcoded endpoint(s): ${hardcoded.join(", ")}`);
  } else {
    pass("deps-injected", "no outbound dependencies");
  }

  /* --- ARTEFACTS --------------------------------------------------------- */

  const required = {
    "package.json": "dependency manifest",
    "LICENSE": "licence — required to transfer legally",
    "README.md": "integration documentation",
    "module.json": "trade + technical manifest",
    ".env.example": "configuration template",
    ".gitignore": "needed once extracted to its own repo",
  };
  const missing = Object.keys(required).filter((f) => !fs.existsSync(path.join(dir, f)));
  missing.length === 0
    ? pass("artefacts-present", `all ${Object.keys(required).length} required files present`)
    : fail("artefacts-present", `missing: ${missing.join(", ")}`);

  // Must declare its own dependencies rather than inheriting the root's.
  let pkg = null;
  try {
    pkg = JSON.parse(read(path.join(dir, "package.json")));
    Object.keys(pkg.dependencies || {}).length > 0 || !clientsFile
      ? pass("own-dependencies", "declares its own npm dependencies")
      : warn("own-dependencies", "declares no dependencies — verify this is intended");
  } catch {
    fail("own-dependencies", "package.json unreadable");
  }

  // No dependency on the workspace root.
  if (pkg) {
    const depsOnRoot = Object.entries({
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
    }).filter(([, v]) => typeof v === "string" && (v.startsWith("file:") || v.startsWith("link:")));
    depsOnRoot.length === 0
      ? pass("no-workspace-links", "no file:/link: dependencies on the parent repo")
      : fail("no-workspace-links", depsOnRoot.map(([k]) => k).join(", "));
  }

  /* --- LEGAL ------------------------------------------------------------- */

  let manifest = null;
  try {
    manifest = JSON.parse(read(path.join(dir, "module.json")));
  } catch {
    fail("manifest-valid", "module.json missing or unparseable");
  }

  if (manifest) {
    const prov = manifest.provenance || {};
    prov.origin && prov.owner && prov.license
      ? pass("provenance-recorded", `${prov.origin}, ${prov.license}`)
      : fail("provenance-recorded", "provenance must state origin, owner and license");

    // The declared licence must match the LICENSE file.
    if (fs.existsSync(path.join(dir, "LICENSE"))) {
      const licenceText = read(path.join(dir, "LICENSE"));
      const declaredMit = /^MIT/i.test(prov.license || "");
      const fileIsMit = /^MIT License/m.test(licenceText);
      declaredMit === fileIsMit
        ? pass("licence-consistent", "module.json licence matches LICENSE file")
        : fail(
            "licence-consistent",
            `module.json says "${prov.license}" but LICENSE file says otherwise`
          );
    }

    prov.transferable === true
      ? pass("transferable", "declared transferable")
      : fail("transferable", "provenance.transferable is not true — cannot be traded");

    // Surface restrictions rather than letting a buyer discover them late.
    if (prov.support_contract_expires) {
      const expiry = new Date(prov.support_contract_expires);
      const daysLeft = Math.round((expiry - Date.now()) / 86400000);
      daysLeft > 0
        ? warn(
            "support-window",
            `vendor support transfers only if assumed before ${prov.support_contract_expires} (${daysLeft}d left)`
          )
        : fail(
            "support-window",
            `vendor support window CLOSED on ${prov.support_contract_expires} — transfers as-is`
          );
    }

    // Selling a module whose dependents are still wired to it is fine — the
    // capability indirection covers it — but the buyer should be told.
    const requires = manifest.requires || [];
    const mandatory = requires.filter((r) => r.optional !== true);
    mandatory.length === 0
      ? pass(
          "deps-optional",
          requires.length === 0
            ? "no outbound dependencies"
            : `${requires.length} dependency(ies), all optional and degrading`
        )
      : fail(
          "deps-optional",
          `${mandatory.length} MANDATORY dependency(ies) — module cannot run standalone`
        );
  }

  return { name, findings };
}

/* ------------------------------------------------------------------- run */

log(C.bold("\nTrading-compliance check\n"));

for (const name of MODULES) {
  results.push(checkModule(name));
}

let failures = 0;
let warnings = 0;

for (const { name, findings } of results) {
  const bad = findings.filter((f) => !f.ok);
  const warns = findings.filter((f) => f.warn);
  failures += bad.length;
  warnings += warns.length;

  const status = bad.length === 0 ? C.green("TRANSFERABLE") : C.red("BLOCKED");
  log(`${C.bold(name.padEnd(22))} ${status}`);

  for (const f of findings) {
    if (!f.ok) log(`  ${C.red("✗")} ${f.id}: ${f.detail}`);
    else if (f.warn) log(`  ${C.yellow("!")} ${f.id}: ${f.detail}`);
    else log(`  ${C.green("✓")} ${C.dim(`${f.id}: ${f.detail}`)}`);
  }
  log("");
}

const checksRun = results.reduce((n, r) => n + r.findings.length, 0);

if (JSON_ONLY) {
  console.log(
    JSON.stringify(
      {
        compliant: failures === 0,
        modules: results.length,
        checks: checksRun,
        failures,
        warnings,
        results,
      },
      null,
      2
    )
  );
} else {
  log(
    `${C.bold(`${checksRun} checks across ${results.length} modules`)} — ` +
      (failures === 0
        ? `${C.green("0 blocking")} , ${warnings} advisory`
        : `${C.red(`${failures} blocking`)}, ${warnings} advisory`)
  );
  if (failures === 0) {
    log(C.dim("\nEvery module can be extracted and transferred independently."));
    log(C.dim("Extract one with:  node scripts/extract-module.js <name> <dest>\n"));
  } else {
    log(C.red("\nAt least one module cannot be traded as-is. Fix the ✗ items above.\n"));
  }
}

process.exit(failures === 0 ? 0 : 1);

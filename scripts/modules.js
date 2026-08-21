#!/usr/bin/env node
/**
 * Registry orchestration: install dependencies for all six modules, or start
 * the whole mesh with dependency URLs wired up.
 *
 * The modules do not need this script — each runs standalone with `npm start`
 * in its own directory. This exists purely for convenience when running the
 * full network locally.
 */
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const MODULES_DIR = path.join(ROOT, "modules");

const NOTIFY_API_KEY = process.env.NOTIFY_API_KEY || "dev-signalpost-key";
const CREW_AUTH_TOKEN = process.env.CREW_AUTH_TOKEN || "dev-fieldops-token";

// Boot order matters only for log readability — every module tolerates its
// dependencies being absent, so any order works.
const MODULES = [
  { name: "waste_recognition", port: 4102, env: {} },
  { name: "route_optimizer", port: 4103, env: {} },
  { name: "analytics_dashboard", port: 4104, env: {} },
  {
    name: "notification_system",
    port: 4105,
    env: { NOTIFY_API_KEY },
  },
  {
    name: "worker_dashboard",
    port: 4106,
    env: {
      ROUTE_OPTIMIZER_URL: "http://localhost:4103",
      NOTIFICATION_URL: "http://localhost:4105",
      ANALYTICS_URL: "http://localhost:4104",
      NOTIFY_API_KEY,
      CREW_AUTH_TOKEN,
    },
  },
  {
    name: "bin_reporting",
    port: 4101,
    env: {
      WASTE_RECOGNITION_URL: "http://localhost:4102",
      WORKER_DASHBOARD_URL: "http://localhost:4106",
      ANALYTICS_URL: "http://localhost:4104",
      CREW_AUTH_TOKEN,
    },
  },
];

const COLORS = ["36", "32", "33", "35", "34", "31"];

function install() {
  for (const { name } of MODULES) {
    process.stdout.write(`installing ${name}... `);
    const result = spawnSync("npm", ["install", "--no-audit", "--no-fund", "--silent"], {
      cwd: path.join(MODULES_DIR, name),
      encoding: "utf-8",
    });
    if (result.status !== 0) {
      console.log("FAILED");
      console.error(result.stderr || result.stdout);
      process.exit(1);
    }
    console.log("ok");
  }
  console.log("\nAll six modules installed.");
}

function start() {
  const children = [];

  MODULES.forEach((mod, i) => {
    const color = COLORS[i % COLORS.length];
    const child = spawn("node", ["src/server.js"], {
      cwd: path.join(MODULES_DIR, mod.name),
      env: { ...process.env, PORT: String(mod.port), ...mod.env },
    });

    const prefix = `\x1b[${color}m${mod.name.padEnd(20)}\x1b[0m`;
    const pipe = (stream, out) => {
      stream.on("data", (buf) => {
        for (const line of buf.toString().split("\n")) {
          if (line.trim()) out.write(`${prefix} ${line}\n`);
        }
      });
    };
    pipe(child.stdout, process.stdout);
    pipe(child.stderr, process.stderr);

    child.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        console.error(`${prefix} exited with code ${code}`);
      }
    });

    children.push(child);
  });

  const shutdown = () => {
    for (const c of children) c.kill("SIGTERM");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log("\nRegistry starting. Ctrl-C to stop all six.\n");
}

const command = process.argv[2];
if (command === "install") install();
else if (command === "start") start();
else {
  console.error("usage: node scripts/modules.js <install|start>");
  process.exit(1);
}

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Vendored per-module datastore — deliberately not shared with siblings.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = path.join(__dirname, "data", "store.json");

const EMPTY = { events: [] };

function load() {
  if (!fs.existsSync(DB_FILE)) {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(EMPTY, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
}

export const store = {
  read: load,
  write(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  },
};

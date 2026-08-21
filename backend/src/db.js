import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Lightweight JSON-file datastore. Swappable for Postgres/Mongo later —
// every route only talks to the functions exported below, never to the file.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = path.join(__dirname, "data", "db.json");

const EMPTY_DB = {
  bins: [],
  workers: [],
  tasks: [],
  notifications: [],
};

function load() {
  if (!fs.existsSync(DB_FILE)) {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(EMPTY_DB, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
}

function save(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// Simple synchronous read-modify-write. Fine for a single-process demo;
// a real deployment would swap this module for a proper database client.
export const db = {
  read() {
    return load();
  },
  write(data) {
    save(data);
  },
  reset() {
    save(structuredClone(EMPTY_DB));
  },
};

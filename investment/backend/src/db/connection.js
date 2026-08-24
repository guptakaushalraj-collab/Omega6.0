import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** Absolute path of the SQLite file, or the literal ':memory:' for tests. */
export function resolveDatabaseFile() {
  const configured = process.env.DATABASE_FILE || 'database/data/investments.sqlite';
  if (configured === ':memory:') return ':memory:';
  return path.isAbsolute(configured) ? configured : path.join(PROJECT_ROOT, configured);
}

export function openDatabase(file = resolveDatabaseFile()) {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new Database(file);
  // WAL keeps reads from blocking the sync endpoint's writes; foreign_keys is
  // off by default in SQLite and has to be re-enabled per connection.
  if (file !== ':memory:') db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

let singleton = null;

/** Process-wide connection used by the running server. */
export function getDatabase() {
  if (!singleton) singleton = openDatabase();
  return singleton;
}

export function setDatabase(db) {
  singleton = db;
  return db;
}

export function closeDatabase() {
  singleton?.close();
  singleton = null;
}

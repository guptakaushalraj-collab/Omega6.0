#!/usr/bin/env node
/**
 * Applies every un-applied file in database/migrations, in filename order.
 *
 *   node database/migrate.js            # apply pending migrations
 *   node database/migrate.js --seed     # ...then load database/seeds/demo.sql
 *   node database/migrate.js --reset    # delete the database file first
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { openDatabase, resolveDatabaseFile } from '../backend/src/db/connection.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(here, 'migrations');
const SEEDS_DIR = path.join(here, 'seeds');

export function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name       TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);

  const applied = new Set(
    db.prepare('SELECT name FROM schema_migrations').all().map((row) => row.name),
  );
  const pending = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .filter((name) => !applied.has(name));

  const record = db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)');
  for (const name of pending) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8');
    // better-sqlite3 cannot run multi-statement SQL inside a prepared
    // transaction, so each migration gets its own explicit BEGIN/COMMIT.
    db.exec('BEGIN');
    try {
      db.exec(sql);
      record.run(name, new Date().toISOString());
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`migration ${name} failed: ${error.message}`, { cause: error });
    }
  }
  return pending;
}

export function seed(db, file = 'demo.sql') {
  const sql = fs.readFileSync(path.join(SEEDS_DIR, file), 'utf8');
  db.exec(sql);
}

function main() {
  const args = new Set(process.argv.slice(2));
  const file = resolveDatabaseFile();

  if (args.has('--reset') && file !== ':memory:') {
    for (const suffix of ['', '-wal', '-shm']) {
      fs.rmSync(`${file}${suffix}`, { force: true });
    }
    console.log(`reset ${file}`);
  }

  const db = openDatabase();
  const pending = migrate(db);
  console.log(pending.length ? `applied ${pending.join(', ')}` : 'schema up to date');

  if (args.has('--seed')) {
    seed(db);
    console.log('seeded demo data');
  }
  db.close();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}

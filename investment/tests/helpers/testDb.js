import { openDatabase, setDatabase } from '../../backend/src/db/connection.js';
import { migrate, seed } from '../../database/migrate.js';

/**
 * A migrated in-memory database, installed as the process-wide connection the
 * routes read through. Every test gets a fresh one, so ordering never matters.
 */
export function freshDb({ withSeed = false } = {}) {
  const db = openDatabase(':memory:');
  migrate(db);
  if (withSeed) seed(db);
  setDatabase(db);
  return db;
}

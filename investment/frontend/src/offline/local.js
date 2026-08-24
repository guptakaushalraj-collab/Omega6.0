import { openDB } from 'idb';

/**
 * The local mirror. Every read in the UI goes through here, never through
 * fetch — that is what makes the app offline-first rather than
 * offline-tolerant: there is no code path where losing the network changes
 * which data source the screen reads from.
 */

const DB_NAME = 'investment-manager';
const DB_VERSION = 1;

export const STORES = {
  portfolios: 'portfolios',
  assets: 'assets',
  transactions: 'transactions',
  prices: 'prices',
  queue: 'queue',
  meta: 'meta',
};

let dbPromise = null;

export function getLocalDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore(STORES.portfolios, { keyPath: 'id' });
        db.createObjectStore(STORES.assets, { keyPath: 'id' });

        const transactions = db.createObjectStore(STORES.transactions, { keyPath: 'id' });
        transactions.createIndex('by-portfolio', 'portfolio_id');

        // Composite key: one row per asset per date, matching the server's
        // prices primary key so a re-sync overwrites rather than accumulates.
        db.createObjectStore(STORES.prices, { keyPath: ['asset_id', 'as_of'] });

        db.createObjectStore(STORES.queue, { keyPath: 'op_id' });
        db.createObjectStore(STORES.meta);
      },
    });
  }
  return dbPromise;
}

export async function getAll(store) {
  return (await getLocalDb()).getAll(store);
}

export async function get(store, key) {
  return (await getLocalDb()).get(store, key);
}

export async function put(store, value) {
  await (await getLocalDb()).put(store, value);
  return value;
}

export async function remove(store, key) {
  await (await getLocalDb()).delete(store, key);
}

export async function getMeta(key, fallback = null) {
  const value = await (await getLocalDb()).get(STORES.meta, key);
  return value === undefined ? fallback : value;
}

export async function setMeta(key, value) {
  await (await getLocalDb()).put(STORES.meta, value, key);
  return value;
}

/** Replaces the mirror wholesale with a server snapshot, in one transaction. */
export async function replaceFromSnapshot(snapshot) {
  const db = await getLocalDb();
  const stores = [STORES.portfolios, STORES.assets, STORES.transactions, STORES.prices];
  const tx = db.transaction(stores, 'readwrite');

  await Promise.all(stores.map((store) => tx.objectStore(store).clear()));
  await Promise.all([
    ...snapshot.portfolios.map((row) => tx.objectStore(STORES.portfolios).put(row)),
    ...snapshot.assets.map((row) => tx.objectStore(STORES.assets).put(row)),
    ...snapshot.transactions.map((row) => tx.objectStore(STORES.transactions).put(row)),
    ...snapshot.prices.map((row) => tx.objectStore(STORES.prices).put(row)),
  ]);
  await tx.done;

  await setMeta('seq', snapshot.seq);
  await setMeta('last_sync_at', new Date().toISOString());
  return snapshot;
}

/**
 * Re-applies the pending queue on top of a freshly pulled snapshot.
 *
 * Without this, a sync would visibly revert the user's un-synced edits for the
 * few seconds until the queue drains — the single most jarring bug in an
 * offline-first UI.
 */
export async function reapplyQueue() {
  const pending = await getAll(STORES.queue);
  for (const op of pending) {
    if (op.type === 'transaction.upsert') await put(STORES.transactions, op.payload);
    else if (op.type === 'portfolio.upsert') await put(STORES.portfolios, op.payload);
    else if (op.type === 'asset.upsert') await put(STORES.assets, op.payload);
    else if (op.type === 'transaction.delete') await remove(STORES.transactions, op.payload.id);
    else if (op.type === 'portfolio.delete') await remove(STORES.portfolios, op.payload.id);
  }
  return pending.length;
}

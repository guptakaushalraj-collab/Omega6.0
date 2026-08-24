import { getDatabase } from '../db/connection.js';
import { nowIso } from '../db/ids.js';
import {
  validateAsset,
  validatePortfolio,
  validatePrice,
  validateTransaction,
} from './validate.js';
import {
  changesSince,
  currentSeq,
  deletePortfolio,
  deleteTransaction,
  listAssets,
  listPortfolios,
  listTransactions,
  latestPrices,
  recordPrice,
  upsertAsset,
  upsertPortfolio,
  upsertTransaction,
} from './repository.js';

/**
 * The reconciliation half of offline-first.
 *
 * The browser queues mutations in IndexedDB while offline and replays the whole
 * queue on reconnect. Replays are expected to overlap — a request can succeed
 * server-side and still fail to deliver its response — so every operation
 * carries a client-minted `op_id` and is applied at most once.
 */

const requireId = (payload) => (payload?.id ? null : 'id is required');

// Each handler pairs a validator with the mutation it guards, so a malformed
// queued operation is rejected with a readable reason instead of whichever
// NOT NULL constraint SQLite happens to trip over first.
const HANDLERS = {
  'portfolio.upsert': [validatePortfolio, (payload, db) => upsertPortfolio(payload, db)],
  'portfolio.delete': [
    requireId,
    (payload, db) => ({ id: payload.id, deleted: deletePortfolio(payload.id, db) }),
  ],
  'asset.upsert': [validateAsset, (payload, db) => upsertAsset(payload, db)],
  'transaction.upsert': [validateTransaction, (payload, db) => upsertTransaction(payload, db)],
  'transaction.delete': [
    requireId,
    (payload, db) => ({ id: payload.id, deleted: deleteTransaction(payload.id, db) }),
  ],
  'price.upsert': [validatePrice, (payload, db) => recordPrice(payload, db)],
};

export const SUPPORTED_OPERATIONS = Object.keys(HANDLERS);

export class SyncError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'SyncError';
    this.status = status;
  }
}

function applyOne(operation, clientId, db) {
  const { op_id: opId, type, payload } = operation;
  if (!opId) throw new SyncError('each operation needs an op_id');
  if (!HANDLERS[type]) throw new SyncError(`unsupported operation type: ${type}`);

  const seen = db.prepare('SELECT * FROM sync_ops WHERE op_id = ?').get(opId);
  if (seen) {
    // Idempotent replay: return the original outcome rather than re-applying.
    return {
      op_id: opId,
      status: seen.status,
      duplicate: true,
      result: seen.result_json ? JSON.parse(seen.result_json) : null,
    };
  }

  const [validate, handle] = HANDLERS[type];
  const problem = validate(payload ?? {});
  if (problem) throw new SyncError(problem);

  const result = handle(payload ?? {}, db);
  db.prepare(
    `INSERT INTO sync_ops (op_id, client_id, entity, entity_id, status, result_json, applied_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(opId, clientId, type, result?.id ?? null, 'applied', JSON.stringify(result ?? null), nowIso());

  return { op_id: opId, status: 'applied', duplicate: false, result };
}

/**
 * Applies a batch of queued client operations.
 *
 * Each operation gets its own savepoint: one malformed row in a week-old queue
 * must not block the other 99 from landing, and the client needs per-operation
 * results to know what to drop from its queue and what to surface for repair.
 */
export function applyOperations(operations, clientId, db = getDatabase()) {
  if (!Array.isArray(operations)) throw new SyncError('operations must be an array');
  if (!clientId) throw new SyncError('client_id is required');

  const results = [];
  for (const [index, operation] of operations.entries()) {
    db.exec('SAVEPOINT sync_op');
    try {
      results.push(applyOne(operation, clientId, db));
      db.exec('RELEASE sync_op');
    } catch (error) {
      db.exec('ROLLBACK TO sync_op');
      db.exec('RELEASE sync_op');
      results.push({
        op_id: operation?.op_id ?? `index_${index}`,
        status: 'rejected',
        duplicate: false,
        error: error.message,
      });
    }
  }
  return results;
}

/** Everything a freshly installed client needs to work offline immediately. */
export function snapshot(db = getDatabase()) {
  return {
    seq: currentSeq(db),
    generated_at: nowIso(),
    portfolios: listPortfolios(db),
    assets: listAssets(db),
    transactions: listTransactions({ limit: 5000 }, db),
    prices: latestPrices(db),
  };
}

/** Incremental catch-up for a client that already holds a snapshot. */
export function changes(since, db = getDatabase()) {
  const log = changesSince(since, db);
  return {
    since: Number(since) || 0,
    seq: currentSeq(db),
    generated_at: nowIso(),
    changes: log,
  };
}

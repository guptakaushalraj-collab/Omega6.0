import { getDatabase } from '../db/connection.js';
import { newId, nowIso } from '../db/ids.js';

/**
 * Thin data-access layer. Every mutation writes a change_log row in the same
 * transaction as the row itself, so a client pulling `?since=` can never see a
 * write it has no matching log entry for.
 */

function logChange(db, entity, entityId, op, at) {
  db.prepare(
    'INSERT INTO change_log (entity, entity_id, op, changed_at) VALUES (?, ?, ?, ?)',
  ).run(entity, entityId, op, at);
}

/* ---------------------------------------------------------------- portfolios */

export function listPortfolios(db = getDatabase()) {
  return db
    .prepare('SELECT * FROM portfolios WHERE deleted_at IS NULL ORDER BY name')
    .all();
}

export function getPortfolio(id, db = getDatabase()) {
  return db.prepare('SELECT * FROM portfolios WHERE id = ? AND deleted_at IS NULL').get(id);
}

export function upsertPortfolio(input, db = getDatabase()) {
  const at = input.updated_at || nowIso();
  const id = input.id || newId('pf');
  const existing = db.prepare('SELECT * FROM portfolios WHERE id = ?').get(id);

  // Last-writer-wins: a stale queued edit from a device that was offline for a
  // week must not clobber a newer edit made elsewhere.
  if (existing && existing.updated_at > at) return existing;

  db.prepare(
    `INSERT INTO portfolios (id, name, base_currency, created_at, updated_at, deleted_at)
     VALUES (@id, @name, @base_currency, @created_at, @updated_at, NULL)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       base_currency = excluded.base_currency,
       updated_at = excluded.updated_at,
       deleted_at = NULL`,
  ).run({
    id,
    name: input.name,
    base_currency: input.base_currency || 'USD',
    created_at: existing?.created_at || at,
    updated_at: at,
  });

  logChange(db, 'portfolio', id, 'upsert', at);
  return db.prepare('SELECT * FROM portfolios WHERE id = ?').get(id);
}

export function deletePortfolio(id, db = getDatabase()) {
  const at = nowIso();
  const result = db
    .prepare('UPDATE portfolios SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
    .run(at, at, id);
  if (result.changes) logChange(db, 'portfolio', id, 'delete', at);
  return result.changes > 0;
}

/* -------------------------------------------------------------------- assets */

export function listAssets(db = getDatabase()) {
  return db.prepare('SELECT * FROM assets WHERE deleted_at IS NULL ORDER BY symbol').all();
}

export function upsertAsset(input, db = getDatabase()) {
  const at = input.updated_at || nowIso();
  const symbol = String(input.symbol).trim().toUpperCase();
  // Symbol is the natural key: two devices adding "AAPL" offline must converge
  // on one asset row rather than two rows with different generated ids.
  const existing =
    db.prepare('SELECT * FROM assets WHERE symbol = ?').get(symbol) ||
    (input.id ? db.prepare('SELECT * FROM assets WHERE id = ?').get(input.id) : undefined);
  const id = existing?.id || input.id || newId('as');

  if (existing && existing.updated_at > at) return existing;

  db.prepare(
    `INSERT INTO assets (id, symbol, name, asset_class, currency, created_at, updated_at, deleted_at)
     VALUES (@id, @symbol, @name, @asset_class, @currency, @created_at, @updated_at, NULL)
     ON CONFLICT(id) DO UPDATE SET
       symbol = excluded.symbol,
       name = excluded.name,
       asset_class = excluded.asset_class,
       currency = excluded.currency,
       updated_at = excluded.updated_at,
       deleted_at = NULL`,
  ).run({
    id,
    symbol,
    name: input.name || symbol,
    asset_class: input.asset_class || 'equity',
    currency: input.currency || 'USD',
    created_at: existing?.created_at || at,
    updated_at: at,
  });

  logChange(db, 'asset', id, 'upsert', at);
  return db.prepare('SELECT * FROM assets WHERE id = ?').get(id);
}

/* -------------------------------------------------------------- transactions */

export function listTransactions({ portfolioId, limit = 500 } = {}, db = getDatabase()) {
  const sql = portfolioId
    ? `SELECT t.*, a.symbol FROM transactions t JOIN assets a ON a.id = t.asset_id
       WHERE t.deleted_at IS NULL AND t.portfolio_id = ?
       ORDER BY t.traded_at DESC LIMIT ?`
    : `SELECT t.*, a.symbol FROM transactions t JOIN assets a ON a.id = t.asset_id
       WHERE t.deleted_at IS NULL ORDER BY t.traded_at DESC LIMIT ?`;
  return portfolioId ? db.prepare(sql).all(portfolioId, limit) : db.prepare(sql).all(limit);
}

export function getTransaction(id, db = getDatabase()) {
  return db.prepare('SELECT * FROM transactions WHERE id = ? AND deleted_at IS NULL').get(id);
}

export function upsertTransaction(input, db = getDatabase()) {
  const at = input.updated_at || nowIso();
  const id = input.id || newId('tx');
  const existing = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);

  if (existing && existing.updated_at > at) return existing;

  db.prepare(
    `INSERT INTO transactions
       (id, portfolio_id, asset_id, type, quantity, price, fee, traded_at, note, created_at, updated_at, deleted_at)
     VALUES
       (@id, @portfolio_id, @asset_id, @type, @quantity, @price, @fee, @traded_at, @note, @created_at, @updated_at, NULL)
     ON CONFLICT(id) DO UPDATE SET
       portfolio_id = excluded.portfolio_id,
       asset_id = excluded.asset_id,
       type = excluded.type,
       quantity = excluded.quantity,
       price = excluded.price,
       fee = excluded.fee,
       traded_at = excluded.traded_at,
       note = excluded.note,
       updated_at = excluded.updated_at,
       deleted_at = NULL`,
  ).run({
    id,
    portfolio_id: input.portfolio_id,
    asset_id: input.asset_id,
    type: input.type,
    quantity: Number(input.quantity),
    price: Number(input.price),
    fee: Number(input.fee || 0),
    traded_at: input.traded_at || at,
    note: input.note ?? null,
    created_at: existing?.created_at || at,
    updated_at: at,
  });

  logChange(db, 'transaction', id, 'upsert', at);
  return db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
}

export function deleteTransaction(id, db = getDatabase()) {
  const at = nowIso();
  const result = db
    .prepare('UPDATE transactions SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
    .run(at, at, id);
  if (result.changes) logChange(db, 'transaction', id, 'delete', at);
  return result.changes > 0;
}

/* -------------------------------------------------------------------- prices */

export function latestPrices(db = getDatabase()) {
  return db
    .prepare(
      `SELECT p.asset_id, p.close, p.as_of
       FROM prices p
       JOIN (SELECT asset_id, MAX(as_of) AS as_of FROM prices GROUP BY asset_id) latest
         ON latest.asset_id = p.asset_id AND latest.as_of = p.as_of`,
    )
    .all();
}

export function recordPrice({ asset_id, as_of, close }, db = getDatabase()) {
  const at = nowIso();
  db.prepare(
    `INSERT INTO prices (asset_id, as_of, close, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(asset_id, as_of) DO UPDATE SET close = excluded.close`,
  ).run(asset_id, as_of, Number(close), at);
  logChange(db, 'price', `${asset_id}:${as_of}`, 'upsert', at);
  return { asset_id, as_of, close: Number(close) };
}

/* ---------------------------------------------------------------- change log */

export function changesSince(seq = 0, db = getDatabase()) {
  return db
    .prepare('SELECT * FROM change_log WHERE seq > ? ORDER BY seq LIMIT 1000')
    .all(Number(seq) || 0);
}

export function currentSeq(db = getDatabase()) {
  return db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM change_log').get().seq;
}

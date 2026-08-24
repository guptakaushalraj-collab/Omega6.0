import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { closeDatabase } from '../../backend/src/db/connection.js';
import {
  changesSince,
  deleteTransaction,
  listPortfolios,
  listTransactions,
  upsertAsset,
  upsertPortfolio,
  upsertTransaction,
} from '../../backend/src/services/repository.js';
import { freshDb } from '../helpers/testDb.js';

describe('repository', () => {
  let db;
  beforeEach(() => {
    db = freshDb();
  });
  after(() => closeDatabase());

  it('creates a portfolio and lists it', () => {
    const portfolio = upsertPortfolio({ name: 'Growth' }, db);
    assert.equal(portfolio.name, 'Growth');
    assert.equal(portfolio.base_currency, 'USD');
    assert.deepEqual(
      listPortfolios(db).map((p) => p.name),
      ['Growth'],
    );
  });

  it('deduplicates assets by symbol, case-insensitively', () => {
    const first = upsertAsset({ symbol: 'aapl', name: 'Apple' }, db);
    const second = upsertAsset({ symbol: 'AAPL', name: 'Apple Inc.' }, db);
    assert.equal(first.id, second.id, 'the same ticker must resolve to one asset');
    assert.equal(second.name, 'Apple Inc.');
  });

  it('refuses to let a stale offline edit overwrite a newer one', () => {
    const portfolio = upsertPortfolio({ name: 'Original' }, db);
    upsertPortfolio({ id: portfolio.id, name: 'Newer', updated_at: '2030-01-01T00:00:00.000Z' }, db);

    const result = upsertPortfolio(
      { id: portfolio.id, name: 'Stale queued edit', updated_at: '2020-01-01T00:00:00.000Z' },
      db,
    );
    assert.equal(result.name, 'Newer');
  });

  it('soft-deletes transactions and hides them from listings', () => {
    const portfolio = upsertPortfolio({ name: 'P' }, db);
    const asset = upsertAsset({ symbol: 'VTI' }, db);
    const tx = upsertTransaction(
      { portfolio_id: portfolio.id, asset_id: asset.id, type: 'buy', quantity: 1, price: 10 },
      db,
    );

    assert.equal(listTransactions({}, db).length, 1);
    assert.equal(deleteTransaction(tx.id, db), true);
    assert.equal(listTransactions({}, db).length, 0);
    assert.equal(deleteTransaction(tx.id, db), false, 'deleting twice is a no-op');

    const row = db.prepare('SELECT deleted_at FROM transactions WHERE id = ?').get(tx.id);
    assert.ok(row.deleted_at, 'the row must survive so offline clients learn about the delete');
  });

  it('records a change_log entry for every mutation', () => {
    const portfolio = upsertPortfolio({ name: 'P' }, db);
    const asset = upsertAsset({ symbol: 'BND' }, db);
    upsertTransaction(
      { portfolio_id: portfolio.id, asset_id: asset.id, type: 'buy', quantity: 2, price: 5 },
      db,
    );

    const log = changesSince(0, db);
    assert.deepEqual(
      log.map((entry) => entry.entity),
      ['portfolio', 'asset', 'transaction'],
    );
    assert.ok(log.every((entry) => entry.seq > 0));
  });
});

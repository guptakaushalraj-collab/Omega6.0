import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { closeDatabase } from '../../backend/src/db/connection.js';
import { listTransactions, upsertAsset, upsertPortfolio } from '../../backend/src/services/repository.js';
import { applyOperations, changes, snapshot } from '../../backend/src/services/sync.js';
import { freshDb } from '../helpers/testDb.js';

describe('sync engine', () => {
  let db;
  let portfolio;
  let asset;

  beforeEach(() => {
    db = freshDb();
    portfolio = upsertPortfolio({ name: 'Main' }, db);
    asset = upsertAsset({ symbol: 'VTI' }, db);
  });
  after(() => closeDatabase());

  const buy = (opId, quantity = 1) => ({
    op_id: opId,
    type: 'transaction.upsert',
    payload: {
      portfolio_id: portfolio.id,
      asset_id: asset.id,
      type: 'buy',
      quantity,
      price: 100,
    },
  });

  it('applies a queued batch', () => {
    const results = applyOperations([buy('op-1'), buy('op-2', 3)], 'client-a', db);
    assert.deepEqual(
      results.map((r) => r.status),
      ['applied', 'applied'],
    );
    assert.equal(listTransactions({}, db).length, 2);
  });

  it('is idempotent: replaying a batch creates nothing new', () => {
    applyOperations([buy('op-1'), buy('op-2')], 'client-a', db);
    const replay = applyOperations([buy('op-1'), buy('op-2')], 'client-a', db);

    assert.ok(replay.every((r) => r.duplicate), 'every replayed op must be flagged duplicate');
    assert.equal(
      listTransactions({}, db).length,
      2,
      'a redelivered queue must not double-book the trades',
    );
  });

  it('isolates a bad operation so the rest of the queue still lands', () => {
    const results = applyOperations(
      [buy('op-good-1'), { op_id: 'op-bad', type: 'transaction.upsert', payload: {} }, buy('op-good-2')],
      'client-a',
      db,
    );

    assert.deepEqual(
      results.map((r) => r.status),
      ['applied', 'rejected', 'applied'],
    );
    assert.equal(listTransactions({}, db).length, 2);
    assert.match(results[1].error, /portfolio_id is required/);
  });

  it('rejects unknown operation types without touching the database', () => {
    const [result] = applyOperations([{ op_id: 'op-x', type: 'wire.transfer' }], 'client-a', db);
    assert.equal(result.status, 'rejected');
    assert.match(result.error, /unsupported operation type/);
    assert.equal(listTransactions({}, db).length, 0);
  });

  it('requires a client_id and an array of operations', () => {
    assert.throws(() => applyOperations([], null, db), /client_id is required/);
    assert.throws(() => applyOperations('nope', 'client-a', db), /operations must be an array/);
  });

  it('does not record a rejected operation as applied, so a fixed retry works', () => {
    applyOperations([{ op_id: 'op-retry', type: 'transaction.upsert', payload: {} }], 'client-a', db);
    const retry = applyOperations([buy('op-retry')], 'client-a', db);
    assert.equal(retry[0].status, 'applied');
    assert.equal(listTransactions({}, db).length, 1);
  });

  it('snapshot carries everything a fresh client needs to work offline', () => {
    applyOperations([buy('op-1')], 'client-a', db);
    const result = snapshot(db);

    assert.equal(result.portfolios.length, 1);
    assert.equal(result.assets.length, 1);
    assert.equal(result.transactions.length, 1);
    assert.ok(result.seq > 0);
    assert.ok(Array.isArray(result.prices));
  });

  it('changes advertises the current seq so a client can skip a no-op pull', () => {
    const before = changes(0, db);
    const unchanged = changes(before.seq, db);
    assert.equal(unchanged.changes.length, 0);
    assert.equal(unchanged.seq, before.seq);

    applyOperations([buy('op-1')], 'client-a', db);
    const after = changes(before.seq, db);
    assert.equal(after.changes.length, 1);
    assert.ok(after.seq > before.seq);
  });
});

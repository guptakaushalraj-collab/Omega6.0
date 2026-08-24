import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORES, getAll, getMeta, replaceFromSnapshot } from '../../frontend/src/offline/local.js';
import { acknowledge, enqueue, markRejected, pending, pendingCount } from '../../frontend/src/offline/queue.js';
import { pull, push, sync } from '../../frontend/src/offline/syncEngine.js';

/** Wipes every store so each test starts from a cold install. */
async function resetLocal() {
  const { getLocalDb } = await import('../../frontend/src/offline/local.js');
  const db = await getLocalDb();
  const tx = db.transaction(Object.values(STORES), 'readwrite');
  await Promise.all(Object.values(STORES).map((store) => tx.objectStore(store).clear()));
  await tx.done;
}

const emptySnapshot = (seq = 1) => ({
  seq,
  generated_at: new Date().toISOString(),
  portfolios: [],
  assets: [],
  transactions: [],
  prices: [],
});

function mockFetch(handler) {
  const fetchMock = vi.fn(async (url, options) => {
    const body = await handler(String(url), options);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(body),
    };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(async () => {
  await resetLocal();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the offline queue', () => {
  it('stores a mutation durably with an op_id', async () => {
    const op = await enqueue('transaction.upsert', { id: 'tx_1', quantity: 1 });

    expect(op.op_id).toBeTruthy();
    expect(await pendingCount()).toBe(1);
    expect((await pending())[0].payload.id).toBe('tx_1');
  });

  it('orders the queue by when each mutation was made', async () => {
    await enqueue('a.upsert', { n: 1 });
    await new Promise((resolve) => setTimeout(resolve, 2));
    await enqueue('b.upsert', { n: 2 });

    expect((await pending()).map((op) => op.type)).toEqual(['a.upsert', 'b.upsert']);
  });

  it('keeps a rejected operation instead of silently losing the user data', async () => {
    const op = await enqueue('transaction.upsert', { id: 'tx_bad' });
    await markRejected(op.op_id, 'asset_id is required');

    const [stored] = await pending();
    expect(stored.rejected).toBe(true);
    expect(stored.last_error).toBe('asset_id is required');
    expect(await pendingCount()).toBe(1);
  });

  it('drops an operation once the server acknowledges it', async () => {
    const op = await enqueue('transaction.upsert', { id: 'tx_1' });
    await acknowledge(op.op_id);
    expect(await pendingCount()).toBe(0);
  });
});

describe('push', () => {
  it('does nothing and makes no request when the queue is empty', async () => {
    const fetchMock = mockFetch(async () => ({}));
    expect(await push()).toEqual({ pushed: 0, applied: 0, rejected: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('clears acknowledged operations and keeps rejected ones', async () => {
    const good = await enqueue('asset.upsert', { symbol: 'VTI' });
    const bad = await enqueue('transaction.upsert', {});

    mockFetch(async () => ({
      results: [
        { op_id: good.op_id, status: 'applied', duplicate: false },
        { op_id: bad.op_id, status: 'rejected', error: 'asset_id is required' },
      ],
    }));

    const result = await push();
    expect(result.applied).toBe(1);
    expect(result.rejected).toBe(1);

    const remaining = await pending();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].op_id).toBe(bad.op_id);
    expect(remaining[0].rejected).toBe(true);
  });

  it('treats a duplicate as success, so a redelivered batch drains the queue', async () => {
    const op = await enqueue('asset.upsert', { symbol: 'VTI' });
    mockFetch(async () => ({
      results: [{ op_id: op.op_id, status: 'applied', duplicate: true }],
    }));

    await push();
    expect(await pendingCount()).toBe(0);
  });

  it('keeps the whole batch queued when the network is down', async () => {
    await enqueue('asset.upsert', { symbol: 'VTI' });
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));

    await expect(push()).rejects.toThrow(/Failed to fetch/);
    const [op] = await pending();
    expect(op.attempts).toBe(1);
    expect(op.last_error).toMatch(/Failed to fetch/);
  });

  it('never re-sends an operation the server already rejected', async () => {
    const op = await enqueue('transaction.upsert', {});
    await markRejected(op.op_id, 'bad');

    const fetchMock = mockFetch(async () => ({ results: [] }));
    await push();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends a stable client_id across calls', async () => {
    await enqueue('asset.upsert', { symbol: 'A' });
    const seen = [];
    mockFetch(async (url, options) => {
      seen.push(JSON.parse(options.body).client_id);
      return { results: [] };
    });

    await push();
    await enqueue('asset.upsert', { symbol: 'B' });
    await push();

    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
    expect(seen[0]).toMatch(/^client_/);
  });
});

describe('pull', () => {
  it('skips the snapshot request when the server sequence has not moved', async () => {
    await replaceFromSnapshot(emptySnapshot(7));
    const fetchMock = mockFetch(async (url) => {
      if (url.includes('/changes')) return { seq: 7, changes: [] };
      throw new Error('snapshot should not have been requested');
    });

    const result = await pull();
    expect(result.changed).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('replaces the mirror when the server has newer data', async () => {
    await replaceFromSnapshot(emptySnapshot(1));
    mockFetch(async (url) => {
      if (url.includes('/changes')) return { seq: 2, changes: [] };
      return {
        ...emptySnapshot(2),
        portfolios: [{ id: 'pf_1', name: 'Synced', base_currency: 'USD' }],
      };
    });

    const result = await pull();
    expect(result.changed).toBe(true);
    expect(await getMeta('seq')).toBe(2);
    expect((await getAll(STORES.portfolios)).map((p) => p.name)).toEqual(['Synced']);
  });

  it('re-applies un-synced local edits on top of a fresh snapshot', async () => {
    // The bug this guards: a pull clears the mirror, so a queued edit the
    // server has not seen yet would visibly vanish from the UI until it drains.
    await enqueue('transaction.upsert', { id: 'tx_local', portfolio_id: 'pf_1', quantity: 9 });
    mockFetch(async () => emptySnapshot(3));

    await pull({ force: true });

    const transactions = await getAll(STORES.transactions);
    expect(transactions.map((tx) => tx.id)).toEqual(['tx_local']);
  });

  it('re-applies a queued delete on top of a snapshot that still has the row', async () => {
    await replaceFromSnapshot({
      ...emptySnapshot(1),
      transactions: [{ id: 'tx_gone', portfolio_id: 'pf_1', asset_id: 'a1', quantity: 1 }],
    });
    await enqueue('transaction.delete', { id: 'tx_gone' });

    mockFetch(async () => ({
      ...emptySnapshot(4),
      transactions: [{ id: 'tx_gone', portfolio_id: 'pf_1', asset_id: 'a1', quantity: 1 }],
    }));

    await pull({ force: true });
    expect(await getAll(STORES.transactions)).toHaveLength(0);
  });
});

describe('sync', () => {
  it('pushes before pulling, so the snapshot already contains our writes', async () => {
    await enqueue('asset.upsert', { id: 'as_1', symbol: 'VTI' });
    const calls = [];
    mockFetch(async (url, options) => {
      calls.push(options?.method === 'POST' ? 'push' : url.includes('/changes') ? 'changes' : 'snapshot');
      if (options?.method === 'POST') return { results: [] };
      if (url.includes('/changes')) return { seq: 5, changes: [] };
      return emptySnapshot(5);
    });

    await sync();
    expect(calls[0]).toBe('push');
    expect(calls).toContain('snapshot');
  });

  it('records the time of the last successful sync', async () => {
    mockFetch(async (url) => (url.includes('/changes') ? { seq: 0, changes: [] } : emptySnapshot(0)));
    await sync();
    expect(await getMeta('last_sync_at')).toBeTruthy();
  });
});

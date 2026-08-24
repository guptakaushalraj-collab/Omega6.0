import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { STORES, getAll, put, remove } from './local.js';
import { enqueue, newLocalId, pending } from './queue.js';
import { sync } from './syncEngine.js';

const DataContext = createContext(null);

const RETRY_MS = 30_000;

export function DataProvider({ children }) {
  const [data, setData] = useState({
    portfolios: [],
    assets: [],
    transactions: [],
    prices: [],
    queue: [],
  });
  const [online, setOnline] = useState(() => globalThis.navigator?.onLine ?? true);
  const [status, setStatus] = useState({ state: 'loading', lastSyncAt: null, error: null });
  const syncing = useRef(false);

  const refresh = useCallback(async () => {
    const [portfolios, assets, transactions, prices, queue] = await Promise.all([
      getAll(STORES.portfolios),
      getAll(STORES.assets),
      getAll(STORES.transactions),
      getAll(STORES.prices),
      pending(),
    ]);
    setData({ portfolios, assets, transactions, prices, queue });
  }, []);

  const runSync = useCallback(
    async ({ force = false } = {}) => {
      // Guard against overlapping runs: the online event, the interval and a
      // manual click can all fire within the same second.
      if (syncing.current) return null;
      syncing.current = true;
      setStatus((prev) => ({ ...prev, state: 'syncing', error: null }));
      try {
        const result = await sync({ force });
        await refresh();
        setStatus({ state: 'idle', lastSyncAt: new Date().toISOString(), error: null });
        return result;
      } catch (error) {
        // Failing to reach the server is the expected offline case, not a
        // crash: the queue survives and the UI keeps serving the mirror.
        setStatus((prev) => ({ ...prev, state: 'offline', error: error.message }));
        await refresh();
        return null;
      } finally {
        syncing.current = false;
      }
    },
    [refresh],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await refresh();
      if (!cancelled) await runSync();
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh, runSync]);

  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      runSync();
    };
    const goOffline = () => setOnline(false);
    globalThis.addEventListener?.('online', goOnline);
    globalThis.addEventListener?.('offline', goOffline);

    const timer = setInterval(() => {
      if (globalThis.navigator?.onLine !== false) runSync();
    }, RETRY_MS);

    const onMessage = (event) => {
      if (event.data?.type === 'flush-queue') runSync();
    };
    navigator.serviceWorker?.addEventListener('message', onMessage);

    return () => {
      globalThis.removeEventListener?.('online', goOnline);
      globalThis.removeEventListener?.('offline', goOffline);
      clearInterval(timer);
      navigator.serviceWorker?.removeEventListener('message', onMessage);
    };
  }, [runSync]);

  /** Optimistic write: mirror first, queue second, network whenever. */
  const mutate = useCallback(
    async (type, payload, { store, deleteKey } = {}) => {
      if (deleteKey) await remove(store, deleteKey);
      else if (store) await put(store, payload);

      await enqueue(type, payload);
      await refresh();
      if (globalThis.navigator?.onLine !== false) runSync();
      return payload;
    },
    [refresh, runSync],
  );

  const actions = useMemo(
    () => ({
      refresh,
      sync: runSync,

      savePortfolio: (input) => {
        const now = new Date().toISOString();
        const record = {
          id: input.id || newLocalId('pf'),
          name: input.name,
          base_currency: input.base_currency || 'USD',
          created_at: input.created_at || now,
          updated_at: now,
          deleted_at: null,
        };
        return mutate('portfolio.upsert', record, { store: STORES.portfolios });
      },

      deletePortfolio: (id) =>
        mutate('portfolio.delete', { id }, { store: STORES.portfolios, deleteKey: id }),

      saveAsset: (input) => {
        const now = new Date().toISOString();
        const record = {
          id: input.id || newLocalId('as'),
          symbol: String(input.symbol).trim().toUpperCase(),
          name: input.name || String(input.symbol).trim().toUpperCase(),
          asset_class: input.asset_class || 'equity',
          currency: input.currency || 'USD',
          created_at: input.created_at || now,
          updated_at: now,
          deleted_at: null,
        };
        return mutate('asset.upsert', record, { store: STORES.assets });
      },

      saveTransaction: (input) => {
        const now = new Date().toISOString();
        const record = {
          id: input.id || newLocalId('tx'),
          portfolio_id: input.portfolio_id,
          asset_id: input.asset_id,
          type: input.type,
          quantity: Number(input.quantity),
          price: Number(input.price),
          fee: Number(input.fee || 0),
          traded_at: input.traded_at || now,
          note: input.note || null,
          created_at: input.created_at || now,
          updated_at: now,
          deleted_at: null,
        };
        return mutate('transaction.upsert', record, { store: STORES.transactions });
      },

      deleteTransaction: (id) =>
        mutate('transaction.delete', { id }, { store: STORES.transactions, deleteKey: id }),

      savePrice: (assetId, close, asOf = new Date().toISOString().slice(0, 10)) =>
        mutate(
          'price.upsert',
          { asset_id: assetId, as_of: asOf, close: Number(close) },
          { store: STORES.prices },
        ),
    }),
    [mutate, refresh, runSync],
  );

  const value = useMemo(
    () => ({ ...data, online, status, ...actions }),
    [data, online, status, actions],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  const context = useContext(DataContext);
  if (!context) throw new Error('useData must be used inside a <DataProvider>');
  return context;
}

import { api } from './api.js';
import { getMeta, reapplyQueue, replaceFromSnapshot, setMeta } from './local.js';
import { acknowledge, markFailed, markRejected, newOpId, pending } from './queue.js';

/**
 * Push-then-pull reconciliation.
 *
 * Order matters: pushing first means the snapshot we pull afterwards already
 * contains our own writes, so the mirror lands in one consistent state instead
 * of briefly showing the pre-write server view.
 */

const PUSH_BATCH = 100;

export async function getClientId() {
  let id = await getMeta('client_id');
  if (!id) id = await setMeta('client_id', `client_${newOpId()}`);
  return id;
}

export async function push() {
  const queued = (await pending()).filter((op) => !op.rejected);
  if (queued.length === 0) return { pushed: 0, applied: 0, rejected: 0 };

  const clientId = await getClientId();
  const batch = queued.slice(0, PUSH_BATCH);

  let response;
  try {
    response = await api.push(
      clientId,
      batch.map(({ op_id, type, payload }) => ({ op_id, type, payload })),
    );
  } catch (error) {
    // Network failure: leave the whole batch queued and try again next tick.
    await Promise.all(batch.map((op) => markFailed(op.op_id, error.message)));
    throw error;
  }

  let applied = 0;
  let rejected = 0;
  for (const result of response.results ?? []) {
    if (result.status === 'applied') {
      // A duplicate is still a success — the server already has it.
      await acknowledge(result.op_id);
      applied += 1;
    } else {
      await markRejected(result.op_id, result.error || 'rejected by server');
      rejected += 1;
    }
  }

  return { pushed: batch.length, applied, rejected, remaining: queued.length - batch.length };
}

/**
 * Pulls a full snapshot, but only when the server's sequence has moved past
 * ours. The change log tells us *that* something changed and which entities;
 * re-fetching the (small) snapshot is simpler and less error-prone than
 * hydrating each changed id individually, and costs one request either way.
 */
export async function pull({ force = false } = {}) {
  const localSeq = await getMeta('seq', 0);
  if (!force) {
    const { seq } = await api.changes(localSeq);
    if (seq === localSeq) {
      await setMeta('last_sync_at', new Date().toISOString());
      return { changed: false, seq };
    }
  }

  const snapshot = await api.snapshot();
  await replaceFromSnapshot(snapshot);
  // Un-synced local edits were just cleared by the snapshot; put them back.
  await reapplyQueue();
  return { changed: true, seq: snapshot.seq };
}

export async function sync({ force = false } = {}) {
  const pushResult = await push();
  const pullResult = await pull({ force });
  await setMeta('last_sync_at', new Date().toISOString());
  return { ...pushResult, ...pullResult };
}

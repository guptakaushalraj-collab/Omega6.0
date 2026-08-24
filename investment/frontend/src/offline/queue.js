import { STORES, getAll, getLocalDb, put, remove } from './local.js';

/**
 * The write path. Mutations are applied to the local mirror immediately and
 * appended to a durable queue; the network is a background detail the UI never
 * waits on. This is the difference the user actually feels — every action is
 * instant whether or not there is a connection.
 */

export function newOpId() {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `op_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function newLocalId(prefix) {
  return `${prefix}_${newOpId()}`;
}

export async function enqueue(type, payload) {
  const op = {
    op_id: newOpId(),
    type,
    payload,
    queued_at: new Date().toISOString(),
    attempts: 0,
    last_error: null,
  };
  await put(STORES.queue, op);
  return op;
}

export async function pending() {
  const ops = await getAll(STORES.queue);
  return ops.sort((a, b) => a.queued_at.localeCompare(b.queued_at));
}

export async function pendingCount() {
  return (await getLocalDb()).count(STORES.queue);
}

export async function acknowledge(opId) {
  await remove(STORES.queue, opId);
}

/**
 * A rejected operation is kept, not dropped, but flagged so the UI can offer a
 * repair. Silently discarding a user's trade because the server disliked it is
 * data loss; retrying it forever is an infinite loop.
 */
export async function markRejected(opId, error) {
  const op = await (await getLocalDb()).get(STORES.queue, opId);
  if (!op) return null;
  const updated = { ...op, attempts: op.attempts + 1, last_error: error, rejected: true };
  await put(STORES.queue, updated);
  return updated;
}

export async function markFailed(opId, error) {
  const op = await (await getLocalDb()).get(STORES.queue, opId);
  if (!op) return null;
  const updated = { ...op, attempts: op.attempts + 1, last_error: error };
  await put(STORES.queue, updated);
  return updated;
}

export async function discard(opId) {
  await remove(STORES.queue, opId);
}

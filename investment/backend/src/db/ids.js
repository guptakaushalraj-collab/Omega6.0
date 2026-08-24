import { randomUUID } from 'node:crypto';

/**
 * Prefixed, sortable-enough identifiers. Clients mint these offline, so they
 * must be collision-free without a round trip to the server.
 */
export function newId(prefix) {
  return `${prefix}_${randomUUID()}`;
}

export function nowIso() {
  return new Date().toISOString();
}

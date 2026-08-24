/**
 * Shared input validation.
 *
 * Both entry points — the REST routes and the offline sync queue — run these,
 * so a trade rejected while queued reports the same reason it would have
 * reported if it had been submitted online.
 */

export const TRANSACTION_TYPES = ['buy', 'sell', 'dividend'];
export const ASSET_CLASSES = ['equity', 'etf', 'bond', 'crypto', 'cash', 'other'];

function nonNegativeNumber(value) {
  return Number.isFinite(Number(value)) && Number(value) >= 0;
}

export function validateTransaction(input) {
  if (!input?.portfolio_id) return 'portfolio_id is required';
  if (!input?.asset_id) return 'asset_id is required';
  if (!TRANSACTION_TYPES.includes(input?.type)) {
    return `type must be one of ${TRANSACTION_TYPES.join(', ')}`;
  }
  if (!nonNegativeNumber(input?.quantity)) return 'quantity must be a non-negative number';
  if (!nonNegativeNumber(input?.price)) return 'price must be a non-negative number';
  if (input?.fee !== undefined && !nonNegativeNumber(input.fee)) {
    return 'fee must be a non-negative number';
  }
  return null;
}

export function validatePortfolio(input) {
  if (!input?.name || !String(input.name).trim()) return 'name is required';
  return null;
}

export function validateAsset(input) {
  if (!input?.symbol || !String(input.symbol).trim()) return 'symbol is required';
  if (input?.asset_class && !ASSET_CLASSES.includes(input.asset_class)) {
    return `asset_class must be one of ${ASSET_CLASSES.join(', ')}`;
  }
  return null;
}

export function validatePrice(input) {
  if (!input?.asset_id) return 'asset_id is required';
  if (!nonNegativeNumber(input?.close)) return 'close must be a non-negative number';
  return null;
}

const currencyCache = new Map();

function formatter(currency) {
  if (!currencyCache.has(currency)) {
    currencyCache.set(
      currency,
      new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }),
    );
  }
  return currencyCache.get(currency);
}

export function money(value, currency = 'USD') {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return formatter(currency).format(value);
}

export function percent(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(digits)}%`;
}

export function quantity(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }).format(value);
}

export function shortDate(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function relativeTime(iso) {
  if (!iso) return 'never';
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

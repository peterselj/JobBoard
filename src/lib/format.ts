export function formatMoney(n: number): string {
  if (n >= 1000) return `$${Math.round(n / 1000)}k`;
  return `$${Math.round(n)}`;
}

/** Local YYYY-MM-DD for `daysBack` days ago (0 = today, 1 = yesterday). */
export function isoDate(daysBack = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function daysAgo(ts: number): number {
  return Math.floor((Date.now() - ts) / (24 * 3600 * 1000));
}

export function formatDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Short local date from a millisecond timestamp, e.g. "Jun 22, 2026". */
export function formatTsDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatWeight(weight: number): string {
  return `${weight % 1 === 0 ? weight : weight.toFixed(1).replace(/\.0$/, '')}%`;
}

export function formatExpectedOffers(n: number): string {
  return n.toFixed(2);
}

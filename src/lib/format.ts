export function formatMoney(n: number): string {
  if (n >= 1000) return `$${Math.round(n / 1000)}k`;
  return `$${Math.round(n)}`;
}

export function formatCompRange(min?: number | null, max?: number | null): string {
  if (min != null && max != null) return min === max ? formatMoney(min) : `${formatMoney(min)}–${formatMoney(max)}`;
  if (min != null) return `${formatMoney(min)}+`;
  if (max != null) return `up to ${formatMoney(max)}`;
  return '—';
}

export function daysAgo(ts: number): number {
  return Math.floor((Date.now() - ts) / (24 * 3600 * 1000));
}

export function relativeDays(ts: number): string {
  const d = daysAgo(ts);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  return `${d}d ago`;
}

export function formatDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function isOverdue(dateStr?: string): boolean {
  if (!dateStr) return false;
  const d = new Date(`${dateStr}T23:59:59`);
  return d.getTime() < Date.now();
}

export function formatWeight(weight: number): string {
  return `${weight % 1 === 0 ? weight : weight.toFixed(1).replace(/\.0$/, '')}%`;
}

export function formatExpectedOffers(n: number): string {
  return n.toFixed(2);
}

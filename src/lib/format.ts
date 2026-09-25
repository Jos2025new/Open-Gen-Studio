export function formatUsd(v: number | null | undefined, opts: { approx?: boolean } = {}): string {
  if (v == null || !Number.isFinite(v)) return '—';
  if (v === 0) return '$0';
  const abs = Math.abs(v);
  // A real cost never reads as zero: tiny amounts (per-minute speech-to-text) show as "<$0.001".
  if (abs < 0.001) return `${opts.approx ? '≈' : ''}<$0.001`;
  const digits = abs < 0.01 ? 4 : abs < 0.1 ? 3 : 2;
  const s = `$${v.toFixed(digits).replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '')}`;
  return opts.approx ? `≈${s}` : s;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
}

export function formatRelative(ts: number, now = Date.now()): string {
  const d = Math.max(0, now - ts);
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (d < min) return 'just now';
  if (d < hour) return `${Math.floor(d / min)}m ago`;
  if (d < day) return `${Math.floor(d / hour)}h ago`;
  if (d < 2 * day) return 'yesterday';
  if (d < 7 * day) return `${Math.floor(d / day)}d ago`;
  if (d < 30 * day) return `${Math.floor(d / (7 * day))}w ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Calendar bucket for grouping lists by date. */
export function dateGroup(ts: number, now = Date.now()): string {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const day = 24 * 3600 * 1000;
  const t = start.getTime();
  if (ts >= t) return 'Today';
  if (ts >= t - day) return 'Yesterday';
  if (ts >= t - 6 * day) return 'This week';
  if (ts >= t - 29 * day) return 'This month';
  return new Date(ts).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/** Split an already sorted list into consecutive date groups. */
export function groupByDate<T>(items: T[], ts: (item: T) => number): Array<{ label: string; items: T[] }> {
  const out: Array<{ label: string; items: T[] }> = [];
  for (const item of items) {
    const label = dateGroup(ts(item));
    if (out[out.length - 1]?.label === label) out[out.length - 1].items.push(item);
    else out.push({ label, items: [item] });
  }
  return out;
}

export function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function truncate(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

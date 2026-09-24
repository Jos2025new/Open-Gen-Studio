export function formatUsd(v: number | null | undefined, opts: { approx?: boolean } = {}): string {
  if (v == null || !Number.isFinite(v)) return '—';
  if (v === 0) return '$0';
  const abs = Math.abs(v);
  const digits = abs < 0.1 ? 3 : 2;
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

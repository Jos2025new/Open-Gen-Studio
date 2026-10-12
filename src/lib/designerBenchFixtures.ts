import type { RasterStroke, Session } from '../engine/types';

/** Stable, bounded fixtures: no credentials, generation jobs or external requests. */
export function longBenchStrokes(count = 300): RasterStroke[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `bench-stroke-${i}`, x: 0, y: 0, color: '#ffffff', opacity: 0.6, erase: false,
    tip: { hardness: 1, texture: 'none', blend: 'normal' },
    segments: Array.from({ length: 120 }, (_, j) => {
      const x = 80 + j * 14;
      const y = 80 + (i % 60) * 15;
      return [x, y + Math.sin(j / 6) * 4, x + 14, y + Math.sin((j + 1) / 6) * 4, 8] as [number, number, number, number, number];
    }),
  }));
}

export function appendBenchSessions(existing: Record<string, Session>, factory: (title: string) => Session) {
  const sessions = { ...existing };
  for (let i = 0; i < 1000; i++) {
    const id = `bench-fluidity-session-${i}`;
    if (!sessions[id]) sessions[id] = { ...factory(`Synthetic fluidity ${i}`), id };
  }
  return sessions;
}

/** Union of measured intervals: nested handlers and RAF callbacks are counted once. */
export function intervalWork(intervals: Array<[number, number]>, start: number, end: number) {
  const clipped = intervals.map(([a, b]) => [Math.max(start, a), Math.min(end, b)])
    .filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  let total = 0, until = start;
  for (const [a, b] of clipped) { total += Math.max(0, b - Math.max(until, a)); until = Math.max(until, b); }
  return total;
}

export function sandboxBenchAllowed(location: { hostname: string; port: string }) {
  return location.port === '5183' && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
}

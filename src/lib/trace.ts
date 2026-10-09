import { LOCAL_WRITE } from './disk';

/*
 * Performance trace for test sessions (ADR 0012), modelled on GIMP's dashboard log (a recording with the user's
 * markers) and Inkscape's framecheck (events with start and end, off = one boolean check). Off by default; nothing is
 * kept in the app state. A session writes JSON lines to logs/trace-<id>.jsonl through the local server, and
 * `npm run trace:report` summarizes them, also between markers.
 *
 * Generic: any code adds a probe with one line, `const end = span('domain', 'name', data); … end(more)`.
 * Domains let a session record only what is being looked at (`?trace=label&domains=fx,render`).
 */

export interface TraceEvent {
  /** ms since the session started. */
  t: number;
  d: string;
  n: string;
  ms?: number;
  data?: Record<string, unknown>;
}

export interface TraceOptions {
  label: string;
  /** Only these domains are recorded; empty = all. */
  domains?: string[];
  /** Times a synchronized 1-pixel read after each FX pass; perturbs rendering, not an exact CPU/GPU split. */
  deep?: boolean;
}

interface Session { id: string; label: string; domains: Set<string>; deep: boolean; t0: number; buffer: string[]; timer: ReturnType<typeof setInterval> | null; observer: PerformanceObserver | null }

let session: Session | null = null;
const listeners = new Set<() => void>();
const NOOP = () => 0;

/** Cheap check for hot paths: true only while a session records this domain. */
export function tracing(domain: string): boolean {
  return session !== null && (session.domains.size === 0 || session.domains.has(domain));
}

export function traceDeep(): boolean {
  return session?.deep ?? false;
}

export function traceStatus(): { id: string; label: string; domains: string[]; deep: boolean; seconds: number } | null {
  return session && { id: session.id, label: session.label, domains: [...session.domains], deep: session.deep, seconds: Math.round((performance.now() - session.t0) / 1000) };
}

export function onTraceChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function push(e: TraceEvent): void {
  if (!session) return;
  session.buffer.push(JSON.stringify(e));
  if (session.buffer.length >= 500) flush();
}

/** An instant event. */
export function note(domain: string, name: string, data?: Record<string, unknown>): void {
  if (!tracing(domain)) return;
  push({ t: Math.round((performance.now() - session!.t0) * 100) / 100, d: domain, n: name, ...(data ? { data } : {}) });
}

/** A timed event: call the result when it ends (extra data is merged). Off = a no-op closure. */
export function span(domain: string, name: string, data?: Record<string, unknown>): (more?: Record<string, unknown>) => number {
  if (!tracing(domain)) return NOOP;
  const start = performance.now(), t0 = session!.t0;
  return (more) => {
    const ms = performance.now() - start;
    if (session && session.t0 === t0) push({ t: Math.round((start - t0) * 100) / 100, d: domain, n: name, ms: Math.round(ms * 1000) / 1000, ...(data || more ? { data: { ...data, ...more } } : {}) });
    return ms;
  };
}

/** The user's or the agent's own words in the timeline ("now I drag the layer"); always recorded while on. */
export function mark(text: string): void {
  if (session) push({ t: Math.round((performance.now() - session.t0) * 100) / 100, d: 'mark', n: text.slice(0, 200) });
}

// Waits for the next frame that shows a change: an action calls `awaitFrame`, the canvas calls `frameShown`.
let pending: Array<{ d: string; n: string; start: number; data?: Record<string, unknown> }> = [];

/** From now to the first frame the canvas shows after it (the latency the user sees). */
export function awaitFrame(domain: string, name: string, data?: Record<string, unknown>): void {
  if (tracing(domain)) pending.push({ d: domain, n: name, start: performance.now(), data });
}

/** The canvas drew a frame: resolves every action waiting for one once the browser paints it. */
export function frameShown(): void {
  if (!pending.length || !session) return;
  const waiting = pending;
  pending = [];
  const done = () => { for (const p of waiting) push({ t: Math.round((p.start - session!.t0) * 100) / 100, d: p.d, n: p.n, ms: Math.round((performance.now() - p.start) * 100) / 100, ...(p.data ? { data: p.data } : {}) }); };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => session && done());
  else done();
}

// Off-screen canvases made while recording: how many and how many pixels (memory pressure).
let made = { count: 0, px: 0 };
export function canvasMade(w: number, h: number): void {
  if (session) { made.count++; made.px += w * h; }
}
/** Canvases made since the last call (a frame reads and resets them). */
export function takeCanvasCount(): { canvases: number; px: number } {
  const out = { canvases: made.count, px: made.px };
  made = { count: 0, px: 0 };
  return out;
}

function flush(): void {
  if (!session || !session.buffer.length) return;
  const body = session.buffer.splice(0).join('\n');
  void fetch(`/x/store/trace?id=${encodeURIComponent(session.id)}`, { method: 'POST', body, headers: { 'Content-Type': 'text/plain', ...LOCAL_WRITE }, keepalive: body.length < 60_000 }).catch(() => undefined);
}

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'session';

export function startTrace(opts: TraceOptions): string {
  if (session) stopTrace();
  const now = new Date();
  const id = `${now.toISOString().slice(0, 19).replace(/[:T]/g, '-')}-${slug(opts.label)}`;
  session = { id, label: opts.label, domains: new Set((opts.domains ?? []).filter(Boolean)), deep: !!opts.deep, t0: performance.now(), buffer: [], timer: null, observer: null };
  made = { count: 0, px: 0 };
  pending = [];
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  push({ t: 0, d: 'session', n: 'start', data: { label: opts.label, domains: opts.domains ?? [], deep: !!opts.deep, at: now.toISOString(), userAgent: nav?.userAgent, cores: nav?.hardwareConcurrency, dpr: typeof devicePixelRatio === 'number' ? devicePixelRatio : 1 } });
  session.timer = setInterval(() => {
    // JS heap where the browser exposes it (Chrome); other browsers record nothing here.
    const mem = (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory;
    if (mem) note('memory', 'heap', { usedMB: Math.round(mem.usedJSHeapSize / 1e5) / 10, totalMB: Math.round(mem.totalJSHeapSize / 1e5) / 10 });
    flush();
  }, 1000);
  try {
    session.observer = new PerformanceObserver((list) => { for (const e of list.getEntries()) note('browser', 'longtask', { ms: Math.round(e.duration) }); });
    session.observer.observe({ type: 'longtask', buffered: false });
  } catch { session.observer = null; }
  listeners.forEach((fn) => fn());
  return id;
}

export function stopTrace(): string | null {
  if (!session) return null;
  const id = session.id;
  push({ t: Math.round((performance.now() - session.t0) * 100) / 100, d: 'session', n: 'stop' });
  flush();
  if (session.timer) clearInterval(session.timer);
  session.observer?.disconnect();
  session = null;
  pending = [];
  listeners.forEach((fn) => fn());
  return id;
}

/** `?trace=<label>&domains=a,b&deep=1` starts a session at load (the sandbox and the real app alike). */
export function traceFromUrl(search: string): void {
  const q = new URLSearchParams(search);
  const label = q.get('trace');
  // Once per page: React mounts twice in development, and a second start would split the session.
  if (label != null && !session) startTrace({ label: label || 'session', domains: q.get('domains')?.split(',') ?? [], deep: q.get('deep') === '1' });
}

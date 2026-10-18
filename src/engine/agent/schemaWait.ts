/**
 * The plan check's real waits: each parameter schema it loads (not cached) is one sub-step of the turn's activity
 * block, and while it loads a pending entry ticks. Durations are measured here, never guessed; samples live only in
 * this session's memory (no persistence).
 */

const SAMPLE_LIMIT = 50;
/** The "usually ~Ns" hint needs at least this many earlier real loads. */
export const MIN_SAMPLES = 3;
const samples: number[] = [];

export function recordSchemaLoad(ms: number): void {
  samples.push(ms);
  if (samples.length > SAMPLE_LIMIT) samples.shift();
}

export function median(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The typical load time, or undefined until there are enough real samples to say something. */
export function typicalSchemaLoad(): number | undefined {
  return samples.length >= MIN_SAMPLES ? median(samples) : undefined;
}

export const seconds = (ms: number) => `${Math.max(1, Math.round(ms / 1000))}s`;

/** Detail of a pending load: "<model> · <elapsed>s", plus the usual time and "taking longer" past twice that. */
export function waitDetail(name: string, elapsedMs: number, typical: number | undefined = typicalSchemaLoad()): string {
  if (typical == null) return `${name} · ${seconds(elapsedMs)}`;
  const longer = elapsedMs > 2 * typical ? ', taking longer' : '';
  return `${name} · ${seconds(elapsedMs)} · usually ~${seconds(typical)}${longer}`;
}

/** Only the plan check's schema loads: the activity entries, the pending marker in the agent state, and the samples. */
export interface WaitSink {
  patch: (fn: (a: { waiting?: PendingWait[] }) => { waiting?: PendingWait[] }) => void;
  action: (entry: { icon: 'schema'; label: string; detail: string }) => void;
}
export interface PendingWait { key: string; name: string; since: number }

export function waitHooks(sink: WaitSink) {
  return {
    begin(key: string, name: string) {
      sink.patch((a) => ({ waiting: [...(a.waiting ?? []), { key, name, since: Date.now() }] }));
    },
    end(key: string, name: string, ok: boolean, ms: number) {
      sink.patch((a) => ({ waiting: (a.waiting ?? []).filter((w) => w.key !== key) }));
      if (ok) recordSchemaLoad(ms);
      sink.action({ icon: 'schema', label: ok ? 'Schema loaded' : 'Schema unavailable', detail: `${name} · ${seconds(ms)}` });
    },
  };
}

export type WaitHooks = ReturnType<typeof waitHooks>;

/** Test helper: forget the samples of earlier loads. */
export function resetSchemaSamples(): void {
  samples.length = 0;
}

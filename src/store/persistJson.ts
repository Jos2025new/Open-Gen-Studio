/*
 * The saved state as JSON, without serializing every session on every save. Sessions are replaced, never mutated,
 * when they change (the store's rule), so a session object that is the same as last time has the same JSON: its text
 * is kept and reused. The result is byte for byte what JSON.stringify(value) gives (tests/persist-json.test.ts).
 *
 * The same bytes also come as a Blob made of one kept Blob per session, for the disk copy: sending a 12 MB string
 * through fetch() blocked the page for ~0.9 s on every save (it is encoded on the main thread), while a Blob of
 * already encoded parts is handed over at once. Only sessions that changed are encoded again.
 *
 * Safety net: if some code ever mutated a stored session in place, its kept text would be stale. On the first save
 * after FULL_EVERY_MS has passed, every session is serialized afresh and compared with its kept text; a difference is logged and the
 * fresh text is the one saved, so a stale session can never outlive that interval.
 */

interface Kept { text: string; blob?: Blob }
export type { Kept };
const kept = new WeakMap<object, Kept>();
const MARK = '\u0000ogs-sessions\u0000';
export const FULL_EVERY_MS = 30_000;
let lastFull = Number.NEGATIVE_INFINITY;

/** The saved state's JSON. `open` replaces its opening `{` (a stamp such as `{"savedAt":1,`); both give the same bytes. */
export interface StateJson {
  text(open?: string): string;
  blob(open?: string): Blob;
  /** Format 2 parts (ADR 0014) when the state has sessions: the global record and each session's text. */
  v2?: { version: number; globals: string; order: string[]; sessions: Map<string, string> };
}

function sessionParts(sessions: Record<string, unknown>, fresh: boolean): Array<{ id: string; key: string; rec: Kept }> {
  const parts: Array<{ id: string; key: string; rec: Kept }> = [];
  for (const [id, s] of Object.entries(sessions)) {
    if (s === undefined || typeof s === 'function' || typeof s === 'symbol') continue;
    const cacheable = !!s && typeof s === 'object';
    const old = cacheable ? kept.get(s as object) : undefined;
    let rec = fresh ? undefined : old;
    if (rec === undefined) {
      const text = JSON.stringify(s);
      if (old !== undefined && old.text !== text) console.error(`Saved state: session ${id} changed in place; its fresh text is saved`);
      rec = old?.text === text ? old : { text };
      if (cacheable) kept.set(s as object, rec);
    }
    parts.push({ id, key: `${JSON.stringify(id)}:`, rec });
  }
  return parts;
}

export function persistState(value: { state?: unknown; version?: number }, now = Date.now()): StateJson {
  const state = value.state as Record<string, unknown> | undefined;
  const sessions = state?.sessions;
  if (!state || !sessions || typeof sessions !== 'object' || Array.isArray(sessions)) {
    const whole = JSON.stringify(value);
    const text = (open = '{') => (whole.startsWith('{') ? open + whole.slice(1) : whole);
    return { text, blob: (open) => new Blob([text(open)], { type: 'application/json' }) };
  }
  const fresh = now - lastFull >= FULL_EVERY_MS;
  if (fresh) lastFull = now;
  // Everything but the sessions is small: serialized as usual, with a marker where the sessions go.
  const head = JSON.stringify({ ...value, state: { ...state, sessions: MARK } });
  const at = head.indexOf(JSON.stringify(MARK));
  const pre = head.slice(1, at), post = head.slice(at + JSON.stringify(MARK).length);
  const parts = sessionParts(sessions as Record<string, unknown>, fresh);
  const { sessions: _sessions, ...globals } = state as Record<string, unknown>;
  return {
    v2: { version: value.version ?? 1, globals: JSON.stringify(globals), order: parts.map((p) => p.id), sessions: new Map(parts.map((p) => [p.id, p.rec.text])) },
    text: (open = '{') => `${open}${pre}{${parts.map((p) => p.key + p.rec.text).join(',')}}${post}`,
    blob: (open = '{') => {
      const bits: BlobPart[] = [open + pre, '{'];
      parts.forEach((p, i) => bits.push(i ? `,${p.key}` : p.key, (p.rec.blob ??= new Blob([p.rec.text]))));
      bits.push('}', post);
      return new Blob(bits, { type: 'application/json' });
    },
  };
}

export function persistJson(value: { state?: unknown; version?: number }, now = Date.now()): string {
  return persistState(value, now).text();
}

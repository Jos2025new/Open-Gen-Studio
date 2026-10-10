/*
 * The saved state as JSON, without serializing every session on every save. Sessions are replaced, never mutated,
 * when they change (the store's rule), so a session object that is the same as last time has the same JSON: its text
 * is kept and reused. The result is byte for byte what JSON.stringify(value) gives (tests/persist-json.test.ts).
 *
 * Safety net: if some code ever mutated a stored session in place, its kept text would be stale. On the first save
 * after FULL_EVERY_MS has passed, every session is serialized afresh and compared with its kept text; a difference is logged and the
 * fresh text is the one saved, so a stale session can never outlive that interval.
 */

const kept = new WeakMap<object, string>();
const MARK = '\u0000ogs-sessions\u0000';
export const FULL_EVERY_MS = 30_000;
let lastFull = Number.NEGATIVE_INFINITY;

function sessionsJson(sessions: Record<string, unknown>, fresh: boolean): string {
  const parts: string[] = [];
  for (const [id, s] of Object.entries(sessions)) {
    if (s === undefined || typeof s === 'function' || typeof s === 'symbol') continue;
    const cacheable = !!s && typeof s === 'object';
    const old = cacheable ? kept.get(s as object) : undefined;
    let text = fresh ? undefined : old;
    if (text === undefined) {
      text = JSON.stringify(s);
      if (old !== undefined && old !== text) console.error(`Saved state: session ${id} changed in place; its fresh text is saved`);
      if (cacheable) kept.set(s as object, text);
    }
    parts.push(`${JSON.stringify(id)}:${text}`);
  }
  return `{${parts.join(',')}}`;
}

export function persistJson(value: { state?: unknown; version?: number }, now = Date.now()): string {
  const state = value.state as Record<string, unknown> | undefined;
  const sessions = state?.sessions;
  if (!state || !sessions || typeof sessions !== 'object' || Array.isArray(sessions)) return JSON.stringify(value);
  const fresh = now - lastFull >= FULL_EVERY_MS;
  if (fresh) lastFull = now;
  // Everything but the sessions is small: serialized as usual, with a marker where the sessions go.
  return JSON.stringify({ ...value, state: { ...state, sessions: MARK } }).replace(JSON.stringify(MARK), () => sessionsJson(sessions as Record<string, unknown>, fresh));
}

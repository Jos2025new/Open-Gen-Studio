import { describe, expect, it, vi } from 'vitest';
import { FULL_EVERY_MS, persistJson, persistState } from '../src/store/persistJson';

/* The saved state's JSON reuses unchanged sessions' text, and is byte for byte what JSON.stringify gives. */
const session = (id: string, n: number) => ({ id, title: `S ${id} "q"\n`, docs: [{ layers: Array.from({ length: n }, (_, i) => ({ i, v: undefined, s: 'é ' })) }], gone: undefined });

describe('persistJson', () => {
  it('equals JSON.stringify, first time and after reuse, with odd text and undefined fields', () => {
    const a = session('a', 3), b = session('b', 2);
    const v = { state: { settings: { x: 1 }, sessions: { a, b, c: undefined }, activeSessionId: 'a' }, version: 1 };
    expect(persistJson(v, 0)).toBe(JSON.stringify(v));
    const next = { ...v, state: { ...v.state, sessions: { ...v.state.sessions, b: session('b', 5) } } };
    expect(persistJson(next, 1)).toBe(JSON.stringify(next));
  });
  it('an unchanged session is not serialized again', () => {
    const big = session('big', 50), v = { state: { sessions: { big } }, version: 1 };
    persistJson(v, 10 * FULL_EVERY_MS);
    const spy = vi.spyOn(JSON, 'stringify');
    persistJson({ state: { sessions: { big }, ui: 1 }, version: 1 }, 10 * FULL_EVERY_MS + 1);
    expect(spy.mock.calls.some(([x]) => x === big)).toBe(false);
    spy.mockRestore();
  });
  it('a session mutated in place is caught by the periodic full pass and saved fresh', () => {
    const s = session('m', 1), v = { state: { sessions: { m: s } }, version: 1 };
    persistJson(v, 100 * FULL_EVERY_MS);
    (s.docs[0].layers as unknown[]).push({ added: true });
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(persistJson(v, 101 * FULL_EVERY_MS)).toBe(JSON.stringify(v));
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
  it('the Blob for the disk has the same bytes as the text, stamped the same way', async () => {
    const v = { state: { settings: { x: 'é' }, sessions: { a: session('a', 3), b: session('b', 2) } }, version: 1 };
    const json = persistState(v, 1000 * FULL_EVERY_MS);
    expect(json.text()).toBe(JSON.stringify(v));
    const open = '{"savedAt":5,"baseAt":4,';
    expect(json.text(open)).toBe(open + JSON.stringify(v).slice(1));
    expect(await json.blob(open).text()).toBe(json.text(open));
    const none = persistState({ state: { settings: 1 }, version: 1 });
    expect(await none.blob(open).text()).toBe(none.text(open));
  });
  it('an unchanged session is not encoded again for the Blob', async () => {
    const Real = globalThis.Blob;
    let made = 0;
    vi.stubGlobal('Blob', class extends Real { constructor(...a: ConstructorParameters<typeof Blob>) { super(...a); made++; } });
    const big = session('big', 50);
    const first = persistState({ state: { sessions: { big } }, version: 1 }, 2000 * FULL_EVERY_MS);
    first.blob();
    made = 0;
    const next = { state: { sessions: { big, small: session('s', 1) } }, version: 1 };
    const blob = persistState(next, 2000 * FULL_EVERY_MS + 1).blob();
    expect(made).toBe(2); // the new session and the whole; big's kept Blob is reused
    vi.unstubAllGlobals();
    expect(await blob.text()).toBe(JSON.stringify(next));
  });
});

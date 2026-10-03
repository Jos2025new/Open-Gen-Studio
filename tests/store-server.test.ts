import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { localStore } from '../server/local-store.js';

const last = { headers: {} as Record<string, string> };
/** Drive the plugin's middleware with a fake request; resolves with the status code. */
function call(mw: (req: unknown, res: unknown, next: () => void) => void, method: string, url: string, body = '', headers: Record<string, string> = { 'x-ogs': '1', host: 'localhost:5173' }): Promise<number> {
  return new Promise((resolve) => {
    const req = { method, url, headers, async *[Symbol.asyncIterator]() { if (body) yield new TextEncoder().encode(body); } };
    const res = { statusCode: 0, headers: {} as Record<string, string>, setHeader: (k: string, v: string) => { res.headers[k.toLowerCase()] = v; }, end: () => { last.headers = res.headers; resolve(res.statusCode); } };
    mw(req, res, () => resolve(404));
  });
}

function setup(state = '{"savedAt":100,"x":0}') {
  const root = mkdtempSync(join(tmpdir(), 'ogs-'));
  mkdirSync(join(root, 'data'));
  writeFileSync(join(root, 'data', 'state.json'), state);
  let mw: (req: unknown, res: unknown, next: () => void) => void = () => undefined;
  (localStore(root).configureServer as unknown as (s: unknown) => void)({ middlewares: { use: (fn: typeof mw) => (mw = fn) } });
  return { root, mw };
}

describe('local store: writes only from the app', () => {
  it('a cross-site POST to /wipe (no preflight needed) is refused and the data stays', async () => {
    const { root, mw } = setup();
    expect(await call(mw, 'POST', '/x/store/wipe', '', { host: 'localhost:5173', origin: 'https://evil.example' })).toBe(403);
    expect(await call(mw, 'POST', '/x/store/wipe', '', { host: 'localhost:5173', origin: 'https://evil.example', 'x-ogs': '1' })).toBe(403);
    expect(await call(mw, 'POST', '/x/store/log', '{}', { host: 'localhost:5173' })).toBe(403);
    expect(String(readFileSync(join(root, 'data', 'state.json')))).toContain('"x":0');
    // Reads and the app's own writes still work.
    expect(await call(mw, 'GET', '/x/store/state', '', { host: 'localhost:5173' })).toBe(200);
    expect(await call(mw, 'POST', '/x/store/log', '{}', { host: 'localhost:5173', origin: 'http://localhost:5173', 'x-ogs': '1' })).toBe(204);
  });
});

describe('local store: only a whole saved state replaces the file', () => {
  it('refuses a body that is not a stamped state, or one without baseAt, and keeps the file', async () => {
    const { root, mw } = setup();
    expect(await call(mw, 'PUT', '/x/store/state', 'not-json')).toBe(400);
    expect(await call(mw, 'PUT', '/x/store/state', '{"savedAt":200,"x":1}')).toBe(400);
    expect(await call(mw, 'PUT', '/x/store/state', '{"savedAt":200,"baseAt":100,"x":')).toBe(400);
    expect(String(readFileSync(join(root, 'data', 'state.json')))).toBe('{"savedAt":100,"x":0}');
    expect(await call(mw, 'PUT', '/x/store/state', '{"savedAt":200,"baseAt":100,"x":1}')).toBe(204);
  });
});

describe('local store: media is served as data', () => {
  it('an SVG with a script comes back sandboxed and without sniffing', async () => {
    const { mw } = setup();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    const put = await new Promise<number>((resolve) => {
      const req = { method: 'PUT', url: '/x/store/blob/asset%3Aa1', headers: { 'x-ogs': '1', host: 'localhost:5173', 'content-type': 'image/svg+xml' }, async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(svg); } };
      const res = { statusCode: 0, setHeader: () => undefined, end: () => resolve(res.statusCode) };
      mw(req, res, () => resolve(404));
    });
    expect(put).toBe(204);
    expect(await call(mw, 'GET', '/x/store/blob/asset%3Aa1', '', { host: 'localhost:5173' })).toBe(200);
    expect(last.headers['content-security-policy']).toBe('sandbox');
    expect(last.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('local store: state writes', () => {
  it('two tabs saving on the same base: one is written, the other gets 409; no temp file is left', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ogs-'));
    mkdirSync(join(root, 'data'));
    writeFileSync(join(root, 'data', 'state.json'), '{"savedAt":100,"x":0}');
    let mw: (req: unknown, res: unknown, next: () => void) => void = () => undefined;
    (localStore(root).configureServer as unknown as (s: unknown) => void)({ middlewares: { use: (fn: typeof mw) => (mw = fn) } });
    const big = 'y'.repeat(2_000_000); // a slow write, so both checks would run before either write without the queue
    const [a, b] = await Promise.all([
      call(mw, 'PUT', '/x/store/state', `{"savedAt":200,"baseAt":100,"tab":"a","p":"${big}"}`),
      call(mw, 'PUT', '/x/store/state', `{"savedAt":201,"baseAt":100,"tab":"b"}`),
    ]);
    expect([a, b].sort()).toEqual([204, 409]);
    const saved = String(readFileSync(join(root, 'data', 'state.json')));
    expect(saved).toContain(a === 204 ? '"tab":"a"' : '"tab":"b"');
    const { readdir } = await import('node:fs/promises' as string);
    expect(((await readdir(join(root, 'data'))) as string[]).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    // The queue keeps working after a refusal.
    expect(await call(mw, 'PUT', '/x/store/state', `{"savedAt":300,"baseAt":${a === 204 ? 200 : 201},"tab":"c"}`)).toBe(204);
  });
});

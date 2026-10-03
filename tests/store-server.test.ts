import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { localStore } from '../server/local-store.js';

/** Drive the plugin's middleware with a fake request; resolves with the status code. */
function call(mw: (req: unknown, res: unknown, next: () => void) => void, method: string, url: string, body = ''): Promise<number> {
  return new Promise((resolve) => {
    const req = { method, url, async *[Symbol.asyncIterator]() { if (body) yield new TextEncoder().encode(body); } };
    const res = { statusCode: 0, setHeader: () => undefined, end: () => resolve(res.statusCode) };
    mw(req, res, () => resolve(404));
  });
}

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

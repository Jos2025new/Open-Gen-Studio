// @ts-nocheck -- Node http server in a test; the project has no @types/node (see tests/bench/node.d.ts).
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
// @ts-expect-error plain JS server module without types
import { localStore } from '../server/local-store.js';

/*
 * The live test of 2026-10-03 lost its sessions: a tab still holding the state from before the test saved later and
 * overwrote everything. Two "tabs" (two copies of the disk module) against the real local store server.
 */

let root = '';
let server: Server;
let base = '';

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'ogs-conflict-'));
  let mw: (req: unknown, res: unknown, next: () => void) => void = () => undefined;
  localStore(root).configureServer({ middlewares: { use: (fn: typeof mw) => (mw = fn) } });
  server = createServer((req, res) => mw(req, res, () => res.writeHead(404).end()));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const real = globalThis.fetch;
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => real(url.startsWith('/') ? base + url : url, { ...init, keepalive: false }));
});
afterAll(() => {
  server.close();
  rmSync(root, { recursive: true, force: true });
});

async function tab() {
  vi.resetModules();
  return (await import('../src/lib/disk')).disk;
}
const state = (at: number, what: string) => `{"savedAt":${at},"what":"${what}"}`;
const onDisk = () => readFileSync(join(root, 'data', 'state.json'), 'utf8');
const settle = () => new Promise((r) => setTimeout(r, 150));

describe('two tabs saving the same state', () => {
  it('a tab that loaded before another one saved cannot overwrite the newer work', async () => {
    const old = await tab();
    await old.getState(); // empty disk: both tabs start from nothing
    const fresh = await tab();
    await fresh.getState();

    fresh.setState(state(1000, 'test sessions'));
    await settle();
    fresh.setState(state(2000, 'more test sessions')); // its own later saves still go through
    await settle();
    expect(onDisk()).toContain('more test sessions');

    let warned = 0;
    old.onStateConflict(() => warned++);
    old.setState(state(3000, 'stale copy')); // newer clock, older content: refused
    await settle();
    expect(onDisk()).toContain('more test sessions');
    expect(old.isStale()).toBe(true);
    expect(warned).toBe(1);
    old.setState(state(4000, 'stale again')); // and it stops trying
    await settle();
    expect(onDisk()).toContain('more test sessions');
  });

  it('at load, a browser copy left by a stale tab loses to the disk; one built on the disk state is kept', async () => {
    const t = await tab();
    const now = JSON.parse(onDisk()).savedAt as number;
    expect(await t.putState(state(now + 5000, 'left behind'), now - 1)).toBe('conflict');
    expect(await t.putState(state(now + 5000, 'continues'), now)).toBe('ok');
    expect(onDisk()).toContain('continues');
  });
});

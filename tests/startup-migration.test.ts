import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener() {} }, document: { addEventListener() {}, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined }));
// A descriptor at version 2 whose step 1 → 2 renames the title: test data only.
vi.mock('../src/engine/nodecore/registry', async (original) => ({
  ...(await original<typeof import('../src/engine/nodecore/registry')>()),
  descriptorOf: (kind: string) => (kind === 'text' ? { version: 2, migrate: { 1: (d: Record<string, unknown>) => ({ ...d, title: `${String(d.title)} (v2)` }) } } : undefined),
}));
import '../src/engine/nodecore/migrate';
import { createSession, useStore } from '../src/store/store';

describe('a saved graph is upgraded when the app loads', () => {
  it('main.tsx imports the migration before the app', () => {
    const main = readFileSync('src/main.tsx', 'utf8');
    const at = main.indexOf("import './engine/nodecore/migrate'");
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(main.indexOf("import { App }"));
  });
  it('a v1 node (no `v`) loads at v2, once; a v2 node is left alone', () => {
    const saved = createSession('old');
    saved.graph = { nodes: [
      { id: 'a', position: { x: 0, y: 0 }, data: { kind: 'text', title: 'A', text: 'x' } },
      { id: 'b', position: { x: 0, y: 0 }, data: { kind: 'text', title: 'B', text: 'x', v: 2 } },
    ], edges: [] } as never;
    const merged = useStore.persist.getOptions().merge!({ sessions: { [saved.id]: saved } }, useStore.getState()) as ReturnType<typeof useStore.getState>;
    const nodes = merged.sessions[saved.id].graph.nodes;
    expect(nodes[0].data).toMatchObject({ title: 'A (v2)', v: 2 });
    expect(nodes[1].data).toMatchObject({ title: 'B', v: 2 });
  });
});

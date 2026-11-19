// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import '../src/store/store';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { check } from '../scripts/check-node-descriptors.mjs';

/** ADR 0031 point 1, open registry: a new node type is ONE file; saved nodes of an older version migrate on load. */
const SCRATCH = join(process.cwd(), 'tests/.scratch-registry');
const FILE = join(SCRATCH, 'zztest.node.ts');
const SOURCE = `import { defineNode } from '../../src/engine/nodecore/descriptor';
declare module '../../src/engine/graphTypes' { interface ExtraNodeKinds { zztest: { kind: 'zztest'; title: string; label?: string } } }
export default defineNode({
  kind: 'zztest',
  version: 2,
  params: ['title', 'label'],
  inputs: () => [],
  output: () => null,
  required: [],
  affects: {},
  evaluate: () => ({ text: null, assets: [], issues: [] }) as never,
  actions: [],
  migrate: { 1: (d) => ({ ...d, label: (d as { title: string }).title }) as never },
});
`;

const load = (): Promise<{ default: never }> => import(/* @vite-ignore */ FILE);

describe('open node registry', () => {
  /** A tree of its own (not the real `types/`, which parallel tests read): the check reads files, the registry gets this one. */
  let root = '';
  const put = (text: string) => { writeFileSync(join(root, 'src/engine/nodecore/types/zztest.node.ts'), text); writeFileSync(FILE, text); };
  beforeAll(() => {
    mkdirSync(SCRATCH, { recursive: true });
    root = mkdtempSync(join(tmpdir(), 'reg-'));
    mkdirSync(join(root, 'src/engine/nodecore'), { recursive: true });
    mkdirSync(join(root, 'src/engine/nodecore/types'), { recursive: true });
    const real = (p: string) => join(process.cwd(), p);
    // The check reads each real descriptor file by name; copying them is enough for its verdict on the tree.
    for (const k of ['text', 'image', 'video', 'audio', 'model3d', 'tool', 'asset', 'ref']) writeFileSync(join(root, `src/engine/nodecore/types/${k}.node.ts`), readFileSync(real(`src/engine/nodecore/types/${k}.node.ts`)));
    writeFileSync(join(root, 'src/engine/graphTypes.ts'), readFileSync(real('src/engine/graphTypes.ts')));
    put(SOURCE);
  });
  afterAll(() => { rmSync(SCRATCH, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); });

  it('adding a type is one descriptor file: the registry and the check accept it with graphTypes.ts untouched', async () => {
    const { collect, descriptors } = await import('../src/engine/nodecore/registry');
    const real = Object.fromEntries(descriptors().map((d) => [d.kind, { default: d }]));
    const all = collect({ ...real, zztest: await load() as never });
    expect(all.get('zztest' as never)?.version).toBe(2);
    expect(all.size).toBe(descriptors().length + 1);
    const { errors, kinds } = check(root);
    expect(errors).toEqual([]);
    expect(kinds).toContain('zztest');
  });

  it('a node saved at version 1 is seen migrated after load; a new one is born current', async () => {
    // The registry only knows the real types, so this test gives the migration the descriptor through the registry's own door.
    const registry = await import('../src/engine/nodecore/registry');
    const zz = (await load()).default;
    vi.spyOn(registry, 'descriptorOf').mockImplementation((k) => (k === ('zztest' as never) ? zz : undefined));
    const { migrateGraph, stampNew } = await import('../src/engine/nodecore/migrate');
    const old = { nodes: [{ id: 'z', position: { x: 0, y: 0 }, data: { kind: 'zztest', title: 'Hola' } }], edges: [] } as never;
    const loaded = migrateGraph(old) as unknown as { nodes: { data: Record<string, unknown> }[] };
    expect(loaded.nodes[0].data).toMatchObject({ title: 'Hola', label: 'Hola', v: 2 });
    expect(migrateGraph(loaded as never)).toBe(loaded); // already current: the same graph, nothing rewritten
    const born = stampNew(old, { nodes: [...(old as { nodes: unknown[] }).nodes, { id: 'n', position: { x: 0, y: 0 }, data: { kind: 'zztest', title: 'Nuevo' } }], edges: [] } as never) as unknown as { nodes: { data: Record<string, unknown> }[] };
    expect(born.nodes[1].data.v).toBe(2);
    expect(born.nodes[0].data.v).toBeUndefined(); // the old node is left for the migration
  });

  it('the check wants one migration per version bump', () => {
    // Version 3 with only 1→2 declared: 2→3 is missing.
    put(SOURCE.replace('version: 2', 'version: 3'));
    expect(check(root).errors).toEqual([expect.stringMatching(/zztest\.node\.ts:\d+: version 3 needs `migrate` for 2→3/)]);
    put(SOURCE);
  });
});

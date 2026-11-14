import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined, putAssetBlob: async () => undefined,
}));
import { allCommands, argsSchema, defineCommand, run, setApprover } from '../src/engine/commands';
import { register } from '../src/engine/commands/registry';
import { createDoc, newVectorLayer } from '../src/engine/design/doc';
import { createSession, useStore } from '../src/store/store';
import type { DesignDoc, Graph } from '../src/engine/types';

// These commands require browser pixels, image decoding or a download.
const skipped: Record<string, string> = {
  'designer.doc.export': 'Browser download and canvas.',
  'designer.doc.save_to_gallery': 'Renders the page into a canvas.',
  'designer.doc.from_asset': 'Decodes an image in the browser.',
  'designer.layer.place_asset': 'Decodes image pixels.',
  'designer.layer.flatten': 'Renders layers into a canvas.',
  'designer.layer.merge_down': 'Renders layers into a canvas.',
  'designer.layer.rasterize': 'Renders a layer into a canvas.',
  'designer.layer.rebase_paint': 'Manipulates a raster buffer.',
  'designer.layer.ensure_paint': 'Creates a raster buffer.',
  'designer.layer.to_asset': 'Reads pixels from a raster buffer.',
  'designer.layer.replace_pixels': 'Decodes image pixels.',
  'designer.layer.place_above': 'Decodes image pixels.',
};

type Schema = { type?: string; const?: unknown; enum?: unknown[]; anyOf?: Schema[]; oneOf?: Schema[]; properties?: Record<string, Schema>; required?: string[]; items?: Schema; minItems?: number; minLength?: number; minimum?: number; exclusiveMinimum?: number; $ref?: string; $defs?: Record<string, Schema> };
type Fixture = ReturnType<typeof fixture>;
function fixture() {
  const session = createSession('Smoke');
  const layer = newVectorLayer('Layer');
  const doc = { ...createDoc('Page', 100, 100), layers: [layer], activeLayerId: layer.id };
  const graph: Graph = { nodes: [
    { id: 'node1', position: { x: 0, y: 0 }, data: { kind: 'text', title: 'A', text: '' } },
    { id: 'node2', position: { x: 100, y: 0 }, data: { kind: 'text', title: 'B', text: '' } },
  ], edges: [{ id: 'edge1', source: 'node1', target: 'node2', sourceHandle: '', targetHandle: 'prompt' }] };
  useStore.setState({ sessions: { [session.id]: { ...session, docs: [doc], activeDocId: doc.id, graph } }, activeSessionId: session.id });
  return { session: session.id, doc: doc.id, layer: layer.id, node: 'node1', target: 'node2', edge: 'edge1' };
}
function value(schema: Schema, ids: Fixture, key = '', root = schema): unknown {
  if (schema.$ref) return value(root.$defs![schema.$ref.split('/').at(-1)!], ids, key, root);
  if (schema.const !== undefined) return schema.const;
  if (schema.enum) return schema.enum[0];
  if (schema.anyOf || schema.oneOf) return value((schema.anyOf ?? schema.oneOf)![0], ids, key, root);
  if (schema.type === 'object') return Object.fromEntries((schema.required ?? []).map((k) => [k, value(schema.properties![k], ids, k, root)]));
  if (schema.type === 'array') return Array.from({ length: schema.minItems ?? 0 }, () => value(schema.items ?? {}, ids, key.replace(/s$/, ''), root));
  if (schema.type === 'string') {
    if (key === 'layer') return ids.layer;
    if (key === 'node' || key === 'source') return ids.node;
    if (key === 'target') return ids.target;
    if (key === 'edge') return ids.edge;
    if (key === 'session') return ids.session;
    return 'x'.repeat(Math.max(0, schema.minLength ?? 0));
  }
  if (schema.type === 'integer' || schema.type === 'number') return schema.minimum ?? (schema.exclusiveMinimum !== undefined ? schema.exclusiveMinimum + 1 : 0);
  if (schema.type === 'boolean') return false;
  return null;
}
function validDoc(doc: DesignDoc) {
  const ids = doc.layers.map((l) => l.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(doc.activeLayerId === null || ids.includes(doc.activeLayerId)).toBe(true);
  for (const l of doc.layers) {
    expect(l).toEqual(expect.objectContaining({ id: expect.any(String), name: expect.any(String), type: expect.any(String), visible: expect.any(Boolean), locked: expect.any(Boolean), opacity: expect.any(Number), blend: expect.any(String) }));
    if (l.type === 'vector') expect(Array.isArray(l.shapes)).toBe(true);
    if (l.type === 'text') expect(l).toEqual(expect.objectContaining({ text: expect.any(String), x: expect.any(Number), y: expect.any(Number), width: expect.any(Number), fontFamily: expect.any(String), fontSize: expect.any(Number), fontWeight: expect.any(Number), color: expect.any(String), align: expect.any(String), lineHeight: expect.any(Number), letterSpacing: expect.any(Number) }));
    if (l.type === 'fx') expect(l).toEqual(expect.objectContaining({ group: expect.any(String), scope: expect.any(String), ops: expect.any(Array) }));
    if (l.type === 'raster') for (const key of ['x', 'y', 'width', 'height', 'pxWidth', 'pxHeight', 'rev'] as const) expect(typeof l[key]).toBe('number');
  }
}
function validState() {
  const state = useStore.getState();
  expect(state.sessions[state.activeSessionId]).toBeDefined();
  for (const session of Object.values(state.sessions)) {
    for (const doc of session.docs) validDoc(doc);
    const { nodes, edges } = session.graph;
    const ids = new Set(nodes.map((n) => n.id));
    expect(ids.size).toBe(nodes.length);
    for (const edge of edges) { expect(ids.has(edge.source)).toBe(true); expect(ids.has(edge.target)).toBe(true); }
    expect(JSON.parse(JSON.stringify(session))).toEqual(session);
  }
}
const fetchSpy = vi.fn(() => { throw new Error('Network is forbidden in the smoke test'); });
const specs = allCommands();
beforeAll(() => { vi.stubGlobal('fetch', fetchSpy); setApprover(({ steps }) => !steps.some((s) => s.effect === 'spend')); });
afterAll(() => { expect(fetchSpy).not.toHaveBeenCalled(); setApprover(null); vi.unstubAllGlobals(); });

describe('schema-generated command smoke', () => {
  it('requires a decision for every registered command and rejects stale skips', () => {
    const ids = new Set(specs.map((s) => s.id));
    for (const [id, reason] of Object.entries(skipped)) { expect(ids.has(id), id).toBe(true); expect(reason.length).toBeGreaterThan(0); }
    expect(specs.length).toBeGreaterThan(0);
  });
  for (const spec of specs) {
    if (skipped[spec.id]) continue;
    it(spec.id, async () => {
      const ids = fixture();
      const schema = argsSchema(spec) as Schema;
      const args = value(schema, ids);
      const on = Object.fromEntries((spec.needs ?? []).map((key) => [key, ids[key]]));
      const before = JSON.stringify(useStore.getState());
      const result = await run({ cmd: spec.id, args, on }, { caller: 'agent' });
      if (spec.effect === 'spend') { expect(result).toMatchObject({ ok: false, error: { code: 'denied' } }); expect(JSON.stringify(useStore.getState())).toBe(before); }
      else if (!result.ok) expect(['invalid', 'ref']).not.toContain(result.error.code);
      validState();
    });
  }
  it('denies a sequence containing spend before any earlier write', async () => {
    const ids = fixture();
    const spend = specs.find((s) => s.effect === 'spend');
    expect(spend).toBeDefined();
    const before = JSON.stringify(useStore.getState());
    const on = Object.fromEntries((spend!.needs ?? []).map((key) => [key, ids[key]]));
    const result = await run({ seq: [
      { cmd: 'sessions.rename', on: { session: ids.session }, args: { title: 'Changed' } },
      { cmd: spend!.id, on, args: value(argsSchema(spend!) as Schema, ids) },
    ] }, { caller: 'agent' });
    expect(result).toMatchObject({ ok: false, error: { code: 'denied' } });
    expect(JSON.stringify(useStore.getState())).toBe(before);
  });
  it('detects a command that breaks the document invariant', async () => {
    const ids = fixture();
    register(defineCommand({ id: 'smoke.break_doc', title: 'Break document', args: z.object({}).strict(), effect: 'write', run: () => {
      useStore.setState((st) => ({ sessions: { ...st.sessions, [ids.session]: { ...st.sessions[ids.session], docs: st.sessions[ids.session].docs.map((d) => ({ ...d, activeLayerId: 'missing' })) } } }));
    } }));
    expect((await run({ cmd: 'smoke.break_doc' }, { caller: 'agent' })).ok).toBe(true);
    expect(() => validState()).toThrow();
  });
});

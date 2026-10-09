import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined }, blobDb: { set: async () => undefined } }));
import { runFxCommands } from '../src/engine/fx/commands';
import { fxParams, FX_DEFS, FX_KINDS } from '../src/engine/fx/defs';
import { fxPlan, fxTarget } from '../src/engine/fx/plan';
import { createDoc, newVectorLayer } from '../src/engine/design/doc';
import { addDoc, getDoc, undoDoc, redoDoc } from '../src/engine/design/actions';
import { runFx } from '../src/engine/design/fx';
import { historyDepth } from '../src/engine/design/history';
import { useStore } from '../src/store/store';
import type { DesignDoc } from '../src/engine/types';
import type { FxLayer } from '../src/engine/fx/types';

/* FX layers (ADR 0011): the commands the layers panel and the agent share, and what each FX acts on. */

function doc(): DesignDoc {
  const a = { ...newVectorLayer('A'), id: 'a' }, b = { ...newVectorLayer('B'), id: 'b', groupId: 'g1' };
  return { ...createDoc('fx', 100, 80), layers: [a, b], groups: [{ id: 'g1', name: 'Folder' }], activeLayerId: 'b' };
}
const fx = (d: DesignDoc, i: number) => d.layers[i] as FxLayer;

describe('the registry', () => {
  it('clamps every value to its range, keeps valid colours and fills defaults', () => {
    expect(fxParams('blur', { radius: 500 })).toEqual({ radius: 100 });
    expect(fxParams('shadow', { color: 'red', opacity: '0.25' })).toMatchObject({ color: '#000000', opacity: 0.25, blur: 12 });
    expect(fxParams('flare', { color: '#AABBCC', junk: 1 })).not.toHaveProperty('junk');
    expect(fxParams('flare', { color: '#AABBCC' }).color).toBe('#aabbcc');
  });
  it('filters are colour and tone; effects are glow, shadow and lens flare', () => {
    expect(FX_KINDS.filter((k) => FX_DEFS[k].group === 'effect')).toEqual(['glow', 'shadow', 'flare']);
    expect(FX_KINDS.filter((k) => !FX_DEFS[k].svg)).toEqual(['flare']);
  });
});

describe('commands', () => {
  it('a filter "on" a layer: an FX layer right above it, in its folder, acting only on it', () => {
    const r = runFxCommands(doc(), [{ do: 'add', group: 'filter', scope: 'layer', above: 'a', ops: [{ kind: 'blur', params: { radius: 6 } }], simple: true }]);
    expect(r.error).toBeUndefined();
    const l = fx(r.doc, 1);
    expect(l).toMatchObject({ type: 'fx', group: 'filter', scope: 'layer', name: 'Blur', simple: true });
    expect(l.ops[0]).toMatchObject({ kind: 'blur', enabled: true, params: { radius: 6 } });
    expect(fxTarget(r.doc.layers, l.id)?.id).toBe('a');
    expect(r.doc.activeLayerId).toBe(l.id);
    const inFolder = runFxCommands(doc(), [{ do: 'add', group: 'effect', scope: 'layer', ops: [{ kind: 'glow' }], simple: true }]);
    expect(inFolder.doc.layers.map((x) => x.id).slice(0, 2)).toEqual(['a', 'b']);
    expect(fx(inFolder.doc, 2).groupId).toBe('g1');
  });
  it('a list runs in order with "last", and changes nothing when one command fails', () => {
    const d = doc();
    const ok = runFxCommands(d, [
      { do: 'add', group: 'filter' },
      { do: 'add_op', layer: 'last', kind: 'saturation', params: { amount: 0.2 } },
      { do: 'add_op', layer: 'last', kind: 'hue', params: { degrees: 90 } },
      { do: 'set', layer: 'last', opacity: 0.5, blend: 'multiply' },
    ]);
    expect(ok.error).toBeUndefined();
    const l = fx(ok.doc, 2);
    expect(l.ops.map((o) => o.kind)).toEqual(['saturation', 'hue']);
    expect(l).toMatchObject({ opacity: 0.5, blend: 'multiply', scope: 'below' });
    const bad = runFxCommands(d, [{ do: 'add', group: 'filter' }, { do: 'add_op', layer: 'last', kind: 'glow' }]);
    expect(bad.error).toMatch(/Command 2: Glow is an effect; "Filters" is a filter layer\. Nothing was changed\./);
    expect(bad.doc).toBe(d);
  });
  it('toggles, reorders, removes and deletes; a second op exposes a simple filter as a full layer', () => {
    let d = runFxCommands(doc(), [{ do: 'add', group: 'filter', ops: [{ kind: 'blur' }], simple: true }]).doc;
    const id = d.layers[2].id;
    d = runFxCommands(d, [{ do: 'add_op', layer: id, kind: 'invert' }]).doc;
    expect(fx(d, 2).simple).toBeUndefined();
    const [blur, invert] = fx(d, 2).ops;
    d = runFxCommands(d, [{ do: 'move_op', layer: id, op: invert.id, to: 0 }, { do: 'set_op', layer: id, op: blur.id, enabled: false, params: { radius: 2 } }]).doc;
    expect(fx(d, 2).ops.map((o) => [o.kind, o.enabled, o.params])).toEqual([['invert', true, { amount: 1 }], ['blur', false, { radius: 2 }]]);
    d = runFxCommands(d, [{ do: 'remove_op', layer: id, op: 'first' }]).doc;
    expect(fx(d, 2).ops.map((o) => o.kind)).toEqual(['blur']);
    d = runFxCommands(d, [{ do: 'delete', layer: id }]).doc;
    expect(d.layers.map((l) => l.id)).toEqual(['a', 'b']);
  });
  it('refuses normal layers, locked FX layers and unknown kinds', () => {
    expect(runFxCommands(doc(), [{ do: 'set', layer: 'a', opacity: 1 }]).error).toMatch(/is a vector layer, not an FX layer/);
    const d = runFxCommands(doc(), [{ do: 'add', group: 'filter' }]).doc;
    const locked = { ...d, layers: d.layers.map((l) => (l.type === 'fx' ? { ...l, locked: true } : l)) };
    expect(runFxCommands(locked, [{ do: 'delete', layer: d.layers[2].id }]).error).toMatch(/is locked/);
    expect(runFxCommands(doc(), [{ do: 'add', group: 'filter', ops: [{ kind: 'sharpen' }] }]).error).toMatch(/unknown filter or effect "sharpen"/);
  });
});

describe('what each FX acts on (the plan shared by canvas and SVG)', () => {
  it('"layer" FX stack on the nearest normal layer; "below" FX act on what comes before; idle FX do nothing', () => {
    let d = doc();
    d = runFxCommands(d, [
      { do: 'add', group: 'filter', scope: 'layer', above: 'a', ops: [{ kind: 'blur' }] },
      { do: 'add', group: 'effect', scope: 'layer', above: 'last', ops: [{ kind: 'glow' }] },
      { do: 'add', group: 'filter', scope: 'below', above: 'b', ops: [{ kind: 'sepia' }] },
      { do: 'add', group: 'filter', scope: 'below', ops: [] },
    ]).doc;
    const plan = fxPlan(d.layers);
    expect(plan.map((s) => s.t)).toEqual(['clip', 'draw', 'below']);
    expect(plan[0].t === 'clip' && plan[0].fx.map((f) => f.ops[0].kind)).toEqual(['blur', 'glow']);
    // A hidden target: its FX go with it. A "layer" FX with nothing under it does nothing.
    expect(fxPlan(d.layers, 'a').map((s) => s.t)).toEqual(['draw', 'below']);
    const orphan = runFxCommands(createDoc('o', 10, 10), [{ do: 'add', group: 'filter', scope: 'layer', ops: [{ kind: 'blur' }] }]).doc;
    expect(fxPlan(orphan.layers)).toEqual([]);
    expect(fxTarget(orphan.layers, orphan.layers[0].id)).toBeNull();
  });
});

describe('through the store: one undo step', () => {
  it('a command list is one undo and one redo', () => {
    const sid = useStore.getState().activeSessionId;
    const d = doc();
    addDoc(sid, d);
    const r = runFx(sid, d.id, [{ do: 'add', group: 'effect', ops: [{ kind: 'glow' }, { kind: 'shadow' }] }, { do: 'set', layer: 'last', name: 'Neon' }]);
    expect(r?.error).toBeUndefined();
    expect(getDoc(sid, d.id)!.layers.map((l) => l.name)).toEqual(['A', 'B', 'Neon']);
    expect(historyDepth(d.id).undo).toBe(1);
    undoDoc(sid, d.id);
    expect(getDoc(sid, d.id)!.layers).toHaveLength(2);
    redoDoc(sid, d.id);
    expect((getDoc(sid, d.id)!.layers[2] as FxLayer).ops.map((o) => o.kind)).toEqual(['glow', 'shadow']);
    expect(runFx(sid, d.id, [{ do: 'delete', layer: 'nope' }])?.error).toMatch(/no layer "nope"/);
    expect(historyDepth(d.id).undo).toBe(1);
  });
});

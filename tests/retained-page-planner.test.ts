import { describe, expect, it } from 'vitest';
import type { FxLayer } from '../src/engine/fx/types';
import { fxPlan } from '../src/engine/fx/plan';
import { retainedPlannerSteps } from '../src/engine/design/retainedPlanner';
import { planFrame, type FrameMemo } from '../src/engine/design/retainedPage';
import type { Layer, RasterLayer } from '../src/engine/types';

const raster = (id: string, x: number, visible = true, opacity = 1, groupId?: string): RasterLayer => ({
  id, name: id, type: 'raster', visible, locked: false, opacity, blend: 'normal',
  x, y: 10, width: 10, height: 10, pxWidth: 10, pxHeight: 10, rev: 1, groupId,
});
const fx = (id: string, scope: FxLayer['scope'], enabled = true, visible = true, groupId?: string): FxLayer => ({
  id, name: id, type: 'fx', visible, locked: false, opacity: 1, blend: 'normal', groupId,
  group: 'effect', scope, ops: [{ id: `${id}-op`, kind: 'blur', enabled, params: { radius: 2 } }],
});
const boxOf = (layer: Layer) => layer.type === 'raster' ? { x0: layer.x, y0: 10, x1: layer.x + 10, y1: 20 } : null;
const memo = (steps: ReturnType<typeof retainedPlannerSteps>): FrameMemo => ({
  W: 100, H: 100, scale: 1, background: undefined, fontEpoch: 0, base: null, steps,
});
const planner = (layers: Layer[], composition = fxPlan(layers)) => retainedPlannerSteps(layers, composition, 1, boxOf, () => [], () => null);

describe('retained page stable planner steps', () => {
  it('keeps hidden and zero-opacity normal layers as local invalidations', () => {
    const shown = raster('paint', 12), hidden = { ...shown, visible: false }, transparent = { ...shown, opacity: 0 };
    const before = planner([shown]);
    expect(fxPlan([shown])).toHaveLength(1);
    expect(fxPlan([hidden])).toHaveLength(0);
    expect(planner([hidden]).map((s) => s.id)).toEqual(['paint']);
    expect(planFrame(memo(before), memo(planner([hidden])))).toEqual({ kind: 'region', rect: { x0: 12, y0: 10, x1: 22, y1: 20 }, reach: 0 });
    expect(planFrame(memo(before), memo(planner([transparent])))).toEqual({ kind: 'region', rect: { x0: 12, y0: 10, x1: 22, y1: 20 }, reach: 0 });
  });

  it('preserves folder member boxes and attached FX reach when a group is hidden', () => {
    const a = raster('folder-a', 10, true, 1, 'folder');
    const layerFx = fx('folder-fx', 'layer', true, true, 'folder');
    const b = raster('folder-b', 40, true, 1, 'folder');
    const layers = [a, layerFx, b];
    const hidden = layers.map((l) => ({ ...l, visible: false } as Layer));
    const before = planner(layers), after = planner(hidden);
    expect(before.map((s) => s.id)).toEqual(['folder-a', 'folder-b']);
    expect(after.map((s) => s.id)).toEqual(['folder-a', 'folder-b']);
    expect(fxPlan(layers).map((s) => s.t)).toEqual(['clip', 'draw']);
    expect(fxPlan(hidden)).toEqual([]);
    expect(planFrame(memo(before), memo(after))).toEqual({ kind: 'region', rect: { x0: 4, y0: 4, x1: 50, y1: 26 }, reach: 0 });
  });

  it('invalidates a temporary hideLayerId as an empty slot and restores its old box when shown', () => {
    const layer = raster('temporary-hide', 25), layers = [layer];
    const shownSteps = fxPlan(layers), hiddenSteps = fxPlan(layers, layer.id);
    const shown = planner(layers, shownSteps), hidden = planner(layers, hiddenSteps), shownAgain = planner(layers, shownSteps);
    expect(shownSteps.map((s) => s.t)).toEqual(['draw']);
    expect(hiddenSteps).toEqual([]);
    expect(shown.map((s) => s.id)).toEqual(['temporary-hide']);
    expect(hidden.map((s) => s.id)).toEqual(['temporary-hide']);
    expect(planFrame(memo(shown), memo(hidden))).toEqual({ kind: 'region', rect: { x0: 25, y0: 10, x1: 35, y1: 20 }, reach: 0 });
    expect(planFrame(memo(hidden), memo(shownAgain))).toEqual({ kind: 'region', rect: { x0: 25, y0: 10, x1: 35, y1: 20 }, reach: 0 });
  });

  it('retains inactive below FX slots and repaints only their actual reach when enabled', () => {
    const layer = raster('under', 30), inactive = fx('below', 'below', false), active = { ...inactive, ops: inactive.ops.map((op) => ({ ...op, enabled: true })) };
    const beforeLayers = [layer, inactive], afterLayers = [layer, active];
    const before = planner(beforeLayers), after = planner(afterLayers);
    expect(before.map((s) => s.id)).toEqual(['under', 'below']);
    expect(after.map((s) => s.id)).toEqual(['under', 'below']);
    expect(fxPlan(beforeLayers).map((s) => s.t)).toEqual(['draw']);
    expect(fxPlan(afterLayers).map((s) => s.t)).toEqual(['draw', 'below']);
    expect(planFrame(memo(before), memo(after))).toEqual({ kind: 'region', rect: { x0: 24, y0: 4, x1: 46, y1: 26 }, reach: 6 });
  });

  it('keeps layer FX order in the original composition plan while memoizing order changes locally', () => {
    const layer = raster('ordered', 15), blurA = fx('blur-a', 'layer'), blurB = fx('blur-b', 'layer');
    const forward = [layer, blurA, blurB], reverse = [layer, blurB, blurA];
    const forwardClip = fxPlan(forward).find((s) => s.t === 'clip');
    const reverseClip = fxPlan(reverse).find((s) => s.t === 'clip');
    expect(forwardClip?.t === 'clip' ? forwardClip.fx.map((f) => f.id) : null).toEqual(['blur-a', 'blur-b']);
    expect(reverseClip?.t === 'clip' ? reverseClip.fx.map((f) => f.id) : null).toEqual(['blur-b', 'blur-a']);
    const before = planner(forward), after = planner(reverse);
    expect(before.map((s) => s.id)).toEqual(after.map((s) => s.id));
    expect(planFrame(memo(before), memo(after))).toEqual({ kind: 'region', rect: { x0: 3, y0: 0, x1: 37, y1: 32 }, reach: 0 });
  });
});

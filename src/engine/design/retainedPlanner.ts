import type { FxLayer } from '../fx/types';
import { fxActive, type FxStep } from '../fx/plan';
import type { Layer } from '../types';
import { fxLayerKey, stepSig, type Rect, type StepSig } from './retainedPage';

/** Stable memo steps for the editor; composition still uses the original, active-only fxPlan result. */
export function retainedPlannerSteps(
  layers: Layer[],
  compositionSteps: FxStep[],
  scale: number,
  boxOf: (layer: Layer) => Rect | null,
  versionsOf: (layer: Layer) => unknown[],
  dirtyOf: (layer: Layer) => Rect | null,
  placementOf: (layer: Layer) => Rect | null = boxOf,
): StepSig[] {
  const out: StepSig[] = [];
  const composedLayers = new Set(compositionSteps.flatMap((step) => step.t === 'below' ? [] : [step.layer.id]));
  const composedBelow = new Set(compositionSteps.flatMap((step) => step.t === 'below' ? [step.fx.id] : []));
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    if (layer.type === 'fx') {
      if (layer.scope === 'below') {
        const sig = stepSig({ t: 'below', fx: layer }, scale, boxOf, versionsOf, dirtyOf, placementOf);
        out.push({ ...sig, id: layer.id, key: [layer.id, composedBelow.has(layer.id), ...fxLayerKey([layer])], margin: fxActive(layer) ? sig.margin : 0 });
      }
      continue;
    }

    // Match fxPlan's target rule, but retain inactive layer FX so toggling one only changes this box.
    const attached: FxLayer[] = [];
    while (layers[i + 1]?.type === 'fx' && (layers[i + 1] as FxLayer).scope === 'layer') attached.push(layers[++i] as FxLayer);
    const active = attached.filter(fxActive);
    const compositionStep: FxStep = active.length ? { t: 'clip', layer, fx: active } : { t: 'draw', layer };
    const sig = stepSig(compositionStep, scale, boxOf, versionsOf, dirtyOf, placementOf);
    const allFx = fxLayerKey(attached);
    const render = [...(sig.render ?? []), 'planner-fx', ...allFx];
    const included = composedLayers.has(layer.id);
    out.push({ ...sig, id: layer.id, render: [...render, included], key: [...sig.key, 'planner-fx', ...allFx, 'composed', included] });
  }
  return out;
}

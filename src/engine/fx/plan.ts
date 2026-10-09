import type { Layer } from '../types';
import type { FxLayer } from './types';

/*
 * Which FX acts on what, shared by the canvas renderer and the SVG export so both agree (ADR 0011, D3):
 * - scope 'below': everything drawn before it;
 * - scope 'layer': the nearest normal layer under it; a run of them stacks on that layer, bottom first.
 * An FX that is hidden, transparent or has no op on does nothing; a 'layer' FX with no target does nothing.
 */

export type FxStep =
  | { t: 'draw'; layer: Exclude<Layer, FxLayer> }
  | { t: 'clip'; layer: Exclude<Layer, FxLayer>; fx: FxLayer[] }
  | { t: 'below'; fx: FxLayer };

export const fxActive = (l: FxLayer) => l.visible && l.opacity > 0 && l.ops.some((o) => o.enabled);

export function fxPlan(layers: Layer[], hideLayerId?: string): FxStep[] {
  const steps: FxStep[] = [];
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    if (l.type === 'fx') {
      if (l.scope === 'below' && fxActive(l)) steps.push({ t: 'below', fx: l });
      continue;
    }
    const fx: FxLayer[] = [];
    while (layers[i + 1]?.type === 'fx' && (layers[i + 1] as FxLayer).scope === 'layer') {
      const f = layers[++i] as FxLayer;
      if (fxActive(f)) fx.push(f);
    }
    if (l.id === hideLayerId || !l.visible || l.opacity <= 0) continue;
    steps.push(fx.length ? { t: 'clip', layer: l, fx } : { t: 'draw', layer: l });
  }
  return steps;
}

/** The layer a 'layer'-scoped FX acts on, for the panel ("Applies to …"); null when it has none. */
export function fxTarget(layers: Layer[], fxId: string): Layer | null {
  let i = layers.findIndex((l) => l.id === fxId);
  if (i < 0 || layers[i].type !== 'fx' || (layers[i] as FxLayer).scope !== 'layer') return null;
  while (--i >= 0) {
    const l = layers[i];
    if (l.type !== 'fx') return l;
    if (l.scope !== 'layer') return null;
  }
  return null;
}

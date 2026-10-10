import type { LayerBase } from '../types';

/* FX layers (ADR 0011): non-destructive filters and effects. One registry (fx/defs.ts) feeds the Designer, the `fx`
 * operation on assets and nodes, and the agent's designer_fx tool. */

/** Filters change colour and tone; effects add light or shape. */
export type FxGroup = 'filter' | 'effect';

export type FxKind =
  | 'brightness' | 'contrast' | 'saturation' | 'hue' | 'grayscale' | 'sepia' | 'invert' | 'blur' | 'levels' | 'curves'
  | 'glow' | 'shadow' | 'flare';

export type FxValue = number | string;

export interface FxOp {
  id: string;
  kind: FxKind;
  enabled: boolean;
  params: Record<string, FxValue>;
}

/** below: everything under the layer in the document; layer: only the nearest normal layer under it (a clip). */
export type FxScope = 'below' | 'layer';

export interface FxLayer extends LayerBase {
  type: 'fx';
  group: FxGroup;
  scope: FxScope;
  /** Applied bottom to top: the first op runs first. */
  ops: FxOp[];
  /** Made from a single filter or effect ("Blur", "Glow"); editing it in full clears the flag. */
  simple?: boolean;
}

/*
 * What every object carries besides its geometry (docs/propuesta-objetos-y-profundidad.md, sections 2 and 4).
 * All optional: documents saved before these fields read the same.
 */

import type { BlendMode } from './types';

/** How a container (layer or group) orders what it holds. Only 'list' exists today: the list order, bottom first. */
export type DepthOrder = 'list' | 'depth' | 'mixed';

/** Depth lives in the object, beside x and y, so it travels with copy, duplicate, undo and moves between layers. */
export interface ObjectDepth {
  /** Geometric depth (perspective, parallax); 0 when absent. It does not decide who covers whom while the order is 'list'. */
  z?: number;
  /** Containers only: absent = 'list'. */
  depthOrder?: DepthOrder;
}

/** A shape or a group in the objects list. */
export interface ObjectMeta extends ObjectDepth {
  /** The user's name for it; absent = a generated one ("Rectangle 2"). */
  name?: string;
  /** Not drawn, not exported, not picked. A hidden group hides its members. */
  hidden?: boolean;
  /** Drawn and exported, but not picked or changed on the canvas. A locked group locks its members. */
  locked?: boolean;
}

/**
 * Shapes group in a vector layer (SVG <g>), nesting via parentId. A group may carry its own opacity and blend mode, as
 * an SVG <g opacity style="mix-blend-mode"> or an Illustrator group: its members are composed together first and laid
 * down once. Absent = 1 and normal. (Effects on a group have no field yet: FX are still layers.)
 */
export interface ObjectGroup extends ObjectMeta { id: string; name: string; parentId?: string; collapsed?: boolean; opacity?: number; blend?: BlendMode }

import { move } from './move';
import { hand } from './hand';
import { select } from './select';
import { eyedropper } from './eyedropper';
import { fill } from './fill';
import { gradient } from './gradient';
import { lineart } from './lineart';
import { text } from './text';
import { ruler } from './ruler';
import { shapeBuilder } from './shapeBuilder';
import { brush, eraser } from './paint';
import { arc, arrow, chord, curve, ellipse, line, polygon, rect, sector, ShapeSettings, shapeGestures, star } from './shape';
import { guideGestures } from './guides';
import type { Drag, GestureHandler, GestureMap, PointerHover, ToolDescriptor } from './types';
import type { StageState } from '../stageState';
import type { DesignTool } from '../../../engine/design/rules';
import { snapIdleFeed } from '../snapIdle';

export const designerTools: Record<DesignTool, ToolDescriptor> = {
  move, hand, select, eyedropper, brush, eraser, fill, gradient, lineart,
  rect, ellipse, polygon, star, sector, arc, chord, line, curve, arrow,
  text, ruler, shapeBuilder,
};

const gestures: GestureMap = {
  ...move.gestures,
  ...hand.gestures,
  ...select.gestures,
  ...eyedropper.gestures,
  ...brush.gestures,
  ...gradient.gestures,
  ...lineart.gestures,
  ...shapeGestures,
  ...guideGestures,
};

function handlers<K extends Drag['kind']>(kind: K) {
  // The lookup and the handler share this discriminator at both call sites.
  return gestures[kind] as GestureHandler<Extract<Drag, { kind: K }>>;
}

export function moveGesture(state: StageState, d: Drag, p: PointerHover['p'], e: React.PointerEvent, next: (e: React.PointerEvent) => void) {
  if (d.kind !== 'sample') snapIdleFeed(d, e, next);
  handlers(d.kind).move?.({ state, d, p, e });
}

export function releaseGesture(state: StageState, d: Drag, e?: React.PointerEvent) {
  const gesture = handlers(d.kind);
  if (!gesture.skipReleaseGuides) state.showGuides({});
  gesture.up?.({ state, d, e });
}

const unknownTool: ToolDescriptor = { settings: ShapeSettings };

/** Saved UI preferences can carry a tool name from another app version. */
export function getDesignerTool(tool: string): ToolDescriptor {
  return Object.hasOwn(designerTools, tool) ? designerTools[tool as DesignTool] : unknownTool;
}

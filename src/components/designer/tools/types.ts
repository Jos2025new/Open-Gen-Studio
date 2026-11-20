import type { DesignDoc, Layer, Stroke, TextLayer } from '../../../engine/types';
import type { EditMarqueeDrag } from '../StageEditMarquee';
import type { ObjGroup } from '../stageObjMove';
import type { SampleDrag } from '../StageSample';
import type { GuideAxis } from '../../../engine/design/guides';
import type { gestureBuffers } from '../../../engine/design/affine';
import type { SelectGesture } from '../StageSelect';
import type { PixelMove } from '../../../engine/design/pixelMove';
import type { StagePaintGesture } from '../StagePaintCommit';
import type { ComponentType } from 'react';
import type { Handle, StageState, XformOp } from '../stageState';
import type { ShapeDrag } from './shape';
import type { View } from '../../../engine/design/viewCoordinates';
import type { QuickKind } from '../QuickSettings';

export type Drag =
  | { kind: 'pixelMove'; move: PixelMove; start: { x: number; y: number } }
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | { kind: 'move'; layerId: string; startX: number; startY: number; base: Layer; others?: Layer[]; again?: boolean; moved?: boolean; ctrlToggle?: string; pre?: DesignDoc }
  | { kind: 'xform'; pre?: DesignDoc; moved?: boolean; op: XformOp; h: Handle; startX: number; startY: number; cx: number; cy: number; box: { x: number; y: number; w: number; h: number }; bases: Array<{ layer: Layer; ids: string[] | null; buffers: ReturnType<typeof gestureBuffers> }> }
  | { kind: 'scale'; layerId: string; ax: number; ay: number; startDist: number; base: Layer; startX: number; startY: number; pre: DesignDoc; moved?: boolean }
  | ({ kind: 'objMove'; startX: number; startY: number; again?: boolean; moved?: boolean; ctrlToggle?: string; pre?: DesignDoc; others?: ObjGroup[] } & ObjGroup)
  | EditMarqueeDrag
  | StagePaintGesture
  | { kind: 'guide'; axis: GuideAxis; index?: number; at: number }
  | { kind: 'gradient'; x0: number; y0: number; x1: number; y1: number }
  | SelectGesture
  | SampleDrag
  | ShapeDrag
  | { kind: 'stroke'; layerId: string | null; points: Array<[number, number, number]>; pen: boolean }
  | { kind: 'bend'; layerId: string; stroke: number; point: number; startX: number; startY: number; base: Stroke[]; influence?: number; recorded?: boolean };

type Point = { x: number; y: number };
export interface PointerHover {
  state: StageState;
  p: Point;
  e: React.PointerEvent;
}

export interface PointerPress extends PointerHover {
  current: DesignDoc;
  act: Layer | null;
}

export interface GestureHandler<D extends Drag> {
  move?: (args: PointerHover & { d: D }) => void;
  up?: (args: { state: StageState; d: D; e?: React.PointerEvent }) => void;
  skipReleaseGuides?: boolean;
}

export type GestureMap = {
  [K in Drag['kind']]: GestureHandler<Extract<Drag, { kind: K }>>;
};

export interface ToolSettingsProps {
  sessionId: string;
  doc: DesignDoc;
  selectedCurve: { layerId: string; strokeId: string } | null;
  compact: boolean;
  modeToggle: boolean;
  card: boolean;
}

export interface ToolDescriptor {
  down?: (args: PointerPress) => void;
  hover?: (args: PointerHover) => void;
  doubleClick?: (state: StageState, e: React.MouseEvent) => void;
  gestures?: Partial<GestureMap>;
  pan?: boolean;
  objectEditing?: boolean;
  curveHandles?: 'always' | 'edit';
  overlay?: ComponentType<{ view: View; sessionId: string; doc: DesignDoc }>;
  placeStrokeRuler?: boolean;
  showBlockReason?: boolean;
  cursor?: (blocked: string | null) => string;
  quick?: readonly QuickKind[];
  hideSelectionChip?: boolean;
  settings?: ComponentType<ToolSettingsProps>;
  bareSettings?: boolean;
  hideContext?: boolean;
  contextTarget?: (layer: Layer | null) => string | null;
  selectionContext?: boolean;
  textContext?: ComponentType<{ sessionId: string; docId: string; layer: TextLayer }>;
  contextTail?: ComponentType<{ docId: string }>;
}

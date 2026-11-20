import type { StageState } from '../stageState';
import type { GestureMap, ToolDescriptor } from './types';

export function beginPan({ drag, view }: StageState, e: React.PointerEvent) {
  drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
}

const gestures = {
  pan: {
    move({ state: { setView }, d, e }) {
      setView((v) => ({ ...v, x: d.vx + (e.clientX - d.sx), y: d.vy + (e.clientY - d.sy) }));
    },
  },
} satisfies Partial<GestureMap>;

export const hand = {
  pan: true,
  gestures,
  cursor: () => 'grab',
  hideContext: true,
  bareSettings: true,
} satisfies ToolDescriptor;

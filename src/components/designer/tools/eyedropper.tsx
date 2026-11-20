import type { DesignDoc } from '../../../engine/types';
import { beginSample, moveSample, sampleUp, samplingGesture, showLoupe } from '../StageSample';
import { SamplerSettings } from '../SamplerSettings';
import type { StageState } from '../stageState';
import type { GestureMap, ToolDescriptor } from './types';

/** Color sampling can preempt another tool when the sampling modifiers are held. */
export function trySample({ tool, drag, loupe, view }: StageState, current: DesignDoc, p: { x: number; y: number }, e: React.PointerEvent): boolean {
  if (samplingGesture(tool, e)) {
    const s = beginSample(current, p, tool, e);
    if (s) { drag.current = s; showLoupe(loupe, view, p, s.color); }
    return true;
  }
  return false;
}

const gestures = {
  sample: {
    skipReleaseGuides: true,
    move({ state: { loupe, view, doc }, d, p }) {
      showLoupe(loupe, view, p, moveSample(d, doc, p));
    },
    up({ state: { loupe, doc, toDoc }, d, e }) {
      sampleUp(loupe, d, doc, e?.type === 'pointercancel' || !e ? null : toDoc(e.clientX, e.clientY));
    },
  },
} satisfies Partial<GestureMap>;

export const eyedropper = {
  gestures,
  quick: ['sampleRadius', 'sampleSource', 'colorPair'],
  settings: SamplerSettings,
  bareSettings: true,
} satisfies ToolDescriptor;

import { OPS } from '../ops';
import type { OutputKind, PlanContext, RawStep } from '../plan';
import type { OpId, PlanStep } from '../types';

type FrameOf = (ref: string, which: 'first' | 'last', forId: string) => string;
interface RawStepInfo {
  output(step: RawStep, ctx: PlanContext): OutputKind | undefined | Promise<OutputKind | undefined>;
  clip?: boolean;
  repairFrames?(step: RawStep, isVideo: (ref: string | undefined) => boolean, frameOf: FrameOf, adjustments: string[]): void;
}

export const RAW_STEP_INFO: Record<PlanStep['kind'], RawStepInfo> = {
  text: { output: () => 'text' },
  image: { output: () => 'image' },
  model3d: { output: () => 'model3d' },
  video: {
    output: () => 'video',
    clip: true,
    repairFrames(s, isVideo, frameOf, adjustments) {
      if (s.first_frame && isVideo(s.first_frame)) {
        adjustments.push(`${s.id}: first_frame ${s.first_frame} is a clip → its last frame`);
        s.first_frame = frameOf(s.first_frame, 'last', s.id!);
      }
      if (s.last_frame && isVideo(s.last_frame)) {
        adjustments.push(`${s.id}: last_frame ${s.last_frame} is a clip → its first frame`);
        s.last_frame = frameOf(s.last_frame, 'first', s.id!);
      }
    },
  },
  audio: {
    // A lyrics model answers with text, through prompt_from / lyrics_from.
    async output(s, ctx) {
      const ref = s.model?.trim() || ctx.defaultModel('audio', false);
      return ref && (await ctx.getModel(ref))?.model.textOutput ? 'text' : 'audio';
    },
  },
  op: { output: (s) => s.op && s.op in OPS ? OPS[s.op as OpId].output : undefined },
  layer: { output: () => 'layer' },
};

export function rawStepInfo(step: RawStep): RawStepInfo | undefined {
  const kind = step.kind ?? '';
  return Object.hasOwn(RAW_STEP_INFO, kind) ? RAW_STEP_INFO[kind as PlanStep['kind']] : undefined;
}

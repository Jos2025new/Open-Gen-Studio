import type { PlanStep } from '../types';
import type { NormalizeStep } from './env';
import { normalizeAudio } from './audio';
import { normalizeLayer } from './layer';
import { normalizeMedia } from './media';
import { normalizeOp } from './op';
import { normalizeText } from './text';

/** Every step kind's normalizer. The record is exhaustive over `PlanStep['kind']`: a new kind fails the type check until it has its file here. */
export const NORMALIZE_STEP: Record<PlanStep['kind'], NormalizeStep> = {
  text: normalizeText,
  image: normalizeMedia,
  model3d: normalizeMedia,
  video: normalizeMedia,
  audio: normalizeAudio,
  op: normalizeOp,
  layer: normalizeLayer,
};

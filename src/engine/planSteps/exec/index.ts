import type { PlanStep } from '../../types';
import { estimateAudio, runAudio } from './audio';
import type { EstimateStep, RunStep } from './env';
import { estimateLayer, runLayer } from './layer';
import { estimateImage, estimateModel3d, estimateVideo, runImage, runModel3d, runVideo } from './media';
import { estimateOperation, runOp } from './op';
import { estimateText, runText } from './text';

/** What each step kind costs and how it runs. The records are exhaustive over `PlanStep['kind']`: a new kind fails the type check until it has its entries. */
export const ESTIMATE_STEP: { [K in PlanStep['kind']]: EstimateStep<K> } = {
  text: estimateText,
  image: estimateImage,
  model3d: estimateModel3d,
  video: estimateVideo,
  audio: estimateAudio,
  op: estimateOperation,
  layer: estimateLayer,
};

export const RUN_STEP: { [K in PlanStep['kind']]: RunStep<K> } = {
  text: runText,
  image: runImage,
  model3d: runModel3d,
  video: runVideo,
  audio: runAudio,
  op: runOp,
  layer: runLayer,
};

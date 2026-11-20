import { OPS } from '../ops';
import type { OutputKind } from '../plan';
import type { ImageStep, Model3dStep, PlanStep, StepRef, VideoStep } from '../types';

type Kind = PlanStep['kind'];
type StepOf<K extends Kind> = Extract<PlanStep, { kind: K }>;

interface StepInfo<K extends Kind> {
  output(step: StepOf<K>): OutputKind;
  ownDeps(step: StepOf<K>): StepRef[];
  afterInOwnDeps?: boolean;
  imageAspect?(step: StepOf<K>): string | undefined;
  candidateCount?(step: StepOf<K>): number | undefined;
  candidateLabel?: string;
  firstFrame?(step: StepOf<K>): StepRef | undefined;
  traceInputs?(step: StepOf<K>): { references?: StepRef[]; firstFrame?: StepRef; lastFrame?: StepRef };
  editPrompts?(step: StepOf<K>, edit: (prompt: string) => string): void;
  countOrDuration?(step: StepOf<K>, choice?: { count?: number; duration?: number }): { count?: number; duration?: number };
  serial?: boolean;
  nodePlanProblem?: string;
  resumedOutput?(step: StepOf<K>): { assetIds: string[]; text: string };
  prompts?(step: StepOf<K>): string[];
  visual?: boolean;
  contentRefs?(step: StepOf<K>): StepRef[];
  graphOutput?(step: StepOf<K>): OutputKind;
}

const refs = (step: ImageStep | Model3dStep) => [...(step.promptFrom ? [step.promptFrom] : []), ...step.refs];
const present = (ref: StepRef | undefined): ref is StepRef => Boolean(ref);
const videoRefs = (step: VideoStep) => [step.firstFrame, step.lastFrame, ...(step.refs ?? [])];
const prompt = (step: { prompt: string }) => [step.prompt];
const traceRefs = (step: ImageStep | Model3dStep) => ({ references: step.refs });

export const STEP_INFO: { [K in Kind]: StepInfo<K> } = {
  text: {
    output: () => 'text', ownDeps: () => [],
    resumedOutput: (step) => ({ assetIds: [], text: step.text }),
  },
  image: {
    output: () => 'image', ownDeps: refs, contentRefs: (step) => step.refs,
    imageAspect: (step) => step.settings.aspect,
    candidateCount: (step) => step.settings.count,
    traceInputs: traceRefs,
    editPrompts: (step, edit) => { step.prompt = edit(step.prompt); },
    countOrDuration: (step, choice) => ({ count: choice?.count ?? step.settings.count }),
    prompts: prompt, visual: true,
  },
  model3d: { output: () => 'model3d', ownDeps: refs, contentRefs: (step) => step.refs, traceInputs: traceRefs, prompts: prompt },
  video: {
    output: () => 'video',
    ownDeps: (step) => [step.promptFrom, ...videoRefs(step)].filter(present),
    contentRefs: (step) => videoRefs(step).filter(present),
    candidateCount: (step) => step.settings.count,
    candidateLabel: 'several clips',
    firstFrame: (step) => step.firstFrame,
    traceInputs: (step) => ({ references: step.refs, firstFrame: step.firstFrame, lastFrame: step.lastFrame }),
    editPrompts: (step, edit) => {
      step.prompt = edit(step.prompt);
      if (step.settings.shots) step.settings.shots = step.settings.shots.map((shot) => ({ ...shot, prompt: edit(shot.prompt) }));
    },
    countOrDuration: (step, choice) => ({ duration: choice?.duration ?? step.settings.duration }),
    prompts: (step) => [step.prompt, ...(step.settings.shots?.map((shot) => shot.prompt) ?? [])],
    visual: true,
  },
  audio: {
    output: (step) => step.textOutput ? 'text' : 'audio',
    ownDeps: (step) => [step.promptFrom, step.lyricsFrom].filter(present),
    prompts: prompt,
  },
  op: {
    output: (step) => OPS[step.op].output,
    graphOutput: (step) => OPS[step.op].output,
    ownDeps: (step) => [step.input, ...(step.more ?? []), ...(step.refs ?? []).map((r) => r.ref),
      ...(typeof step.params?.music === 'string' && step.params.music ? [step.params.music] : [])],
    contentRefs: (step) => [step.input, ...(step.more ?? []),
      ...(typeof step.params.music === 'string' && step.params.music ? [step.params.music] : [])],
    candidateCount: (step) => Number(step.params.count ?? 1),
    prompts: (step) => [Object.values(step.params).join(' ')],
  },
  layer: {
    output: () => 'layer',
    ownDeps: (step) => [...(step.source ? [step.source] : []), ...(step.after ?? [])],
    contentRefs: (step) => step.source ? [step.source] : [],
    afterInOwnDeps: true,
    serial: true,
    nodePlanProblem: 'Layer steps are not valid in the Node workspace.',
  },
};

/** Bind the descriptor to the same step whose discriminant selected it. */
export function stepInfo(step: PlanStep) {
  const info = STEP_INFO[step.kind] as StepInfo<Kind>;
  const own = () => info.ownDeps(step);
  return {
    ownDeps: own,
    deps: () => info.afterInOwnDeps ? own() : [...own(), ...(step.after ?? [])],
    output: () => info?.output(step),
    graphOutput: () => info?.graphOutput?.(step) ?? step.kind,
    imageAspect: () => info?.imageAspect?.(step),
    hasCandidates: () => (info?.candidateCount?.(step) ?? 1) > 1,
    candidateLabel: info?.candidateLabel ?? 'several images',
    firstFrame: () => info?.firstFrame?.(step),
    traceInputs: () => info?.traceInputs?.(step),
    editPrompts: (edit: (prompt: string) => string) => info?.editPrompts?.(step, edit),
    countOrDuration: (choice?: { count?: number; duration?: number }) => info?.countOrDuration?.(step, choice),
    prompts: () => info?.prompts?.(step) ?? [],
    contentRefs: () => info?.contentRefs?.(step) ?? [],
    visual: info?.visual ?? false,
    nodePlanProblem: info?.nodePlanProblem,
    resumedOutput: () => info?.resumedOutput?.(step) ?? { assetIds: [], layerId: null },
  };
}

/** Select steps for a feature that specifically operates on one existing kind. */
export function isStepKind<K extends Kind>(step: PlanStep, kind: K): step is StepOf<K> {
  return step.kind === kind;
}

export function isVisualStep(step: PlanStep): step is ImageStep | VideoStep {
  return STEP_INFO[step.kind]?.visual === true;
}

export function isJoin(step: PlanStep): step is StepOf<'op'> {
  return isStepKind(step, 'op') && OPS[step.op].multiInput === true;
}

/** These steps apply in plan order and only start when other work has drained. */
export function serialStep(step: PlanStep | undefined): boolean {
  return step != null && STEP_INFO[step.kind]?.serial === true;
}

import { routeVideoInputs, videoInputProblem } from '../params';
import type { GraphNodeData, ImageStep, Model3dStep, ModelSchema, PlanStep, StepRef, VideoStep } from '../types';

type Kind = PlanStep['kind'];
type Link = (ref: StepRef | undefined, port: string) => void;
type RefKind = (ref: StepRef) => string | undefined;
interface GraphStep<K extends Kind> {
  node(step: Extract<PlanStep, { kind: K }>): GraphNodeData | null;
  previewRefs?(step: Extract<PlanStep, { kind: K }>): StepRef[];
  inputProblem?(step: Extract<PlanStep, { kind: K }>, schema: ModelSchema, subjects: number, kindOf: RefKind): string | undefined;
  needsPrompt?(step: Extract<PlanStep, { kind: K }>): boolean;
  link?(step: Extract<PlanStep, { kind: K }>, link: Link, kindOf: RefKind): void;
}

const mediaNode = ({ kind, title, prompt, modelRef, settings }: ImageStep | Model3dStep | VideoStep): GraphNodeData =>
  ({ kind, title, prompt, modelRef, settings, outputIndex: 0 });
const imageLinks = (step: ImageStep | Model3dStep, link: Link, kindOf: RefKind) => {
  link(step.promptFrom, 'prompt');
  step.refs.forEach((ref) => link(ref, kindOf(ref) === 'video' ? 'clip' : 'ref'));
};

type MediaStep = ImageStep | Model3dStep | VideoStep;
const missingPrompt = (step: MediaStep) => !step.prompt.trim() && !step.promptFrom;
const needsImagePrompt = (step: ImageStep | Model3dStep) => missingPrompt(step) && !hasPromptAlternative(step.kind, step.refs?.length);
const previewImageRefs = (step: ImageStep | Model3dStep) => step.refs ?? [];

function videoProblem(step: VideoStep, schema: ModelSchema, subjects: number, kind: RefKind): string | undefined {
  const refs = step.refs ?? [];
  const images = refs.filter(r => kind(r) === 'image');
  const videos = refs.filter(r => kind(r) === 'video');
  const audios = refs.filter(r => kind(r) === 'audio');
  const routed = routeVideoInputs(schema.slots, images, videos, step.firstFrame);
  return videoInputProblem(schema.slots, { firstFrame: Boolean(routed.firstFrame), lastFrame: Boolean(step.lastFrame), sourceVideo: false, images: routed.images.length + subjects, videos: routed.videos.length, audios: audios.length, resolution: step.settings.resolution }) ?? undefined;
}

export const GRAPH_STEP: { [K in Kind]: GraphStep<K> } = {
  text: { node: (s) => ({ kind: 'text', title: s.title, text: s.text }) },
  image: {
    node: mediaNode, link: imageLinks, needsPrompt: needsImagePrompt, previewRefs: previewImageRefs,
    inputProblem: (s, schema, subjects) => s.refs.length + subjects < (schema.slots.images?.min ?? 0) + (schema.slots.source ? 1 : 0)
      ? 'the model needs an input image.' : undefined,
  },
  model3d: { node: mediaNode, link: imageLinks, needsPrompt: needsImagePrompt, previewRefs: previewImageRefs },
  video: {
    node: mediaNode,
    needsPrompt: (s) => missingPrompt(s) && !hasPromptAlternative(s.kind, s.refs?.length, Boolean(s.firstFrame)),
    previewRefs: (s) => [s.firstFrame, s.lastFrame, ...(s.refs ?? [])].filter((r): r is StepRef => Boolean(r)),
    inputProblem: videoProblem,
    link: (s, link, kindOf) => {
      link(s.promptFrom, 'prompt');
      link(s.firstFrame, 'first');
      link(s.lastFrame, 'last');
      (s.refs ?? []).forEach((ref) => {
        link(ref, kindOf(ref) === 'audio' ? 'audio' : kindOf(ref) === 'video' ? 'refVideo' : 'ref');
      });
    },
  },
  audio: {
    inputProblem: (s, schema) => s.lyricsFrom && !schema.params.some(p => /lyrics/i.test(p.key)) ? 'the model takes no lyrics.' : undefined,
    node: (s) => ({ kind: 'audio', title: s.title, prompt: s.prompt, modelRef: s.modelRef, settings: s.settings, outputIndex: 0, ...(s.textOutput ? { textOutput: true } : {}) }),
    link: (s, link) => {
      link(s.promptFrom, 'prompt');
      link(s.lyricsFrom, 'lyrics');
    },
  },
  op: {
    previewRefs: (s) => [s.input, ...Object.values(s.params).filter((v): v is string => typeof v === 'string' && v.startsWith('asset:'))],
    node: (s) => ({ kind: 'tool', title: s.title, op: s.op, params: s.params, outputIndex: 0 }),
    link: (s, link) => link(s.input, 'input'),
  },
  layer: { node: () => null },
};

export function graphStepNode(step: PlanStep): GraphNodeData | null {
  return (GRAPH_STEP[step.kind] as GraphStep<Kind> | undefined)?.node(step) ?? null;
}

export function linkGraphStep(step: PlanStep, link: Link, kindOf: RefKind): void {
  (GRAPH_STEP[step.kind] as GraphStep<Kind> | undefined)?.link?.(step, link, kindOf);
}

export function graphStepNeedsPrompt(step: PlanStep): boolean {
  return (GRAPH_STEP[step.kind] as GraphStep<Kind> | undefined)?.needsPrompt?.(step) ?? false;
}

export function nodePreviewRefs(step: PlanStep): StepRef[] {
  return (GRAPH_STEP[step.kind] as GraphStep<Kind> | undefined)?.previewRefs?.(step) ?? [];
}

export function nodePreviewInputProblem(step: PlanStep, schema: ModelSchema, subjects: number, kindOf: RefKind): string | undefined {
  return (GRAPH_STEP[step.kind] as GraphStep<Kind> | undefined)?.inputProblem?.(step, schema, subjects, kindOf);
}

/** Image/reference-driven models can run without text when the plan has a visual input. */
export function hasPromptAlternative(kind: 'image' | 'video' | 'model3d', referenceCount = 0, hasFirstFrame = false): boolean {
  return referenceCount > 0 || (kind === 'video' && hasFirstFrame);
}

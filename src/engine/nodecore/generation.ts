import type { AudioStep, ImageStep, Model3dStep, PortType, VideoStep } from '../types';
import { defineNode, type NodeDescriptor, type PortInfo, type StepContext } from './descriptor';
import { deliverGenerated } from './deliver';

const PROMPT: PortInfo = { id: 'prompt', type: 'text', label: 'Prompt', multi: false };

const refsOf = (ctx: StepContext, handles: string[]): string[] =>
  ctx.inEdges.filter((e) => handles.includes(e.targetHandle)).map((e) => ctx.refFor(e)).filter((r): r is string => Boolean(r));

const imageLike: NodeDescriptor['plan'] = (d, ctx) => {
  if (d.kind !== 'image' && d.kind !== 'model3d') throw new Error('plan: wrong kind');
  const refs = refsOf(ctx, ['ref', 'clip']);
  return { id: ctx.id, kind: d.kind, title: d.title, prompt: d.prompt, promptFrom: ctx.promptFrom, modelRef: d.modelRef, settings: d.settings, refs } satisfies ImageStep | Model3dStep;
};

const PLANS: Record<'image' | 'video' | 'audio' | 'model3d', NonNullable<NodeDescriptor['plan']>> = {
  image: imageLike,
  model3d: imageLike,
  video(d, ctx) {
    if (d.kind !== 'video') throw new Error('plan: wrong kind');
    const first = ctx.inEdges.find((e) => e.targetHandle === 'first');
    const last = ctx.inEdges.find((e) => e.targetHandle === 'last');
    const refs = refsOf(ctx, ['ref', 'refVideo', 'audio']);
    return {
      id: ctx.id, kind: 'video', title: d.title, prompt: d.prompt, promptFrom: ctx.promptFrom, modelRef: d.modelRef, settings: d.settings,
      firstFrame: first ? ctx.refFor(first) ?? undefined : undefined,
      lastFrame: last ? ctx.refFor(last) ?? undefined : undefined,
      refs: refs.length ? refs : undefined,
    } satisfies VideoStep;
  },
  audio(d, ctx) {
    if (d.kind !== 'audio') throw new Error('plan: wrong kind');
    return {
      id: ctx.id, kind: 'audio', title: d.title, prompt: d.prompt, promptFrom: ctx.promptFrom, lyricsFrom: ctx.textFrom('lyrics'), modelRef: d.modelRef, settings: d.settings,
      ...(d.textOutput ? { textOutput: true } : {}),
    } satisfies AudioStep;
  },
};

/** The shared descriptor of the four generation kinds: they differ in ports and output, not in contract. */
export function generationNode(kind: 'image' | 'video' | 'audio' | 'model3d', ports: { inputs: PortInfo[]; output: PortType | ((textOutput?: boolean) => PortType) }): NodeDescriptor {
  const plan = PLANS[kind];
  return defineNode({
    kind,
    version: 1,
    params: ['title', 'prompt', 'modelRef', 'settings', 'outputIndex', 'subjects', 'textOutput'],
    inputs: () => ports.inputs.map((p) => ({ ...p })),
    output: (data) => (typeof ports.output === 'function' ? ports.output('textOutput' in data ? data.textOutput : undefined) : ports.output),
    required: [],
    affects: { prompt: true, ref: true, clip: true, first: true, last: true, refVideo: true, audio: true, lyrics: true },
    evaluate: deliverGenerated,
    plan,
    actions: ['generate'],
  });
}
export { PROMPT };

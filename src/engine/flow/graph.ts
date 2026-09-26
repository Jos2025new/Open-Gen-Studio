import { uid } from '../../lib/id';
import { OPS } from '../ops';
import { parseRef } from '../plan';
import type {
  Asset,
  AudioStep,
  GenNodeData,
  ToolNodeData,
  Generation,
  Graph,
  GraphEdge,
  GraphNode,
  GraphNodeData,
  ImageStep,
  Model3dStep,
  OpStep,
  Plan,
  PlanStep,
  PortType,
  TextStep,
  VideoStep,
} from '../types';

/* Node editor model: ports, validation, plan ↔ graph conversion and auto layout. */

export const NODE_WIDTH = 260;

/** Nodes that run a generation (and so hold a `generationId`). */
export function runsGeneration(d: GraphNodeData): d is GenNodeData | ToolNodeData {
  return d.kind === 'image' || d.kind === 'video' || d.kind === 'audio' || d.kind === 'model3d' || d.kind === 'tool';
}

export function outputPort(data: GraphNodeData, assets: Record<string, Asset>): PortType | null {
  switch (data.kind) {
    case 'text':
      return 'text';
    case 'image':
      return 'image';
    case 'model3d':
      return 'model3d';
    case 'video':
      return 'video';
    case 'audio':
      return data.textOutput ? 'text' : 'audio';
    case 'tool':
      return OPS[data.op].output;
    case 'asset':
      return data.assetId ? assets[data.assetId]?.kind ?? null : null;
  }
}

export function inputPorts(data: GraphNodeData): Array<{ id: string; type: PortType; label: string; multi: boolean }> {
  switch (data.kind) {
    case 'image':
      return [
        { id: 'prompt', type: 'text', label: 'Prompt', multi: false },
        { id: 'ref', type: 'image', label: 'References', multi: true },
        // Clip models (Nano Banana 2 reference-to-image): a trimmed reference video.
        { id: 'clip', type: 'video', label: 'Video clip', multi: true },
      ];
    case 'model3d':
      return [
        { id: 'prompt', type: 'text', label: 'Prompt', multi: false },
        { id: 'ref', type: 'image', label: 'Reference images', multi: true },
      ];
    case 'video':
      return [
        { id: 'prompt', type: 'text', label: 'Prompt', multi: false },
        { id: 'first', type: 'image', label: 'First frame', multi: false },
        { id: 'last', type: 'image', label: 'Last frame', multi: false },
        // Reference-to-video models take these as references; keyframe models pin them in order.
        { id: 'ref', type: 'image', label: 'References / keyframes', multi: true },
        { id: 'refVideo', type: 'video', label: 'Reference videos', multi: true },
        // Lip-sync speech, a soundtrack or reference audio, as the model takes it.
        { id: 'audio', type: 'audio', label: 'Audio', multi: true },
      ];
    case 'audio':
      return [
        { id: 'prompt', type: 'text', label: 'Prompt', multi: false },
        // Song lyrics: a text node, a lyrics node or a transcription.
        { id: 'lyrics', type: 'text', label: 'Lyrics', multi: false },
      ];
    case 'tool':
      return [{ id: 'input', type: OPS[data.op].input, label: 'Input', multi: false }];
    default:
      return [];
  }
}

function reaches(edges: GraphEdge[], from: string, to: string): boolean {
  const stack = [from];
  const seen = new Set<string>();
  while (stack.length) {
    const n = stack.pop()!;
    if (n === to) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    edges.filter((e) => e.source === n).forEach((e) => stack.push(e.target));
  }
  return false;
}

export function connectionError(
  graph: Graph,
  assets: Record<string, Asset>,
  c: { source: string; target: string; targetHandle: string | null },
): string | null {
  if (c.source === c.target) return 'A node cannot connect to itself.';
  const src = graph.nodes.find((n) => n.id === c.source);
  const tgt = graph.nodes.find((n) => n.id === c.target);
  if (!src || !tgt) return 'Unknown node.';
  const out = outputPort(src.data, assets);
  const port = inputPorts(tgt.data).find((p) => p.id === c.targetHandle);
  if (!port) return 'This node has no such input.';
  if (!out) return 'The source has no output yet.';
  if (out !== port.type) return `${port.label} expects ${port.type}, got ${out}.`;
  if (reaches(graph.edges, c.target, c.source)) return 'That connection would create a loop.';
  return null;
}

/** Add an edge, replacing the existing edge on single-input ports. */
export function connect(graph: Graph, c: { source: string; target: string; targetHandle: string }): Graph {
  const tgt = graph.nodes.find((n) => n.id === c.target);
  const port = tgt ? inputPorts(tgt.data).find((p) => p.id === c.targetHandle) : undefined;
  let edges = graph.edges.filter((e) => !(e.source === c.source && e.target === c.target && e.targetHandle === c.targetHandle));
  if (port && !port.multi) edges = edges.filter((e) => !(e.target === c.target && e.targetHandle === c.targetHandle));
  edges.push({ id: uid('edge'), source: c.source, target: c.target, sourceHandle: 'out', targetHandle: c.targetHandle });
  return { ...graph, edges };
}

// ---------------------------------------------------------------------------
// Plan → graph

/** `kindOf` tells whether an asset ref is a video (it goes to the video ports); step outputs are known from the plan. */
export function planToGraph(plan: Plan, kindOf: (assetId: string) => string | undefined = () => undefined): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeOf = new Map<string, string>();
  const assetNodes = new Map<string, string>();
  const nid = (stepId: string) => `${plan.id}_${stepId}`;

  for (const s of plan.steps) {
    let data: GraphNodeData | null = null;
    if (s.kind === 'text') data = { kind: 'text', title: s.title, text: s.text };
    else if (s.kind === 'image' || s.kind === 'model3d' || s.kind === 'video')
      data = { kind: s.kind, title: s.title, prompt: s.prompt, modelRef: s.modelRef, settings: s.settings, outputIndex: 0 };
    else if (s.kind === 'audio')
      data = { kind: 'audio', title: s.title, prompt: s.prompt, modelRef: s.modelRef, settings: s.settings, outputIndex: 0, ...(s.textOutput ? { textOutput: true } : {}) };
    else if (s.kind === 'op') data = { kind: 'tool', title: s.title, op: s.op, params: s.params, outputIndex: 0 };
    if (!data) continue;
    const id = nid(s.id);
    nodeOf.set(s.id, id);
    nodes.push({ id, position: { x: 0, y: 0 }, data, planId: plan.id });
  }

  const link = (ref: string | undefined, target: string, handle: string) => {
    if (!ref) return;
    const p = parseRef(ref);
    if (!p) return;
    let source: string | undefined;
    if (p.type === 'step') source = nodeOf.get(p.id);
    else if (p.type === 'asset') {
      source = assetNodes.get(p.id);
      if (!source) {
        source = `${plan.id}_asset_${assetNodes.size + 1}`;
        assetNodes.set(p.id, source);
        nodes.push({ id: source, position: { x: 0, y: 0 }, data: { kind: 'asset', title: 'Reference', assetId: p.id }, planId: plan.id });
      }
    }
    if (source) edges.push({ id: uid('edge'), source, target, sourceHandle: 'out', targetHandle: handle });
  };

  const kindOfRef = (ref: string) => {
    const p = parseRef(ref);
    if (p?.type === 'asset') return kindOf(p.id);
    const step = p?.type === 'step' ? plan.steps.find((x) => x.id === p.id) : undefined;
    return step?.kind === 'op' ? OPS[step.op].output : step?.kind;
  };
  const isVideo = (ref: string) => kindOfRef(ref) === 'video';
  for (const s of plan.steps) {
    const target = nodeOf.get(s.id);
    if (!target) continue;
    if (s.kind === 'image' || s.kind === 'model3d') {
      link(s.promptFrom, target, 'prompt');
      s.refs.forEach((r) => link(r, target, isVideo(r) ? 'clip' : 'ref'));
    } else if (s.kind === 'video') {
      link(s.promptFrom, target, 'prompt');
      link(s.firstFrame, target, 'first');
      link(s.lastFrame, target, 'last');
      (s.refs ?? []).forEach((r) => link(r, target, kindOfRef(r) === 'audio' ? 'audio' : isVideo(r) ? 'refVideo' : 'ref'));
    } else if (s.kind === 'audio') {
      link(s.promptFrom, target, 'prompt');
      link(s.lyricsFrom, target, 'lyrics');
    } else if (s.kind === 'op') {
      link(s.input, target, 'input');
    }
  }
  return { nodes, edges };
}

export function estimatedHeight(data: GraphNodeData): number {
  switch (data.kind) {
    // Media-first cards: a preview (or the text) plus the label above it; controls float outside.
    case 'text':
      return 170;
    case 'image':
    case 'model3d':
    case 'video':
    case 'audio':
    case 'tool':
    case 'asset':
      return 220;
  }
}

/** Layered left-to-right layout by dependency depth. Returns new positions for the given node ids. */
export function autoLayout(nodes: GraphNode[], edges: GraphEdge[], origin = { x: 0, y: 0 }): Map<string, { x: number; y: number }> {
  const ids = new Set(nodes.map((n) => n.id));
  const incoming = new Map<string, string[]>();
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) continue;
    incoming.set(e.target, [...(incoming.get(e.target) ?? []), e.source]);
  }
  const depth = new Map<string, number>();
  const dfs = (id: string, trail: Set<string>): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (trail.has(id)) return 0;
    trail.add(id);
    const d = Math.max(-1, ...(incoming.get(id) ?? []).map((s) => dfs(s, trail))) + 1;
    trail.delete(id);
    depth.set(id, d);
    return d;
  };
  nodes.forEach((n) => dfs(n.id, new Set()));
  const columns = new Map<number, GraphNode[]>();
  for (const n of nodes) {
    const d = depth.get(n.id) ?? 0;
    columns.set(d, [...(columns.get(d) ?? []), n]);
  }
  const gapX = 90;
  const gapY = 36;
  const heights = [...columns.values()].map((col) => col.reduce((h, n) => h + estimatedHeight(n.data) + gapY, -gapY));
  const tallest = Math.max(0, ...heights);
  const out = new Map<string, { x: number; y: number }>();
  [...columns.entries()]
    .sort((a, b) => a[0] - b[0])
    .forEach(([d, col]) => {
      // Keep sibling order stable by the average position of their parents.
      col.sort((a, b) => avgParent(a.id) - avgParent(b.id));
      const colH = col.reduce((h, n) => h + estimatedHeight(n.data) + gapY, -gapY);
      let y = origin.y + (tallest - colH) / 2;
      for (const n of col) {
        out.set(n.id, { x: origin.x + d * (NODE_WIDTH + gapX), y });
        y += estimatedHeight(n.data) + gapY;
      }
    });
  return out;

  function avgParent(id: string): number {
    const ps = incoming.get(id) ?? [];
    if (!ps.length) return nodes.findIndex((n) => n.id === id);
    return ps.reduce((s, p) => s + (out.get(p)?.y ?? 0), 0) / ps.length;
  }
}

/** Bounding box of existing nodes (to place new flows beside them). */
export function graphBounds(nodes: GraphNode[]): { x: number; y: number; w: number; h: number } | null {
  if (!nodes.length) return null;
  const x0 = Math.min(...nodes.map((n) => n.position.x));
  const y0 = Math.min(...nodes.map((n) => n.position.y));
  const x1 = Math.max(...nodes.map((n) => n.position.x + NODE_WIDTH));
  const y1 = Math.max(...nodes.map((n) => n.position.y + estimatedHeight(n.data)));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// ---------------------------------------------------------------------------
// Graph → executable steps

export interface GraphRunPlan {
  steps: PlanStep[];
  /** step id (= node id) of every node that will run. */
  runIds: string[];
  errors: string[];
}

function nodeOutputAsset(node: GraphNode, generations: Record<string, Generation>): string | null {
  const d = node.data;
  if (d.kind !== 'text' && d.sketchAssetId) return d.sketchAssetId;
  if (d.kind === 'asset') return d.assetId;
  if (runsGeneration(d)) {
    const g = d.generationId ? generations[d.generationId] : undefined;
    if (g?.status === 'done') return g.assetIds[d.outputIndex] ?? g.assetIds[0] ?? null;
  }
  return null;
}

/** The text a node already produced (Transcribe, lyrics), or undefined. */
function finishedText(node: GraphNode, generations: Record<string, Generation>): string | undefined {
  const d = node.data;
  if ((d.kind !== 'tool' && d.kind !== 'audio') || !d.generationId) return undefined;
  const g = generations[d.generationId];
  return g?.status === 'done' && g.text != null ? g.text : undefined;
}

/**
 * Build steps for running `targets`. Upstream generation nodes without a finished
 * output run too; nodes that already have output are referenced by their asset.
 */
export function graphToSteps(graph: Graph, targets: string[], generations: Record<string, Generation>): GraphRunPlan {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const errors: string[] = [];
  const run = new Set<string>();
  const visit = (id: string, forced: boolean) => {
    const n = byId.get(id);
    if (!n || run.has(id)) return;
    const runnable = runsGeneration(n.data);
    if (!runnable) return;
    if (!forced && nodeOutputAsset(n, generations)) return;
    // A finished text result (Transcribe, lyrics) is an output too: reuse it instead of running again.
    if (!forced && finishedText(n, generations) != null) return;
    run.add(id);
    graph.edges.filter((e) => e.target === id).forEach((e) => visit(e.source, false));
  };
  targets.forEach((t) => visit(t, true));

  const refFor = (sourceId: string): string | null => {
    const n = byId.get(sourceId);
    if (!n || n.data.kind === 'text') return null;
    if (run.has(sourceId)) return sourceId;
    const asset = nodeOutputAsset(n, generations);
    if (asset) return `asset:${asset}`;
    errors.push(`"${n.data.title}" has no output yet.`);
    return null;
  };

  const steps: PlanStep[] = [];
  const textSteps = new Map<string, TextStep>();
  for (const id of run) {
    const n = byId.get(id)!;
    const inEdges = graph.edges.filter((e) => e.target === id);
    const d = n.data;
    // Text ports (prompt, lyrics): a text node, or a node with a text result (Transcribe, lyrics) from this run or before.
    const textFrom = (handle: string): string | undefined => {
      const edge = inEdges.find((e) => e.targetHandle === handle);
      const src = edge ? byId.get(edge.source) : undefined;
      if (!src) return undefined;
      if (src.data.kind === 'text') {
        if (!textSteps.has(src.id)) textSteps.set(src.id, { id: src.id, kind: 'text', title: src.data.title, text: src.data.text });
        return src.id;
      }
      const textual = (src.data.kind === 'tool' && OPS[src.data.op].output === 'text') || (src.data.kind === 'audio' && src.data.textOutput);
      if (!textual) return undefined;
      if (!run.has(src.id) && !textSteps.has(src.id)) {
        const done = finishedText(src, generations);
        if (done != null) textSteps.set(src.id, { id: src.id, kind: 'text', title: src.data.title, text: done });
        else errors.push(`"${src.data.title}" has no text yet.`);
      }
      return src.id;
    };
    const promptFrom = textFrom('prompt');
    if (d.kind === 'image' || d.kind === 'model3d') {
      const refs = inEdges
        .filter((e) => e.targetHandle === 'ref' || e.targetHandle === 'clip')
        .map((e) => refFor(e.source))
        .filter((r): r is string => Boolean(r));
      steps.push({ id, kind: d.kind, title: d.title, prompt: d.prompt, promptFrom, modelRef: d.modelRef, settings: d.settings, refs } satisfies ImageStep | Model3dStep);
    } else if (d.kind === 'video') {
      const first = inEdges.find((e) => e.targetHandle === 'first');
      const last = inEdges.find((e) => e.targetHandle === 'last');
      const refs = inEdges
        .filter((e) => e.targetHandle === 'ref' || e.targetHandle === 'refVideo' || e.targetHandle === 'audio')
        .map((e) => refFor(e.source))
        .filter((r): r is string => Boolean(r));
      steps.push({
        id,
        kind: 'video',
        title: d.title,
        prompt: d.prompt,
        promptFrom,
        modelRef: d.modelRef,
        settings: d.settings,
        firstFrame: first ? refFor(first.source) ?? undefined : undefined,
        lastFrame: last ? refFor(last.source) ?? undefined : undefined,
        refs: refs.length ? refs : undefined,
      } satisfies VideoStep);
    } else if (d.kind === 'audio') {
      steps.push({
        id,
        kind: 'audio',
        title: d.title,
        prompt: d.prompt,
        promptFrom,
        lyricsFrom: textFrom('lyrics'),
        modelRef: d.modelRef,
        settings: d.settings,
        ...(d.textOutput ? { textOutput: true } : {}),
      } satisfies AudioStep);
    } else if (d.kind === 'tool') {
      const input = inEdges.find((e) => e.targetHandle === 'input');
      const ref = input ? refFor(input.source) : null;
      if (!ref) errors.push(`"${d.title}" needs an ${OPS[d.op].input} input.`);
      steps.push({ id, kind: 'op', title: d.title, op: d.op, input: ref ?? '', params: d.params } satisfies OpStep);
    }
  }
  for (const s of steps) {
    if ((s.kind === 'image' || s.kind === 'model3d' || s.kind === 'video') && !s.prompt.trim() && !s.promptFrom) {
      const needsPrompt = s.kind === 'image' || s.kind === 'model3d' ? !s.refs.length : !s.firstFrame && !s.refs?.length;
      if (needsPrompt) errors.push(`"${s.title}" needs a prompt.`);
    }
  }
  return { steps: [...textSteps.values(), ...steps], runIds: [...run], errors };
}

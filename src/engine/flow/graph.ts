import { mentionSubjects } from '../params';
import { nodeIsCurrent, type RequestContext } from './freshness';
import { uid } from '../../lib/id';
import { refNodeText } from './refText';
import { ignoredRunCable, resolveInputs, sessionChatText } from '../nodecore/resolver';
import { descriptorOf } from '../nodecore/registry';
import { OPS } from '../ops';
import { parseRef } from '../plan';
import { allNodePorts, portTypeCompatible, resolveSystemConnection } from '../nodes/system';
import type {
  Asset,
  GenNodeData,
  ToolNodeData,
  Generation,
  Graph,
  GraphEdge,
  GraphNode,
  GraphNodeData,
  LinkKind,
  Plan,
  PlanStep,
  PortSpec,
  PortType,
  TextStep,
  Subject,
} from '../types';

/* Node editor model: ports, validation, plan ↔ graph conversion and auto layout. */

export * from './graph-layout';

/** Nodes that run a generation (and so hold a `generationId`). */
export function runsGeneration(d: GraphNodeData): d is GenNodeData | ToolNodeData {
  return d.kind === 'image' || d.kind === 'video' || d.kind === 'audio' || d.kind === 'model3d' || d.kind === 'tool';
}

/** Whether an output fits an input. A 3D model fits image inputs: they receive its view image. */
export function portFits(out: PortType | null, input: PortType | undefined): boolean {
  return !!out && (out === input || (out === 'model3d' && input === 'image'));
}

export function outputPort(data: GraphNodeData, assets: Record<string, Asset>): PortType | null {
  return descriptorOf(data.kind)?.output(data, assets) ?? null;
}

export function inputPorts(data: GraphNodeData): Array<{ id: string; type: PortType; label: string; multi: boolean }> {
  return descriptorOf(data.kind)?.inputs(data) ?? [];
}

export function nodePorts(data: GraphNodeData, assets: Record<string, Asset> = {}): PortSpec[] {
  return allNodePorts(data, assets, inputPorts(data), outputPort(data, assets));
}

function reaches(edges: GraphEdge[], from: string, to: string): boolean {
  const next = new Map<string, string[]>();
  for (const e of edges) {
    const targets = next.get(e.source);
    if (targets) targets.push(e.target);
    else next.set(e.source, [e.target]);
  }
  const stack = [from];
  const seen = new Set<string>();
  while (stack.length) {
    const n = stack.pop()!;
    if (n === to) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    for (const target of next.get(n) ?? []) stack.push(target);
  }
  return false;
}

function usesSystemPorts(
  src: GraphNode,
  tgt: GraphNode,
  c: { sourceHandle?: string | null; targetHandle?: string | null; kind?: LinkKind; both?: boolean },
): boolean {
  return (
    src.data.kind === 'ref' ||
    tgt.data.kind === 'ref' ||
    (c.kind != null && c.kind !== 'data') ||
    Boolean(c.both) ||
    Boolean(c.targetHandle && ['sys_ref', 'model', 'control'].includes(c.targetHandle)) ||
    Boolean(c.sourceHandle && ['out_ref', 'out_control'].includes(c.sourceHandle))
  );
}

type ConnectionPorts = { sourceHandle?: string | null; targetHandle: string | null; kind?: LinkKind; both?: boolean };

function systemPortsFor(src: GraphNode, tgt: GraphNode, assets: Record<string, Asset>, c: ConnectionPorts) {
  return usesSystemPorts(src, tgt, c) ? resolveSystemConnection(nodePorts(src.data, assets), nodePorts(tgt.data, assets), c) : undefined;
}

function portProblem(src: GraphNode, tgt: GraphNode, assets: Record<string, Asset>, c: ConnectionPorts,
  resolved: ReturnType<typeof systemPortsFor>, unknownAsset = false): string | null {
  if (resolved) {
    if (resolved.classMismatch) return resolved.classMismatch;
    if (!resolved.tgtPort) return 'This node has no such input.';
    if (!resolved.srcPort) return unknownAsset ? null : 'The source has no output yet.';
    const kind = resolved.kind ?? resolved.tgtPort.kind;
    if (c.both && kind === 'data') return 'Data links cannot be bidirectional (both is only allowed on ref and control links).';
    if (resolved.srcPort.kind !== resolved.tgtPort.kind) return `Link class mismatch: cannot connect ${resolved.srcPort.kind} to ${resolved.tgtPort.kind}.`;
    if (!portTypeCompatible(kind, resolved.srcPort.type, resolved.tgtPort.type)) {
      return `${resolved.tgtPort.label ?? resolved.tgtPort.id} expects ${resolved.tgtPort.type}, got ${resolved.srcPort.type}.`;
    }
    return null;
  }
  const out = outputPort(src.data, assets);
  const port = inputPorts(tgt.data).find((p) => p.id === c.targetHandle);
  if (!port) return 'This node has no such input.';
  if (!out) return unknownAsset ? null : 'The source has no output yet.';
  if (!portFits(out, port.type)) return `${port.label} expects ${port.type}, got ${out}.`;
  return null;
}

/** A cable can outlive a port's former type. Its original endpoints stay in the graph. */
export function cablePortProblem(src: GraphNode, tgt: GraphNode, assets: Record<string, Asset> | undefined, edge: GraphEdge): string | null {
  // An omitted inventory leaves the type unknown. An empty inventory can confirm deletion.
  const unknownAsset = !assets && src.data.kind === 'asset' && !!src.data.assetId;
  const inventory = assets ?? {};
  return portProblem(src, tgt, inventory, edge, systemPortsFor(src, tgt, inventory, edge), unknownAsset);
}

export function compatibleDataEdges(graph: Graph, assets?: Record<string, Asset>): GraphEdge[] {
  const nodes = new Map(graph.nodes.map(n => [n.id, n]));
  return graph.edges.filter(edge => {
    if ((edge.kind ?? 'data') !== 'data') return false;
    const source = nodes.get(edge.source), target = nodes.get(edge.target);
    return source && target && !cablePortProblem(source, target, assets, edge);
  });
}

export function connectionError(
  graph: Graph,
  assets: Record<string, Asset>,
  c: { source: string; target: string; targetHandle: string | null; sourceHandle?: string | null; kind?: LinkKind; both?: boolean },
): string | null {
  if (c.source === c.target) return 'A node cannot connect to itself.';
  const src = graph.nodes.find((n) => n.id === c.source);
  const tgt = graph.nodes.find((n) => n.id === c.target);
  if (!src || !tgt) return 'Unknown node.';
  const system = systemPortsFor(src, tgt, assets, c);
  const problem = portProblem(src, tgt, assets, c, system);
  if (problem) return problem;
  const kind = system?.kind ?? system?.tgtPort?.kind ?? 'data';
  return kind === 'data' && reaches(compatibleDataEdges(graph, assets), c.target, c.source) ? 'That connection would create a loop.' : null;
}

export { resultHandle, NO_RESULT, GONE_HANDLE } from './results';
import { resultHandle, NO_RESULT, GONE_HANDLE } from './results';
/** The result a source port names, or undefined for `out` (the node's chosen result). */
export function handleIndex(handle: string | null | undefined): number | undefined {
  const m = handle ? /^out-(\d+)$/.exec(handle) : null;
  return m ? Number(m[1]) - 1 : undefined;
}

/** The same output of the same node (an output with no handle is `out`): two outputs of one node are two cables. */
export const sameSourcePort = (a: GraphEdge, b: GraphEdge): boolean => a.source === b.source && (a.sourceHandle ?? 'out') === (b.sourceHandle ?? 'out');

/** `edge` joins the cables: the same cable again is replaced, and on a single-cable input so is whatever else sits there (same kind). One rule for both ways of wiring a resolved port. */
export function withEdge(edges: GraphEdge[], edge: GraphEdge, single: boolean): GraphEdge[] {
  const kind = edge.kind ?? 'data';
  const here = (e: GraphEdge) => e.target === edge.target && e.targetHandle === edge.targetHandle && (e.kind ?? 'data') === kind;
  return [...edges.filter((e) => !(here(e) && (single || sameSourcePort(e, edge)))), edge];
}

/** Add an edge, replacing the existing edge on single-input ports. */
export function connect(
  graph: Graph,
  c: { source: string; target: string; targetHandle: string; sourceHandle?: string | null; kind?: LinkKind; both?: boolean },
): Graph {
  const src = graph.nodes.find((n) => n.id === c.source);
  const tgt = graph.nodes.find((n) => n.id === c.target);
  if (src && tgt && usesSystemPorts(src, tgt, c)) {
    const resolved = resolveSystemConnection(nodePorts(src.data, {}), nodePorts(tgt.data, {}), c);
    const kind: LinkKind = c.kind ?? resolved.kind ?? 'data';
    const targetHandle = resolved.tgtPort?.id ?? c.targetHandle;
    const sourceHandle = resolved.srcPort?.id ?? (c.sourceHandle || 'out');
    const edge: GraphEdge = { id: uid('edge'), source: c.source, target: c.target, sourceHandle, targetHandle, kind, ...(c.both && kind !== 'data' ? { both: true } : {}) };
    return { ...graph, edges: withEdge(graph.edges, edge, resolved.tgtPort?.multi === false) };
  }
  const port = tgt ? inputPorts(tgt.data).find((p) => p.id === c.targetHandle) : undefined;
  // A copy of a link that lost its image stays without one (it must not fall back to the node's chosen result).
  const outputIndex = c.sourceHandle === GONE_HANDLE ? NO_RESULT : handleIndex(c.sourceHandle);
  const edge: GraphEdge = { id: uid('edge'), source: c.source, target: c.target, sourceHandle: outputIndex === NO_RESULT ? GONE_HANDLE : outputIndex == null ? 'out' : resultHandle(outputIndex), targetHandle: c.targetHandle, ...(outputIndex == null ? {} : { outputIndex }) };
  return { ...graph, edges: withEdge(graph.edges, edge, Boolean(port && !port.multi)) };
}

// ---------------------------------------------------------------------------
// Plan → graph

/** `kindOf` tells whether an asset ref is a video (it goes to the video ports); step outputs are known from the plan. */
export function planToGraph(plan: Plan, kindOf: (assetId: string) => string | undefined = () => undefined, existingSource: (assetId: string) => string | undefined = () => undefined): { nodes: GraphNode[]; edges: GraphEdge[] } {
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
    // A24: the link keeps the result it uses (s1#2), so two links can use two candidates of one step.
    let outputIndex: number | undefined;
    if (p.type === 'step') {
      source = nodeOf.get(p.id);
      if (ref.includes('#')) outputIndex = p.index;
    }
    else if (p.type === 'asset') {
      source = existingSource(p.id) ?? assetNodes.get(p.id);
      if (!source) {
        source = `${plan.id}_asset_${assetNodes.size + 1}`;
        assetNodes.set(p.id, source);
        nodes.push({ id: source, position: { x: 0, y: 0 }, data: { kind: 'asset', title: 'Reference', assetId: p.id }, planId: plan.id });
      }
    }
    if (source) edges.push({ id: uid('edge'), source, target, sourceHandle: outputIndex == null ? 'out' : resultHandle(outputIndex), targetHandle: handle, ...(outputIndex == null ? {} : { outputIndex }) });
  };

  for (const n of nodes) {
    if (!('prompt' in n.data)) continue;
    const prompt = n.data.prompt;
    const bindings = (plan.subjects ?? []).filter(s => mentionSubjects(prompt, [{ id: s.name, name: s.name }]).ids.length);
    if (bindings.length) n.data.subjects = bindings.map(s => {
      const p = parseRef(s.from);
      return { ...s, from: p?.type === 'step' ? `${nid(p.id)}${p.index ? `#${p.index + 1}` : ''}` : s.from };
    });
  }

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

// ---------------------------------------------------------------------------
// Graph → executable steps

export interface GraphRunPlan {
  steps: PlanStep[];
  /** step id (= node id) of every node that will run. */
  runIds: string[];
  errors: string[];
}

/** Last attempt may be running/failed while the last usable result stays attached. */
export function nodeAttempt(node: GraphNode, generations: Record<string, Generation>): Generation | undefined {
  const d = node.data;
  let latest = runsGeneration(d) && d.generationId ? generations[d.generationId] : undefined;
  for (const g of Object.values(generations)) if (g.stepId === node.id && (!latest || g.createdAt > (latest.createdAt ?? 0))) latest = g;
  return latest;
}

export function nodeOutputAsset(node: GraphNode, generations: Record<string, Generation>, index?: number): string | null {
  if (index === NO_RESULT) return null;
  const d = node.data;
  if ('sketchAssetId' in d && d.sketchAssetId) return d.sketchAssetId;
  if (d.kind === 'asset') return d.assetId;
  if (runsGeneration(d)) {
    const g = d.generationId ? generations[d.generationId] : undefined;
    if (g?.status === 'done') return g.assetIds[index ?? d.outputIndex] ?? null;
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

/** Topological execution order through compatible data links and subject bindings. */
export function executionOrder(graph: Graph, targets?: string[], assets?: Record<string, Asset>): string[] {
  const sources = new Map<string, string[]>();
  for (const edge of compatibleDataEdges(graph, assets)) {
    const incoming = sources.get(edge.target);
    if (incoming) incoming.push(edge.source);
    else sources.set(edge.target, [edge.source]);
  }
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const roots = targets?.length ? targets : graph.nodes.filter((n) => runsGeneration(n.data)).map((n) => n.id);
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const ordered: string[] = [];
  const visit = (id: string) => {
    if (visited.has(id) || visiting.has(id)) return;
    const n = byId.get(id);
    if (!n) return;
    visiting.add(id);
    const subjectIds = 'subjects' in n.data ? (n.data.subjects ?? []).flatMap((s) => { const p = parseRef(s.from); return p?.type === 'step' ? [p.id] : []; }) : [];
    const dataSources = sources.get(id) ?? [];
    for (const srcId of [...dataSources, ...subjectIds]) visit(srcId);
    visiting.delete(id);
    visited.add(id);
    if (runsGeneration(n.data)) ordered.push(id);
  };
  roots.forEach(visit);
  return ordered;
}

/**
 * Build steps for running `targets`. Upstream generation nodes without a finished
 * output run too; nodes that already have output are referenced by their asset.
 */
export function graphToSteps(graph: Graph, targets: string[], generations: Record<string, Generation>, options: RequestContext & { force?: boolean; library?: Subject[]; assets?: Record<string, Asset> } = {}): GraphRunPlan {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const errors: string[] = [];
  const run = new Set<string>();
  const checked = new Map<string, boolean>();
  const visiting = new Set<string>();
  const targetSet = new Set(targets);
  // The plan takes its cables from the resolver (ADR 0031 point 3): an invalid one (a pinned revision that moved, a
  // deleted image) delivers nothing, so it is neither run for nor handed to the provider.
  const env = { generations, assets: options.assets, chatText: sessionChatText };
  const badEdges = new Map<string, Set<string>>();
  const unusable = (id: string): Set<string> => {
    if (!badEdges.has(id)) { const n = byId.get(id); badEdges.set(id, new Set(n ? resolveInputs(graph, n, env).filter(ignoredRunCable).map(i => i.edgeId) : [])); }
    return badEdges.get(id)!;
  };
  const visit = (id: string, forced: boolean): boolean => {
    const n = byId.get(id);
    if (!n) { errors.push(`No such node: ${id}.`); return false; }
    if (visiting.has(id)) { errors.push('The graph contains a cycle.'); return false; }
    const effectiveForced = forced || (options.force !== false && targetSet.has(id));
    if (checked.has(id) && (!effectiveForced || checked.get(id))) return checked.get(id)!;
    if (!runsGeneration(n.data)) return false;
    visiting.add(id);
    // A subject whose source was deleted is reported by the preview as a missing input, not walked.
    const subjectIds = 'subjects' in n.data ? (n.data.subjects ?? []).flatMap(s => { const p = parseRef(s.from); return p?.type === 'step' && byId.has(p.id) ? [p.id] : []; }) : [];
    const upstream = [...graph.edges.filter(e => (e.kind ?? 'data') === 'data' && e.target === id && !unusable(id).has(e.id) && e.pin == null).map(e => e.source), ...subjectIds].map(uid => visit(uid, false)).some(Boolean);
    visiting.delete(id);
    const needsRun = effectiveForced || upstream || !nodeIsCurrent(graph, n, generations, options.library, options);
    checked.set(id, needsRun);
    if (needsRun) {
      if (n.data.sketchAssetId) errors.push(`“${n.data.title}” has a Sketch on its previous base. Reset or save the Sketch before updating this node.`);
      run.add(id);
    }
    return needsRun;
  };
  targets.forEach(t => visit(t, options.force !== false));

  /** `index`: the result the link uses (edge.outputIndex); unset = the node's chosen result. */
  const refFor = (sourceId: string, index?: number, pinned = false): string | null => {
    const n = byId.get(sourceId);
    if (!n || n.data.kind === 'text') return null;
    // A link whose image was deleted delivers nothing, even when its source runs in this batch (never `source#0`).
    if (index === NO_RESULT) { errors.push(`The link from "${n.data.title}" has no output: its image was deleted. Connect it again.`); return null; }
    // A 3D source gives its view image (rendered when the model is shown or its view changes).
    if (n.data.kind === 'model3d' || (n.data.kind === 'asset' && options.assets?.[n.data.assetId ?? '']?.kind === 'model3d')) {
      if (!pinned && run.has(sourceId)) { errors.push(`Run "${n.data.title}" first: its view image is made from the finished model.`); return null; }
      const model = nodeOutputAsset(n, generations), view = model ? options.assets?.[model]?.viewImageId : undefined;
      if (view) return `asset:${view}`;
      errors.push(`"${n.data.title}" has no view image yet. Wait a moment for its preview to render, then run again.`);
      return null;
    }
    const at = index ?? ('outputIndex' in n.data ? n.data.outputIndex : 0);
    // A cable fixed to a finished revision takes that result as it is: the source is not run for it.
    if (!pinned && run.has(sourceId)) return at ? `${sourceId}#${at + 1}` : sourceId;
    const asset = nodeOutputAsset(n, generations, at);
    if (asset) return `asset:${asset}`;
    errors.push(`"${n.data.title}" has no output yet.`);
    return null;
  };

  const steps: PlanStep[] = [];
  const textSteps = new Map<string, TextStep>();
  for (const id of run) {
    const n = byId.get(id)!;
    const inEdges = graph.edges.filter((e) => (e.kind ?? 'data') === 'data' && e.target === id && !unusable(id).has(e.id));
    const d = n.data;
    // Text ports (prompt, lyrics): a text node, or a node with a text result (Transcribe, lyrics) from this run or before.
    const textFrom = (handle: string): string | undefined => {
      const edge = inEdges.find((e) => e.targetHandle === handle);
      const src = edge ? byId.get(edge.source) : undefined;
      if (!src) return undefined;
      if (src.data.kind === 'text') {
        if (handle === 'prompt' && !src.data.text.trim()) return undefined;
        if (!textSteps.has(src.id)) textSteps.set(src.id, { id: src.id, kind: 'text', title: src.data.title, text: src.data.text });
        return src.id;
      }
      if (src.data.kind === 'ref') {
        const said = refNodeText(src);
        if (said == null) { errors.push(`"${src.data.title}" has no text yet.`); return undefined; }
        if (handle === 'prompt' && !said.trim()) return undefined;
        if (!textSteps.has(src.id)) textSteps.set(src.id, { id: src.id, kind: 'text', title: src.data.title, text: said });
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
    const plan = descriptorOf(d.kind)?.plan;
    if (!plan) continue;
    const promptFrom = textFrom('prompt');
    steps.push(plan(d, { id, inEdges, textFrom, refFor: (e) => refFor(e.source, e.outputIndex, e.pin != null), errors, promptFrom }));
  }
  for (const s of steps) {
    const d = byId.get(s.id)!.data;
    if ('subjects' in d && d.subjects?.length) {
      s.nodeSubjects = d.subjects.map(subj => {
        const p = parseRef(subj.from);
        const source = p?.type === 'step' ? byId.get(p.id) : undefined;
        return { ...subj, from: source ? refFor(source.id, subj.from.includes('#') ? p?.index : undefined) ?? subj.from : subj.from };
      });
      s.after = s.nodeSubjects.flatMap(subj => { const p = parseRef(subj.from); return p?.type === 'step' ? [p.id] : []; });
    }

    if ((s.kind === 'image' || s.kind === 'model3d' || s.kind === 'video') && !s.prompt.trim() && !s.promptFrom) {
      const needsPrompt = !hasPromptAlternative(s.kind, s.refs?.length, s.kind === 'video' && !!s.firstFrame);
      if (needsPrompt) errors.push(`"${s.title}" needs a prompt.`);
    }
  }
  return { steps: [...textSteps.values(), ...steps], runIds: [...run], errors };
}

/** Image/reference-driven models can run without text when the plan has a visual input. */
export function hasPromptAlternative(kind: 'image' | 'video' | 'model3d', referenceCount = 0, hasFirstFrame = false): boolean {
  return referenceCount > 0 || (kind === 'video' && hasFirstFrame);
}

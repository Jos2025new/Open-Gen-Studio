import { useStore } from '../../store/store';
import { normalizeAssetRevisions } from '../assetRevisions';
import type { Asset, Generation, Graph, GraphEdge, GraphNode } from '../types';
import { digest, type RefMode, type RefStatus } from './address';

/*
 * The one resolver (ADR 0031 point 3). Preview, the freshness signature and the run plan all take a node's effective
 * inputs from here, with the revision each one carried. Nothing reads the store during resolution except `storeEnv`,
 * which is the only place this module touches it: tests and the inspector hand in a plain env instead.
 */
export interface ResolveEnv {
  generations: Record<string, Generation>;
  assets: Record<string, Asset>;
  /** The last user message of a chat node / last reply of an agent node (undefined: none, or its session is gone). */
  chatText(node: GraphNode): string | undefined;
}

export interface ResolvedInput {
  port: string;
  edgeId: string;
  /** Source node id, or null when it no longer exists. */
  from: string | null;
  mode: RefMode;
  status: RefStatus;
  /** Why an input is invalid or empty, in words the inspector shows. */
  reason?: string;
  value: string | null;
  /** Revision of what the source delivers now (moving) or of what the link was fixed to (pinned). */
  revision: string | null;
  /** A tombstone of a deleted node's link: shown as invalid, not part of the request. */
  broken?: true;
  kind?: import('../types').LinkKind;
  /** Set when the cable is invalid because its pin no longer matches. */
  pinMoved?: true;
  /** The revision, only for a source whose content was revised: it joins the freshness signature. */
  rev?: string;
}

/** An edge whose image was deleted keeps this index: it can never match a result (see graph.ts NO_RESULT). */
const GONE = -1;

/**
 * Chat/agent text straight from the session feed: the single store read of the resolver. An agent node delivers the
 * last reply written by that agent, a chat node the last message written in that chat. Rows from before agents and
 * chats carried an id belong to the session's first agent / first chat, as everywhere else.
 */
export function sessionChatText(node: GraphNode): string | undefined {
  const d = node.data;
  // An independent prompt box says what it holds; the composer's box says what is typed there.
  if (d.kind === 'ref' && d.type === 'prompt') return d.ref === 'composer' ? useStore.getState().composer.text : d.promptText ?? '';
  if (d.kind !== 'ref' || (d.type !== 'chat' && d.type !== 'agent')) return undefined;
  const s = useStore.getState().sessions[d.ref];
  const first = s?.graph.nodes.find((n) => n.data.kind === 'ref' && n.data.type === d.type)?.id ?? node.id; // a node outside the session graph (or with none) reads the untagged items
  const wanted = d.type === 'chat' ? 'user' : 'assistant';
  const owner = (f: { meta?: { agentNodeId?: string; chatNodeId?: string } }) => (d.type === 'chat' ? f.meta?.chatNodeId : f.meta?.agentNodeId) ?? first;
  const last = [...(s?.feed ?? [])].reverse().find((f) => f.type === wanted && 'text' in f && owner(f as never) === node.id);
  return last && 'text' in last ? last.text : undefined;
}

export function storeEnv(): ResolveEnv {
  const st = useStore.getState();
  return { generations: st.generations, assets: st.assets, chatText: sessionChatText };
}

/** What a source node delivers on one edge: its value and the revision label of that value. */
export function sourceValue(src: GraphNode | undefined, edge: Pick<GraphEdge, 'outputIndex'>, env: ResolveEnv): { value: string | null; revision: string | null; edited?: true } {
  const data = src?.data;
  if (!data) return { value: null, revision: null };
  const gen = 'generationId' in data && data.generationId ? env.generations[data.generationId] : undefined;
  let value: string | null | undefined;
  let revision: string | null = null;
  let edited: true | undefined;
  if (data.kind === 'text') value = data.text;
  else if (data.kind === 'ref') value = env.chatText(src!);
  else if (data.kind === 'asset') {
    value = data.sketchAssetId ?? data.assetId;
    const rev = data.assetId ? normalizeAssetRevisions(env.assets[data.assetId]) : undefined;
    if (value) revision = `${value}@${rev ? `${rev.index}/${rev.versions.length}` : '0'}`;
    if (rev && rev.versions.length > 1) edited = true;
  } else {
    value = gen?.text ?? ('outputIndex' in data ? data.sketchAssetId ?? gen?.assetIds[edge.outputIndex ?? data.outputIndex] : null);
    if (value && gen) revision = `${gen.id}:${value}`;
  }
  if (value == null) return { value: null, revision: null };
  return { value, revision: revision ?? digest(value), ...(edited ? { edited } : {}) };
}

/** Every data input of a node, resolved: the value, its revision, and whether the link is usable. */
export function resolveInputs(graph: Graph, node: GraphNode, env: ResolveEnv): ResolvedInput[] {
  const live = graph.edges.filter((e) => (e.kind ?? 'data') === 'data' && e.target === node.id).map((e): ResolvedInput => {
    const src = graph.nodes.find((n) => n.id === e.source);
    const base = { port: e.targetHandle, edgeId: e.id, from: src?.id ?? null, mode: (e.pin ? 'pinned' : 'moving') as RefMode };
    if (!src) return { ...base, status: 'invalid', reason: 'The source node no longer exists.', value: null, revision: null };
    if (e.outputIndex === GONE) return { ...base, status: 'invalid', reason: 'The image this link used was deleted.', value: null, revision: null };
    const { value, revision, edited } = sourceValue(src, e, env);
    if (e.pin && revision !== e.pin) return { ...base, status: 'invalid', pinMoved: true, reason: "The pinned revision is no longer the source's.", value: null, revision: e.pin };
    return { ...base, status: value == null ? 'empty' : 'ok', ...(value == null ? { reason: 'The source has no output yet.' } : {}), value, revision, ...(edited ? { rev: revision! } : {}) };
  });
  const broken = (graph.broken ?? []).filter((b) => b.edge.target === node.id).map((b): ResolvedInput => ({
    kind: b.edge.kind ?? 'data', port: b.edge.targetHandle, edgeId: b.edge.id, from: b.missing === 'source' ? null : b.edge.source, mode: b.edge.pin ? 'pinned' : 'moving',
    status: 'invalid', reason: `The ${b.missing} node was deleted.`, value: null, revision: null, broken: true,
  }));
  return [...live, ...broken];
}

/** The inputs a node's request is built from, in the `{ port, value }` shape saved signatures already use. */
export const incomingOf = (inputs: ResolvedInput[]) => inputs.filter((i) => !i.broken).map((i) => ({ port: i.port, value: i.value, ...(i.rev ? { rev: i.rev } : {}) }));

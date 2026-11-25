import type { AdvancedValue, GenSettings, MediaKind, OpId, PlanSubject } from './types';
import type { KitGroupLink } from './libraryTypes';

/* The node graph: creative nodes, system nodes that point to data where it lives, and classed links. Re-exported by types.ts. */

/**
 * Open registry (ADR 0031): a new node type is ONE file, `nodecore/types/<kind>.node.ts`, that declares its data here by
 * merging (`declare module '../../graphTypes' { interface ExtraNodeKinds { <kind>: MyData } }`). Nothing in this file changes.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ExtraNodeKinds {}
/** Same for a system part: its file merges `interface ExtraSystemTypes { <type>: true }`. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ExtraSystemTypes {}
export const BASE_NODE_KINDS = ['text', 'image', 'video', 'audio', 'model3d', 'tool', 'asset', 'ref'] as const;
export type BaseNodeKind = typeof BASE_NODE_KINDS[number];
export type NodeKind = BaseNodeKind | keyof ExtraNodeKinds;
export type PortType = 'text' | MediaKind;
/** Link classes: `data` carries values and runs in order; `ref` points; `control` governs. `both` only on ref and control. */
export const LINK_KINDS = ['data', 'ref', 'control'] as const;
export type LinkKind = typeof LINK_KINDS[number];
export const BASE_SYSTEM_NODE_TYPES = ['chat', 'agent', 'provider', 'model', 'session', 'space', 'designer.doc', 'library', 'toolset', 'prompt', 'mediaSettings'] as const;
export type BaseSystemNodeType = typeof BASE_SYSTEM_NODE_TYPES[number];
export type SystemNodeType = BaseSystemNodeType | keyof ExtraSystemTypes;
export const MODEL_ATTACH_MODES = ['wired', 'docked', 'grouped', 'merged'] as const;
export type ModelAttachMode = typeof MODEL_ATTACH_MODES[number];

export interface PortSpec {
  id: string;
  direction: 'in' | 'out';
  kind: LinkKind;
  type: string;
  multi?: boolean;
  label?: string;
}

export interface NodeTypeSpec {
  type: SystemNodeType;
  title: string;
  ports: PortSpec[];
}

export interface TextNodeData {
  kind: 'text';
  title: string;
  text: string;
}

export interface GenNodeData {
  /** Plan-local identities retain their source node IDs when materialized. */
  subjects?: PlanSubject[];
  kind: MediaKind;
  title: string;
  prompt: string;
  modelRef: string;
  settings: GenSettings;
  generationId?: string;
  outputIndex: number;
  /** Painted-over copy of the result (Sketch): replaces it downstream; clearing restores the original. */
  sketchAssetId?: string;
  /** Audio nodes whose model answers with text (MiniMax Lyrics): the output port is text. Kept with `modelRef`. */
  textOutput?: boolean;
}

export interface ToolNodeData {
  kind: 'tool';
  title: string;
  op: OpId;
  params: Record<string, AdvancedValue>;
  generationId?: string;
  outputIndex: number;
  /** Painted-over copy of the result (Sketch), as above. */
  sketchAssetId?: string;
}

export interface AssetNodeData {
  kind: 'asset';
  title: string;
  assetId: string | null;
  /** Painted-over copy of the result (Sketch), as above. */
  sketchAssetId?: string;
}

/** A system part (chat, agent, model, doc, Space...) that POINTS to the data where it lives: nothing is copied. */
export interface RefNodeData {
  kind: 'ref';
  type: SystemNodeType;
  ref: string;
  title: string;
  attachMode?: ModelAttachMode;
  /** Agent node: its own LLM. Absent = follows the default in settings.agent (nothing to migrate). */
  llm?: { provider: string; model: string };
  /** Chat node: the agent node its messages go to when several are connected. Absent = the first connected. */
  recipient?: string;
  /** Prompt node: its own text. Absent with ref 'composer' = the composer's text (the Studio prompt box). */
  promptText?: string;
  dockedTo?: string;
  mergedModels?: string[];
  mediaKind?: MediaKind | 'llm';
  /** Studio, Nodes and Designer Space nodes (omnicanvas): the look the user chose. Absent = thumbnail. */
  view?: 'thumb' | 'node';
  /** Chat node: shows its agent and model connections (undocked) instead of looking like Studio's chat. */
  undocked?: boolean;
}

/** `v`: the descriptor version this node's data was last written at; absent = 1 (see nodecore/migrate.ts). */
export type GraphNodeData = (TextNodeData | GenNodeData | ToolNodeData | AssetNodeData | RefNodeData | ExtraNodeKinds[keyof ExtraNodeKinds]) & { v?: number; /** Library entry: which section of it this element is in. */ section?: string };

export interface GraphNode {
  id: string;
  position: { x: number; y: number };
  data: GraphNodeData;
  planId?: string;
  /** Put here by the omnicanvas, not by the user: the ordinary Nodes canvas does not show it. */
  omni?: true;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  /** Target port: prompt, ref, first, last, input. */
  targetHandle: string;
  sourceHandle: string;
  outputIndex?: number;
  /** Link class; absent means `data` (saved sessions load unchanged). */
  kind?: LinkKind;
  /** Bidirectional; only on `ref` and `control` links. */
  both?: boolean;
  /** Pinned reference (ADR 0031): the source revision this link was fixed to. Absent = moving (follows the current one). */
  pin?: string;
  /** Optional label for explicit ref links (e.g. Library relationships). */
  label?: string;
}

/** A link whose node was deleted (ADR 0031 point 2): kept visible to the core as invalid, never silently dropped. */
export interface BrokenLink {
  edge: GraphEdge;
  /** Which end of the link is gone. */
  missing: 'source' | 'target';
  /** Why it is recorded: `deleted` (the user or an agent removed the node: silent, kept only to restore) or `incompatible` (the cable exists but cannot work: reported). Absent: `deleted`. */
  reason?: 'deleted' | 'incompatible';
  at: number;
}

/** A named frame around some nodes (each node is in one group at most). */
export interface GraphGroup {
  id: string;
  title: string;
  nodeIds: string[];
  /** Optional background tint (hex); none by default. */
  color?: string;
  /** Set when the group came from or was saved to a Library entry. */
  library?: KitGroupLink;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  groups?: GraphGroup[];
  /** Where the Nodes canvas was left (flow offset and zoom); not part of undo. */
  viewport?: { x: number; y: number; zoom: number };
  /** The same for the omnicanvas, which keeps its own view. */
  omniViewport?: { x: number; y: number; zoom: number };
  /** When the omnicanvas last brought the session's assets in: older ones the user removed do not come back. */
  omniAt?: number;
  /** Asset ids already seen at `omniAt`, so new assets sharing that timestamp are not discarded. */
  omniAtIds?: string[];
  /** Links whose node was deleted (or that cannot work): kept to restore; only `incompatible` ones are reported as invalid. Cleared when the node comes back. */
  broken?: BrokenLink[];
}

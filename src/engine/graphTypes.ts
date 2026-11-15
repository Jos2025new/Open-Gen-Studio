import type { AdvancedValue, GenSettings, MediaKind, OpId, PlanSubject } from './types';

/* The node graph: creative nodes, system nodes that point to data where it lives, and classed links. Re-exported by types.ts. */

export type NodeKind = 'text' | 'image' | 'video' | 'audio' | 'model3d' | 'tool' | 'asset' | 'ref';
export type PortType = 'text' | 'image' | 'video' | 'audio' | 'model3d';
/** Link classes: `data` carries values and runs in order; `ref` points; `control` governs. `both` only on ref and control. */
export type LinkKind = 'data' | 'ref' | 'control';
export type SystemNodeType = 'chat' | 'agent' | 'provider' | 'model' | 'session' | 'space' | 'designer.doc' | 'library' | 'toolset';
export type ModelAttachMode = 'wired' | 'docked' | 'grouped' | 'merged';

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
  commands: string[];
}

export interface TextNodeData {
  kind: 'text';
  title: string;
  text: string;
}

export interface GenNodeData {
  /** Plan-local identities retain their source node IDs when materialized. */
  subjects?: PlanSubject[];
  kind: 'image' | 'video' | 'audio' | 'model3d';
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
  dockedTo?: string;
  mergedModels?: string[];
  mediaKind?: MediaKind | 'llm';
}

export type GraphNodeData = TextNodeData | GenNodeData | ToolNodeData | AssetNodeData | RefNodeData;

export interface GraphNode {
  id: string;
  position: { x: number; y: number };
  data: GraphNodeData;
  planId?: string;
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
}

/** A named frame around some nodes (each node is in one group at most). */
export interface GraphGroup {
  id: string;
  title: string;
  nodeIds: string[];
  /** Optional background tint (hex); none by default. */
  color?: string;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  groups?: GraphGroup[];
  viewport?: { x: number; y: number; zoom: number };
}

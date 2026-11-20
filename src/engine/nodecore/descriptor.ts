import type { Asset, GraphNodeData, PortType } from '../types';
import type { GraphEdge, GraphNode } from '../types';
import type { ResolveEnv } from './resolver';

/*
 * One descriptor per node type (ADR 0031 point 1). A file in `types/` declares what a type owns (parameters), its
 * typed ports, what its inputs affect, its pure `evaluate`, its explicit actions and its version with migrations.
 * `registry.ts` collects them; `scripts/check-node-descriptors.mjs` fails `npm test` when a type has none.
 */
export type NodeKindId = GraphNodeData['kind'];
/** An explicit action: the only things that spend or send. Connecting and editing are never actions. */
export type NodeActionId = 'generate' | 'run-tool' | 'send';

/** What a node delivers on an edge now: the value and the revision label of that value (`edited` when a source asset was revised). */
export interface Delivery { value: string | null; revision: string | null; edited?: true }

export interface PortInfo { id: string; type: PortType; label: string; multi: boolean }

export interface NodeDescriptor {
  kind: NodeKindId;
  /** Shape version of the node's data; `migrate[n]` upgrades data saved at version n to n + 1. */
  version: number;
  /** The state this node owns: keys of its data an edit may write. */
  params: readonly string[];
  inputs(data: GraphNodeData): PortInfo[];
  output(data: GraphNodeData, assets: Record<string, Asset>): PortType | null;
  /** Input ports an action cannot run without: an invalid or empty cable there blocks it. */
  required: readonly string[];
  /** Input port id → whether a change there makes the output stale. A port missing from the map affects it. */
  affects: Readonly<Record<string, boolean>>;
  /** What the node delivers on one edge. The resolver asks it for every input; it reads only the env it is given. */
  evaluate(node: GraphNode, edge: Pick<GraphEdge, 'outputIndex'>, env: ResolveEnv): Delivery;
  actions: readonly NodeActionId[];
  migrate?: Readonly<Record<number, (data: GraphNodeData) => GraphNodeData>>;
}

export const defineNode = (d: NodeDescriptor): NodeDescriptor => d;

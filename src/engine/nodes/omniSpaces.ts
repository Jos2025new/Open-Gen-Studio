import type { Graph, GraphNode, PortSpec } from '../types';

/*
 * The omnicanvas (plan "todo es un nodo", step 12). Studio, Nodes and Designer are one node each per session; they
 * point at the Space where it lives. What only the omnicanvas shows (system and Space nodes, assets it brought in)
 * is hidden from the ordinary Nodes canvas, which stays as it was.
 */

export const OMNI_SPACES = ['studio', 'nodes', 'designer'] as const;
export type OmniSpace = (typeof OMNI_SPACES)[number];
export const OMNI_SPACE_TITLES: Record<OmniSpace, string> = { studio: 'Studio', nodes: 'Nodes', designer: 'Designer' };
export const omniSpaceNodeId = (space: OmniSpace): string => `sys_space_${space}`;

export function isOmniSpace(ref: string): ref is OmniSpace {
  return (OMNI_SPACES as readonly string[]).includes(ref);
}

const control = (id: string, direction: 'in' | 'out'): PortSpec => ({ id, direction, kind: 'control', type: 'control', multi: true, label: 'Control' });
const ref = (id: string, direction: 'in' | 'out', label: string): PortSpec => ({ id, direction, kind: 'ref', type: 'any', multi: true, label });
const data = (id: string, direction: 'in' | 'out', type: string, label: string): PortSpec => ({ id, direction, kind: 'data', type, multi: true, label });

/** The three link classes in and out of each Space; the same ids as the other Space nodes, named for what the Space takes and gives. */
const PORTS: Record<OmniSpace, PortSpec[]> = {
  studio: [control('control', 'in'), ref('ref', 'in', 'References'), data('in', 'in', 'any', 'Prompt or assets'), control('out_control', 'out'), ref('space', 'out', 'Studio'), data('out', 'out', 'image', 'Results')],
  nodes: [control('control', 'in'), ref('ref', 'in', 'References'), data('in', 'in', 'any', 'Inputs'), control('out_control', 'out'), ref('space', 'out', 'Nodes'), data('out', 'out', 'image', 'Results')],
  designer: [control('control', 'in'), ref('ref', 'in', 'References'), data('in', 'in', 'image', 'Layer input'), control('out_control', 'out'), ref('space', 'out', 'Designer'), data('out', 'out', 'image', 'Render')],
};

export function omniSpacePorts(spaceRef: string): PortSpec[] | undefined {
  return isOmniSpace(spaceRef) ? PORTS[spaceRef] : undefined;
}

/** A node only the omnicanvas shows: system and Space nodes, and assets it brought in. */
export const omniOnly = (n: GraphNode): boolean => n.data.kind === 'ref' || n.omni === true;

/** The graph as the ordinary Nodes canvas draws it: without omnicanvas-only nodes and the links that touch them. The same object when there are none. */
export function ordinaryGraph(g: Graph): Graph {
  if (!g.nodes.some(omniOnly)) return g;
  const hidden = new Set(g.nodes.filter(omniOnly).map((n) => n.id));
  const groups = g.groups?.map((gr) => ({ ...gr, nodeIds: gr.nodeIds.filter((id) => !hidden.has(id)) })).filter((gr) => gr.nodeIds.length > 1);
  return {
    ...g,
    nodes: g.nodes.filter((n) => !hidden.has(n.id)),
    edges: g.edges.filter((e) => !hidden.has(e.source) && !hidden.has(e.target)),
    ...(g.groups ? { groups: groups?.length ? groups : undefined } : {}),
  };
}

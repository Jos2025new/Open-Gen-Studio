import { z } from 'zod';
import { registerHistory } from '../commands/history';
import { defineCommand, type Availability, type CommandContext, type CommandSpec, type Target } from '../commands/types';
import { patchSession, useStore } from '../../store/store';
import type { Graph, GraphNode } from '../types';
import { openHistoryGroup } from './history';

/*
 * What the node graph's command files share (ADR 0030): the target of a graph command, its undo history, and the
 * checks that turn an action's silent "nothing happened" into a reason the caller can read.
 */

export type GraphTarget = { session: string };
export const nodeRef = z.string().min(1).max(80);
export const edgeRef = z.string().min(1).max(80);

const NO_SESSION = 'No such session.';

/** The graph a command acts on; throws the reason when the session is gone. */
export function graphOf(on: Target): Graph {
  const graph = useStore.getState().sessions[on.session ?? '']?.graph;
  if (!graph) throw new Error(NO_SESSION);
  return graph;
}

export function findNode(on: Target, id: string): GraphNode | undefined {
  return useStore.getState().sessions[on.session ?? '']?.graph.nodes.find((n) => n.id === id);
}

export function nodeOf(on: Target, id: string): GraphNode {
  const node = findNode(on, id);
  if (!node) throw new Error(`No such node: ${id}.`);
  return node;
}

type Named = {
  node?: unknown;
  nodes?: unknown;
  source?: unknown;
  target?: unknown;
  targets?: unknown;
  edge?: unknown;
  edges?: unknown;
};

const strings = (...values: unknown[]): string[] => values.flatMap((v) => (Array.isArray(v) ? v : [v])).filter((v): v is string => typeof v === 'string');

/** The session exists and, when the call names nodes or edges, so do they. */
export function hasTarget(ctx: CommandContext, args?: Named): Availability {
  const graph = useStore.getState().sessions[ctx.on.session ?? '']?.graph;
  if (!graph) return NO_SESSION;
  const missingNode = strings(args?.node, args?.source, args?.target, args?.nodes, args?.targets).find((id) => !graph.nodes.some((n) => n.id === id));
  if (missingNode) return `No such node: ${missingNode}.`;
  const missingEdge = strings(args?.edge, args?.edges).find((id) => !graph.edges.some((e) => e.id === id));
  return missingEdge ? `No such edge: ${missingEdge}.` : true;
}

type GraphSpec<A, R> = Omit<CommandSpec<A, R>, 'needs' | 'history' | 'run'> & {
  /** `false` for what the graph does not record in undo. */
  undo?: false;
  run: (on: GraphTarget, args: A, ctx: CommandContext) => R;
};

/** A command on one session's graph: it needs `on.session`, and is one undo step in that graph. */
export function nodeCommand<A, R>(spec: GraphSpec<A, R>): CommandSpec<A, R> {
  const { undo, run, ...rest } = spec;
  return defineCommand<A, R>({
    available: hasTarget as CommandSpec<A, R>['available'],
    ...rest,
    needs: ['session'],
    ...(undo === false ? {} : { history: (on: Target) => `nodes:${on.session}` }),
    run: (ctx, args) => run(ctx.on as GraphTarget, args, ctx),
  });
}

/** The graph's undo behind `nodes:<session>`: every `recordGraph` of a call or sequence is one step; a failure puts it back. */
registerHistory('nodes', {
  begin(sessionId) {
    const before = useStore.getState().sessions[sessionId]?.graph;
    const group = openHistoryGroup(sessionId);
    return {
      commit: () => group.close(),
      rollback: () => {
        const back = group.revert() ?? before;
        if (back) patchSession(sessionId, (s) => ({ ...s, graph: back }));
      },
    };
  },
});

import { getStudioBoard } from '../../lib/studioBoard';
import { useStore } from '../../store/store';
import { setStudioBoard } from '../../lib/studioBoard';
import { readGraph } from '../flow/graphView';
import { nodeSelection } from '../flow/selection';
import { z } from 'zod';
import type { Workspace } from '../types';

/**
 * The canvas the agent works on: the workspace the user is in, except in Studio (the chat), where an open board
 * showing Nodes or the Designer makes that canvas the agent's. Read it again wherever the board may have changed.
 */
export function agentCanvas(): Workspace {
  const ws = useStore.getState().ui.workspace;
  if (ws !== 'chat') return ws;
  const b = getStudioBoard();
  return b.open && b.view === 'nodes' ? 'node' : b.open && b.view === 'designer' ? 'designer' : 'chat';
}

/** The agent is back on the chat canvas: the board stops showing Nodes or the Designer (the board stays as open or closed as it was). */
export function backToChatCanvas(): Workspace {
  if (getStudioBoard().view !== 'assets') setStudioBoard({ view: 'assets' });
  return agentCanvas();
}

/** What the context says about Studio's board, or nothing outside Studio. */
export function studioLine(): string[] {
  if (useStore.getState().ui.workspace !== 'chat') return [];
  const b = getStudioBoard();
  const shows = !b.open ? 'closed' : b.view === 'nodes' ? 'Nodes (the node canvas is your canvas now)' : b.view === 'designer' ? 'the Designer (the designer canvas is your canvas now)' : 'Generations (the chat canvas)';
  return [`You are in Studio (chat). The board shows: ${shows}.`];
}

export const openBoardSchema = z.object({ view: z.enum(['assets', 'nodes', 'designer', 'closed']) }).strict();

export const OPEN_BOARD_TOOL = {
  type: 'function' as const,
  function: {
    name: 'open_board',
    description:
      'Studio (the chat) only. Sets what the board beside the chat shows: "assets" (Generations), "nodes" (the node canvas), "designer" (the Designer: layers on a stage) or "closed". While the board shows Nodes or the Designer, that canvas is your canvas: its tools (read_graph, edit_node…; view_canvas, designer_fx, layer plan steps…) work on it, in this same turn. Opens or switches the view only; nothing runs and nothing is charged. Call it before node or Designer work when the user is in Studio and the board does not show that canvas.',
    parameters: { type: 'object', properties: { view: { type: 'string', enum: ['assets', 'nodes', 'designer', 'closed'] } }, required: ['view'] },
  },
};

export const STUDIO_RULE =
  '- In Studio (app_context says "You are in Studio") the board beside the chat can show Nodes or the Designer: MUST call open_board with view "nodes" before node work (read_graph, edit_node, run_nodes…) and "designer" before Designer work (view_canvas, designer_fx, layer steps); your canvas is then that one, in the same turn. open_board with "assets" or "closed" returns to the chat canvas. Never ask the user to open the board by hand.';

/** Runs open_board: the text to answer the model with, and the log label when the board changed. */
export function openBoard(input: unknown, graph: Parameters<typeof readGraph>[0], sessionId: string): { text: string; label?: string; canvas?: Workspace } {
  const v = openBoardSchema.safeParse(input);
  const where = useStore.getState().ui.workspace;
  if (!v.success) return { text: `Invalid open_board input: ${v.error.issues.map((i) => i.message).join('; ')}` };
  if (where !== 'chat') return { text: `open_board works only in Studio (the chat). The user is on the ${where} canvas now: use that canvas's own tools.` };
  const view = v.data.view;
  setStudioBoard(view === 'closed' ? { open: false } : { open: true, view });
  const canvas = agentCanvas();
  const label = view === 'closed' ? 'Closed the board' : view === 'nodes' ? 'Opened the node canvas in the board' : view === 'designer' ? 'Opened the Designer in the board' : 'Showed Generations in the board';
  const docs = useStore.getState().sessions[sessionId]?.docs.length ?? 0;
  const text = canvas === 'designer'
    ? `The board shows the Designer; the designer canvas is your canvas now, in this turn too. ${docs ? `This session has ${docs} design${docs === 1 ? '' : 's'}.` : 'This session has no design yet: send the chat images with continue_in_designer or start one.'}`
    : canvas === 'node'
    ? `The board shows Nodes; the node canvas is your canvas now, in this turn too. Node index:\n${readGraph(graph, useStore.getState().generations, nodeSelection(sessionId), {})}`
    : `The board ${view === 'closed' ? 'is closed' : 'shows Generations'}; your canvas is the chat canvas.`;
  return { text, label, canvas };
}

import { getStudioBoard } from '../../lib/studioBoard';
import { setUi, useStore } from '../../store/store';
import { setStudioBoard } from '../../lib/studioBoard';
import { readGraph } from '../flow/graphView';
import { nodeSelection } from '../flow/selection';
import { z } from 'zod';
import type { Workspace } from '../types';

/**
 * The canvas a turn starts on: the workspace the user is in. Studio is the chat canvas whatever its board shows (the
 * board is a viewer, 2026-10-24); the agent works on Nodes or the Designer from Studio only after it opens them itself
 * (open_board, continue_in_canvas), for that turn.
 */
export function agentCanvas(): Workspace {
  return useStore.getState().ui.workspace;
}

const viewCanvas = (view: string): Workspace => (view === 'nodes' ? 'node' : view === 'designer' ? 'designer' : 'chat');

/** The agent is back on the chat canvas: the board stops showing Nodes or the Designer (the board stays as open or closed as it was). */
export function backToChatCanvas(): Workspace {
  if (getStudioBoard().view !== 'assets') setStudioBoard({ view: 'assets' });
  return useStore.getState().ui.workspace === 'chat' ? 'chat' : agentCanvas();
}

/** The agent moves work to Nodes or the Designer: in Studio the board opens on that tab and the workspace stays; elsewhere the workspace switches. */
export function moveToCanvas(view: 'nodes' | 'designer'): Workspace {
  if (useStore.getState().ui.workspace === 'chat') setStudioBoard({ open: true, view });
  else if (useStore.getState().ui.workspace !== viewCanvas(view)) setUi({ workspace: viewCanvas(view), panel: null, lightbox: null });
  return viewCanvas(view);
}

/** What the context says about Studio's board, or nothing outside Studio. */
export function studioLine(): string[] {
  if (useStore.getState().ui.workspace !== 'chat') return [];
  const b = getStudioBoard();
  const shows = !b.open ? 'closed' : b.view === 'nodes' ? 'Nodes' : b.view === 'designer' ? 'the Designer' : 'Generations';
  return [`You are in Studio (chat), on the chat canvas, whatever the board shows. The board shows: ${shows} (a viewer; it does not change your canvas). Asked where you are, say Studio${b.open && b.view !== 'assets' ? `, with the board on ${shows}` : ''}. Plan and confirm settings as in the chat; node or Designer work only when the user asks for it, after open_board.`];
}

export const openBoardSchema = z.object({ view: z.enum(['assets', 'nodes', 'designer', 'closed']) }).strict();

export const OPEN_BOARD_TOOL = {
  type: 'function' as const,
  function: {
    name: 'open_board',
    description:
      'Studio (the chat) only. Sets what the board beside the chat shows: "assets" (Generations), "nodes" (the node canvas), "designer" (the Designer: layers on a stage) or "closed". After open_board with Nodes or the Designer, that canvas is your canvas for this turn: its tools (read_graph, edit_node…; view_canvas, designer_fx, layer plan steps…) work on it. Opens or switches the view only; nothing runs and nothing is charged. Call it before node or Designer work in Studio, whatever the board shows.',
    parameters: { type: 'object', properties: { view: { type: 'string', enum: ['assets', 'nodes', 'designer', 'closed'] } }, required: ['view'] },
  },
};

/** Moved from tools.ts unchanged (size baseline). */
export const CONTINUE_IN_CANVAS_TOOL = {
  type: 'function' as const,
  function: {
    name: 'continue_in_canvas',
    description:
      'Any canvas. When the user wants to move to or continue on the node canvas ("pasémonos al canvas de nodos", "continuamos en canvas"): the app switches the user\'s view to Nodes (in Studio the board opens on Nodes instead) and adds every finished chat result as a node with its own result, prompt, model and settings, connected by the inputs it used; nothing runs again and nothing is charged. Returns the new node ids. Call it once; then build on those nodes.',
    parameters: { type: 'object', properties: {} },
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
  const canvas = view === 'closed' ? 'chat' : viewCanvas(view);
  const label = view === 'closed' ? 'Closed the board' : view === 'nodes' ? 'Opened the node canvas in the board' : view === 'designer' ? 'Opened the Designer in the board' : 'Showed Generations in the board';
  const docs = useStore.getState().sessions[sessionId]?.docs.length ?? 0;
  const text = canvas === 'designer'
    ? `The board shows the Designer; the designer canvas is your canvas now, in this turn too. ${docs ? `This session has ${docs} design${docs === 1 ? '' : 's'}.` : 'This session has no design yet: send the chat images with continue_in_designer or start one.'}`
    : canvas === 'node'
    ? `The board shows Nodes; the node canvas is your canvas now, in this turn too. Node index:\n${readGraph(graph, useStore.getState().generations, nodeSelection(sessionId), {})}`
    : `The board ${view === 'closed' ? 'is closed' : 'shows Generations'}; your canvas is the chat canvas.`;
  return { text, label, canvas };
}

import type { FxCommand } from '../fx/commands';
import { activeDoc } from '../design/actions';
import { runFx } from '../design/fx';
import { designerFxSchema } from './designerTools';
import { markAgentEdit } from '../design/agentGlow';

/** Runs the commands on the active design; the text is the tool result for the agent. */
export function designerFxTool(sessionId: string, input: unknown): { text: string; done: boolean } {
  const v = designerFxSchema.safeParse(input);
  if (!v.success) return { text: `Invalid designer_fx: ${v.error.message}`, done: false };
  const doc = activeDoc(sessionId);
  if (!doc) return { text: 'There is no open design.', done: false };
  const run = runFx(sessionId, doc.id, v.data.commands as FxCommand[]);
  if (!run || run.error) return { text: run?.error ?? 'The design is gone.', done: false };
  // The agent's edit glows on the canvas for a moment (in memory only: never saved, undone or exported).
  const after = activeDoc(sessionId);
  if (after) markAgentEdit(doc.id, doc, after);
  return { text: `${run.results.join(' ')} The user can undo it all with one Ctrl+Z.`, done: true };
}

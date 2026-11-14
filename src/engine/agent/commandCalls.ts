import { findCommands, run } from '../commands';
import { activeDoc, getDoc } from '../design/actions';
import { markAgentEdit } from '../design/agentGlow';
import { findCommandsSchema, runCommandsSchema } from './commandTools';

/* Runs find_commands and run_commands. The text is the tool result the agent reads. */

type ToolAnswer = { text: string; done: boolean };
const problems = (error: { issues: { path: PropertyKey[]; message: string }[] }) => error.issues.map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; ');
const RESULT_MAX = 4000;

/** The commands of an area, one line each, with whether each can run on the document on screen. */
export function findCommandsTool(sessionId: string, input: unknown): ToolAnswer {
  const v = findCommandsSchema.safeParse(input ?? {});
  if (!v.success) return { text: `Invalid find_commands input: ${problems(v.error)}`, done: false };
  const doc = activeDoc(sessionId);
  const found = findCommands({ ...v.data, signatures: true, caller: 'agent', ...(doc ? { on: { session: sessionId, doc: doc.id } } : {}) });
  if (!found.length) return { text: 'No command matches. Areas: designer.', done: false };
  const lines = found.map((f) => `${f.id} ${f.signature} — ${f.description ?? f.title}${typeof f.available === 'string' ? ` [not now: ${f.available}]` : ''}`);
  const where = doc ? `Document on screen: ${doc.id} "${doc.name}", ${doc.width}x${doc.height}.` : 'No document is open: start with designer.doc.new.';
  return { text: [where, ...lines].join('\n'), done: true };
}

/** Runs the sequence on this session; steps act on the document on screen unless they name another. */
export async function runCommandsTool(sessionId: string, input: unknown, signal?: AbortSignal): Promise<ToolAnswer> {
  const v = runCommandsSchema.safeParse(input);
  if (!v.success) return { text: `Invalid run_commands input: ${problems(v.error)}`, done: false };
  const doc = activeDoc(sessionId);
  const result = await run({ seq: v.data.seq, on: { session: sessionId, ...(doc ? { doc: doc.id } : {}) } }, { caller: 'agent', signal });
  const ran = result.results.length;
  if (!result.ok) {
    const kept = ran === 0 ? 'Nothing ran.' : result.rolledBack ? `Steps 1 to ${ran} ran and were taken back: the documents are as before.` : `Steps 1 to ${ran} ran and stay.`;
    return { text: `Step ${result.error.step ?? 1} failed (${result.error.code}): ${result.error.message} ${kept}`, done: false };
  }
  // The agent's edit glows on the canvas for a moment (in memory only: never saved, undone or exported).
  const after = doc ? getDoc(sessionId, doc.id) : undefined;
  if (doc && after) markAgentEdit(doc.id, doc, after);
  const results = JSON.stringify(result.results);
  return { text: `Done, ${ran} step${ran === 1 ? '' : 's'}. Results: ${results.length > RESULT_MAX ? `${results.slice(0, RESULT_MAX)}… (cut)` : results}. One Ctrl+Z per document undoes it all.`, done: true };
}

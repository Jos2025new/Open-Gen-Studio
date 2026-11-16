import { allCommands, command, findCommands, run } from '../commands';
import { activeDoc, getDoc } from '../design/actions';
import { markAgentEdit } from '../design/agentGlow';
import { findCommandsSchema, runCommandsSchema } from './commandTools';

/* Runs find_commands and run_commands. The text is the tool result the agent reads. */

type ToolAnswer = { text: string; done: boolean };
const problems = (error: { issues: { path: PropertyKey[]; message: string }[] }) => error.issues.map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; ');
const RESULT_MAX = 4000;
/** Commands the agent never sees and never runs (id -> why). Whoever types the id gets the reason and nothing runs. */
export const AGENT_HIDDEN: Record<string, string> = {
  'models.composer.pick': 'the model is the user\'s choice',
  'models.composer.reset': 'the model is the user\'s choice',
  'models.agent.pick': 'the model is the user\'s choice',
  'models.agent.reset': 'the model is the user\'s choice',
  'skills.skill.select': 'the skill is the user\'s choice',
  'skills.workflow.select': 'the workflow is the user\'s choice',
  'sessions.select': 'it would move the user to another session in the middle of the agent\'s turn',
  'sessions.new': 'it would move the user to another session in the middle of the agent\'s turn',
  'sessions.archive': 'it hides sessions from the user\'s list',
};

/** What each area is for: the index `find_commands` answers when it gets neither `area` nor `text`. */
const AREAS: Record<string, string> = {
  designer: 'documents, layers, text, shapes, filters and effects of the Designer',
  nodes: 'the node graph: nodes, connections, layout and runs',
  studio: 'assets and generations: attach, estimate, regenerate, delete, start a generation',
  library: 'saved subjects, styles and voices',
  skills: 'read skills, workflows and guides',
  models: 'the model catalog (read only)',
  sessions: 'list, rename, pin and title sessions',
};
const NEEDS_APPROVAL = 'needs the user\'s approval: not available from here yet';
const DOC_CREATORS = new Set(['designer.doc.new', 'designer.doc.ensure', 'designer.doc.from_asset']);
const ON_DOC_HINT = ' (target a new doc from an earlier step with "on": "$1.doc", or pass an id from designer.doc.list)';
const visible = <T extends { id: string }>(items: T[]) => items.filter((item) => !AGENT_HIDDEN[item.id]);
const areaOf = (id: string) => id.slice(0, id.indexOf('.'));
const formatLine = (f: { id: string; signature?: string; description?: string; title: string; effect: string; available?: unknown }) =>
  `${f.id} ${f.signature} — ${f.description ?? f.title}${f.effect === 'spend' || f.effect === 'delete' ? ` [${NEEDS_APPROVAL}]` : ''}${typeof f.available === 'string' ? ` [not now: ${f.available}]` : ''}`;

let catalogCache: string | undefined;
/** Static one-line reference of every command the agent may call, for the cached system prompt. Byte-identical across calls. */
export function commandCatalog(): string {
  return (catalogCache ??= [
    'COMMANDS FOR run_commands (all command ids and arguments; call run_commands directly without calling find_commands first):',
    ...visible(findCommands({ signatures: true })).map(formatLine),
  ].join('\n'));
}

/** The commands of an area, one line each, with whether each can run now; with neither area nor text, an index of the areas. */
export function findCommandsTool(sessionId: string, input: unknown): ToolAnswer {
  const v = findCommandsSchema.safeParse(input ?? {});
  if (!v.success) return { text: `Invalid find_commands input: ${problems(v.error)}`, done: false };
  const doc = activeDoc(sessionId);
  const where = doc ? ` Document on screen: ${doc.id} "${doc.name}", ${doc.width}x${doc.height}.` : '';
  const context = `Commands run as the user's own actions in this session.${where}`;
  const everything = visible(allCommands());
  const index = (): string => {
    const names = Object.keys(AREAS);
    const known = [...names, ...new Set(everything.map((c) => areaOf(c.id)).filter((a) => !names.includes(a)))];
    return [context, 'Areas (call find_commands with area, or with text):', ...known.map((a) => `${a} (${everything.filter((c) => areaOf(c.id) === a).length}) — ${AREAS[a] ?? 'other commands'}`)].join('\n');
  };
  const { area, text } = v.data;
  if ((!area && !text) || (area && !everything.some((c) => areaOf(c.id) === area))) return { text: index(), done: true };
  const found = visible(findCommands({ area, text, signatures: true, caller: 'agent', ...(doc ? { on: { session: sessionId, doc: doc.id } } : { on: { session: sessionId } }) }));
  if (!found.length) return { text: `No command matches. Areas: ${Object.keys(AREAS).join(', ')}.`, done: false };
  const lines = found.map(formatLine);
  return { text: [context, ...lines].join('\n'), done: true };
}

/** Runs the sequence on this session; steps act on the document on screen unless they name another. */
export async function runCommandsTool(sessionId: string, input: unknown, signal?: AbortSignal): Promise<ToolAnswer> {
  const v = runCommandsSchema.safeParse(input);
  if (!v.success) return { text: `Invalid run_commands input: ${problems(v.error)}`, done: false };
  let docRef: string | undefined;
  const seq = v.data.seq.map((step, i) => {
    const spec = command(step.cmd);
    const next = !step.on?.doc && docRef && spec?.needs?.includes('doc') ? { ...step, on: { doc: docRef } } : step;
    if (spec && DOC_CREATORS.has(spec.id)) docRef = `$${i + 1}.doc`;
    return next;
  });
  for (const [i, step] of seq.entries()) {
    const reason = AGENT_HIDDEN[command(step.cmd)?.id ?? step.cmd];
    if (reason) return { text: `Step ${i + 1}: "${step.cmd}" is not available to the agent: ${reason}. Nothing ran.`, done: false };
  }
  const doc = activeDoc(sessionId);
  const result = await run({ seq, on: { session: sessionId, ...(doc ? { doc: doc.id } : {}) } }, { caller: 'agent', signal });
  const ran = result.results.length;
  if (!result.ok) {
    const kept = ran === 0 ? 'Nothing ran.'
      : result.kept ? `Steps 1 to ${ran} ran and stay, as one undo step: the sequence waited on a step and the user may have edited meanwhile, so nothing was taken back. Read the document before going on.`
      : result.rolledBack ? `Steps 1 to ${ran} ran and were taken back: the documents are as before.` : `Steps 1 to ${ran} ran and stay.`;
    if (result.error.code === 'denied') return { text: `Step ${result.error.step ?? 1} ${NEEDS_APPROVAL} (it spends or deletes). Nothing ran.`, done: false };
    const msg = result.error.code === 'target' && result.error.message.includes('on.doc') ? `${result.error.message.replace(/\.$/, '')}${ON_DOC_HINT}.` : result.error.message;
    return { text: `Step ${result.error.step ?? 1} failed (${result.error.code}): ${msg} ${kept}`, done: false };
  }
  // The agent's edit glows on the canvas for a moment (in memory only: never saved, undone or exported).
  const after = doc ? getDoc(sessionId, doc.id) : undefined;
  if (doc && after) markAgentEdit(doc.id, doc, after);
  const results = JSON.stringify(result.results);
  return { text: `Done, ${ran} step${ran === 1 ? '' : 's'}. Results: ${results.length > RESULT_MAX ? `${results.slice(0, RESULT_MAX)}… (cut)` : results}. One Ctrl+Z per document undoes it all.`, done: true };
}

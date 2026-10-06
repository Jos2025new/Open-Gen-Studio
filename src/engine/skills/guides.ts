import { WORKFLOW_CONTRACT } from '../procedure';
import { APP_GUIDES } from './app';
import { MODEL_GUIDES, modelGuide } from '../guides';
import type { Workspace, LlmMessage } from '../types';
import stagedGuide from '../guides/staged.md?raw';
import { SKILLS, skillById } from './catalog';
import { WORKFLOWS, workflowById, describeWorkflow } from './workflows';
import type { Workflow } from './types';

/**
 * Rules shared by every piece with 2+ results, clips or stages (questions card, look, pre-production, sheets, pilot,
 * one clip or several, sequence). One source of truth: not repeated in the system prompt, not a pickable skill.
 * It travels with any workflow the agent loads (same tool result, no extra round).
 */
export const STAGED_ID = 'staged';
export const STAGED_GUIDE = stagedGuide;

/** One line per workflow and skill, for the agent's system prompt: name and when to use it. */
export function guideIndex(): string {
  return [
    ...WORKFLOWS.map((w) => `  workflow:${w.id} — ${w.name}: ${w.description}${w.variants?.length ? ` (variants: ${w.variants.map((v) => v.id).join(', ')})` : ''}${canvasNote(w)}`),
    `  skill:${STAGED_ID} — Staged pieces: the rules for any piece with 2+ results, clips or stages (questions card, look, pre-production, sheets, pilot, one clip or several, sequence). Comes with every workflow; load it yourself only when no workflow fits.`,
    ...SKILLS.map((k) => `  skill:${k.id} — ${k.name}: ${k.description}`),
    ...MODEL_GUIDES.map((g) => `  model:${g.id} — how to write prompts for ${g.name}${g.optional ? ' (optional)' : ''}`),
    ...APP_GUIDES.map((g) => `  app:${g.id} — ${g.name}: ${g.description}`),
  ].join('\n');
}

const ALL_CANVASES: Workspace[] = ['chat', 'node', 'designer'];

/** " (chat only)" when a workflow does not work on every canvas; the prompt stays the same on all of them. */
function canvasNote(w: Workflow): string {
  return ALL_CANVASES.every((c) => w.workspaces.includes(c)) ? '' : ` (${w.workspaces.join(', ')} only)`;
}

/** Why read_guide refuses a workflow on this canvas, with what to do instead; undefined when it fits. */
export function guideWorkspaceProblem(id: string, workspace: Workspace): string | undefined {
  const [type, rest = ''] = id.trim().split(':');
  if (type !== 'workflow') return undefined;
  const w = workflowById(rest.split('/')[0]);
  if (!w || w.workspaces.includes(workspace)) return undefined;
  const instead = workspace === 'node' ? ' For several clips keep the same narrative split, one node per clip, without join_clips.' : '';
  return `Workflow "${w.id}" works only on the ${w.workspaces.join(' / ')} canvas; you are on the ${workspace} canvas. Plan the request directly with the steps this canvas supports.${instead}`;
}

/** The full text of a skill or workflow for read_guide ("skill:product", "workflow:storyboard", "workflow:ugc/unboxing"). */
export function readGuide(id: string): string | undefined {
  const [type, rest = ''] = id.trim().split(':');
  if (type === 'app') return APP_GUIDES.find((g) => g.id === rest)?.text;
  if (type === 'model') return modelGuide(rest)?.text;
  if (type === 'skill') {
    if (rest === STAGED_ID) return stagedGuide;
    const k = skillById(rest);
    return k ? `${k.name}: ${k.guidance}${k.guide ? `\n\n${k.guide}` : ''}` : undefined;
  }
  if (type !== 'workflow') return undefined;
  const [wid, variant] = rest.split('/');
  const w = workflowById(wid);
  if (!w) return undefined;
  const v = variant ? w.variants?.find((x) => x.id === variant) : undefined;
  if (variant && !v) return undefined;
  const chosen: Workflow = v ? { ...w, name: `${w.name} · ${v.name}`, description: v.description, steps: v.steps ?? w.steps, variants: undefined } : w;
  const skill = skillById(w.skill);
  return `workflow (${WORKFLOW_CONTRACT}):\n${describeWorkflow(chosen)}${skill ? `\nskill ${skill.name}: ${skill.guidance}` : ''}`;
}


/** Replace outdated instruction payloads in a live conversation; keep calls, user messages and result IDs. */
export function refreshLoadedGuides(history: LlmMessage[]): LlmMessage[] {
  const calls = new Map<string, string>();
  for (const message of history) for (const call of message.tool_calls ?? []) {
    if (call.function.name !== 'read_guide') continue;
    try {
      const id = JSON.parse(call.function.arguments ?? '{}').id;
      if (typeof id === 'string' && /^(workflow|skill):/.test(id)) calls.set(call.id, id);
    } catch { /* Malformed arguments remain available to the existing repair mechanism. */ }
  }
  const currentById = new Map([...new Set(calls.values())].map(id => [id, readGuide(id)]));
  return history.map(original => {
    const message = original.role === 'user' ? { ...original, content: typeof original.content === 'string'
      ? historicalContext(original.content) : Array.isArray(original.content)
        ? original.content.map(part => part.type === 'text' ? { ...part, text: historicalContext(part.text) } : part) : original.content } : original;
    if (message.role !== 'tool' || !message.tool_call_id || typeof message.content !== 'string') return message;
    const id = calls.get(message.tool_call_id);
    const current = id ? currentById.get(id) : undefined;
    if (!current) return message;
    // Short errors/compaction markers are not successful guide payloads and must retain their meaning.
    const successful = id!.startsWith('workflow:') ? message.content.startsWith('workflow (')
      : id === 'skill:staged' ? message.content.startsWith('# Staged pieces')
        : message.content.startsWith(`${skillById(id!.slice(6))?.name}:`);
    if (!successful) return message;
    const shared = id!.startsWith('workflow:') && message.content.includes('# Staged pieces') ? `\n\n---\n${STAGED_GUIDE}` : '';
    if (message.content.includes(current) && (!shared || message.content.includes(STAGED_GUIDE))) return message;
    return { ...message, content: current + shared };
  });
}

/** Historical app snapshots retain selections and references; current guides supply procedure. */
function historicalContext(text: string): string {
  const start = text.lastIndexOf('\n\n<app_context>');
  if (start < 0 || !text.endsWith('</app_context>')) return text;
  return text.slice(0, start) + text.slice(start).replace(/<app_context>([\s\S]*?)<\/app_context>$/, (_, context: string) => {
    const state = context
      .replace(/^skill: ([^\n]+?) — [^\n]*$/gm, 'skill previously selected: $1')
      .replace(/^workflow \([^\n]*\):\n([^\n:]+):[^\n]*(?:\n  [^\n]*)*/gm, 'workflow previously selected: $1')
      .replace(/\n\n---\n# Staged pieces[\s\S]*$/, '');
    return `<app_context>${state}</app_context>`;
  });
}

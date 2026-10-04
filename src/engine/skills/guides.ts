import { APP_GUIDES } from './app';
import { MODEL_GUIDES, modelGuide } from '../guides';
import type { Workspace } from '../types';
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
  return `workflow (follow this structure, adapt prompts to the request):\n${describeWorkflow(chosen)}${skill ? `\nskill ${skill.name}: ${skill.guidance}` : ''}`;
}

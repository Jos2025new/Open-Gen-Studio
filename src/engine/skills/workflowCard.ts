import { workflowById } from './workflows';

/**
 * Before the agent has asked (first question round, outside Direct), read_guide of a workflow answers with this short
 * card instead of the full guide: the agent checks that the request really asks for the whole piece, asks what is
 * missing, and only then loads the guide (after a round of questions, or at once with ready: true).
 */
export function workflowCard(id: string): string | undefined {
  const [type, rest = ''] = id.trim().split(':');
  if (type !== 'workflow') return undefined;
  const w = workflowById(rest.split('/')[0]);
  if (!w) return undefined;
  const needs = w.needs?.length ? w.needs.map((n) => `  - ${n}`).join('\n') : '  - nothing mandatory';
  return [
    `Workflow card "${w.id}" (not loaded yet): ${w.name}.`,
    `Delivers: ${w.description}`,
    `Needs:\n${needs}`,
    'If the request does not ask for this whole piece, it is not this workflow: its purpose ("for an ad", "for some ideas") is not a deliverable; plan what was asked and offer the workflow afterwards as a choice. If something material is missing, ask_questions first; if nothing is missing, call read_guide again with ready: true.',
  ].join('\n');
}

/** The card when read_guide must answer with it (first round, not Direct, no ready flag); undefined when the guide is sent. */
export function cardInsteadOfGuide(input: { id: string; ready?: boolean }, questionRound: number, direct: boolean): string | undefined {
  return questionRound === 0 && !direct && !input.ready ? workflowCard(input.id) : undefined;
}

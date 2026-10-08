import { OPS } from '../ops';
import { detectOps, normalizeRequest, OP_TRIGGERS } from './triggers';

/*
 * Steering: a request's keywords direct the agent toward the tool call that carries the operation. Every trigger counts
 * (one per operation). The agent reads which operations the request named, with each one's purpose, and that call must
 * be propose_plan (tool_choice), only when keywords applied. The agent still writes the steps, prompts and parameters;
 * the plan is checked as any other plan (no rejection for a missing operation).
 */

/** The tool a request's keywords direct the agent to: the plan, where operations are steps. */
export const STEER_TOOL = 'propose_plan';

export interface SteerOp {
  op: string;
  /** The words that named it, as matched (lower case, no accents). */
  phrase: string;
  /** An attached input of the kind the operation takes: asset:<id>. */
  input?: string;
}

/** The operations a request's keywords name, in the order it names them, with an attached input when one fits. */
export function steerOps(text: string, attachments: Array<{ id: string; kind?: string }>): SteerOp[] {
  const s = normalizeRequest(text);
  return detectOps(text).map((op) => {
    const phrase = (OP_TRIGGERS[op] ?? []).map((re) => re.exec(s)?.[0]).find(Boolean) ?? op;
    const kind = (OPS as Record<string, { input?: string }>)[op]?.input;
    const source = attachments.find((a) => a.kind === kind);
    return { op, phrase, ...(source ? { input: `asset:${source.id}` } : {}) };
  });
}

/** Two lines the agent reads with the request: what the keywords named, and that the plan carries them as op steps. */
export function steerNote(ops: SteerOp[]): string {
  if (!ops.length) return '';
  const list = ops.map((o) => `${o.op} («${o.phrase}»${o.input ? `, on ${o.input}` : ''}: ${(OPS as Record<string, { description?: string }>)[o.op]?.description ?? ''})`).join('; ');
  return `\n\n---\nThe request's keywords name: ${list}.\nCall propose_plan with ${ops.length > 1 ? 'these operations as op steps, in this order' : 'this operation as an op step'}; write the prompts and parameters yourself, and add other steps as needed.`;
}

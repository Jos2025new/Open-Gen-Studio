import { namedAngle, namesSheet } from './fit';
import { normalizeRequest, OP_TRIGGERS } from './triggers';

/*
 * Forced operations: the floor a request sets on its plan. As in Gentle-AI's native routing, code decides from state
 * (the request's words and its attachments) and the agent may add to that decision, never drop it. Only five strong
 * triggers force, each with its input as precondition; every other trigger stays information for the agent.
 *
 * The agent is told before it plans (two lines in the request), the normalizer refuses a plan without the operation,
 * and the accepted plan says which step the request forced, and whether a plan without it was sent back.
 */

export interface ForcedOp {
  op: string;
  /** The words that triggered it, as written in the request (lower case, no accents). */
  phrase: string;
  /** The attached input the operation runs on: asset:<id>. */
  input: string;
}

type InputKind = 'image' | 'video' | 'audio';

/** The strong triggers: an unequivocal phrase plus the input the operation needs, attached to the same request. */
const STRONG: Array<{ op: string; input: InputKind; also?: (text: string) => boolean }> = [
  { op: 'remove_bg', input: 'image' },
  { op: 'extract_frame', input: 'video' },
  // An angle forces only when one is named, and not inside a sheet (a sheet's views are not angle steps).
  { op: 'angle', input: 'image', also: (t) => Boolean(namedAngle(t)) && !namesSheet(t) },
  { op: 'reference_sheet', input: 'image', also: namesSheet },
  { op: 'create_voice', input: 'audio' },
];

/** The operations a request forces, in the order it names them. Without the attachment, nothing is forced. */
export function strongOps(text: string, attachments: Array<{ id: string; kind?: string }>): ForcedOp[] {
  const s = normalizeRequest(text);
  const found: Array<ForcedOp & { at: number }> = [];
  for (const { op, input, also } of STRONG) {
    const match = (OP_TRIGGERS[op] ?? []).map((re) => re.exec(s)).find(Boolean);
    const source = attachments.find((a) => a.kind === input);
    if (!match || !source || (also && !also(text))) continue;
    found.push({ op, phrase: match[0], input: `asset:${source.id}`, at: match.index });
  }
  return found.sort((a, b) => a.at - b.at).map(({ op, phrase, input }) => ({ op, phrase, input }));
}

/** The two lines the agent reads with the request: what the app detected and what the plan must contain. */
export function forcedNote(forced: ForcedOp[]): string {
  if (!forced.length) return '';
  const list = forced.map((f) => `${f.op} on ${f.input} («${f.phrase}»)`).join('; ');
  return `\n\n---\nThe app detected in this request: ${list}.\nThe plan must include ${forced.length > 1 ? 'these operations' : 'this operation'} as op steps (add other steps as needed; do not replace ${forced.length > 1 ? 'them' : 'it'} with an edit or a generation).`;
}

/** Operations a plan of this request left out and was sent back for, by session: said on the plan finally accepted. */
const missed = new Map<string, { request: string; ops: Set<string> }>();

export interface ForcedState { ops: ForcedOp[]; missed: Set<string> }

/** The forced operations of a session's current request, with what earlier plans of the same request missed. */
export function forcedFor(sessionId: string, request: string, attachments: Array<{ id: string; kind?: string }>): ForcedState {
  let entry = missed.get(sessionId);
  if (!entry || entry.request !== request) missed.set(sessionId, (entry = { request, ops: new Set() }));
  return { ops: strongOps(request, attachments), missed: entry.ops };
}

/**
 * The floor, checked on a normalized plan: each forced operation needs an op step of its kind. A missing one sends the
 * plan back with the exact step to add (and is remembered); a present one is said on the plan.
 */
export function forcedCheck(steps: Array<{ id?: string; kind?: string; op?: string }>, state: ForcedState | undefined): { errors: string[]; adjustments: string[] } {
  const errors: string[] = [];
  const adjustments: string[] = [];
  for (const f of state?.ops ?? []) {
    const step = steps.find((x) => x.kind === 'op' && x.op === f.op);
    if (!step) {
      state!.missed.add(f.op);
      errors.push(`The request asks for ${f.op} («${f.phrase}») on ${f.input}, and the plan has no ${f.op} step. Add { "kind": "op", "op": "${f.op}", "input": "${f.input}" } (later steps may use its output), then propose again.`);
      continue;
    }
    adjustments.push(`${step.id}: ${f.op}, required by your request («${f.phrase}»)${state!.missed.has(f.op) ? '; an earlier plan without it was sent back' : ''}`);
  }
  return { errors, adjustments };
}

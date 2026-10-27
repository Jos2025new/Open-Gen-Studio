import { useStore } from '../../store/store';
import { logEvent } from '../../lib/log';
import { modelSummary } from '../catalog';
import { resolveNamedModel } from '../modelNamed';
import type { AgentState, FeedItem, MediaKind } from '../types';

/*
 * A model written on a step or settings part without `user_requested`: the app decides, the agent is not bounced.
 * True only when this request's user words (the message and the answers to the agent's questions after it) name that
 * model; anything else is the agent's recommendation. An older choice or the agent's own text never counts.
 */

const flat = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const GENERIC = /\b(image|video|text|to)\b/gi;

/** What the user wrote for the current request: the last user message, its answered questions, and the draft. */
export function requestWords(feed: FeedItem[], draft: AgentState['draft']): string {
  const at = feed.findLastIndex((f) => f.type === 'user');
  const said = feed.slice(Math.max(at, 0)).flatMap((f) => (f.type === 'user' ? [f.text ?? ''] : f.type === 'questions' && f.answers ? Object.values(f.answers) : []));
  return [...said, draft?.request ?? '', ...Object.values(draft?.answers ?? {})].join('\n');
}

/** Whether `words` name the model written as `written` (a ref or a name) for `kind`. */
export function namesModel(words: string, written: string, kind: MediaKind): boolean {
  const said = flat(words);
  const w = written.trim();
  if (!said || !w) return false;
  const found = w.includes('::') ? modelSummary(w) : (() => { const r = resolveNamedModel(w, kind, false); return 'ref' in r ? modelSummary(r.ref) : undefined; })();
  const names = [w.includes('::') ? '' : w, found?.name ?? '', (found?.name ?? '').replace(GENERIC, ' ')].map(flat).filter((n) => n.length >= 4);
  return names.some((n) => said.includes(n));
}

type Written = { kind?: string; model?: string; user_requested?: boolean };

/** Fill `user_requested` where the agent left it out; returns what was inferred for the harness log. */
export function inferUserRequested<T extends Written>(items: T[], words: string): Array<{ at: number; model: string; user_requested: boolean }> {
  const out: Array<{ at: number; model: string; user_requested: boolean }> = [];
  items.forEach((it, at) => {
    const model = it.model?.trim();
    if (!model || typeof it.user_requested === 'boolean') return;
    it.user_requested = namesModel(words, model, it.kind === 'video' ? 'video' : 'image');
    out.push({ at, model, user_requested: it.user_requested });
  });
  return out;
}

/** Infer the missing flags of a tool call's steps or parts from this request's words, and log it. */
export function inferChoices(sessionId: string, where: string, items: Written[]): void {
  const s = useStore.getState().sessions[sessionId];
  const inferred = s ? inferUserRequested(items, requestWords(s.feed, s.agent.draft)) : [];
  if (inferred.length) logEvent('harness', { session: sessionId, where, inferred: 'user_requested', items: inferred });
}

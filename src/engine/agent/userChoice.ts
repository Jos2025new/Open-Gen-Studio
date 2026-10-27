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

const strip = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
/** Words and numbers: "seedream5" -> seedream, 5; "v5.0" -> v, 5; "5.0" and "5" are one version. */
const tokens = (s: string) => (strip(s).match(/[a-z]+|\d+(?:\.\d+)*/g) ?? []).map((t) => t.replace(/(\.0)+$/, ''));
/** Tier and generic words a short name leaves out: they never decide which model was meant. */
const TIER = new Set(['v', 'image', 'video', 'text', 'to', 'pro', 'max', 'turbo', 'fast', 'ultra', 'klein', 'preview', 'edit', 'mini', 'lite', 'standard', 'dev', 'schnell', 'by', 'the', 'ai']);
const isNum = (t: string) => /^\d/.test(t);

/** The model's brand words and its version, from its catalog name (else the id without its vendor segment). */
function identity(name: string): { brand: string[]; version?: string } {
  const t = tokens(name).filter((x) => !TIER.has(x));
  return { brand: [...new Set(t.filter((x) => !isNum(x)))], version: t.find(isNum) };
}

/** Whether `words` name this identity: all brand words, and the version right after the last of them (a different version is another model). */
function matches(words: string[], id: { brand: string[]; version?: string }): boolean {
  if (!id.brand.length) return false;
  const at = id.brand.map((b) => words.indexOf(b));
  if (at.some((i) => i < 0)) return false;
  if (!id.version) return true;
  return words.some((w, j) => {
    if (!id.brand.includes(w)) return false;
    let i = j + 1;
    while (words[i] === 'v' || id.brand.includes(words[i])) i++;
    return words[i] === id.version;
  });
}

/** What the user wrote for the current request: the last user message, its answered questions, and the draft. */
export function requestWords(feed: FeedItem[], draft: AgentState['draft']): string {
  const at = feed.findLastIndex((f) => f.type === 'user');
  const said = feed.slice(Math.max(at, 0)).flatMap((f) => (f.type === 'user' ? [f.text ?? ''] : f.type === 'questions' && f.answers ? Object.values(f.answers) : []));
  return [...said, draft?.request ?? '', ...Object.values(draft?.answers ?? {})].join('\n');
}

/** Whether `words` name the model written as `written` (a ref or a name) for `kind`. */
export function namesModel(words: string, written: string, kind: MediaKind): boolean {
  const w = written.trim();
  const spoken = tokens(words);
  if (!spoken.length || !w) return false;
  const found = w.includes('::') ? modelSummary(w) : (() => { const r = resolveNamedModel(w, kind, false); return 'ref' in r ? modelSummary(r.ref) : undefined; })();
  const fromId = w.includes('::') ? (() => { const p = w.split('::')[1].split('/'); return (p.length > 1 ? p.slice(1) : p).join(' '); })() : w;
  return [found?.name ?? '', fromId].some((n) => n && matches(spoken, identity(n)));
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

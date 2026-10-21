import { lineKey } from './variants';
import { userNamed } from './modelNaming';
import { modelSummary } from './catalog';
import { indexedModels, searchIndex, suggestModel } from './agent/modelIndex';
import { PROVIDER_LABELS } from './providers/types';
import type { PlanContext } from './plan';
import type { AgentState, MediaKind, ModelSummary, ProviderId } from './types';

/** requestText plus the agent's reply an acceptance answers: change detection only (ADR 0025 D); plan fitting reads requestText. */
export type OfferContext = PlanContext & { offerText?: () => string };

/*
 * "Ask to change" (ADR 0025 D): the user names another model, or only another provider for the same model. Both go
 * through the same Keep / Change card; the agent only declares the model (and the provider it was asked for), the
 * app decides what kind of change it is and never swaps either one silently.
 */

export type ModelChange = 'model' | 'provider';

const REMOTE = (Object.keys(PROVIDER_LABELS) as ProviderId[]).filter((p) => p !== 'local');
const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Words that turn the provider right after them into one the user does not want ("no en fal", "instead of fal"). */
const NEGATORS = new Set(['no', 'not', 'sin', 'nunca', 'never', 'tampoco', 'don', 'dont', 'nor', 'ni', 'instead', 'vez', 'rather']);
const plain = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** Whether a clause (its words) names provider `p`, by id or label, and not right after a negation (within 3 words). */
function mentions(p: ProviderId, words: string[]): boolean {
  const label = flat(PROVIDER_LABELS[p]);
  return words.some((w, i) => {
    let hit = w === p;
    for (let j = i, acc = ''; !hit && label.length >= 6 && j < words.length && acc.length < label.length; j++) hit = (acc += words[j]) === label;
    return hit && !words.slice(Math.max(0, i - 3), i).some((x) => NEGATORS.has(x));
  });
}

/** The providers a text asks for ("use NanoGPT", "en atlas cloud"): by id or label as whole words; a negated one ("no en fal") is not asked for. */
export function providersIn(said: string): ProviderId[] {
  const clauses = plain(said).split(/[,.;:!?\n]+/).map((c) => c.split(/[^a-z0-9]+/).filter(Boolean));
  return REMOTE.filter((p) => clauses.some((words) => mentions(p, words)));
}

/** A provider written by the agent ("nanogpt", "NanoGPT", "Atlas Cloud"). */
export function providerNamed(written: string | undefined): ProviderId | undefined {
  const w = flat(written ?? '');
  return w ? REMOTE.find((p) => p === w || flat(PROVIDER_LABELS[p]) === w) : undefined;
}

/** What going from `was` to `now` is: another model line, or the same line at another provider (none: the same choice). */
export function modelChange(now: ModelSummary, was: ModelSummary): ModelChange | undefined {
  if (lineKey(now) !== lineKey(was)) return 'model';
  return now.provider !== was.provider ? 'provider' : undefined;
}

/**
 * The change the user asked for in `said` (the current request): another line only when they named it, the same line
 * at another provider only when they named that provider. Anything else is the app's own default, not a request.
 */
export function changeNamed(now: ModelSummary, was: ModelSummary, said: string, written?: string): ModelChange | undefined {
  const change = modelChange(now, was);
  if (change === 'model') return userNamed([now.name, written ?? ''], said) ? change : undefined;
  // The provider asked for, other than the confirmed one: two of them is ambiguous, so no change is inferred.
  const others = providersIn(said).filter((p) => p !== was.provider);
  return change && others.length === 1 && others[0] === now.provider ? change : undefined;
}

/** The adjustment note for a step that wrote another line or provider than the confirmed one; same names are told apart by ref. */
export function modelMove(wrote: ModelSummary, conf: ModelSummary): string {
  const same = wrote.name === conf.name;
  return `model ${same ? wrote.ref : wrote.name} → ${same ? conf.ref : conf.name} (confirmed)`;
}

/**
 * With several confirmed parts of a kind (an A/B), the part a step's written model means: the exact ref, else the same
 * line at the same provider (another input route of it), else the same line when only one part has it (never the
 * wrong provider of a line compared across providers). Undefined: the step keeps the kind's confirmed choice.
 */
export async function partNamed<P extends { modelRef: string }>(parts: P[], written: string, getModel: (ref: string) => Promise<{ model: ModelSummary } | null | undefined>): Promise<P | undefined> {
  const named = (await getModel(written))?.model;
  if (!named) return undefined;
  const exact = parts.find((p) => p.modelRef === named.ref);
  if (exact) return exact;
  const same: Array<{ p: P; m: ModelSummary }> = [];
  for (const p of parts) {
    const m = (await getModel(p.modelRef))?.model;
    if (m && lineKey(m) === lineKey(named)) same.push({ p, m });
  }
  return same.find((x) => x.m.provider === named.provider)?.p ?? (same.length === 1 ? same[0].p : undefined);
}

/** The model a confirm_settings part names; with only a provider, the model already confirmed for that kind (the same model at that provider). */
export function partModel(part: { kind: MediaKind; model?: string; provider?: string }, confirmed: Partial<Record<MediaKind, { modelRef: string }>> | undefined): string | undefined {
  return part.model?.trim() || (part.provider ? confirmed?.[part.kind]?.modelRef : undefined);
}

/**
 * A model written by name, tolerant of spelling but never of guesses: an exact ref wins; the same line as a known ref
 * at the wanted provider; otherwise the words are searched among the models of that provider (every word must match; a one-letter typo or a
 * partial word still counts, an extra unmatched word does not). Nothing similar returns the reason and the closest model of any provider.
 */
export function resolveNamedModel(name: string, kind: MediaKind, needsImage: boolean, provider?: string): { ref: string } | { error: string } {
  const n = name.trim();
  const want = provider ? providerNamed(provider) : undefined;
  if (provider && !want) return { error: `Unknown provider "${provider}". Use one of: ${REMOTE.map((p) => PROVIDER_LABELS[p]).join(', ')}.` };
  const exact = n.includes('::') ? modelSummary(n) : undefined;
  if (exact && (!want || exact.provider === want)) return { ref: exact.ref };
  const pool = indexedModels().filter((m) => m.kind === kind && (!want || m.provider === want));
  const fit = (m: ModelSummary) => (needsImage === Boolean(m.acceptsImage) ? 0 : 1);
  const line = exact ? pool.filter((m) => lineKey(m) === lineKey(exact)).sort((a, b) => fit(a) - fit(b) || a.id.length - b.id.length) : [];
  const found = line[0] ?? searchIndex(pool, n, { kind, needsImage, strict: true, limit: 3 })[0];
  if (found) return { ref: found.ref };
  const closest = suggestModel(n, kind, needsImage);
  return { error: `Unknown model "${n}"${want ? ` at ${PROVIDER_LABELS[want]}` : ''}.${closest ? ` The closest is ${modelSummary(closest)?.name ?? closest} (${closest}).` : ''} Call find_models, or leave "model" out for the recommended one.` };
}

/**
 * The model the plan writes when the user asked for it in the CURRENT request (ctx.requestText: this turn and its
 * answers, never the whole history) and it is not what the card confirmed: another line they named, or the same line
 * at the provider they named. Then the user's words win over the card, after a question. Undefined when it is not.
 */
export async function namedOverConfirmed(ctx: OfferContext, written: string, confirmedRef: string): Promise<ModelSummary | undefined> {
  const asking = ctx.offerText ?? ctx.requestText;
  if (!asking) return undefined;
  const said = asking();
  const conf = (await ctx.getModel(confirmedRef))?.model;
  if (!conf) return undefined;
  // A name that is not a ref is read as the user wrote it: the provider they named (other than the confirmed one) decides.
  const asked = providersIn(said).find((p) => p !== conf.provider);
  const hit = (await ctx.getModel(written))?.model ?? modelSummary((resolveNamedModel(written, conf.kind, false, asked) as { ref?: string }).ref ?? '');
  return hit && changeNamed(hit, conf, said, written) ? hit : undefined;
}

/** After a switch, a request that names no model must first ask whether to continue with the switched one; undefined when it need not. */
export async function followUpProblem(ctx: OfferContext, confirmedRef: string, kind: MediaKind): Promise<string | undefined> {
  const to = ctx.switchedTo?.(kind);
  const [sw, conf] = to ? await Promise.all([ctx.getModel(to.modelRef), ctx.getModel(confirmedRef)]) : [];
  if (!to || !sw || !conf || userNamed([conf.model.name], (ctx.offerText ?? ctx.requestText)?.() ?? '')) return undefined;
  // The same model at another provider has the same name: say where each one is.
  const tag = (m: ModelSummary) => (modelChange(sw.model, conf.model) === 'provider' ? `${m.name} at ${PROVIDER_LABELS[m.provider]}` : m.name);
  return `The user switched ${kind} to ${tag(sw.model)} (${to.modelRef}) last time and has not said whether to continue with it; call confirm_settings for ${kind} with model ${to.modelRef} first (the app asks: continue with ${tag(sw.model)} or go back to ${tag(conf.model)}).`;
}

const ACCEPT = new Set(['si', 'vale', 'ok', 'okay', 'dale', 'claro', 'hazlo', 'cambialo', 'cambia', 'cambiar', 'adelante', 'perfecto', 'venga', 'listo', 'bueno', 'yes', 'yeah', 'yep', 'sure', 'go', 'do', 'please']);
const REFUSE = new Set(['no', 'nope', 'nah', 'not', 'dont', 'nunca', 'tampoco']);
/** Keep, stay, prefer or conditional wording ("bueno, prefiero seguir igual", "ok, keep it"): not an acceptance of a change. "si" as "if" cannot be told from "yes". */
const KEEP = new Set(['sigue', 'seguir', 'sigo', 'igual', 'mantener', 'manten', 'mantengo', 'quedate', 'quedo', 'prefiero', 'keep', 'stay', 'same', 'prefer', 'rather', 'instead', 'if', 'unless']);

/**
 * Whether a message is a plain acceptance of what the agent just offered ("sí, cámbialo", "dale", "go ahead"): short
 * (up to 6 words), starts with an accepting word, has no refusal word ("no, sigue así", "sí pero no") and is not a
 * question ("sí, ¿y el precio?"). No LLM.
 */
export function isAcceptance(message: string): boolean {
  const words = message.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/'/g, '').split(/[^a-z0-9]+/).filter(Boolean);
  return !message.includes('?') && words.length > 0 && words.length <= 6 && ACCEPT.has(words[0]) && !words.some((w) => REFUSE.has(w) || KEEP.has(w));
}

/** Whether a reply of the agent offers a change: it names a provider or a model, with a change / offer cue. */
function isOffer(reply: string): boolean {
  const text = plain(reply);
  const cue = /\b(cambi\w*|switch\w*|chang\w*|quier\w*|want|would you|shall|prefer\w*|usar|use|probar|try|pasar|offer\w*|ofrezc\w*)\b/.test(text);
  const names = flat(reply);
  return cue && (providersIn(reply).length > 0 || indexedModels().some((m) => flat(m.name).length >= 6 && names.includes(flat(m.name))));
}

/** The agent's last visible text before the user's current message (the one with exactly `request`), or ''. */
function previousAgentText(history: AgentState['history'], request: string): string {
  const text = (m: AgentState['history'][number]) => (typeof m.content === 'string' ? m.content : '');
  const mine = history.map((m, i) => (m.role === 'user' && text(m).includes(`\n${request}\n</user_message>`) ? i : -1)).filter((i) => i >= 0).at(-1);
  for (let i = (mine ?? history.length) - 1; i >= 0; i--) {
    const m = history[i];
    if (m.role === 'user' && text(m).includes('<user_message')) return '';
    if (m.role === 'assistant' && text(m).trim()) return text(m);
  }
  return '';
}

/**
 * The request text that decides a change (ADR 0025 D): this turn's words and answers, plus the agent's previous reply
 * when the user's message only accepts it and that reply is an offer (a provider or model with a change cue). So "Nano Banana 2 is also on NanoGPT, switch?" + "sí, cámbialo" names
 * NanoGPT; "sí" after a reply that named nothing, or "no, sigue así", names nothing. The Keep / Change card still decides.
 */
export function offerRequest(agent: Pick<AgentState, 'draft' | 'history'>): string {
  const base = userRequest(agent);
  const request = agent.draft?.request ?? '';
  const offer = isAcceptance(request) ? previousAgentText(agent.history, request) : '';
  return isOffer(offer) ? `${base}\n${offer}` : base;
}

/** Only the user's own words (the request and its answers): what plan fitting reads, never the agent's reply. */
export function userRequest(agent: Pick<AgentState, 'draft'>): string {
  return [agent.draft?.request ?? '', ...Object.values(agent.draft?.answers ?? {})].join('\n');
}

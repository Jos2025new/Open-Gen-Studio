import { logged } from '../lib/log';
import { HttpError } from '../lib/http';
import { formatUsd } from '../lib/format';
import { apiKeyFor, isConnected, modelSummary } from './catalog';
import { pushAlert, dismissAlert } from './alerts';
import { ADAPTERS } from './providers/registry';
import { PROVIDER_LABELS } from './providers/types';
import { lineKey, modelFamily } from './variants';
import { estimateMedia } from './costs';
import type { GenSettings, Generation, ModelSummary, ProviderId } from './types';
import { patchGeneration, useStore } from '../store/store';

/*
 * A provider with no credit: switch to the same model at another provider that has credit and costs the same or
 * less, and say so; otherwise offer what can run (with prices) or ask to recharge. Never a more expensive model on
 * its own.
 */

const get = useStore.getState;

/** A failure because the account has no credit (HTTP 402, or the provider's own words). */
export function isCreditError(err: unknown): boolean {
  if (err instanceof HttpError && err.status === 402) return true;
  return /insufficient (credits?|balance|funds)|not enough (credits?|balance)|out of credits/i.test(String((err as Error)?.message ?? err));
}

const cache = new Map<ProviderId, { at: number; usd: number | undefined }>();

/** The provider's balance in USD (cached for a minute); undefined when it does not say. */
export async function providerBalance(p: ProviderId): Promise<number | undefined> {
  const hit = cache.get(p);
  if (hit && Date.now() - hit.at < 60_000) return hit.usd;
  const adapter = ADAPTERS[p];
  let usd: number | undefined;
  try {
    usd = adapter?.balance ? await adapter.balance(apiKeyFor(p)) : undefined;
  } catch {
    usd = undefined;
  }
  cache.set(p, { at: Date.now(), usd });
  return usd;
}

/** Forget known balances (tests, or after the user recharges). */
export function forgetBalances(): void {
  cache.clear();
}

/** Mark a provider as empty right away (it just answered "no credit"). */
export function markEmpty(p: ProviderId): void {
  cache.set(p, { at: Date.now(), usd: 0 });
}

/** The model's first published price, comparable only within the same unit. */
function priceOf(m: ModelSummary): { usd: number; unit: string } | undefined {
  const sku = m.price?.skus[0];
  return sku ? { usd: sku.usd, unit: sku.unit } : undefined;
}

/** What this job costs on `m` with its own settings (B11); without a job or a price, the first published price. */
function jobPrice(m: ModelSummary, job: { settings: GenSettings; needsImage: boolean } | undefined): { usd: number; unit: string } | undefined {
  if (job && (m.kind === 'image' || m.kind === 'video' || m.kind === 'audio')) {
    const usd = estimateMedia(m.ref, m.kind, job.settings, job.needsImage, true).usd;
    if (usd != null) return { usd, unit: 'job' };
  }
  return priceOf(m);
}

export interface CreditOption {
  model: ModelSummary;
  /** Same model as the one that failed, at the same price or less. */
  same: boolean;
  /** Price over the failed model's (same unit), when known: above 1 the option is dearer and says so. */
  ratio?: number;
  /** What the job costs on this model, when known. */
  usd?: number;
}

/** Dearer than this (same unit) is not offered: it is another product, not a way out of a missing credit. */
export const CREDIT_PRICE_LIMIT = 1.5;

/** What the generation really sends: an image when it has references, a first or last frame, or works on a source asset (an op). */
export function jobNeedsImage(g: Pick<Generation, 'inputs' | 'op'>): boolean {
  return Boolean(g.inputs?.refs?.length || g.inputs?.firstFrame || g.inputs?.lastFrame || g.op);
}

/**
 * A candidate runs the job when it takes the inputs the job uses (not the ones the failed model could take): a job
 * with an image needs an image-capable model; a text-only job runs on a text-only model too. Only text and image
 * inputs are judged here. `needsImage` undefined: what the failed model accepts (no job known).
 */
export function takesInputsOf(cur: Pick<ModelSummary, 'acceptsText' | 'acceptsImage'>, m: Pick<ModelSummary, 'acceptsText' | 'acceptsImage'>, needsImage: boolean | undefined = cur.acceptsImage): boolean {
  if (needsImage && !m.acceptsImage) return false;
  return !(cur.acceptsText !== false && m.acceptsText === false);
}

/**
 * What can run instead of `ref`: the same variant, then the same family, on connected providers with credit (a
 * provider whose balance is unknown counts as possible), cheapest first. `same` = equal model at ≤ price.
 */
export async function creditOptions(ref: string, needsImage?: boolean): Promise<CreditOption[]> {
  return (await creditCandidates(ref, needsImage)).options;
}

/** creditOptions plus the equivalents the price cap dropped (cheapest first), so the alert can say they exist. */
async function creditCandidates(ref: string, needsImage?: boolean, settings?: GenSettings): Promise<{ options: CreditOption[]; pricey: CreditOption[] }> {
  const cur = modelSummary(ref);
  if (!cur) return { options: [], pricey: [] };
  const key = lineKey(cur);
  const family = modelFamily(cur).key;
  const job = settings ? { settings, needsImage: Boolean(needsImage) } : undefined;
  const price = jobPrice(cur, job);
  const all = Object.values(get().catalog.models).filter((m) => m.kind === cur.kind && m.provider !== cur.provider && m.provider !== 'local' && isConnected(m.provider) && takesInputsOf(cur, m, needsImage));
  const out: CreditOption[] = [];
  const pricey: CreditOption[] = [];
  const providers = [...new Set(all.map((m) => m.provider))];
  const balances = new Map(await Promise.all(providers.map(async (p) => [p, await providerBalance(p)] as const)));
  for (const m of all) {
    const bal = balances.get(m.provider);
    if (bal !== undefined && bal <= 0) continue;
    const sameVariant = lineKey(m) === key;
    if (!sameVariant && modelFamily(m).key !== family) continue;
    const p = jobPrice(m, job);
    const comparable = price && p && p.unit === price.unit && price.usd > 0;
    const ratio = comparable ? p.usd / price.usd : undefined;
    const option = { model: m, same: sameVariant && Boolean(price && p && p.unit === price.unit && p.usd <= price.usd), ratio, usd: p?.unit === 'job' ? p.usd : undefined };
    if (ratio !== undefined && ratio > CREDIT_PRICE_LIMIT) pricey.push(option);
    else out.push(option);
  }
  const cost = (o: CreditOption) => o.usd ?? priceOf(o.model)?.usd ?? Infinity;
  const options = out.sort((a, b) => Number(b.same) - Number(a.same) || Number(lineKey(b.model) === key) - Number(lineKey(a.model) === key) || cost(a) - cost(b)).slice(0, 4);
  return { options, pricey: pricey.sort((a, b) => (a.ratio ?? 0) - (b.ratio ?? 0)) };
}

const label = (m: ModelSummary, ratio?: number, usd?: number) => {
  const p = usd ?? priceOf(m)?.usd;
  return `${m.name} · ${PROVIDER_LABELS[m.provider]}${p != null ? ` · ${formatUsd(p)}` : ''}${ratio !== undefined && ratio > 1 ? ' · pricier' : ''}`;
};

/**
 * A generation failed for lack of credit: switch it to the same model elsewhere (same or lower price, with credit)
 * and run it again, or show the choices above the prompt box. `rerun` runs the generation again.
 */
export async function onGenerationCredit(genId: string, rerun: (id: string) => Promise<unknown>): Promise<boolean> {
  const g = get().generations[genId];
  const cur = g ? modelSummary(g.modelRef) : undefined;
  if (!g || !cur) return false;
  markEmpty(cur.provider);
  const empty = PROVIDER_LABELS[cur.provider];
  const { options, pricey } = await creditCandidates(g.modelRef, jobNeedsImage(g), g.settings);
  const switchTo = (m: ModelSummary) => {
    patchGeneration(genId, { modelRef: m.ref, modelName: m.name, error: undefined });
    return rerun(genId);
  };
  const auto = options.find((o) => o.same);
  if (auto) {
    pushAlert({ level: 'info', text: `${empty} has no credit: ${cur.name} switched to the same model at ${PROVIDER_LABELS[auto.model.provider]} (${label(auto.model, undefined, auto.usd)}, same price or less).` });
    await switchTo(auto.model);
    return true;
  }
  if (options.length) {
    const id = pushAlert({
      level: 'warn',
      text: `${empty} has no credit for ${cur.name}. Run it with another model that has credit (prices per run, dearer ones marked), or recharge ${empty}:`,
      actions: options.slice(0, 3).map((o) => ({ label: label(o.model, o.ratio, o.usd), run: () => { dismissAlert(id); void switchTo(o.model).catch(logged('switch model after no credit')); } })),
    });
    return false;
  }
  // Equivalents exist but cost too much to switch to on their own: say so instead of claiming there are none.
  if (pricey.length) {
    const p = pricey[0];
    pushAlert({ level: 'error', text: `${empty} has no credit for ${cur.name}. ${PROVIDER_LABELS[p.model.provider]} has a similar model (${p.model.name}) but it costs ${Math.round((p.ratio ?? 0) * 10) / 10}× more, so it is not offered automatically. Recharge ${empty} or pick a model yourself.` });
    return false;
  }
  pushAlert({ level: 'error', text: `${empty} has no credit and no other connected provider has ${cur.name} or a similar model with credit. Recharge ${empty} (or another provider) and retry.` });
  return false;
}

// ---------------------------------------------------------------------------
// The agent's own model ran out of credit

const sameName = (s: string) => s.toLowerCase().replace(/^[^:]+:\s*/, '').replace(/[^a-z0-9]+/g, '');

/**
 * The agent's provider has no credit: the same model at another provider with credit, at the same price or less,
 * becomes the agent's model (said above the prompt box) and the turn runs again; otherwise up to three capable
 * models with credit are offered (tools, and vision when the current one has it), or "recharge".
 */
export async function onAgentCredit(): Promise<boolean> {
  const { settings, catalog } = get();
  const provider = settings.agent.provider;
  if (provider === 'offline') return false;
  const cur = catalog.llm[provider]?.find((m) => m.id === settings.agent.model);
  markEmpty(provider as ProviderId);
  const empty = PROVIDER_LABELS[provider as ProviderId] ?? provider;
  const others = (['nanogpt', 'atlas', 'openrouter'] as const).filter((p) => p !== provider && settings.keys[p]?.trim());
  const { loadLlmCatalog } = await import('./catalog');
  await Promise.all(others.map((p) => loadLlmCatalog(p).catch(() => undefined)));
  const cost = (m: { inputPrice?: number; outputPrice?: number }) => (m.inputPrice ?? Infinity) + (m.outputPrice ?? Infinity);
  const choices: Array<{ p: (typeof others)[number]; m: NonNullable<typeof cur>; same: boolean }> = [];
  for (const p of others) {
    const bal = await providerBalance(p);
    if (bal !== undefined && bal <= 0) continue;
    for (const m of get().catalog.llm[p] ?? []) {
      if (!m.tools || (cur?.vision && m.vision === false)) continue;
      const same = Boolean(cur && sameName(m.name) === sameName(cur.name) && cost(m) <= cost(cur));
      choices.push({ p, m, same });
    }
  }
  const use = (c: (typeof choices)[number]) => {
    useStore.setState((s) => ({ settings: { ...s.settings, agent: { ...s.settings.agent, provider: c.p, model: c.m.id, modelPinned: true } } }));
  };
  const auto = choices.find((c) => c.same);
  if (auto) {
    use(auto);
    pushAlert({ level: 'info', text: `${empty} has no credit: the agent switched to the same model at ${PROVIDER_LABELS[auto.p]} (${auto.m.name}, same price or less).` });
    return true;
  }
  const near = choices
    .filter((c) => !cur || cost(c.m) <= cost(cur) * 1.5)
    .sort((a, b) => cost(a.m) - cost(b.m))
    .slice(0, 3);
  if (near.length) {
    const id = pushAlert({
      level: 'warn',
      text: `${empty} has no credit for the agent${cur ? ` (${cur.name})` : ''}. Switch to a model with credit and press Retry, or recharge ${empty}:`,
      actions: near.map((c) => ({ label: `${c.m.name} · ${PROVIDER_LABELS[c.p]}`, run: () => { use(c); dismissAlert(id); } })),
    });
    return false;
  }
  pushAlert({ level: 'error', text: `${empty} has no credit for the agent and no other connected provider has a model with credit. Recharge ${empty} (Settings → Agent shows the provider).` });
  return false;
}

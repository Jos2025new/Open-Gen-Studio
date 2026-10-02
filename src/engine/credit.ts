import { HttpError } from '../lib/http';
import { formatUsd } from '../lib/format';
import { apiKeyFor, isConnected, modelSummary } from './catalog';
import { pushAlert, dismissAlert } from './alerts';
import { ADAPTERS } from './providers/registry';
import { PROVIDER_LABELS } from './providers/types';
import { lineKey, modelFamily } from './variants';
import type { ModelSummary, ProviderId } from './types';
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

export interface CreditOption {
  model: ModelSummary;
  /** Same model as the one that failed, at the same price or less. */
  same: boolean;
}

/**
 * What can run instead of `ref`: the same variant, then the same family, on connected providers with credit (a
 * provider whose balance is unknown counts as possible), cheapest first. `same` = equal model at ≤ price.
 */
export async function creditOptions(ref: string): Promise<CreditOption[]> {
  const cur = modelSummary(ref);
  if (!cur) return [];
  const key = lineKey(cur);
  const family = modelFamily(cur).key;
  const price = priceOf(cur);
  const all = Object.values(get().catalog.models).filter((m) => m.kind === cur.kind && m.provider !== cur.provider && m.provider !== 'local' && isConnected(m.provider) && Boolean(m.acceptsImage) === Boolean(cur.acceptsImage));
  const out: CreditOption[] = [];
  const providers = [...new Set(all.map((m) => m.provider))];
  const balances = new Map(await Promise.all(providers.map(async (p) => [p, await providerBalance(p)] as const)));
  for (const m of all) {
    const bal = balances.get(m.provider);
    if (bal !== undefined && bal <= 0) continue;
    const sameVariant = lineKey(m) === key;
    if (!sameVariant && modelFamily(m).key !== family) continue;
    const p = priceOf(m);
    const cheaper = Boolean(price && p && p.unit === price.unit && p.usd <= price.usd);
    out.push({ model: m, same: sameVariant && cheaper });
  }
  const cost = (o: CreditOption) => priceOf(o.model)?.usd ?? Infinity;
  return out.sort((a, b) => Number(b.same) - Number(a.same) || Number(lineKey(b.model) === key) - Number(lineKey(a.model) === key) || cost(a) - cost(b)).slice(0, 4);
}

const label = (m: ModelSummary) => {
  const p = priceOf(m);
  return `${m.name} · ${PROVIDER_LABELS[m.provider]}${p ? ` · ${formatUsd(p.usd)}` : ''}`;
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
  const options = await creditOptions(g.modelRef);
  const switchTo = (m: ModelSummary) => {
    patchGeneration(genId, { modelRef: m.ref, modelName: m.name, error: undefined });
    return rerun(genId);
  };
  const auto = options.find((o) => o.same);
  if (auto) {
    pushAlert({ level: 'info', text: `${empty} has no credit: ${cur.name} switched to the same model at ${PROVIDER_LABELS[auto.model.provider]} (${label(auto.model)}, same price or less).` });
    await switchTo(auto.model);
    return true;
  }
  if (options.length) {
    const id = pushAlert({
      level: 'warn',
      text: `${empty} has no credit for ${cur.name}. Run it with another model that has credit (prices per run), or recharge ${empty}:`,
      actions: options.slice(0, 3).map((o) => ({ label: label(o.model), run: () => { dismissAlert(id); void switchTo(o.model).catch(() => undefined); } })),
    });
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

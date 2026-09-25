import { coerceSettings } from './params';
import { ADAPTERS, PREFERRED, REMOTE_PROVIDERS, editCounterpart, i2vCounterpart } from './providers/registry';
import { LOCAL_IMAGE_REF, LOCAL_VIDEO_REF } from './providers/demo';
import { listLlmModels, pickDefaultLlm } from './providers/llm';
import { parseModelRef } from './providers/types';
import type { OpEngine } from './ops';
import type { LlmProviderId, MediaKind, ModelSchema, ModelSummary, ProviderId, RemoteProviderId, TranscriberSummary } from './types';
import { setCatalog, setComposerMedia, setSettings, useStore } from '../store/store';

const get = useStore.getState;

export function isConnected(p: ProviderId): boolean {
  if (p === 'local') return true;
  return Boolean(get().settings.keys[p]?.trim());
}

export function connectedProviders(): ProviderId[] {
  return ['local', ...REMOTE_PROVIDERS.filter((p) => isConnected(p))];
}

export function apiKeyFor(p: ProviderId): string {
  return p === 'local' ? 'local' : get().settings.keys[p as RemoteProviderId]?.trim() ?? '';
}

const inflight = new Map<ProviderId, Promise<void>>();

/** Load catalogs for every connected provider (idempotent). */
export async function loadCatalogs(opts: { force?: boolean; preferRemote?: boolean } = {}): Promise<void> {
  const providers = connectedProviders();
  // Drop models of providers that were disconnected.
  setCatalog((c) => {
    const models = Object.fromEntries(Object.entries(c.models).filter(([, m]) => providers.includes(m.provider)));
    const status = { ...c.status };
    for (const p of REMOTE_PROVIDERS) if (!providers.includes(p)) status[p] = 'idle';
    return { models, status };
  });
  await Promise.all(providers.map((p) => loadProvider(p, opts.force)));
  ensureComposerModels(Boolean(opts.preferRemote));
}

function loadProvider(p: ProviderId, force = false): Promise<void> {
  const st = get().catalog.status[p];
  if (!force && (st === 'ready' || st === 'loading')) return inflight.get(p) ?? Promise.resolve();
  const run = (async () => {
    setCatalog((c) => ({ status: { ...c.status, [p]: 'loading' }, errors: { ...c.errors, [p]: undefined } }));
    try {
      const list = await ADAPTERS[p].listModels(apiKeyFor(p) || undefined);
      setCatalog((c) => {
        const models = Object.fromEntries(Object.entries(c.models).filter(([, m]) => m.provider !== p));
        for (const m of list) models[m.ref] = m;
        return { models, status: { ...c.status, [p]: 'ready' } };
      });
      // Speech-to-text models live apart from the image/video catalog; a failure here leaves the rest usable.
      const listTranscribers = ADAPTERS[p].listTranscribers;
      if (listTranscribers) {
        const list = await listTranscribers().catch(() => []);
        setCatalog((c) => {
          const transcribers = Object.fromEntries(Object.entries(c.transcribers ?? {}).filter(([, m]) => m.provider !== p));
          for (const m of list) transcribers[m.ref] = m;
          return { transcribers };
        });
      }
    } catch (err) {
      setCatalog((c) => ({ status: { ...c.status, [p]: 'error' }, errors: { ...c.errors, [p]: (err as Error).message } }));
    } finally {
      inflight.delete(p);
    }
  })();
  inflight.set(p, run);
  return run;
}

export async function loadLlmCatalog(provider: LlmProviderId): Promise<void> {
  const st = get().catalog.llmStatus[provider];
  if (st === 'loading' || st === 'ready') return;
  setCatalog((c) => ({ llmStatus: { ...c.llmStatus, [provider]: 'loading' } }));
  try {
    const models = await listLlmModels(provider);
    setCatalog((c) => ({ llm: { ...c.llm, [provider]: models }, llmStatus: { ...c.llmStatus, [provider]: 'ready' } }));
    const agent = get().settings.agent;
    if (agent.provider === provider && (!agent.model || !models.some((m) => m.id === agent.model))) {
      const pick = pickDefaultLlm(models, agent.tier);
      if (pick) setSettings((s) => ({ agent: { ...s.agent, model: pick } }));
    }
  } catch {
    setCatalog((c) => ({ llmStatus: { ...c.llmStatus, [provider]: 'error' } }));
  }
}

/** Pick the agent model again after the user changes the engine or the tier. */
export async function repickAgentModel(): Promise<void> {
  const { provider } = get().settings.agent;
  if (provider === 'offline') return;
  await loadLlmCatalog(provider);
  const { agent } = get().settings;
  const models = get().catalog.llm[provider];
  const pick = agent.provider === provider && models ? pickDefaultLlm(models, agent.tier) : undefined;
  if (pick) setSettings((s) => ({ agent: { ...s.agent, model: pick } }));
}

export function modelSummary(ref: string): ModelSummary | undefined {
  return get().catalog.models[ref];
}

const schemaInflight = new Map<string, Promise<ModelSchema | null>>();

/** Load (and cache) a model's parameter schema. Falls back to a prompt-only schema. */
export function ensureSchema(ref: string): Promise<ModelSchema | null> {
  const cached = get().catalog.schemas[ref];
  if (cached) return Promise.resolve(cached);
  const existing = schemaInflight.get(ref);
  if (existing) return existing;
  const p = (async () => {
    let model = modelSummary(ref);
    if (!model) {
      const parsed = parseModelRef(ref);
      if (!parsed || !isConnected(parsed.provider)) return null;
      await loadProvider(parsed.provider);
      model = modelSummary(ref);
      if (!model) return null;
    }
    let schema: ModelSchema;
    try {
      schema = await ADAPTERS[model.provider].loadSchema(model, apiKeyFor(model.provider) || undefined);
    } catch (err) {
      console.warn(`Schema for ${ref} unavailable:`, err);
      schema = {
        ref,
        params: [],
        slots: {
          prompt: model.acceptsText ? 'prompt' : undefined,
          promptRequired: model.acceptsText && !model.acceptsImage,
          images: model.kind === 'image' && model.acceptsImage ? { key: 'image_urls', max: 1, min: model.acceptsText ? 0 : 1, multiple: true, format: 'data-url' } : undefined,
          firstFrame: model.kind === 'video' && model.acceptsImage ? { key: 'image_url', format: 'data-url' } : undefined,
        },
        price: model.price,
        source: 'derived',
      };
    }
    if (!schema.price && model.price) schema = { ...schema, price: model.price };
    setCatalog((c) => ({ schemas: { ...c.schemas, [ref]: schema } }));
    return schema;
  })().finally(() => schemaInflight.delete(ref));
  schemaInflight.set(ref, p);
  return p;
}

export async function resolveModel(ref: string): Promise<{ model: ModelSummary; schema: ModelSchema } | null> {
  const parsed = parseModelRef(ref);
  if (!parsed || !isConnected(parsed.provider)) return null;
  if (!modelSummary(ref)) await loadProvider(parsed.provider);
  const model = modelSummary(ref);
  if (!model) return null;
  const schema = await ensureSchema(ref);
  return schema ? { model, schema } : null;
}

/** Models usable for ordinary generation. Models that need a source video are only reached through their operations. */
export function modelsOf(kind: MediaKind): ModelSummary[] {
  const providers = connectedProviders();
  return Object.values(get().catalog.models).filter((m) => m.kind === kind && !m.needsVideo && providers.includes(m.provider));
}

function firstAvailable(provider: RemoteProviderId, ids: string[]): string | null {
  for (const id of ids) {
    const ref = `${provider}::${id}`;
    if (modelSummary(ref)) return ref;
  }
  return null;
}

/** Remote providers in preference order: the composer's current provider first. */
function providerOrder(kind: MediaKind): RemoteProviderId[] {
  const current = parseModelRef(get().composer[kind].modelRef)?.provider;
  const remotes = REMOTE_PROVIDERS.filter((p) => isConnected(p));
  return current && current !== 'local' && remotes.includes(current as RemoteProviderId)
    ? [current as RemoteProviderId, ...remotes.filter((p) => p !== current)]
    : remotes;
}

export function preferredModel(kind: MediaKind): string {
  for (const p of providerOrder(kind)) {
    const hit = firstAvailable(p, PREFERRED[p][kind]);
    if (hit) return hit;
  }
  return kind === 'image' ? LOCAL_IMAGE_REF : LOCAL_VIDEO_REF;
}

/**
 * Keep composer models valid for the connected providers. With `preferRemote`
 * (a provider was just connected) the local demo models are swapped for real ones.
 */
export function ensureComposerModels(preferRemote = false): void {
  const st = get();
  for (const kind of ['image', 'video'] as const) {
    const ref = st.composer[kind].modelRef;
    const parsed = parseModelRef(ref);
    // A model is only replaced once its provider catalog loaded and it is missing from it.
    const valid =
      parsed && isConnected(parsed.provider) && (parsed.provider === 'local' || st.catalog.status[parsed.provider] !== 'ready' || modelSummary(ref));
    const remoteReady = REMOTE_PROVIDERS.some((p) => isConnected(p) && st.catalog.status[p] === 'ready');
    if (!valid || (preferRemote && parsed?.provider === 'local' && remoteReady)) {
      const pick = preferredModel(kind);
      if (pick !== ref) void selectComposerModel(kind, pick);
    }
  }
}

export async function selectComposerModel(kind: MediaKind, ref: string): Promise<void> {
  const current = get().composer[kind];
  setComposerMedia(kind, { modelRef: ref });
  const schema = await ensureSchema(ref);
  if (get().composer[kind].modelRef !== ref) return;
  const { settings } = coerceSettings(schema ?? undefined, kind, { ...current.settings, advanced: {} });
  setComposerMedia(kind, { settings });
}

/**
 * Default model for a new step. With `needsImage`, returns a model that accepts an
 * input image (edit / image-to-video counterpart of the current one when possible).
 */
export function defaultModelFor(kind: MediaKind, needsImage: boolean): string {
  const current = get().composer[kind].modelRef;
  const cur = modelSummary(current) ?? (current.startsWith('local::') ? { acceptsImage: true } : undefined);
  if (!needsImage) return current;
  if (cur?.acceptsImage) {
    const schema = get().catalog.schemas[current];
    const ok = kind === 'image' ? schema?.slots.images != null || !schema : schema?.slots.firstFrame != null || !schema;
    if (ok) return current;
  }
  const parsed = parseModelRef(current);
  if (parsed) {
    const counterpart = kind === 'image' ? editCounterpart(parsed.provider, parsed.id) : i2vCounterpart(parsed.provider, parsed.id);
    if (counterpart && modelSummary(`${parsed.provider}::${counterpart}`)) return `${parsed.provider}::${counterpart}`;
  }
  for (const p of providerOrder(kind)) {
    const list = kind === 'image' ? PREFERRED[p].edit : PREFERRED[p].video.map((id) => i2vCounterpart(p, id) ?? id);
    for (const id of list) {
      const m = modelSummary(`${p}::${id}`);
      if (m?.acceptsImage) return m.ref;
    }
  }
  const any = modelsOf(kind).find((m) => m.acceptsImage && m.provider !== 'local' && !m.tags.length);
  return any?.ref ?? (kind === 'image' ? LOCAL_IMAGE_REF : LOCAL_VIDEO_REF);
}

/** Speech-to-text model for the Transcribe operation: the settings override, then the preferred list, then any. */
export function transcriberFor(): TranscriberSummary | undefined {
  const all = get().catalog.transcribers ?? {};
  const connected = (ref: string | null | undefined) => (ref && all[ref] && isConnected(all[ref].provider) ? all[ref] : undefined);
  const chosen = connected(get().settings.ops.transcribe);
  if (chosen) return chosen;
  for (const p of REMOTE_PROVIDERS) for (const id of PREFERRED[p].transcribe) if (connected(`${p}::${id}`)) return all[`${p}::${id}`];
  return Object.values(all).find((m) => isConnected(m.provider));
}

/** Which model runs an operation engine. */
export function opModelFor(engine: OpEngine): { ref: string; viaEdit: boolean } {
  const ops = get().settings.ops;
  const valid = (ref: string | null) => Boolean(ref && isConnected(parseModelRef(ref)?.provider ?? 'local') && (ref.startsWith('local::') || modelSummary(ref)));
  if (engine === 'transcribe') return { ref: transcriberFor()?.ref ?? '', viaEdit: false };
  if (engine === 'edit') {
    if (valid(ops.edit)) return { ref: ops.edit!, viaEdit: false };
    return { ref: defaultModelFor('image', true), viaEdit: false };
  }
  if (engine === 'video') {
    if (valid(ops.video)) return { ref: ops.video!, viaEdit: false };
    return { ref: defaultModelFor('video', true), viaEdit: false };
  }
  if (engine === 'video_upscale' || engine === 'video_edit' || engine === 'video_extend') {
    // Video-to-video: settings override, then each provider's preferred list, then any tagged model that takes video.
    const key = engine === 'video_upscale' ? 'videoUpscale' : engine === 'video_edit' ? 'videoEdit' : 'videoExtend';
    if (valid(ops[key])) return { ref: ops[key]!, viaEdit: false };
    for (const p of providerOrder('video')) {
      const hit = firstAvailable(p, PREFERRED[p][key]);
      if (hit) return { ref: hit, viaEdit: false };
    }
    const tag = engine === 'video_upscale' ? /upscal|enhance/ : engine === 'video_edit' ? /edit/ : /extend/;
    const tagged = Object.values(get().catalog.models).find((m) => m.acceptsVideo && isConnected(m.provider) && (m.tags.some((t) => tag.test(t)) || tag.test(m.id)));
    return { ref: tagged?.ref ?? '', viaEdit: false };
  }
  const key = engine === 'upscale' ? 'upscale' : 'removeBg';
  const override = ops[key];
  if (valid(override)) return { ref: override!, viaEdit: false };
  for (const p of providerOrder('image')) {
    const hit = firstAvailable(p, PREFERRED[p][key]);
    if (hit) return { ref: hit, viaEdit: false };
  }
  const tag = engine === 'upscale' ? 'upscale' : 'background-removal';
  const tagged = modelsOf('image').find((m) => m.tags.includes(tag));
  if (tagged) return { ref: tagged.ref, viaEdit: false };
  // No dedicated model: use the edit model with an instruction.
  return { ref: opModelFor('edit').ref, viaEdit: true };
}

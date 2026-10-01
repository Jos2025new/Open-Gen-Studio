import { coerceSettings } from './params';
import { byCost, lineKey, variantRoute, type VariantRoute } from './variants';
import { ADAPTERS, PREFERRED, REMOTE_PROVIDERS, editCounterpart, i2vCounterpart } from './providers/registry';
import { LOCAL_IMAGE_REF, LOCAL_VIDEO_REF } from './providers/demo';
import { listLlmModels, pickDefaultLlm } from './providers/llm';
import { parseModelRef } from './providers/types';
import type { OpEngine } from './ops';
import type { LlmProviderId, MediaKind, ModelSchema, ModelSummary, ProviderId, RemoteProviderId, TranscriberSummary } from './types';
import { setCatalog, setComposer, setComposerMedia, setSettings, useStore } from '../store/store';

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
      if (pick) setSettings((s) => ({ agent: { ...s.agent, model: pick, modelPinned: false } }));
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
  if (pick) setSettings((s) => ({ agent: { ...s.agent, model: pick, modelPinned: false } }));
}

/** Pin one director model, or return to the tier's automatic pick. */
export function pickAgentModel(model: string): void {
  setSettings((s) => ({ agent: { ...s.agent, model, modelPinned: true } }));
}

export async function resetAgentModel(): Promise<void> {
  setSettings((s) => ({ agent: { ...s.agent, modelPinned: false } }));
  await repickAgentModel();
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
          images: (model.kind === 'image' || model.kind === 'model3d') && model.acceptsImage ? { key: 'image_urls', max: 1, min: model.acceptsText ? 0 : 1, multiple: true, format: 'data-url' } : undefined,
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
  // No local audio or 3D model: either needs a connected provider.
  if (kind === 'audio') return modelsOf('audio').find((m) => !m.textOutput)?.ref ?? '';
  if (kind === 'model3d') return modelsOf('model3d')[0]?.ref ?? '';
  return kind === 'image' ? LOCAL_IMAGE_REF : LOCAL_VIDEO_REF;
}

/**
 * Keep composer models valid for the connected providers. With `preferRemote`
 * (a provider was just connected) the local demo models are swapped for real ones.
 */
export function ensureComposerModels(preferRemote = false): void {
  const st = get();
  for (const kind of ['image', 'video', 'audio', 'model3d'] as const) {
    const ref = st.composer[kind].modelRef;
    const parsed = parseModelRef(ref);
    // A model is only replaced once its provider catalog loaded and it is missing from it.
    const valid =
      parsed && isConnected(parsed.provider) && (parsed.provider === 'local' || st.catalog.status[parsed.provider] !== 'ready' || modelSummary(ref));
    const remoteReady = REMOTE_PROVIDERS.some((p) => isConnected(p) && st.catalog.status[p] === 'ready');
    // A video model the user never picked is only an app default: it follows the current preference (C2),
    // so an old default (Kling V3 Pro) does not stay forever.
    const staleDefault = kind === 'video' && !st.composer.userPicked?.video && remoteReady && parsed?.provider !== 'local';
    if (!valid || (preferRemote && parsed?.provider === 'local' && remoteReady) || (staleDefault && preferredModel(kind) !== ref)) {
      const pick = preferredModel(kind);
      if (pick !== ref) void selectComposerModel(kind, pick);
    }
  }
}

/** The user picks a model in the selector: from now on it is their choice, and the agent's default for that kind (C2). */
export function pickComposerModel(kind: MediaKind, ref: string): Promise<void> {
  setComposer((c) => ({ userPicked: { ...c.userPicked, [kind]: true } }));
  // One image model everywhere: its edit twin becomes the edit model (tools, agent edits) too.
  if (kind === 'image') {
    const routes = lineRoutes(ref);
    const edit = routes.edit ?? routes.reference ?? opModelFromRef(ref, 'image');
    if (edit) setSettings((st) => ({ ops: { ...st.ops, edit } }));
  }
  // One video model everywhere: its text, image and reference routes fill the agent's video rows.
  if (kind === 'video') fillVideoRoutes(ref);
  return selectComposerModel(kind, ref);
}

/** Set the agent's text / image / reference → video rows to the routes of this model's line that exist. */
export function fillVideoRoutes(ref: string): void {
  const r = lineRoutes(ref);
  const routes = { ...(r.text ? { text: r.text } : {}), ...(r.image ? { image: r.image } : {}), ...(r.reference ? { reference: r.reference } : {}) };
  if (Object.keys(routes).length) setComposer((c) => ({ videoRoutes: { ...(c.videoRoutes ?? {}), ...routes } }));
}

/** Pick the image-edit model; the composer's Image model follows to the same family's text-to-image twin. */
export function pickImageEditModel(ref: string | null): void {
  setSettings((st) => ({ ops: { ...st.ops, edit: ref } }));
  if (!ref) return;
  const base = lineRoutes(ref).text ?? ref;
  setComposer((c) => ({ userPicked: { ...c.userPicked, image: true } }));
  void selectComposerModel('image', base);
}

/** Release a manual composer choice and restore the connected-provider default. */
export function resetComposerModel(kind: MediaKind): Promise<void> {
  setComposer((c) => ({ userPicked: { ...c.userPicked, [kind]: false } }));
  return selectComposerModel(kind, preferredModel(kind));
}

/** Whether the composer's model for this kind was picked by the user (not an app default). */
export function composerChosen(kind: MediaKind): boolean {
  return Boolean(get().composer.userPicked?.[kind]);
}

export async function selectComposerModel(kind: MediaKind, ref: string): Promise<void> {
  const current = get().composer[kind];
  setComposerMedia(kind, { modelRef: ref });
  const schema = await ensureSchema(ref);
  if (get().composer[kind].modelRef !== ref) return;
  const { settings } = coerceSettings(schema ?? undefined, kind, { ...current.settings, audio: undefined, advanced: {} });
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
    const ok = kind === 'image' || kind === 'model3d' ? schema?.slots.images != null || !schema : schema?.slots.firstFrame != null || !schema;
    if (ok) return current;
  }
  const parsed = parseModelRef(current);
  if (parsed) {
    const counterpart = kind === 'image' ? editCounterpart(parsed.provider, parsed.id) : kind === 'model3d' ? null : i2vCounterpart(parsed.provider, parsed.id);
    if (counterpart && modelSummary(`${parsed.provider}::${counterpart}`)) return `${parsed.provider}::${counterpart}`;
  }
  for (const p of providerOrder(kind)) {
    const list = kind === 'image' ? PREFERRED[p].edit : kind === 'model3d' ? PREFERRED[p].model3d : PREFERRED[p].video.map((id) => i2vCounterpart(p, id) ?? id);
    for (const id of list) {
      const m = modelSummary(`${p}::${id}`);
      if (m?.acceptsImage) return m.ref;
    }
  }
  const any = modelsOf(kind).find((m) => m.acceptsImage && m.provider !== 'local' && !m.tags.length);
  return any?.ref ?? (kind === 'image' ? LOCAL_IMAGE_REF : kind === 'video' ? LOCAL_VIDEO_REF : '');
}

/** fal endpoint that creates Kling custom voices (the only provider that exposes it). */
export const KLING_VOICE_REF = 'fal::fal-ai/kling-video/create-voice';
/** fal endpoint that creates Recraft V4 styles from reference images. */
export const RECRAFT_STYLE_REF = 'fal::fal-ai/recraft/v4/create-style';

/** Speech-to-text model for the Transcribe operation: the settings override, then the preferred list, then any. */
export function transcriberFor(): TranscriberSummary | undefined {
  const all = get().catalog.transcribers ?? {};
  const connected = (ref: string | null | undefined) => (ref && all[ref] && isConnected(all[ref].provider) ? all[ref] : undefined);
  const chosen = connected(get().settings.ops.transcribe);
  if (chosen) return chosen;
  for (const p of REMOTE_PROVIDERS) for (const id of PREFERRED[p].transcribe) if (connected(`${p}::${id}`)) return all[`${p}::${id}`];
  return Object.values(all).find((m) => isConnected(m.provider));
}

/** Engines whose model follows the source (the model that made it) and can be picked per run. */
export function opFollowsSource(engine: OpEngine): engine is 'edit' | 'video' {
  return engine === 'edit' || engine === 'video';
}

/**
 * A model that made a source, reused for an operation on it: the same model when it takes an input
 * image of the right kind, else its edit / image-to-video counterpart on the same provider.
 */
export function opModelFromRef(ref: string | undefined, kind: 'image' | 'video'): string | null {
  const parsed = ref ? parseModelRef(ref) : null;
  if (!ref || !parsed || parsed.provider === 'local' || !isConnected(parsed.provider)) return null;
  const takesImage = (r: string) => {
    const m = modelSummary(r);
    if (!m || m.kind !== kind || !m.acceptsImage || m.needsVideo || m.textOutput) return false;
    const schema = get().catalog.schemas[r];
    return !schema || (kind === 'image' ? schema.slots.images != null : schema.slots.firstFrame != null || schema.slots.images != null);
  };
  if (takesImage(ref)) return ref;
  const counterpart = kind === 'image' ? editCounterpart(parsed.provider, parsed.id) : i2vCounterpart(parsed.provider, parsed.id);
  const alt = counterpart ? `${parsed.provider}::${counterpart}` : null;
  if (alt && takesImage(alt)) return alt;
  // Same family, version and tier differing only by the input route (text-to-image ↔ edit, text-to-video ↔ image-to-video).
  return routeTwins(ref).find((m) => takesImage(m.ref))?.ref ?? null;
}

/** The other routes of the same model line on the same provider (text-to-image ↔ edit ↔ reference…). */
function routeTwins(ref: string): ModelSummary[] {
  const me = get().catalog.models[ref];
  if (!me) return [];
  const key = lineKey(me);
  return Object.values(get().catalog.models).filter((m) => m.provider === me.provider && m.ref !== ref && m.kind === me.kind && lineKey(m) === key).sort(byCost([me.provider]));
}

/** The model's line on its provider, one ref per input route (cheapest copy of each). */
export function lineRoutes(ref: string): Partial<Record<VariantRoute, string>> {
  const me = get().catalog.models[ref];
  if (!me) return {};
  const out: Partial<Record<VariantRoute, string>> = {};
  for (const m of [me, ...routeTwins(ref)]) {
    const r = variantRoute(m);
    if (!out[r]) out[r] = m.ref;
  }
  return out;
}

/** Model for an operation on an asset: the one that made it for edit / video engines, else the engine's model. */
export function opModelForAsset(engine: OpEngine, assetId: string | undefined): { ref: string; viaEdit: boolean } {
  if (opFollowsSource(engine) && assetId) {
    const genId = get().assets[assetId]?.generationId;
    const made = genId ? get().generations[genId]?.modelRef : undefined;
    const ref = opModelFromRef(made, engine === 'edit' ? 'image' : 'video');
    if (ref) return { ref, viaEdit: false };
  }
  return opModelFor(engine);
}

/** Video ops whose model the user can pick in the op form (node and chat). */
export const PICKABLE_VIDEO_OPS: readonly string[] = ['video_upscale', 'video_edit', 'video_extend', 'video'];

/** Models that really do this video op: upscale = dedicated upscalers; edit/extend = video-input models named for it. */
export function videoOpFits(engine: string, m: ModelSummary): boolean {
  if (engine === 'video_upscale') return isVideoUpscaler(m);
  // Continue/Animate: image-to-video models (the last or chosen frame starts the clip).
  if (engine === 'video') return m.kind === 'video' && m.acceptsImage && !m.needsVideo;
  const tag = engine === 'video_edit' ? /edit/i : /extend/i;
  if (m.kind !== 'video' || !m.acceptsVideo) return false;
  // Multi-mode models that take a source video without a separate edit route (NanoGPT Gemini Omni 1.1) also edit it.
  return tag.test(`${m.id} ${m.name} ${m.tags.join(' ')}`) || (engine === 'video_edit' && !m.needsVideo);
}

/** Dedicated video super-resolution; enhancement/edit/extend alone is not upscale. */
export function isVideoUpscaler(m: ModelSummary): boolean {
  const identity = `${m.id} ${m.name} ${m.tags.join(' ')}`;
  return m.kind === 'video' && Boolean(m.acceptsVideo) && /upscal|increase[-_/ ]resolution|super[-_/ ]resolution/i.test(identity) && !/text[-_/ ]to[-_/ ]video|image[-_/ ]to[-_/ ]video|video[-_/ ]edit|video[-_/ ]extend|generative/i.test(identity);
}

/** Which model runs an operation engine. */
export function opModelFor(engine: OpEngine): { ref: string; viaEdit: boolean } {
  const ops = get().settings.ops;
  const valid = (ref: string | null) => Boolean(ref && isConnected(parseModelRef(ref)?.provider ?? 'local') && (ref.startsWith('local::') || modelSummary(ref)));
  if (engine === 'transcribe') return { ref: transcriberFor()?.ref ?? '', viaEdit: false };
  if (engine === 'voice') return { ref: isConnected('fal') ? KLING_VOICE_REF : '', viaEdit: false };
  if (engine === 'inpaint' || engine === 'remove_object') {
    // Only mask-capable models: the settings override, then each provider's list; object removal falls back to inpainting with an instruction.
    const key = engine === 'inpaint' ? 'editRegion' : 'removeObject';
    if (valid(ops[key])) return { ref: ops[key]!, viaEdit: false };
    for (const p of providerOrder('image')) {
      const hit = firstAvailable(p, PREFERRED[p][engine === 'inpaint' ? 'inpaint' : 'removeObject']);
      if (hit) return { ref: hit, viaEdit: false };
    }
    if (engine === 'remove_object') {
      const inpaint = opModelFor('inpaint');
      return { ref: inpaint.ref, viaEdit: Boolean(inpaint.ref) };
    }
    return { ref: '', viaEdit: false };
  }
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
    const fits = (ref: string) => engine !== 'video_upscale' || Boolean(modelSummary(ref) && isVideoUpscaler(modelSummary(ref)!));
    if (valid(ops[key]) && fits(ops[key]!)) return { ref: ops[key]!, viaEdit: false };
    for (const p of providerOrder('video')) {
      const hit = firstAvailable(p, PREFERRED[p][key]);
      if (hit && fits(hit)) return { ref: hit, viaEdit: false };
    }
    const tag = engine === 'video_upscale' ? /upscal/ : engine === 'video_edit' ? /edit/ : /extend/;
    const tagged = Object.values(get().catalog.models).find((m) => m.acceptsVideo && isConnected(m.provider) && fits(m.ref) && (m.tags.some((t) => tag.test(t)) || tag.test(m.id)));
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

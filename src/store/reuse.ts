import { acceptsReuseValue } from './reuseValues';
import { FX_DEFS, isFxKind } from '../engine/fx/defs';
import { ensureSchema, opFollowsSource, videoOpFits } from '../engine/catalog';
import { OPS, defaultOpParams } from '../engine/ops';
import { coerceSettings } from '../engine/params';
import type { Generation, MediaKind } from '../engine/types';
import { setComposer, setUi, toast, useStore, type UiState } from './store';
import type { ToolSeed } from './spaceUi';

/** Match Create/Tools navigation, including when Library was opened over Designer. */
function openReuseSpace(patch: Partial<UiState>): void {
  if (useStore.getState().ui.workspace !== 'chat') setUi({ space: undefined, workspace: 'chat' });
  setUi({ ...patch, workspace: 'chat', home: false, panel: null, textView: null, lightbox: null });
}

/** A result can return only to a Space that has a form for it. */
export function canReuse(g: Generation): boolean {
  if (g.place === 'space-tools') {
    const def = g.op && OPS[g.op.id];
    return Boolean(def && !def.viaSketch && !def.multiInput && useStore.getState().assets[g.op!.sourceAssetId]?.kind === def.input);
  }
  return g.place === 'space-create' && !g.op && (g.kind !== 'text' || (g.mode === 'audio' || Boolean(useStore.getState().catalog.models[g.modelRef]?.textOutput)));
}

export async function reuseGeneration(g: Generation): Promise<void> {
  if (!canReuse(g)) return;
  const omitted: string[] = [];
  const st = useStore.getState();
  if (g.place === 'space-tools' && g.op) {
    const def = OPS[g.op.id];
    const candidate = st.catalog.models[g.modelRef];
    const transcriber = def.engine === 'transcribe' && st.catalog.transcribers?.[g.modelRef];
    const modelRef = transcriber || (candidate && (['video_upscale', 'video_edit', 'video_extend', 'video'].includes(def.engine) ? videoOpFits(def.engine, candidate) : candidate.kind === def.output)) ? g.modelRef : undefined;
    const dynamic = ['video_upscale', 'video_edit', 'video_extend', 'video'].includes(def.engine);
    const requested = g.op.params._modelRef;
    const requestedModel = typeof requested === 'string' ? st.catalog.models[requested] : undefined;
    const ref = requestedModel && videoOpFits(def.engine, requestedModel) ? requestedModel.ref : modelRef;
    if (dynamic && ref && st.catalog.models[ref]) await ensureSchema(ref).catch(() => undefined);
    const schema = ref ? useStore.getState().catalog.schemas[ref] : undefined;
    const params = defaultOpParams(def);
    for (const [key, value] of Object.entries(g.op.params)) {
      const field = def.fields.find((f) => f.key === key);
      const param = dynamic ? schema?.params.find((p) => p.key === key) : undefined;
      const fxField = g.op.id === 'fx' && isFxKind(g.op.params.effect) && FX_DEFS[g.op.params.effect].params.some((p) => p.key === key);
      if (key === '_modelRef' && (dynamic || opFollowsSource(def.engine)) && value === ref) params[key] = value;
      else if (field && (field.type !== 'choice' || field.options?.some((o) => o.value === String(value)))) params[key] = value;
      else if ((param && acceptsReuseValue(param, value)) || fxField) params[key] = value;
      else omitted.push(`parameter ${key}`);
    }
    if (dynamic && ref && st.catalog.models[ref]) params._modelRef = ref;
    if (!modelRef && def.engine !== 'local') omitted.push(`model ${g.modelRef}`);
    const seed: ToolSeed = { generationId: g.id, assetId: g.op.sourceAssetId, parentId: g.id, op: g.op.id, params, modelRef };
    // Source may have disappeared while its schema loaded.
    if (!canReuse(g)) { toast('The source asset is no longer available.', 'error'); return; }
    openReuseSpace({ space: 'tools', toolOp: g.op.id, toolAsset: seed.assetId, toolSeed: seed });
  } else {
    const kind: MediaKind = g.kind === 'text' ? 'audio' : g.kind;
    const valid = st.catalog.models[g.modelRef]?.kind === kind;
    const ref = valid ? g.modelRef : st.composer[kind].modelRef;
    if (!valid) omitted.push(`model ${g.modelRef}`);
    if (ref) await ensureSchema(ref).catch(() => undefined);
    const current = useStore.getState();
    const schema = current.catalog.schemas[ref];
    const { settings, changes } = coerceSettings(schema, kind, g.settings);
    omitted.push(...changes);
    for (const key of ['aspect', 'resolution', 'count', 'duration', 'audio', 'seed', 'negative', 'shots'] as const) {
      if (g.settings[key] !== undefined && JSON.stringify(g.settings[key]) !== JSON.stringify(settings[key])) omitted.push(`setting ${key}`);
    }
    for (const [key, value] of Object.entries(g.settings.advanced ?? {})) {
      const param = schema?.params.find((p) => p.key === key);
      if (!param || !acceptsReuseValue(param, value)) delete settings.advanced[key];
      if (!(key in settings.advanced)) omitted.push(`parameter ${key}`);
    }
    for (const key of Object.keys(g.settings.extras ?? {})) if (!(key in (settings.extras ?? {}))) omitted.push(`parameter ${key}`);
    if (!schema) omitted.push('settings without an available model schema');
    const inputIds = [...new Set([g.inputs.firstFrame, ...g.inputs.refs, g.inputs.lastFrame].filter((id): id is string => Boolean(id)))];
    const attachments = inputIds.filter((id) => current.assets[id]);
    for (const id of inputIds) if (!current.assets[id]) omitted.push(`asset ${id}`);
    const onlyLive = <T,>(values: Record<string, T> | undefined) => values ? Object.fromEntries(Object.entries(values).filter(([id]) => attachments.includes(id))) : undefined;
    setComposer((c) => ({ mode: kind, text: g.prompt, attachments, times: onlyLive(g.inputs.times), trims: onlyLive(g.inputs.trims), editing: { generationId: g.id },
      userPicked: { ...c.userPicked, [kind]: true }, [kind]: { modelRef: ref, settings: { ...settings, realism: g.settings.realism, capture: g.settings.capture, shot: g.settings.shot } } }));
    openReuseSpace({ space: 'create', toolSeed: undefined });
  }
  if (omitted.length) toast(`Reused with omissions: ${[...new Set(omitted)].join(', ')}.`, 'info');
}

import { syncOpSpec, type OpSpecInput } from '../opSpec';
import { OPS } from '../ops';
import { parseRef } from '../planRef';
import { applyLyricsSettings, type SendSpec, type SendState } from '../sendInputs';
import { mentionableSubjects } from '../libraryTypes';
import type { PlanStep, Subject } from '../types';
import { useStore } from '../../store/store';

const get = useStore.getState;

/** Build the dry-run SendSpec for a PlanStep using the same opSpec/lyrics rules as execution. */
export function stepSendSpec(s: PlanStep, steps: readonly PlanStep[], nodeOperations?: Record<string, OpSpecInput['nodeChoice']>, state: SendState = get()): { spec?: SendSpec; dynamic: boolean } {
  if (s.kind === 'text' || s.kind === 'layer') return { dynamic: false };
  const textById = new Map(steps.filter((x) => x.kind === 'text').map((x) => [x.id, x.text]));
  let dynamic = false;
  const take = (ref: string | undefined) => { if (!ref) return undefined; const p = parseRef(ref); if (p?.type === 'asset') return p.id; dynamic = true; return `step:${ref}`; };
  const textOf = (ref: string | undefined) => { const p = ref ? parseRef(ref) : null; const t = p?.type === 'step' ? textById.get(p.id) : undefined; if (ref && t == null) dynamic = true; return t; };
  const promptFor = (step: { prompt: string; promptFrom?: string }) => step.promptFrom ? [(textOf(step.promptFrom) ?? `step:${step.promptFrom}`).trim(), step.prompt.trim()].filter(Boolean).join('\n') : step.prompt;
  const subjects: Subject[] = (s.nodeSubjects ?? []).map((b) => ({ id: b.name, name: b.name, description: b.description ?? '', kind: b.kind ?? 'character', frontalAssetId: take(b.from), refAssetIds: [] }));
  const inputsBase = { ...(subjects.length ? { subjects } : {}), nodeLibrary: mentionableSubjects(state.library) };
  if (s.kind === 'op') {
    const source = take(s.input) ?? '';
    let params = s.params;
    if (s.more?.length) params = { ...params, clips: s.more.map((r) => take(r) ?? '').join(','), ...(typeof params.music === 'string' && params.music ? { music: take(params.music) ?? '' } : {}) };
    if (s.refs?.length) { const got = s.refs.map((r) => ({ asset: take(r.ref) ?? '', role: r.role, note: r.note })); params = { ...params, _refs: got.map((x) => x.asset).join(','), _refRoles: JSON.stringify(got) }; }
    const p = parseRef(s.input), upstream = p?.type === 'step' ? steps.find((x) => x.id === p.id) : undefined;
    const built = syncOpSpec(
      { sessionId: '', origin: 'node', op: s.op, params, sourceAssetId: source, nodeChoice: nodeOperations?.[s.id] },
      { sourceForChoice: dynamic ? '' : source, upstreamModelRef: upstream && 'modelRef' in upstream ? upstream.modelRef : undefined },
    );
    return { spec: built ? { ...built, inputs: built.inputs ?? { refs: [] } } : { kind: 'image', prompt: OPS[s.op].label, modelRef: '', settings: { count: 1, advanced: {} }, inputs: { refs: [] }, op: { id: s.op, params, sourceAssetId: source } }, dynamic };
  }
  if (s.kind === 'audio') {
    let settings = s.settings;
    if (s.lyricsFrom) {
      const text = textOf(s.lyricsFrom);
      const applied = applyLyricsSettings(settings, text ?? `step:${s.lyricsFrom}`, state.catalog.schemas[s.modelRef]);
      if (!applied.key) dynamic = true;
      settings = applied.settings;
    }
    return { spec: { kind: s.textOutput ? 'text' : 'audio', prompt: promptFor(s), modelRef: s.modelRef, settings, inputs: { refs: [], ...inputsBase } }, dynamic };
  }
  if (s.kind === 'video') {
    const refs = (s.refs ?? []).map((r) => take(r) ?? '');
    const times = Object.fromEntries(refs.flatMap((a, i) => (s.times?.[i] != null ? [[a, s.times[i]]] : [])));
    return { spec: { kind: 'video', prompt: promptFor(s), modelRef: s.modelRef, settings: s.settings, inputs: { refs, firstFrame: take(s.firstFrame), lastFrame: take(s.lastFrame), ...(Object.keys(times).length ? { times } : {}), ...inputsBase } }, dynamic };
  }
  return { spec: { kind: s.kind, prompt: promptFor(s), modelRef: s.modelRef, settings: s.settings, inputs: { refs: s.refs.map((r) => take(r) ?? ''), ...inputsBase }, ...(s.kind === 'image' && s.variations?.length ? { variants: s.variations } : {}) }, dynamic };
}

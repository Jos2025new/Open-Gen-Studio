import { uid } from '../lib/id';
import { isAbort } from '../lib/http';
import type { BudgetPass } from './budget';
import { RECRAFT_STYLE_REF } from './catalog';
import { estimateRecraftStyle } from './costs';
import { createGeneration, opSpec, runGeneration } from './jobs';
import { mentionSubjects } from './params';
import { sheetCut } from './sheet';
import type { Subject, SubjectKind, Workspace } from './types';
import { appendFeed, patchSession, setComposer, setComposerMedia, toast, useStore } from '../store/store';

const get = useStore.getState;

function feedBase(workspace: Workspace) {
  return { id: uid('fd'), createdAt: Date.now(), workspace };
}

// ---------------------------------------------------------------------------
// Library: characters, objects, products and styles saved as @Name, shared by every session

export const SUBJECT_KINDS: Array<{ value: SubjectKind; label: string }> = [
  { value: 'character', label: 'Character' },
  { value: 'object', label: 'Object' },
  { value: 'product', label: 'Product' },
  { value: 'location', label: 'Location' },
  { value: 'style', label: 'Style' },
];

/** Legacy node results did not record library images. Capture them before the first library edit. */
function rememberNodeLibrary(name: string): void {
  useStore.setState(st => {
    const attached = new Set(Object.values(st.sessions).flatMap(s => s.graph.nodes.flatMap(n => 'generationId' in n.data && n.data.generationId ? [n.data.generationId] : [])));
    const generations = { ...st.generations };
    for (const id of attached) {
      const g = generations[id];
      if (g && !g.nodeRequest && !g.inputs.nodeLibrary && mentionSubjects(g.prompt, [{ id: name, name }]).ids.length) {
        generations[id] = { ...g, inputs: { ...g.inputs, nodeLibrary: structuredClone(st.library) } };
      }
    }
    return { generations };
  });
}

export function saveSubject(subject: Subject): void {
  const previous = get().library.find(s => s.id === subject.id);
  if (previous) rememberNodeLibrary(previous.name);
  useStore.setState((st) => ({
    library: st.library.some((x) => x.id === subject.id) ? st.library.map((x) => (x.id === subject.id ? subject : x)) : [...st.library, subject],
  }));
}

export function deleteSubject(id: string): void {
  const previous = get().library.find(s => s.id === id);
  if (previous) rememberNodeLibrary(previous.name);
  useStore.setState((st) => ({ library: st.library.filter((x) => x.id !== id) }));
}

export function libraryItem(name: string): Subject | undefined {
  const clean = name.trim().replace(/^@/, '').toLowerCase();
  return get().library.find((x) => x.name.toLowerCase() === clean);
}

/** Save to library: a taken name is refused unless `replace`; the item keeps its id and @Name. */
export function subjectFromAsset(assetId: string, name: string, kind: SubjectKind = 'character', opts: { replace?: boolean; views?: string[] } = {}): Subject | null {
  const clean = name.trim().replace(/^@/, '');
  if (!clean || get().assets[assetId]?.kind !== 'image') return null;
  const existing = libraryItem(clean);
  if (existing && !opts.replace) {
    toast(`@${clean} already exists in the library.`, 'error');
    return null;
  }
  const views = opts.views ?? [];
  const subject: Subject = { ...existing, id: existing?.id ?? uid('sub'), name: existing?.name ?? clean, kind, frontalAssetId: views[0] ?? assetId, refAssetIds: views.slice(1, 4), videoAssetId: undefined };
  saveSubject(subject);
  toast(`Saved as @${clean}: mention it in any prompt`, 'success');
  return subject;
}

/** A reference sheet saved as separate views (Grid-split, local and free): the main view first, then the others. */
export async function saveSheetViews(assetId: string, name: string, kind: SubjectKind, replace: boolean): Promise<Subject | null> {
  const sessionId = get().assets[assetId]?.sessionId ?? get().activeSessionId;
  // Cut and order: sheet.ts.
  const { grid, order } = sheetCut(get().generations[get().assets[assetId]?.generationId ?? '']?.op);
  try {
    const g = createGeneration(await opSpec({ sessionId, sourceAssetId: assetId, op: 'grid_split', params: { grid }, origin: 'op' }));
    const cut = await runGeneration(g.id);
    // The main image comes first: a turnaround's front view.
    const views = cut.length === order.length ? order.map((i) => cut[i]) : cut;
    return subjectFromAsset(assetId, name, kind, { replace, views: views.length >= 3 ? views : undefined });
  } catch (err) {
    toast((err as Error).message, 'error');
    return null;
  }
}

/** A subject from the attachments: the first image is the frontal view, up to 3 more are views; or a video. */
export function subjectFromAttachments(name: string): Subject | null {
  const st = get();
  const images = st.composer.attachments.filter((id) => st.assets[id]?.kind === 'image');
  const video = st.composer.attachments.find((id) => st.assets[id]?.kind === 'video');
  const clean = name.trim().replace(/^@/, '');
  if (!clean || (!images.length && !video)) return null;
  const subject: Subject = { id: uid('sub'), name: clean, frontalAssetId: images[0], refAssetIds: images.slice(1, 4), videoAssetId: images.length ? undefined : video };
  saveSubject(subject);
  const used = new Set([subject.frontalAssetId, ...subject.refAssetIds, subject.videoAssetId]);
  setComposer((c) => ({ attachments: c.attachments.filter((a) => !used.has(a)) }));
  return subject;
}

/** Create a Recraft V4 style from the attached images and select it (after cost confirmation). */
export async function createRecraftStyle(sessionId: string, name: string, budgetPass?: BudgetPass, approvalTicketId?: string, approvedFingerprint?: string): Promise<void> {
  const st = get();
  const images = st.composer.attachments.filter((id) => st.assets[id]?.kind === 'image').slice(0, 10);
  if (!images.length) {
    toast('Attach 1–10 reference images first.', 'error');
    return;
  }
  const g = createGeneration({ sessionId, kind: 'text', prompt: `Create Recraft style “${name}”`, modelRef: RECRAFT_STYLE_REF, settings: { count: 1, advanced: {} }, inputs: { refs: images }, origin: 'composer', estimate: estimateRecraftStyle(), budgetPass, approvalTicketId, ...(approvedFingerprint ? { approvedFingerprint } : {}), ...(budgetPass?.stepKey ? { passStepKey: budgetPass.stepKey } : {}) });
  appendFeed(sessionId, { ...feedBase('chat'), type: 'generation', generationId: g.id });
  try {
    await runGeneration(g.id);
    const styleId = get().generations[g.id]?.text;
    if (!styleId) return;
    patchSession(sessionId, (s) => ({ ...s, styles: [...(s.styles ?? []), { id: uid('sty'), name: name.trim() || 'Style', family: 'recraft-v4', styleId }] }));
    const cur = get().composer.image.settings;
    setComposerMedia('image', { settings: { ...cur, extras: { ...cur.extras, style_id: styleId } } });
    toast(`Style “${name}” saved and selected.`, 'info');
  } catch (err) {
    if (!isAbort(err)) toast((err as Error).message, 'error');
  }
}

/** Create a Kling voice and bind it to the subject when ready (after cost confirmation). */
export async function createSubjectVoice(sessionId: string, subjectId: string, budgetPass?: BudgetPass, approvalTicketId?: string, approvedFingerprint?: string): Promise<void> {
  const st = get();
  const audio = st.composer.attachments.find((id) => st.assets[id]?.kind === 'audio');
  if (!audio) {
    toast('Attach 5–30 s of clean speech first.', 'error');
    return;
  }
  try {
    const spec = await opSpec({ sessionId, sourceAssetId: audio, op: 'create_voice', params: {}, origin: 'op' });
    const g = createGeneration({ ...spec, budgetPass, approvalTicketId, ...(approvedFingerprint ? { approvedFingerprint } : {}), ...(budgetPass?.stepKey ? { passStepKey: budgetPass.stepKey } : {}) });
    appendFeed(sessionId, { ...feedBase('chat'), type: 'generation', generationId: g.id });
    await runGeneration(g.id);
    const voiceId = get().generations[g.id]?.text;
    const subject = get().library.find((x) => x.id === subjectId);
    if (voiceId && subject) {
      saveSubject({ ...subject, voiceId });
      toast(`Voice bound to @${subject.name}.`, 'info');
    }
  } catch (err) {
    if (!isAbort(err)) toast((err as Error).message, 'error');
  }
}

import { useStore } from '../../store/store';
import { defaultModelFor, modelSummary } from '../catalog';
import { guideForModel, modelGuide } from '../guides';
import { readGuide, STAGED_GUIDE } from '../skills';

/*
 * Guides that travel with a request: the staged rules of a picked workflow, and in Direct the prompting guides of the
 * models that can run. Also the gate that keeps a video model's guide for the model that will actually run.
 */

const get = useStore.getState;

/** Whether a text is already somewhere in the conversation sent to the model (guides go once). */
export function inConversation(sessionId: string, t: string): boolean {
  return get().sessions[sessionId].agent.history.some((m) => {
    const c = m.content;
    return typeof c === 'string' ? c.includes(t) : Array.isArray(c) && c.some((p) => p.type === 'text' && p.text.includes(t));
  });
}

/** Model guides for the plan's image and video steps, as a block for a message; '' when none is new. */
export function modelGuidesFor(sessionId: string, workflowGuideId: string): string {
  // Every workflow is a staged piece: its shared rules come in the same result, once per conversation. Model guides
  // do not: they come with the confirmed settings (phase 2), for the model the user actually chose.
  return workflowGuideId.startsWith('workflow:') && !inConversation(sessionId, STAGED_GUIDE) ? `\n\n---\n${STAGED_GUIDE}` : '';
}

const isDirect = () => get().composer.agentStyle === 'direct';

/** Whether the request being handled carries an attachment of a kind (its draft, or the composer before sending). */
function requestHas(sessionId: string, kind: string): boolean {
  const ids = get().sessions[sessionId]?.agent.draft?.attachments ?? get().composer.attachments ?? [];
  return ids.some((id) => get().assets[id]?.kind === kind);
}

/**
 * The models Direct can run, kind by kind: the composer's model, the variant of its line that takes the request's image
 * (or the stated fallback), and for video the per-route models set in the composer. In Direct the composer is the choice:
 * nothing confirmed earlier in the session replaces it.
 */
export function directModelRefs(sessionId: string, kind: 'image' | 'video'): string[] {
  const c = get().composer;
  const refs = [c[kind].modelRef];
  if (requestHas(sessionId, 'image')) refs.push(defaultModelFor(kind, true));
  if (kind === 'video') refs.push(...Object.values(c.videoRoutes ?? {}));
  return [...new Set(refs.filter((r): r is string => Boolean(r)))];
}

/** The prompting guide of each model Direct can run, once per guide and per conversation. */
function directModelGuides(sessionId: string): string {
  if (!isDirect()) return '';
  let out = '';
  const sent = new Set<string>();
  for (const kind of ['image', 'video'] as const) {
    for (const ref of directModelRefs(sessionId, kind)) {
      const guide = guideForModel(ref.split('::')[1] ?? '');
      const text = guide && !sent.has(guide.id) ? readGuide(`model:${guide.id}`) : undefined;
      if (!guide || !text) continue;
      sent.add(guide.id);
      if (!inConversation(sessionId, text)) out += `\n\n---\nPrompting guide of ${modelSummary(ref)?.name ?? ref} (model:${guide.id}); write its prompts in this format:\n${text}`;
    }
  }
  return out;
}

/**
 * A workflow picked in the composer brings its shared rules and its image model's guide with the request. The video
 * model's guide comes later, with the confirmed settings (phase 2), so it is the model the user actually chose. In
 * Direct, the guides of the composer's models come with the request.
 */
export function pickedWorkflowGuides(sessionId: string, askFirst = false): string {
  const id = get().composer.workflowId;
  // Before the agent has asked (a request that may need questions), the workflow is left to read_guide.
  return (id && !askFirst ? modelGuidesFor(sessionId, `workflow:${id}`) : '') + directModelGuides(sessionId);
}

/** Why a video model's guide cannot be loaded yet (phase 2 not confirmed, or another model was confirmed); undefined when it can. */
export function earlyModelGuide(sessionId: string, id: string): string | undefined {
  const [type, gid] = id.trim().split(':');
  const guide = type === 'model' ? modelGuide(gid ?? '') : undefined;
  if (!guide || guide.optional || guide.id === 'video-edit') return undefined;
  // In Direct there is no card: the guides of the models that can run are available as they are.
  if (isDirect()) {
    const refs = directModelRefs(sessionId, 'video');
    if (refs.some((ref) => guideForModel(ref.split('::')[1] ?? '')?.id === guide.id)) return undefined;
    return `Not loaded: in direct mode the video model is the composer's (${refs.map((ref) => modelSummary(ref)?.name ?? ref).join(', ')}). Write its prompts with its own guide.`;
  }
  const confirmed = get().sessions[sessionId].agent.settings?.video;
  const confirmedGuide = confirmed ? guideForModel(confirmed.modelRef.split('::')[1] ?? '')?.id : undefined;
  if (!confirmed) return `Not loaded: the video model is not confirmed yet. Call confirm_settings first; the prompting guide of the model the user confirms comes with the confirmation.`;
  if (confirmedGuide !== guide.id) return `Not loaded: the confirmed video model is ${modelSummary(confirmed.modelRef)?.name ?? confirmed.modelRef}${confirmedGuide ? ` (its guide is model:${confirmedGuide})` : ''}. To use another model, call confirm_settings again.`;
  return undefined;
}

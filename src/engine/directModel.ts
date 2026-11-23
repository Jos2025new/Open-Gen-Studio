import { ensureSchema, sentModelRef } from './catalog';
import { placeFor } from './place';
import { routeVideoInputs } from './params';
import type { Estimate, MediaKind } from './types';
import type { GenerationSpec } from './jobState';
import { useStore } from '../store/store';

/**
 * The model a direct run really uses: a text-only pick with an image attached is checked and priced as its family's
 * edit / image-to-video variant (the same one the run switches to, catalog.sentModelRef), so the button never refuses
 * what the run would do. Starts loading that variant's schema when it is not there yet.
 */
export function directModelRef(kind: string, ref: string, hasImage: boolean): string {
  if (!hasImage || (kind !== 'image' && kind !== 'video')) return ref;
  const twin = sentModelRef(ref, kind, true);
  if (twin === ref) return ref;
  if (!useStore.getState().catalog.schemas[twin]) void ensureSchema(twin).catch(() => undefined);
  return twin;
}

function pick<T>(map: Record<string, T> | undefined, ids: string[]): Record<string, T> | undefined {
  const out = Object.fromEntries(ids.filter((id) => map?.[id] !== undefined).map((id) => [id, map![id]]));
  return Object.keys(out).length ? out : undefined;
}

/** Build the exact direct-generation spec used by both `generateDirect` and command approval review. */
export function buildDirectSpec(kind: MediaKind, sessionId: string, estimate?: Estimate): GenerationSpec {
  const st = useStore.getState();
  const workspace = st.ui.workspace;
  const { settings } = st.composer[kind];
  const text = st.composer.text.trim();
  const attachments = st.composer.attachments.filter((id) => st.assets[id]?.kind === 'image');
  const modelRef = directModelRef(kind, st.composer[kind].modelRef, attachments.length > 0);
  const videoAttachments = st.composer.attachments.filter((id) => st.assets[id]?.kind === 'video');
  const audioAttachments = st.composer.attachments.filter((id) => st.assets[id]?.kind === 'audio');
  const slots = st.catalog.schemas[modelRef]?.slots ?? {};
  const routed = routeVideoInputs(slots, attachments, videoAttachments);
  const parentId = st.composer.editing?.generationId;
  return {
    sessionId,
    kind: kind === 'audio' && st.catalog.models[modelRef]?.textOutput ? 'text' : kind,
    prompt: text,
    modelRef,
    settings: { ...settings, seed: parentId ? settings.seed : undefined },
    inputs: {
      ...(kind === 'image'
        ? { refs: [...attachments, ...videoAttachments, ...audioAttachments] }
        : kind === 'audio'
          ? { refs: audioAttachments }
          : kind === 'model3d'
            ? { refs: attachments }
            : { refs: [...routed.images, ...routed.videos, ...audioAttachments], firstFrame: routed.firstFrame }),
      times: pick(st.composer.times, attachments),
      trims: pick(st.composer.trims, videoAttachments),
    },
    origin: workspace === 'node' ? 'node' : workspace === 'designer' ? 'designer' : 'composer',
    place: placeFor(st.ui, workspace),
    mode: kind,
    parentId,
    ...(estimate ? { estimate } : {}),
  };
}

import { uid } from '../lib/id';
import { ctltFromSettings, type CaptureCustom } from './captureStyles';
import { libraryItem, saveSubject } from './actions';
import { pickShot, SHOTS } from './realism';
import type { Subject } from './types';
import { toast, useStore } from '../store/store';

/** «Guardar como estilo»: el CTLT de un resultado (su captura, o la hoja de su registro) guardado en la biblioteca como estilo propio. */

/** The CTLT a result was made with; null for an asset that no generation made, or an operation. */
export function captureOfAsset(assetId: string): CaptureCustom | null {
  const st = useStore.getState();
  const g = st.generations[st.assets[assetId]?.generationId ?? ''];
  if (!g || g.op || (g.kind !== 'image' && g.kind !== 'video')) return null;
  const mode = g.settings.realism ?? 'balanced';
  const sheet = SHOTS[pickShot(g.prompt, mode, g.settings.shot) ?? 'balanced'];
  return ctltFromSettings(g.settings, sheet) ?? null;
}

/** Saves (or, with `replace`, overwrites a style of that name). `withImage`: the image also goes as the style reference of @Name. */
export function saveCaptureStyle(assetId: string, name: string, withImage: boolean, replace = false): Subject | null {
  const clean = name.trim().replace(/^@/, '').slice(0, 40);
  const capture = captureOfAsset(assetId);
  if (!clean || !capture) return null;
  const existing = libraryItem(clean);
  if (existing && (existing.kind !== 'style' || !replace)) {
    toast(existing.kind !== 'style' ? `@${clean} ya existe como otro elemento de la biblioteca.` : `El estilo ${clean} ya existe.`, 'error');
    return null;
  }
  const image = withImage && useStore.getState().assets[assetId]?.kind === 'image' ? assetId : undefined;
  const subject: Subject = { ...existing, id: existing?.id ?? uid('sub'), name: existing?.name ?? clean, kind: 'style', refAssetIds: [], frontalAssetId: image, videoAssetId: undefined, capture };
  saveSubject(subject);
  toast(`Estilo «${clean}» guardado en Mis estilos`, 'success');
  return subject;
}

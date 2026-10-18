import { ensureSchema, inputVariant } from './catalog';
import { useStore } from '../store/store';

/**
 * The model a direct run really uses: a text-only pick with an image attached is checked and priced as its family's
 * edit / image-to-video variant (the same one the run switches to, catalog.inputVariant), so the button never refuses
 * what the run would do. Starts loading that variant's schema when it is not there yet.
 */
export function directModelRef(kind: string, ref: string, hasImage: boolean): string {
  if (!hasImage || (kind !== 'image' && kind !== 'video')) return ref;
  const twin = inputVariant(ref, kind)?.ref;
  if (!twin) return ref;
  if (!useStore.getState().catalog.schemas[twin]) void ensureSchema(twin).catch(() => undefined);
  return twin;
}

import { isUnreadable } from './raster';

export const UNREADABLE_EDIT = 'The pixels of this layer could not be read. They are kept on disk as they are; the warning on the layer in Layers tries again.';

/** Why a raster edit cannot run yet: pixels that failed to read (D30) are not "still loading". */
export function pixelsNotReady(ids: Array<string | undefined>): string {
  return ids.some((id) => id && isUnreadable(id)) ? UNREADABLE_EDIT : 'Layer pixels are still loading. Try again in a moment.';
}

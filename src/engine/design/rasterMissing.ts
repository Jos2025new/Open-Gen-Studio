import { isUnreadable } from './raster';

/** Why a raster edit cannot run yet: pixels that failed to read (D30) are not "still loading". */
export function pixelsNotReady(ids: Array<string | undefined>): string {
  return ids.some((id) => id && isUnreadable(id))
    ? 'The pixels of this layer could not be read. They are kept on disk as they are; the warning on the layer in Layers tries again.'
    : 'Layer pixels are still loading. Try again in a moment.';
}

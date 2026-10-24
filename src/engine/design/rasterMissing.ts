import { isUnreadable, UNREADABLE_EDIT } from './raster';

/** Why a raster edit cannot run yet: pixels that failed to read (D30) are not "still loading". */
export function pixelsNotReady(ids: Array<string | undefined>): string {
  return ids.some((id) => id && isUnreadable(id)) ? UNREADABLE_EDIT : 'Layer pixels are still loading. Try again in a moment.';
}

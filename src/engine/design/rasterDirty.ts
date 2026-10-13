import type { Layer } from '../types';
import { mapBox } from './matrix';
import { bufferVersion, getRasterSurface, rasterBufferIds, takeDirty, type Dirty } from './raster';
import type { Rect } from './retainedPage';
import { extendRasterBounds } from './rasterBounds';

/** Take pending raster writes and map their buffer pixels through layer placement into retained-page pixels. */
export function rasterDirtyRect(layer: Layer, scale: number): Rect | null {
  if (layer.type !== 'raster') return null;
  let area: Rect | null = null;
  for (const id of rasterBufferIds([layer])) {
    const dirty: Dirty | null = takeDirty(id);
    // A paint base is only source material for a rebuild. The displayed pixels live in layer.id, whose rebuild marks
    // its own dirty area; invalidating the page for the base clone alone needlessly turns entering Edit into a repaint.
    if (id !== layer.id || !dirty) continue;
    // Dirty areas are in full-buffer pixels: the layer's size in them, not the size of the box.
    const surface = getRasterSurface(id);
    if (surface) extendRasterBounds(id, bufferVersion(id), surface.fw, surface.fh, dirty);
    const fw = surface?.fw ?? 0, fh = surface?.fh ?? 0;
    const local = dirty === 'all' || !fw || !fh ? { x: layer.x, y: layer.y, w: layer.width, h: layer.height } : {
      x: layer.x + dirty.x0 * layer.width / fw,
      y: layer.y + dirty.y0 * layer.height / fh,
      w: (dirty.x1 - dirty.x0) * layer.width / fw,
      h: (dirty.y1 - dirty.y0) * layer.height / fh,
    };
    const page = layer.transform ? mapBox(layer.transform, local) : local;
    const rect = { x0: page.x * scale, y0: page.y * scale, x1: (page.x + page.w) * scale, y1: (page.y + page.h) * scale };
    area = area ? { x0: Math.min(area.x0, rect.x0), y0: Math.min(area.y0, rect.y0), x1: Math.max(area.x1, rect.x1), y1: Math.max(area.y1, rect.y1) } : rect;
  }
  return area;
}

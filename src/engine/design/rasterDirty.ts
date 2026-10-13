import type { Layer } from '../types';
import { mapBox } from './matrix';
import { getBuffer, rasterBufferIds, takeDirty, type Dirty } from './raster';
import type { Rect } from './retainedPage';

/** Take pending raster writes and map their buffer pixels through layer placement into retained-page pixels. */
export function rasterDirtyRect(layer: Layer, scale: number): Rect | null {
  if (layer.type !== 'raster') return null;
  let area: Rect | null = null;
  for (const id of rasterBufferIds([layer])) {
    const dirty: Dirty | null = takeDirty(id);
    if (!dirty) continue;
    const buf = getBuffer(id);
    const local = dirty === 'all' || !buf?.width || !buf.height ? { x: layer.x, y: layer.y, w: layer.width, h: layer.height } : {
      x: layer.x + dirty.x0 * layer.width / buf.width,
      y: layer.y + dirty.y0 * layer.height / buf.height,
      w: (dirty.x1 - dirty.x0) * layer.width / buf.width,
      h: (dirty.y1 - dirty.y0) * layer.height / buf.height,
    };
    const page = layer.transform ? mapBox(layer.transform, local) : local;
    const rect = { x0: page.x * scale, y0: page.y * scale, x1: (page.x + page.w) * scale, y1: (page.y + page.h) * scale };
    area = area ? { x0: Math.min(area.x0, rect.x0), y0: Math.min(area.y0, rect.y0), x1: Math.max(area.x1, rect.x1), y1: Math.max(area.y1, rect.y1) } : rect;
  }
  return area;
}

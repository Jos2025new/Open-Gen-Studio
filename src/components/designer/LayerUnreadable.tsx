import { useSyncExternalStore } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { Layer } from '../../engine/types';
import { ensureBuffers, isUnreadable, rasterVersion, subscribeRaster } from '../../engine/design/raster';
import { IconButton } from '../ui/primitives';
import { toast } from '../../store/store';

/** D30: a layer whose stored pixels could not be read stays marked (not only a toast); clicking reads them again. */
export function LayerUnreadable({ layer }: { layer: Layer }) {
  useSyncExternalStore(subscribeRaster, rasterVersion);
  if (layer.type !== 'raster' || !(isUnreadable(layer.id) || (layer.paintBaseId && isUnreadable(layer.paintBaseId)))) return null;
  return <IconButton className="layer-toggle is-on" icon={AlertTriangle} size="sm"
    label={`The pixels of ${layer.name} could not be read. They are kept on disk as they are, never saved over. Click to try again.`}
    onClick={() => void ensureBuffers([layer]).then(() => { if (isUnreadable(layer.id) || (layer.paintBaseId && isUnreadable(layer.paintBaseId))) toast(`The pixels of ${layer.name} still could not be read.`, 'error'); })} />;
}

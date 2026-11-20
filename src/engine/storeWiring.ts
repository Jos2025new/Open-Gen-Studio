// Startup wiring for Designer and Nodes hooks registered into storeBindings (DIP for src/store/store.ts).
import './flow/locks';
import './flow/history';
import './design/paintMode';
import { historyDepth } from './design/history';
import { objectPicks } from './design/objectSelection';
import { flushRaster, pendingRaster } from './design/raster';
import { useLayerSelection } from './design/selection';
import { storeHooks } from './storeBindings';

storeHooks.loadRaster = async () => ({ flushRaster });
storeHooks.designerTestInfo = (docId) => ({
  selection: {
    layers: docId ? useLayerSelection.getState().byDoc[docId] ?? [] : [],
    objects: docId ? objectPicks(docId) : [],
  },
  history: docId ? historyDepth(docId) : { undo: 0, redo: 0 },
  raster: pendingRaster(),
});

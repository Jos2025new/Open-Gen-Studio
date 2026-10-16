import { Eye, EyeOff, Lock } from 'lucide-react';
import { IconButton } from '../ui/primitives';
import { patchLayer, setActiveLayer } from '../../engine/design/actions';
import { layerSelection, pickLayer, pickLayerRange, useLayerSelection } from '../../engine/design/selection';
import type { DesignDoc } from '../../engine/types';

/** The compact layers list (the Layers popover of the board's bar): eye, active layer, lock; the order is read-only. */
export function EmbeddedLayers({ sessionId, doc }: { sessionId: string; doc: DesignDoc }) {
  useLayerSelection((st) => st.byDoc[doc.id]);
  const picked = new Set(layerSelection(doc.id, doc.activeLayerId, doc.layers.map((l) => l.id)));
  if (!doc.layers.length) return <p className="studio-layers muted">No layers yet.</p>;
  return <ul className="studio-layers" aria-label="Layers">
    {[...doc.layers].reverse().map((l) => <li key={l.id} className={`studio-layer ${picked.has(l.id) ? 'is-active' : ''} ${l.visible ? '' : 'is-hidden'}`}>
      <IconButton icon={l.visible ? Eye : EyeOff} label={`${l.visible ? 'Hide' : 'Show'} ${l.name}`} size="sm" onClick={() => patchLayer(sessionId, doc.id, l.id, { visible: !l.visible })} />
      <button type="button" className="studio-layer-name" aria-pressed={l.id === doc.activeLayerId} onClick={(e) => {
        if (e.shiftKey && !(e.ctrlKey || e.metaKey)) { pickLayerRange(doc.id, doc.activeLayerId, l.id, doc.layers.map((x) => x.id)); return; }
        pickLayer(doc.id, l.id, e.ctrlKey || e.metaKey, [...picked]); setActiveLayer(sessionId, doc.id, l.id);
      }}>{l.name}</button>
      {l.locked ? <Lock size={12} className="faint" aria-label="Locked" /> : null}
    </li>)}
  </ul>;
}

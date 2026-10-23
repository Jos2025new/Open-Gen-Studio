import { useState } from 'react';
import type { DesignDoc } from '../../engine/types';
import type { RelativeTo } from '../../engine/design/transform';
import { layerObjects } from '../../engine/design/objectOps';
import { layerSelection, useLayerSelection } from '../../engine/design/selection';
import { useObjectSelection } from '../../engine/design/objectSelection';
import { useStore } from '../../store/store';
import { ContextStrip } from './ContextStrip';
import { EditOps } from './ToolSettings';
import { usePickedShape } from './ShapeLookFields';
import { MULTI_SOON } from './toolboxModel';

/** How many objects (or layers, in Layer mode) the Edit tool would act on, read the way EditOps reads them. */
export function useEditCount(doc: DesignDoc): number {
  const mode = useStore((s) => s.ui.selectMode ?? 'objects');
  const objectPick = useObjectSelection((st) => st.byDoc[doc.id] ?? null);
  useLayerSelection((st) => st.byDoc[doc.id]);
  const layerIds = layerSelection(doc.id, doc.activeLayerId, doc.layers.map((l) => l.id));
  const layerGroup = mode === 'layers' || (!objectPick && layerIds.length > 1);
  if (layerGroup) return layerIds.length;
  const layer = objectPick && doc.layers.find((l) => l.id === objectPick.layerId);
  if (layer) { const ids = objectPick!.ids.filter((id) => layerObjects(layer).some((o) => o.id === id)); if (ids.length) return ids.length; }
  const active = doc.layers.find((l) => l.id === doc.activeLayerId);
  return active && !layerObjects(active).length && active.type !== 'vector' ? 1 : 0;
}

/** The Edit card follows the selection: one object shows its own settings with Transform and Align; two or more show Align and Distribute. */
export function EditCard({ sessionId, doc }: { sessionId: string; doc: DesignDoc }) {
  const count = useEditCount(doc);
  const mode = useStore((s) => s.ui.selectMode ?? 'objects');
  const picked = usePickedShape(doc);
  const [prefs, setPrefs] = useState<{ relativeTo: RelativeTo | null; alignAsGroup: boolean }>({ relativeTo: null, alignAsGroup: false });
  const alignPanel = { ...prefs, setRelativeTo: (relativeTo: RelativeTo) => setPrefs((v) => ({ ...v, relativeTo })), setAlignAsGroup: (alignAsGroup: boolean) => setPrefs((v) => ({ ...v, alignAsGroup })) };
  // The strip falls back to the tool settings (which already hold Transform) unless a shape is picked.
  const stripHasTransform = !(picked && mode === 'objects');
  return <div className="edit-card" data-selection={count > 1 ? 'many' : count === 1 ? 'one' : 'none'}>
    <ContextStrip sessionId={sessionId} doc={doc} />
    {count === 1 && !stripHasTransform && <EditOps sessionId={sessionId} doc={doc} turnOnly />}
    {count >= 1 && <section className="edit-card-align" aria-label="Align and distribute">
      <EditOps sessionId={sessionId} doc={doc} panelOnly alignPanel={alignPanel} />
      {count > 1 && <div className="edit-card-soon" role="group" aria-label="Combine">
        {MULTI_SOON.map((item) => <button key={item.id} type="button" className="opt" disabled aria-disabled="true" title={`Soon: ${item.soon}`} data-tip={`Soon: ${item.soon}`}>{item.label}</button>)}
      </div>}
    </section>}
  </div>;
}

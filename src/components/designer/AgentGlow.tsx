import { useSyncExternalStore } from 'react';
import { glowingLayers, subscribeGlow } from '../../engine/design/agentGlow';
import type { DesignDoc } from '../../engine/types';
import { layerBox } from '../../engine/design/render';
import { documentToScreen, type View } from '../../engine/design/viewCoordinates';

/*
 * The agent's canvas edits: a brief outline on each layer it changed (agentGlow.ts). It is drawn over the page and is
 * not part of the document, its history or an export. The CSS animates it; reduced motion keeps a still outline.
 */
export function AgentGlow({ view, doc }: { view: View; doc: DesignDoc }) {
  const key = useSyncExternalStore(subscribeGlow, () => glowingLayers(doc.id).join('|'));
  if (!key) return null;
  const ids = key.split('|');
  return <div className="stroke-ruler agent-glow-layer" aria-hidden="true">
    {doc.layers.filter((l) => ids.includes(l.id)).map((l) => {
      const b = layerBox(l);
      if (!b) return null;
      const at = documentToScreen({ x: b.x, y: b.y }, view, { left: 0, top: 0 });
      return <div key={l.id} className="agent-glow" style={{ left: at.x, top: at.y, width: b.w * view.zoom, height: b.h * view.zoom }} />;
    })}
  </div>;
}

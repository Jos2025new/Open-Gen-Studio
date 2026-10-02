import { canvasIndex } from './canvas';
import { focusNodes } from './flow/selection';
import { selectDoc, setActiveLayer } from './design/actions';
import type { Generation, Workspace } from './types';
import { selectSession, setUi, useStore } from '../store/store';

/*
 * Where a generation was made and how to go back to it: its session and canvas, and there its card (chat), its node
 * (node canvas) or the layer it is on (Designer).
 */

const get = useStore.getState;

export interface GenerationPlace {
  sessionId: string;
  sessionTitle: string;
  canvas: Workspace;
  /** What gets the focus there. */
  target: { kind: 'card' } | { kind: 'node'; nodeId: string } | { kind: 'layer'; docId: string; layerId: string } | { kind: 'none' };
}

export function generationPlace(g: Generation): GenerationPlace | null {
  const st = get();
  const s = st.sessions[g.sessionId];
  if (!s) return null;
  const node = s.graph.nodes.find((n) => 'generationId' in n.data && n.data.generationId === g.id);
  const canvas: Workspace = canvasIndex(s, st.generations).generation(g) ?? (node ? 'node' : 'chat');
  const base = { sessionId: s.id, sessionTitle: s.title, canvas };
  if (canvas === 'node' && node) return { ...base, target: { kind: 'node', nodeId: node.id } };
  if (canvas === 'designer') {
    for (const d of s.docs) {
      const l = d.layers.find((x) => 'sourceAssetId' in x && x.sourceAssetId && g.assetIds.includes(x.sourceAssetId));
      if (l) return { ...base, target: { kind: 'layer', docId: d.id, layerId: l.id } };
    }
  }
  const card = s.feed.some((f) => f.type === 'generation' && f.generationId === g.id);
  return { sessionId: s.id, sessionTitle: s.title, canvas, target: card ? { kind: 'card' } : { kind: 'none' } };
}

/** Switch to the generation's session and canvas and put the focus on it. */
export function goToGeneration(g: Generation): void {
  const place = generationPlace(g);
  if (!place) return;
  if (get().activeSessionId !== place.sessionId) selectSession(place.sessionId);
  setUi({ workspace: place.canvas, panel: null, lightbox: null });
  const t = place.target;
  if (t.kind === 'node') focusNodes(place.sessionId, [t.nodeId]);
  else if (t.kind === 'layer') {
    selectDoc(place.sessionId, t.docId);
    setActiveLayer(place.sessionId, t.docId, t.layerId);
  } else if (t.kind === 'card') {
    // After the canvas renders: scroll the card into view and flash it.
    window.setTimeout(() => {
      const el = document.getElementById(`gen-${g.id}`);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('is-flash');
      window.setTimeout(() => el.classList.remove('is-flash'), 1600);
    }, 120);
  }
}

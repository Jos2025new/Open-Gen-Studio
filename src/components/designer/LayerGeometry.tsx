import { useRef, useState } from 'react';
import { Link2, Link2Off } from 'lucide-react';
import type { DesignDoc, Layer } from '../../engine/types';
import { layerBox } from '../../engine/design/render';
import { scaleLayer, translateLayer } from '../../engine/design/doc';
import { getDoc, mutateDoc, rebasePaintLayer } from '../../engine/design/actions';
import { IconButton } from '../ui/primitives';

type Key = 'x' | 'y' | 'w' | 'h';
const TIPS: Record<Key, string> = {
  x: 'Left edge, from the left of the page',
  y: 'Top edge, from the top of the page',
  w: 'Width of what the layer shows',
  h: 'Height of what the layer shows',
};

/**
 * Where the layer's visible content sits on the page, and how big it is, in page pixels: the box of what you see
 * (a painted stroke, a shape, the image), not the layer's internal frame. Type a value, or drag the letter left or
 * right (Shift: ×10). A drag is one undo step. W and H can keep their ratio.
 */
export function LayerGeometry({ sessionId, doc, layer }: { sessionId: string; doc: DesignDoc; layer: Layer }) {
  const box = layerBox(layer);
  const [lock, setLock] = useState(layer.type === 'raster' && Boolean(layer.sourceAssetId));
  const [draft, setDraft] = useState<{ key: Key; text: string } | null>(null);
  const scrub = useRef<{ key: Key; x: number; start: number; recorded: boolean } | null>(null);

  if (!box) return <p className="faint geometry-empty">Draw or place something on this layer to position it.</p>;

  const values: Record<Key, number> = { x: box.x, y: box.y, w: box.w, h: box.h };

  /** Set one value; the layer moves or scales so its visible box gets it. */
  const apply = (key: Key, v: number, record: boolean) => {
    const cur = getDoc(sessionId, doc.id)?.layers.find((l) => l.id === layer.id);
    const b = cur && layerBox(cur);
    if (!cur || !b || cur.locked || !Number.isFinite(v)) return;
    let next: Layer;
    if (key === 'x') next = translateLayer(cur, v - b.x, 0);
    else if (key === 'y') next = translateLayer(cur, 0, v - b.y);
    else {
      const size = Math.max(1, v);
      const s = key === 'w' ? size / b.w : size / b.h;
      next = scaleLayer(cur, key === 'w' || lock ? s : 1, key === 'h' || lock ? s : 1, b.x, b.y);
    }
    mutateDoc(sessionId, doc.id, (d) => ({ ...d, updatedAt: Date.now(), layers: d.layers.map((l) => (l.id === layer.id ? next : l)) }), { record });
  };
  // Painted layers are redrawn onto a page-sized buffer after a change, so the brush still reaches the whole page.
  const settle = () => { if (layer.type === 'raster' && !layer.sourceAssetId) rebasePaintLayer(sessionId, doc.id, layer.id); };
  const commit = () => {
    if (!draft) return;
    const v = Number(draft.text);
    setDraft(null);
    if (draft.text.trim() !== '' && v !== Math.round(values[draft.key])) { apply(draft.key, v, true); settle(); }
  };

  const cell = (key: Key) => (
    <label key={key} className="xywh-cell" data-tip={`${TIPS[key]} · drag the letter to change it`}>
      <span
        className="xywh-scrub"
        onPointerDown={(e) => {
          if (layer.locked) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          scrub.current = { key, x: e.clientX, start: values[key], recorded: false };
        }}
        onPointerMove={(e) => {
          const s = scrub.current;
          if (!s || s.key !== key) return;
          const dx = (e.clientX - s.x) * (e.shiftKey ? 10 : 1);
          if (!dx) return;
          apply(key, Math.round(s.start + dx), !s.recorded);
          s.recorded = true;
        }}
        onPointerUp={() => { if (scrub.current?.recorded) settle(); scrub.current = null; }}
        onPointerCancel={() => { scrub.current = null; }}
      >{key.toUpperCase()}</span>
      <input
        type="number"
        value={draft?.key === key ? draft.text : Math.round(values[key])}
        min={key === 'w' || key === 'h' ? 1 : undefined}
        onChange={(e) => setDraft({ key, text: e.target.value })}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setDraft(null); e.currentTarget.blur(); } }}
      />
    </label>
  );

  return <div className="geometry">
    <span className="field-label">Position and size <span className="faint">· px</span></span>
    <div className="geometry-row">{cell('x')}<span className="geometry-gap" />{cell('y')}</div>
    <div className="geometry-row">
      {cell('w')}
      <IconButton className="geometry-lock" icon={lock ? Link2 : Link2Off} label={lock ? 'Width and height keep their ratio' : 'Width and height change separately'} size="sm" active={lock} onClick={() => setLock(!lock)} />
      {cell('h')}
    </div>
  </div>;
}

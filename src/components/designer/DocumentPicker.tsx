import { useEffect, useRef, useSyncExternalStore } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { DesignDoc } from '../../engine/types';
import { selectDoc } from '../../engine/design/actions';
import { drawDoc } from '../../engine/design/render';
import { ensureBuffers, rasterVersion, subscribeRaster } from '../../engine/design/raster';
import { usePref } from '../ui/hooks';

function Thumbnail({ doc }: { doc: DesignDoc }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const version = useSyncExternalStore(subscribeRaster, rasterVersion);
  useEffect(() => {
    void ensureBuffers(doc.layers.filter((l) => l.type === 'raster'));
  }, [doc.layers]);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 144, 96);
    const scale = Math.min(144 / doc.width, 96 / doc.height);
    ctx.save();
    ctx.translate((144 - doc.width * scale) / 2, (96 - doc.height * scale) / 2);
    ctx.scale(scale, scale);
    drawDoc(ctx, doc);
    ctx.restore();
  }, [doc, version]);
  return <canvas ref={ref} width={144} height={96} className="document-thumb" aria-hidden="true" />;
}

export function DocumentPicker({ sessionId, docs, active }: { sessionId: string; docs: DesignDoc[]; active: DesignDoc }) {
  // Stays open until its own button closes it (remembered in this browser), so canvases can be switched freely.
  const [open, setOpen] = usePref('ogs:canvas-picker-open', false);
  return <div className="document-picker">
    <button type="button" className="document-picker-toggle" aria-label="Choose canvas" aria-expanded={open} onClick={() => setOpen(!open)}><span>{active.name}</span>{open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button>
    {open ? <div className="document-thumbnails document-picker-panel" role="listbox" aria-label="Canvases">
      {docs.map((doc) => <button type="button" key={doc.id} className={`document-choice ${doc.id === active.id ? 'is-active' : ''}`} aria-pressed={doc.id === active.id} onClick={() => selectDoc(sessionId, doc.id)}>
        <Thumbnail doc={doc} /><span>{doc.name}</span><small>{doc.width} × {doc.height}</small>
      </button>)}
    </div> : null}
  </div>;
}

import { useEffect, useRef } from 'react';
import type { DesignDoc } from '../../engine/types';
import { rulerStep } from '../../engine/design/guides';
import type { View } from '../../engine/design/viewCoordinates';
import { RULER, tok } from './stageTheme';

/** A ruler along the top or left edge of the stage: page units, ticks that follow the zoom. Drag from it to make a guide. */
export function Ruler({ side, view, size, guides, ...handlers }: { side: 'top' | 'left'; view: View; size: { w: number; h: number }; guides?: DesignDoc['guides'] } & Pick<React.HTMLAttributes<HTMLCanvasElement>, 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel' | 'onContextMenu'>) {
  const ref = useRef<HTMLCanvasElement>(null);
  const len = side === 'top' ? size.w : size.h;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = side === 'top' ? len : RULER, h = side === 'top' ? RULER : len;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = tok('--surface', '#18181c');
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = tok('--text-3', '#8e8e98');
    ctx.strokeStyle = tok('--border-strong', '#55555e');
    ctx.font = '9px system-ui, sans-serif';
    const step = rulerStep(view.zoom);
    const origin = side === 'top' ? view.x : view.y;
    const first = Math.floor(-origin / view.zoom / step) * step;
    ctx.beginPath();
    for (let v = first; origin + v * view.zoom < len; v += step / 5) {
      const at = Math.round(origin + v * view.zoom) + 0.5;
      const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
      const tick = major ? RULER : RULER / 3;
      if (side === 'top') { ctx.moveTo(at, RULER); ctx.lineTo(at, RULER - tick); }
      else { ctx.moveTo(RULER, at); ctx.lineTo(RULER - tick, at); }
      if (major) {
        const label = String(Math.round(v));
        if (side === 'top') ctx.fillText(label, at + 2, 9);
        else { ctx.save(); ctx.translate(9, at + 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'right'; ctx.fillText(label, 0, 0); ctx.restore(); }
      }
    }
    ctx.stroke();
    // Guide marks on the ruler.
    ctx.fillStyle = '#2fb8ff';
    for (const g of (side === 'top' ? guides?.x : guides?.y) ?? []) {
      const at = origin + g * view.zoom;
      if (side === 'top') ctx.fillRect(at - 1, RULER - 5, 3, 5);
      else ctx.fillRect(RULER - 5, at - 1, 5, 3);
    }
  }, [side, len, view, guides]);
  const style: React.CSSProperties = side === 'top'
    ? { position: 'absolute', left: 0, top: 0, width: len, height: RULER, cursor: 'row-resize' }
    : { position: 'absolute', left: 0, top: 0, width: RULER, height: len, cursor: 'col-resize' };
  return <canvas ref={ref} className="stage-ruler" style={style} data-tip={side === 'top' ? 'Drag down for a guide · right-click clears guides' : 'Drag right for a guide · right-click clears guides'} {...handlers} />;
}

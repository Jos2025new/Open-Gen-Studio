import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { packRows } from '../../lib/justifiedRows';

const PAD = 12;
/** Used before the first measurement and where layout does not exist (tests), so tiles still render in order. */
const FALLBACK_WIDTH = 640;

export interface JGridItem { id: string; ratio: number; node: ReactNode }

/**
 * Justified rows: every row has one height and each tile's width follows its aspect ratio (no square cropping).
 * The container width comes from one ResizeObserver; rows are packed in a memo, so a slider move or a resize only
 * recomputes numbers and updates inline sizes.
 */
export function JustifiedGrid({ items, rowHeight, gap = 7, className }: { items: JGridItem[]; rowHeight: number; gap?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (w: number) => setWidth((cur) => (Math.abs(cur - w) >= 1 ? Math.floor(w) : cur));
    measure(el.getBoundingClientRect().width - PAD * 2);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => { for (const e of entries) measure(e.contentRect.width); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const usable = width > 0 ? width : FALLBACK_WIDTH;
  const rows = useMemo(() => packRows(items.map(({ id, ratio }) => ({ id, ratio })), usable, rowHeight, gap), [items, usable, rowHeight, gap]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i.node])), [items]);
  return (
    <div ref={ref} className={`jg ${className ?? ''}`} style={{ ['--row-h' as string]: `${rowHeight}px`, gap }}>
      {rows.map((row, i) => (
        <div key={i} className="jg-row" style={{ height: row.height, gap }}>
          {row.cells.map((c) => <div key={c.id} className="jg-cell" style={{ width: c.width, height: c.height }}>{byId.get(c.id)}</div>)}
        </div>
      ))}
    </div>
  );
}

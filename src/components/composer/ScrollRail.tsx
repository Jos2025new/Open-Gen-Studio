import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';

/** A row that scrolls sideways, with « » only while something is out of view. */
export function ScrollRail({ className = '', backLabel, onLabel, children }: { className?: string; backLabel: string; onLabel: string; children: ReactNode }) {
  const rail = useRef<HTMLDivElement>(null);
  const [can, setCan] = useState({ back: false, on: false });
  const measure = () => {
    const r = rail.current;
    if (!r) return;
    const back = r.scrollLeft > 1, on = r.scrollLeft < r.scrollWidth - r.clientWidth - 1;
    setCan((c) => (c.back === back && c.on === on ? c : { back, on }));
  };
  useEffect(() => {
    const r = rail.current;
    if (!r || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(r);
    for (const child of r.children) observer.observe(child);
    return () => observer.disconnect();
  });
  const nudge = (by: number) => rail.current?.scrollBy({ left: by, behavior: 'smooth' });
  return <>
    {can.back ? <button type="button" className="composer-strip-nudge" aria-label={backLabel} onClick={() => nudge(-160)}><ChevronsLeft size={14} /></button> : null}
    <div ref={rail} className={`composer-strip-rail ${className}`} onScroll={measure}>{children}</div>
    {can.on ? <button type="button" className="composer-strip-nudge" aria-label={onLabel} onClick={() => nudge(160)}><ChevronsRight size={14} /></button> : null}
  </>;
}

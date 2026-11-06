import { forwardRef, useImperativeHandle, useRef } from 'react';

export interface SampleLoupeHandle {
  /** Place it by the pointer (stage pixels) showing `color` (null: nothing drawn there). */
  show(x: number, y: number, color: string | null): void;
  hide(): void;
}

/** The color under the pointer while sampling by dragging. Written through the DOM, so a move never re-renders the Stage. */
export const SampleLoupe = forwardRef<SampleLoupeHandle>(function SampleLoupe(_, ref) {
  const el = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => ({
    show(x, y, color) {
      const n = el.current;
      if (!n) return;
      n.style.display = 'block';
      n.style.transform = `translate(${Math.round(x + 18)}px, ${Math.round(y - 46)}px)`;
      n.style.background = color ?? 'repeating-conic-gradient(#888 0 25%, #ccc 0 50%) 0 0 / 8px 8px';
    },
    hide() { if (el.current) el.current.style.display = 'none'; },
  }), []);
  return <div ref={el} aria-hidden data-sample-loupe style={{ position: 'absolute', left: 0, top: 0, width: 30, height: 30, borderRadius: '50%', border: '2px solid #fff', boxShadow: '0 0 0 1px rgba(0,0,0,.55), 0 2px 6px rgba(0,0,0,.35)', pointerEvents: 'none', display: 'none', zIndex: 6 }} />;
});

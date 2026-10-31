import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

/*
 * Dropdowns align their right edge with the trigger's chevron and open below,
 * flipping above when needed. Other panels retain their explicit placement.
 */

export type Placement = 'top-start' | 'top-center' | 'bottom-start' | 'bottom-center' | 'right-start' | 'right-end';

const GAP = 8;
const MARGIN = 8;

/** Choose the side that fits the whole panel; if neither fits, give it the larger scrollable area. */
export function openPopoverAbove(placement: Placement, above: number, below: number, contentH: number): boolean {
  const prefersBelow = placement === 'bottom-start' || placement === 'bottom-center';
  if (prefersBelow) return below < contentH && above > below;
  return above >= contentH || (below < contentH && above >= below);
}

/** Keep a popover within its available horizontal bounds, including narrow panels. */
export function boundPopoverWidth(requested: number, left: number, right: number): number {
  return Math.min(requested, Math.max(0, right - left));
}

/** Left limit of a start-aligned popover: the anchor's left edge while the full width fits to its right; otherwise it
 *  slides left (never past the boundary) instead of shrinking into a sliver beside the edge. */
export function startAlignedBound(anchorLeft: number, width: number, left: number, right: number): number {
  return Math.max(left, Math.min(anchorLeft, right - width));
}

export function boundPopoverLeft(preferred: number, width: number, left: number, right: number): number {
  return Math.max(left, Math.min(preferred, right - width));
}

// Open popovers, oldest first. Lets nested popovers keep their parents open.
const stack: Array<{ id: number; el: () => HTMLElement | null; anchor: () => HTMLElement | null }> = [];
let seq = 0;

interface PopoverProps {
  open: boolean;
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  placement?: Placement;
  /** 'content': the box takes its own width (CSS) and is placed by what it measures. */
  width?: number | 'content';
  align?: 'start' | 'end';
  /** Start-aligned only: near the boundary, 'slide' keeps the full width by moving left; the default narrows beside the anchor. */
  edge?: 'narrow' | 'slide';
  boundarySelector?: string;
  className?: string;
  label?: string;
  children: ReactNode;
}

export function Popover({ open, anchor, onClose, placement = 'top-start', width = 300, align = 'end', edge = 'narrow', boundarySelector, className, label, children }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' });
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const place = useCallback(() => {
    const a = anchor.current;
    const el = ref.current;
    if (!a || !el) return;
    const r = a.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const fit = width === 'content';
    const box = a.closest(boundarySelector ?? '[data-pop-bound], .side-panel, .results-popover, .model-list, .agent-model-pop')?.getBoundingClientRect();
    const lo = Math.max(MARGIN, box?.left ?? 0);
    const hi = Math.min(vw - MARGIN, box?.right ?? vw);
    const start = align === 'start' && placement !== 'right-start' && placement !== 'right-end' ? (edge === 'slide' ? startAlignedBound(r.left, fit ? el.offsetWidth : width, lo, hi) : Math.max(lo, Math.min(r.left, hi))) : lo;
    const w = boundPopoverWidth(fit ? el.offsetWidth : width, start, hi);
    const contentH = el.scrollHeight;
    const next: CSSProperties = { ...(fit ? { maxWidth: Math.max(0, hi - start) } : { width: w }), visibility: 'visible' };
    if (placement === 'right-start') {
      // Beside the anchor, aligned to its top (a rail's flyout).
      next.left = Math.min(r.right + GAP, vw - w - MARGIN);
      next.top = Math.max(MARGIN, Math.min(r.top, vh - contentH - MARGIN));
      next.maxHeight = vh - next.top - MARGIN;
    } else if (placement === 'right-end') {
      next.left = Math.min(r.right + GAP, vw - w - MARGIN);
      next.bottom = Math.max(MARGIN, vh - r.bottom);
      next.maxHeight = r.bottom - MARGIN;
    } else {
      const left = placement === 'bottom-center' || placement === 'top-center' ? r.left + (r.width - w) / 2 : align === 'start' ? r.left : r.right - w;
      next.left = boundPopoverLeft(left, w, start, hi);
      const above = r.top - GAP - MARGIN;
      const below = vh - r.bottom - GAP - MARGIN;
      const openAbove = openPopoverAbove(placement, above, below, contentH);
      if (openAbove) {
        next.bottom = vh - r.top + GAP;
        next.maxHeight = above;
      } else {
        next.top = r.bottom + GAP;
        next.maxHeight = below;
      }
    }
    setStyle(next);
  }, [anchor, placement, width, align, edge, boundarySelector]);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    const el = ref.current;
    const ro = new ResizeObserver(() => place());
    if (el) ro.observe(el);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const anchorEl = anchor.current;
    anchorEl?.setAttribute('data-popover-open', '');
    const id = ++seq;
    stack.push({ id, el: () => ref.current, anchor: () => anchor.current });
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      const idx = stack.findIndex((s) => s.id === id);
      if (idx < 0) return;
      // Inside this popover, its anchor, or any popover opened after it: keep open.
      for (const s of stack.slice(idx)) {
        if (s.el()?.contains(t) || (s.id === id && s.anchor()?.contains(t))) return;
      }
      onCloseRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (stack[stack.length - 1]?.id !== id) return;
      e.stopPropagation();
      onCloseRef.current();
      anchor.current?.focus();
    };
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      anchorEl?.removeAttribute('data-popover-open');
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey, true);
      const i = stack.findIndex((s) => s.id === id);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [open, anchor]);

  if (!open) return null;
  return createPortal(
    <div ref={ref} role="dialog" aria-label={label} className={`popover ${className ?? ''}`} style={style} data-placement={placement}>
      {children}
    </div>,
    document.body,
  );
}

export function usePopover<T extends HTMLElement = HTMLButtonElement>() {
  const ref = useRef<T>(null);
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((o) => !o), []);
  const close = useCallback(() => setOpen(false), []);
  return { ref, open, setOpen, toggle, close };
}

export function PopoverHeader({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="pop-head">
      <div className="pop-head-text">
        <div className="pop-title">{title}</div>
        {sub ? <div className="pop-sub">{sub}</div> : null}
      </div>
      {right}
    </div>
  );
}

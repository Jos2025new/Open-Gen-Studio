import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

/*
 * Every information-dense surface opens as a popover anchored to the button that
 * opened it: just above it and extending to the right, left edges aligned
 * ("top-start"). Sidebar buttons use "right-end": to the right, bottom-aligned,
 * growing upward. When there is not enough room above, it flips below.
 */

export type Placement = 'top-start' | 'right-end';

const GAP = 8;
const MARGIN = 8;

// Open popovers, oldest first. Lets nested popovers keep their parents open.
const stack: Array<{ id: number; el: () => HTMLElement | null; anchor: () => HTMLElement | null }> = [];
let seq = 0;

interface PopoverProps {
  open: boolean;
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  placement?: Placement;
  width?: number;
  className?: string;
  label?: string;
  children: ReactNode;
}

export function Popover({ open, anchor, onClose, placement = 'top-start', width = 300, className, label, children }: PopoverProps) {
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
    const w = Math.min(width, vw - MARGIN * 2);
    const contentH = el.scrollHeight;
    const next: CSSProperties = { width: w, visibility: 'visible' };
    if (placement === 'right-end') {
      next.left = Math.min(r.right + GAP, vw - w - MARGIN);
      next.bottom = Math.max(MARGIN, vh - r.bottom);
      next.maxHeight = r.bottom - MARGIN;
    } else {
      next.left = Math.max(MARGIN, Math.min(r.left, vw - w - MARGIN));
      const above = r.top - GAP - MARGIN;
      const below = vh - r.bottom - GAP - MARGIN;
      if (above >= Math.min(contentH, 240) || above >= below) {
        next.bottom = vh - r.top + GAP;
        next.maxHeight = above;
      } else {
        next.top = r.bottom + GAP;
        next.maxHeight = below;
      }
    }
    setStyle(next);
  }, [anchor, placement, width]);

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

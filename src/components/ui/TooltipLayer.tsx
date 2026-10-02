import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/*
 * One tooltip for the whole app. Any element with `data-tip` gets a tooltip,
 * placed like popovers: above and aligned to the element's left edge, or to the
 * right for sidebar items (`data-tip-side="right"`).
 */
export function TooltipLayer() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; below: number; side: 'top' | 'right' } | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number>(0);
  const current = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const show = (el: HTMLElement) => {
      const text = el.getAttribute('data-tip');
      if (!text) return;
      const r = el.getBoundingClientRect();
      const side = el.getAttribute('data-tip-side') === 'right' ? 'right' : 'top';
      setTip(side === 'right' ? { text, x: r.right + 10, y: r.top + r.height / 2, below: r.bottom + 6, side } : { text, x: r.left, y: r.top - 6, below: r.bottom + 6, side });
    };
    const onOver = (e: Event) => {
      const el = (e.target as HTMLElement | null)?.closest?.('[data-tip]') as HTMLElement | null;
      if (el === current.current) return;
      current.current = el;
      window.clearTimeout(timer.current);
      setTip(null);
      if (el) timer.current = window.setTimeout(() => show(el), e.type === 'focusin' ? 0 : 380);
    };
    const hide = () => {
      window.clearTimeout(timer.current);
      current.current = null;
      setTip(null);
    };
    document.addEventListener('pointerover', onOver);
    document.addEventListener('focusin', onOver);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('focusin', onOver);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  useLayoutEffect(() => {
    const el = tipRef.current;
    if (!tip || !el) return;
    const { width, height } = el.getBoundingClientRect();
    const top = tip.side === 'right' ? tip.y - height / 2 : tip.y - height >= 8 ? tip.y - height : tip.below;
    el.style.left = `${Math.max(8, Math.min(tip.x, window.innerWidth - width - 8))}px`;
    el.style.top = `${Math.max(8, Math.min(top, window.innerHeight - height - 8))}px`;
    el.style.transform = 'none';
  }, [tip]);

  if (!tip) return null;
  const style =
    tip.side === 'right'
      ? { left: tip.x, top: tip.y, transform: 'translateY(-50%)' }
      : { left: Math.max(8, Math.min(tip.x, window.innerWidth - 260)), top: tip.y, transform: 'translateY(-100%)' };
  return createPortal(
    <div ref={tipRef} className="tooltip" role="tooltip" style={{ ...style, maxWidth: 'min(300px, calc(100vw - 16px))', overflowWrap: 'anywhere' }}>
      {tip.text}
    </div>,
    document.body,
  );
}

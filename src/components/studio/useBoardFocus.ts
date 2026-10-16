import { useEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react';

/**
 * Whether the user's last pointer press or focus was inside `scope` (Studio's board). Shortcuts of an embedded canvas
 * read it, so a key typed in the chat composer never reaches the board. A change re-renders the caller (props such as a delete key read it). Without a scope it is always true (the full workspace).
 */
export function useBoardFocus(scope?: RefObject<HTMLElement | null>): MutableRefObject<boolean> {
  const inside = useRef(!scope);
  const [, render] = useState(false);
  useEffect(() => {
    if (!scope) { inside.current = true; return; }
    const h = (e: Event) => {
      const now = Boolean(scope.current?.contains(e.target as Node));
      if (now !== inside.current) { inside.current = now; render(now); }
    };
    document.addEventListener('pointerdown', h, true);
    document.addEventListener('focusin', h);
    return () => { document.removeEventListener('pointerdown', h, true); document.removeEventListener('focusin', h); };
  }, [scope]);
  return inside;
}

import { useEffect, useRef, useState } from 'react';
import type { TextLayer } from '../../engine/types';
import type { View } from '../../engine/design/viewCoordinates';
import { layoutText } from '../../engine/design/render';
import { fontStack } from '../../engine/design/doc';

/* The in-place text editor over the canvas: a textarea placed and transformed like the text it edits (Stage.tsx). */
export function TextEditor({ layer, view, onDone }: { layer: TextLayer; view: View; onDone: (text: string) => void }) {
  const [text, setText] = useState(layer.text);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    // Focus after the canvas mousedown has moved focus to <body>, or it would blur us at once. Keys typed before
    // that frame (a heavy page can delay it) are kept and written once focused, so the first letters are not lost.
    const early: string[] = [];
    const keep = (e: KeyboardEvent) => {
      if (document.activeElement === ref.current || e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
      early.push(e.key);
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', keep, true);
    const t = requestAnimationFrame(() => {
      window.removeEventListener('keydown', keep, true);
      const el = ref.current;
      if (!el) return;
      el.focus();
      if (!early.length) return el.select();
      // Written into the box at once (not on the next render), so the keys that follow land after them.
      const typed = early.join('');
      el.value = typed;
      el.setSelectionRange(typed.length, typed.length);
      setText(typed);
    });
    return () => { cancelAnimationFrame(t); window.removeEventListener('keydown', keep, true); };
  }, []);
  const lay = layoutText({ ...layer, text });
  const z = view.zoom;
  return (
    <textarea
      ref={ref}
      className="text-editor"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onDone(text)}
      onKeyDown={(e) => {
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
        e.stopPropagation();
      }}
      style={{
        left: view.x + layer.x * z,
        top: view.y + layer.y * z,
        // Rotated or skewed text: the editor takes its transform.
        ...(layer.transform ? {
          transform: `matrix(${layer.transform[0]}, ${layer.transform[1]}, ${layer.transform[2]}, ${layer.transform[3]}, ${layer.transform[4] * z}, ${layer.transform[5] * z})`,
          transformOrigin: `${-layer.x * z}px ${-layer.y * z}px`,
        } : {}),
        width: Math.max(8, lay.width * z) + layer.fontSize * 0.3 * z,
        height: lay.height * z + 2,
        whiteSpace: layer.width > 0 ? 'pre-wrap' : 'pre',
        font: `${layer.fontWeight} ${layer.fontSize * z}px ${fontStack(layer.fontFamily)}`,
        lineHeight: `${layer.lineHeight}`,
        letterSpacing: `${layer.letterSpacing * z}px`,
        color: layer.color,
        textAlign: layer.align,
        paddingTop: ((layer.fontSize * layer.lineHeight - layer.fontSize) / 2) * z,
      }}
      aria-label="Edit text"
    />
  );
}

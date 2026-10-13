import { useRef, useState, useSyncExternalStore } from 'react';
import type { DesignDoc } from '../../engine/types';
import { applyDrawingChoice, cancelDrawingChoice, pendingChoiceIn, pendingChoicePoint, promptAnchor, setDrawingPreference, subscribeDrawingChoice, type DrawingChoice } from '../../engine/design/drawingChoice';
import { toast } from '../../store/store';
import { Popover } from '../ui/Popover';

const PROMPT = { w: 340, h: 170 };

/**
 * The prompt for painting in Drawing on a layer with editable strokes (ADR 0016). It opens beside the press on the canvas,
 * inside the view. Escape or a click outside closes it and paints nothing.
 */
export function DrawingChoicePrompt({ sessionId, doc }: { sessionId: string; doc: DesignDoc }) {
  useSyncExternalStore(subscribeDrawingChoice, pendingChoicePoint);
  const layer = pendingChoiceIn(doc);
  const at = pendingChoicePoint();
  const anchor = useRef<HTMLSpanElement>(null);
  const [remember, setRemember] = useState(false);
  if (!layer || !at) return null;
  const pos = promptAnchor(at, { w: window.innerWidth, h: window.innerHeight }, PROMPT);
  const choose = (choice: DrawingChoice) => {
    const message = applyDrawingChoice(sessionId, doc.id, layer.id, choice);
    if (remember) setDrawingPreference(choice);
    cancelDrawingChoice();
    setRemember(false);
    if (message) toast(remember ? `${message} · saved choice` : message, 'info');
  };
  const close = () => { cancelDrawingChoice(); setRemember(false); };
  const strokes = layer.paintStrokes?.length ?? 0;
  return <>
    <span ref={anchor} aria-hidden style={{ position: 'fixed', left: pos.x, top: pos.y, width: 0, height: 0 }} />
    <Popover open anchor={anchor} onClose={close} placement="bottom-start" width={PROMPT.w} label="Painting on a layer with editable strokes">
      <div className="confirm-pop">
        <p><strong>{layer.name}</strong> has {strokes} editable stroke{strokes === 1 ? '' : 's'}. In Drawing, painting goes straight into the pixels. How do you want to paint?</p>
        <div className="confirm-pop-actions">
          <button type="button" className="opt" onClick={() => choose('flatten')}>Flatten and paint</button>
          <button type="button" className="opt" onClick={() => choose('design')}>Paint in Design</button>
          <button type="button" className="opt" onClick={() => choose('newLayer')}>New layer</button>
        </div>
        <label className="check-row"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />Don&apos;t show again</label>
        <div className="confirm-pop-actions"><button type="button" className="opt" onClick={close}>Close</button></div>
      </div>
    </Popover>
  </>;
}

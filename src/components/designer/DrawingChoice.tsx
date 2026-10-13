import { useRef, useState, useSyncExternalStore } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { DesignDoc } from '../../engine/types';
import { applyDrawingChoice, cancelDrawingChoice, pendingChoiceIn, pendingDrawingChoiceLayer, setDrawingPreference, subscribeDrawingChoice, type DrawingChoice } from '../../engine/design/drawingChoice';
import { toast } from '../../store/store';
import { Popover } from '../ui/Popover';
import { IconButton } from '../ui/primitives';

/** The prompt for painting in Drawing on a layer with editable strokes (ADR 0016). Closing it changes nothing. */
export function DrawingChoiceApproval({ sessionId, doc }: { sessionId: string; doc: DesignDoc }) {
  useSyncExternalStore(subscribeDrawingChoice, pendingDrawingChoiceLayer);
  const layer = pendingChoiceIn(doc);
  const anchor = useRef<HTMLButtonElement>(null);
  const [remember, setRemember] = useState(false);
  if (!layer) return null;
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
    <IconButton ref={anchor} icon={AlertTriangle} label={`Painting on ${layer.name}: choose`} size="sm" active aria-haspopup="dialog" aria-expanded />
    <Popover open anchor={anchor} onClose={close} width={340} label="Painting on a layer with editable strokes">
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

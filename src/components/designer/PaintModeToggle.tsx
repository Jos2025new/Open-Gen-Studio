import type { DesignDoc } from '../../engine/types';
import { paintModeOf, type PaintMode } from '../../engine/design/paintMode';
import { setDoc } from '../../store/store';
import { Segmented } from '../ui/primitives';

/** Drawing / Design for the document (ADR 0016). Changing it never flattens or rewrites a stroke. */
export function PaintModeToggle({ sessionId, doc }: { sessionId: string; doc: DesignDoc }) {
  const mode = paintModeOf(doc);
  const choose = (next: PaintMode) => {
    if (next === mode) return;
    setDoc(sessionId, doc.id, (current) => ({ ...current, paintMode: next, updatedAt: Date.now() }));
  };
  return <span className="opt paint-mode" aria-label="Paint mode"><Segmented size="sm" value={mode} onChange={choose} options={[
    { value: 'drawing', label: 'Drawing', tip: 'Drawing: brush strokes paint the layer pixels directly, as in Krita or Photoshop. No stroke limit.' },
    { value: 'design', label: 'Design', tip: 'Design: strokes stay editable up to the stroke limit; then the layer flattens (undo restores them).' },
  ]} /></span>;
}

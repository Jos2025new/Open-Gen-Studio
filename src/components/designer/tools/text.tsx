import type { Layer, TextLayer } from '../../../engine/types';
import { hitTest } from '../../../engine/design/render';
import { addTextLayer, patchLayer, setActiveLayer } from '../../../engine/design/actions';
import { useStore, setUi } from '../../../store/store';
import type { PointerPress, ToolDescriptor, ToolSettingsProps } from './types';
import { TextStyleFields } from '../ToolSettingsFields';

function beginText({ state, current, p }: PointerPress) {
  const { sessionId, doc, setEditingText, textStyle } = state;
  const hit = hitTest(current, p.x, p.y);
  if (hit?.type === 'text' && !hit.locked) {
    setActiveLayer(sessionId, doc.id, hit.id);
    setEditingText(hit.id);
    return;
  }
  // width 0 = auto width: the box follows the text as it is typed.
  const id = addTextLayer(sessionId, doc.id, 'Text', { x: p.x, y: p.y, width: 0 }, textStyle);
  if (id) setEditingText(id);
}

function TextSettings({ compact }: ToolSettingsProps) {
  const text = useStore((s) => s.ui.text);
  return <>
    {!compact && <p className="opt-hint">For the next text you add. A selected text is changed in Properties.</p>}
    <TextStyleFields value={text} compact={compact} onChange={(p) => setUi({ text: { ...text, ...p } })} />
  </>;
}

/** The contextual fields edit the selected text directly. */
function SelectedTextControls({ sessionId, docId, layer }: { sessionId: string; docId: string; layer: TextLayer }) {
  return <div className="tool-settings" role="group" aria-label="Selected text">
    <TextStyleFields value={layer} compact onChange={(patch) => {
      if (!layer.locked) patchLayer(sessionId, docId, layer.id, patch as Partial<Layer>);
    }} />
  </div>;
}

export const text = {
  down: beginText,
  cursor: () => 'text',
  quick: ['fontSize', 'textColor'],
  settings: TextSettings,
  textContext: SelectedTextControls,
  contextTarget: (layer) => layer?.type === 'text' ? `${layer.name} (selected)` : 'new text',
} satisfies ToolDescriptor;

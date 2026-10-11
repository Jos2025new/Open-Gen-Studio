import { Settings2 } from 'lucide-react';
import { useStore } from '../../store/store';
import type { DesignDoc } from '../../engine/types';
import { activeLayer } from '../../engine/design/doc';
import { isProtectedImage } from '../../engine/design/rules';
import { TOOL_NAMES } from '../../engine/shortcuts';
import { setRuler } from '../../engine/design/strokeRuler';
import { TextStyleFields, ToolSettings } from './ToolSettings';
import { patchLayer } from '../../engine/design/actions';
import type { Layer } from '../../engine/types';
import { InlineToggle } from './InlineControls';

/*
 * The contextual strip above the tool box (docs/plan-designer-ux.md, step 1): the active tool's essential controls,
 * close to the tool, never behind a horizontal scroll (lines wrap), with what they change named first ("Brush → Layer
 * 3", "New text"). The rest of the tool's settings open with "Settings…" in the right panel.
 */

/** What the next gesture of the tool changes, in words. */
export function editTarget(doc: DesignDoc, tool: string): string | null {
  const l = activeLayer(doc);
  if (tool === 'brush') return l?.type === 'raster' && !l.locked && l.visible && !isProtectedImage(l) ? l.name : 'new layer';
  if (tool === 'eraser') return l ? l.name : null;
  // Fill and gradient always lay their result on a new layer (fill.ts, gradient.ts).
  if (tool === 'fill' || tool === 'gradient') return 'new layer';
  if (tool === 'text') return l?.type === 'text' ? `${l.name} (selected)` : 'new text';
  if (tool === 'move' || tool === 'select') return l ? l.name : null;
  return null;
}

export function ContextStrip({ sessionId, doc }: { sessionId: string; doc: DesignDoc }) {
  const tool = useStore((s) => s.ui.tool);
  const ruler = useStore((s) => s.ui.strokeRuler);
  if (tool === 'hand') return null;
  const target = editTarget(doc, tool);
  const active = activeLayer(doc);
  const selectedText = tool === 'text' && active?.type === 'text' ? active : null;
  const pageRuler = ruler && ruler.docId === doc.id ? ruler : null;
  return <div className="context-strip" role="toolbar" aria-label={`${TOOL_NAMES[tool]} quick settings`}>
    <span className="context-target" data-tip="What the next action changes">
      <strong>{TOOL_NAMES[tool]}</strong>{target && <> → <span>{target}</span></>}
    </span>
    {/* With a text layer selected, the fields change that text, not the settings for the next one. */}
    {selectedText ? <div className="tool-settings" role="group" aria-label="Selected text">
      <TextStyleFields value={selectedText} compact onChange={(p) => { if (!selectedText.locked) patchLayer(sessionId, doc.id, selectedText.id, p as Partial<Layer>); }} />
    </div> : <ToolSettings sessionId={sessionId} doc={doc} selectedCurve={null} compact />}
    {(tool === 'brush' || tool === 'eraser') && pageRuler && <InlineToggle label="Follow stroke ruler" tip="Strokes follow the guide placed with the Ruler tool (K)" checked={pageRuler.on} onChange={(on) => setRuler({ ...pageRuler, on })} />}
    <button type="button" className="opt context-more" onClick={() => window.dispatchEvent(new CustomEvent('ogs:designer-panel', { detail: selectedText ? 'props' : 'tool' }))} data-tip={selectedText ? 'All the properties of the selected text, in the right panel' : 'All the settings of this tool, in the right panel'}><Settings2 size={13} />Settings…</button>
  </div>;
}

import { useStore } from '../../store/store';
import { getSelection, setSelection, useSelectionVersion } from '../../engine/design/pixelSelection';
import { getDesignerTool } from './tools/registry';
import type { ToolSettingsProps } from './tools/types';

export { AutoSelectToggle, ContextField, EditModeOptions, EditModeToggle, EditOps, TextStyleFields, SELECT_MODES, WAND_DEFAULT } from './ToolSettingsFields';

/** With another tool active, a pixel selection still shows in the bar (it still clips Delete, copy and the gradient). */
export function SelectionChip({ docId }: { docId: string }) {
  useSelectionVersion();
  const tool = useStore((s) => s.ui.tool);
  const sel = getSelection(docId);
  if (!sel || getDesignerTool(tool).hideSelectionChip) return null;
  return <span className="opt selection-chip" data-tip="Delete, copy, cut and the gradient act inside it">
    <span className="opt-label">{sel.inverted ? 'Selection · inverted' : 'Selection'}</span>
    <button type="button" className="sb-link" onClick={() => setSelection(docId, null)}>Deselect</button>
  </span>;
}

/** How a new selection combines with the one there; the same four in the card and in the quick row. */

export function ToolSettings({ sessionId, doc, selectedCurve, compact = false, modeToggle = true, card = false }: Omit<ToolSettingsProps, 'compact' | 'modeToggle' | 'card'> & Partial<Pick<ToolSettingsProps, 'compact' | 'modeToggle' | 'card'>>) {
  useSelectionVersion();
  const tool = useStore((s) => s.ui.tool);
  const { settings: Settings, bareSettings } = getDesignerTool(tool);
  if (!Settings) return null;
  const controls = <Settings sessionId={sessionId} doc={doc} selectedCurve={selectedCurve} compact={compact} modeToggle={modeToggle} card={card} />;
  if (bareSettings) return controls;
  return <div className="tool-settings" key={tool} role="toolbar" aria-label={`${tool} settings`}>{controls}</div>;
}

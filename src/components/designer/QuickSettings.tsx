import { useState, type ReactNode } from 'react';
import type { DesignDoc } from '../../engine/types';
import type { DesignTool } from '../../engine/design/rules';
import { getDoc } from '../../engine/design/actions';
import { record } from '../../engine/design/history';
import { strokeObjectsAvailable } from '../../engine/design/paintMode';
import { getSelection, growSelection, invertSelection, selectAll, selectionToLayer, setSelection, useSelectionVersion } from '../../engine/design/pixelSelection';
import { setRuler } from '../../engine/design/strokeRuler';
import { setUi, toast, useStore } from '../../store/store';
import { AutoSelectToggle, EditModeToggle, WAND_DEFAULT } from './ToolSettings';
import { BrushSizeField } from './BrushSizeField';
import { InlineColor, InlineSelect, InlineSlider, InlineToggle } from './InlineControls';

/** What each control of the subtoolbox's quick settings edits. All of them exist in the tool's card already. */
export type QuickKind = 'gradientShape' | 'gradientColors' | 'wandMode' | 'wandTolerance' | 'wandExpand' | 'wandSmooth' | 'selectOps' | 'editMode' | 'autoSelect' | 'size' | 'opacity' | 'color' | 'threshold' | 'gradientOpacity' | 'lineartSize' | 'lineartOpacity' | 'lineartColor' | 'strokeWidth' | 'stroke' | 'fill' | 'fontSize' | 'textColor' | 'rulerSnap' | 'rulerClear';
const SHAPES: QuickKind[] = ['strokeWidth', 'stroke', 'fill'], LINES: QuickKind[] = ['strokeWidth', 'stroke'];
/** Per tool: at most 2 long sliders first, then 1–2 small controls. A tool absent here has no quick settings (its card may still exist). */
export const QUICK: Partial<Record<DesignTool, QuickKind[]>> = {
  brush: ['size', 'opacity', 'color'], eraser: ['size', 'opacity'], fill: ['opacity', 'threshold', 'color'], gradient: ['gradientShape', 'gradientOpacity', 'gradientColors'], eyedropper: ['color'],
  lineart: ['lineartSize', 'lineartOpacity', 'lineartColor'], rect: SHAPES, ellipse: SHAPES, sector: SHAPES, arc: SHAPES, chord: SHAPES, polygon: SHAPES, star: SHAPES,
  line: LINES, arrow: LINES, curve: LINES, text: ['fontSize', 'textColor'], ruler: ['rulerSnap', 'rulerClear'],
  select: ['wandMode', 'wandTolerance', 'wandExpand', 'wandSmooth', 'selectOps'], move: ['editMode', 'autoSelect'],
};
const WAND_ONLY = new Set<QuickKind>(['wandMode', 'wandTolerance', 'wandExpand', 'wandSmooth']);
const LONG = new Set<QuickKind>(['wandTolerance', 'wandExpand', 'wandSmooth', 'size', 'opacity', 'threshold', 'gradientOpacity', 'lineartSize', 'lineartOpacity', 'strokeWidth', 'fontSize']);
/** Estimated width (px) of a tool's quick settings, and of the row with `subtools` buttons: decides inline or collapsed («). */
const WIDE: Partial<Record<QuickKind, number>> = { gradientShape: 120, gradientColors: 150, selectOps: 230, editMode: 130, autoSelect: 110 };
export const quickWidth = (tool: DesignTool | undefined) => (tool ? QUICK[tool] ?? [] : []).reduce((w, k) => w + (WIDE[k] ?? (LONG.has(k) ? 150 : 44)), 0);
const GRADIENT_DEFAULT = { shape: 'linear' as const, mode: 'fade' as const, color2: '#000000', opacity: 1 };

/** What finishes or changes a pixel selection, the same actions as its card. */
function SelectQuick({ sessionId, doc }: { sessionId: string; doc: DesignDoc }) {
  useSelectionVersion();
  const sel = getSelection(doc.id);
  const cur = () => getDoc(sessionId, doc.id)!;
  const [grow, setGrow] = useState(2);
  const toLayer = () => { const err = selectionToLayer(sessionId, cur()); if (err) toast(err, 'error'); };
  return <>
    <InlineSlider label="Amount" unit="px" tip="How far Grow and Shrink move the selection's edge" min={1} max={50} value={grow} onChange={setGrow} />
    <button type="button" className="opt" disabled={!sel} onClick={() => { record(cur()); growSelection(cur(), -grow); }} data-tip={`Shrinks the selection ${grow} px on every side`}>Shrink</button>
    <button type="button" className="opt" disabled={!sel} onClick={() => { record(cur()); growSelection(cur(), grow); }} data-tip={`Grows the selection ${grow} px on every side`}>Grow</button>
    <button type="button" className="opt" onClick={() => { record(cur()); selectAll(cur()); }} data-tip="Ctrl+A">All</button>
    <button type="button" className="opt" onClick={() => { record(cur()); invertSelection(cur()); }} data-tip="Ctrl+Shift+I">{sel?.inverted ? 'Inverted' : 'Invert'}</button>
    <button type="button" className="opt" disabled={!sel} onClick={() => { record(cur()); setSelection(doc.id, null); }} data-tip="Ctrl+D">Deselect</button>
    <button type="button" className="opt" disabled={!sel} onClick={toLayer} data-tip="Ctrl+J · copies the selected pixels of the active layer to a new layer">To layer</button>
  </>;
}
export const ROW_BUDGET = 560;
export const rowFits = (tool: DesignTool | undefined, subtools: number) => subtools * 36 + quickWidth(tool) + 90 <= ROW_BUDGET;

function Control({ kind, sessionId, doc }: { kind: QuickKind; sessionId: string; doc: DesignDoc }) {
  const docId = doc.id;
  const wand = useStore((s) => s.ui.wand) ?? WAND_DEFAULT;
  const brush = useStore((s) => s.ui.brush), gradient = useStore((s) => s.ui.gradient) ?? GRADIENT_DEFAULT, lineart = useStore((s) => s.ui.lineart), shape = useStore((s) => s.ui.shape), text = useStore((s) => s.ui.text);
  const ruler = useStore((s) => s.ui.strokeRuler);
  const setBrush = (patch: object) => setUi({ brush: { ...useStore.getState().ui.brush, ...patch } });
  const setShape = (patch: object) => setUi({ shape: { ...useStore.getState().ui.shape, ...patch } });
  const setLine = (patch: object) => setUi({ lineart: { ...useStore.getState().ui.lineart, ...patch } });
  const r = ruler && ruler.docId === docId ? ruler : null;
  switch (kind) {
    case 'wandMode': return <InlineSelect label="Mode" value={wand.mode} options={[{ value: 'replace' as const, label: 'New' }, { value: 'add' as const, label: 'Add' }, { value: 'subtract' as const, label: 'Subtract' }]} onChange={(v) => setUi({ wand: { ...wand, mode: v } })} />;
    case 'wandTolerance': return <InlineSlider label="Tolerance" tip="How different a color can be and still be picked" min={0} max={255} value={wand.threshold} onChange={(v) => setUi({ wand: { ...wand, threshold: v } })} />;
    case 'wandExpand': return <InlineSlider label="Expand" unit="px" tip="Widens each new pick by this much" min={0} max={12} value={wand.expand} onChange={(v) => setUi({ wand: { ...wand, expand: v } })} />;
    case 'wandSmooth': return <InlineSlider label="Smooth" unit="px" tip="Softens the jagged edge of each new pick" min={0} max={4} step={0.5} value={wand.smooth} onChange={(v) => setUi({ wand: { ...wand, smooth: v } })} />;
    case 'selectOps': return <SelectQuick sessionId={sessionId} doc={doc} />;
    case 'editMode': return <EditModeToggle objects={strokeObjectsAvailable(doc)} />;
    case 'autoSelect': return <AutoSelectToggle />;
    case 'size': return <BrushSizeField />;
    case 'opacity': return <InlineSlider label="Opacity" unit="%" scale={100} min={0.01} max={1} step={0.01} value={brush.opacity} onChange={(v) => setBrush({ opacity: v })} />;
    case 'threshold': return <InlineSlider label="Threshold" min={0} max={255} value={brush.fillThreshold ?? 24} onChange={(v) => setBrush({ fillThreshold: v })} />;
    case 'color': return <InlineColor label="Color" value={brush.color} iconOnly onChange={(v) => setBrush({ color: v })} />;
    case 'gradientOpacity': return <InlineSlider label="Opacity" unit="%" scale={100} min={0.01} max={1} step={0.01} value={gradient.opacity} onChange={(v) => setUi({ gradient: { ...gradient, opacity: v } })} />;
    case 'gradientShape': return <InlineSelect label="Shape" value={gradient.shape} options={[{ value: 'linear' as const, label: 'Linear' }, { value: 'radial' as const, label: 'Radial' }]} onChange={(v) => setUi({ gradient: { ...gradient, shape: v } })} />;
    case 'gradientColors': return <span className="quick-color-pair">
      <InlineColor label="Color" value={brush.color} iconOnly onChange={(v) => setBrush({ color: v })} />
      <InlineToggle label="Second" tip="Off: from the color to transparent" checked={gradient.mode === 'two'} onChange={(on) => setUi({ gradient: { ...gradient, mode: on ? 'two' : 'fade' } })} />
      {gradient.mode === 'two' ? <InlineColor label="Second" value={gradient.color2} iconOnly onChange={(v) => setUi({ gradient: { ...gradient, color2: v } })} /> : null}
    </span>;
    case 'lineartSize': return <InlineSlider label="Size" unit="px" min={1} max={120} value={lineart.size} onChange={(v) => setLine({ size: v })} />;
    case 'lineartOpacity': return <InlineSlider label="Opacity" unit="%" scale={100} min={0.05} max={1} step={0.01} value={lineart.opacity} onChange={(v) => setLine({ opacity: v })} />;
    case 'lineartColor': return <InlineColor label="Color" value={lineart.color} iconOnly onChange={(v) => setLine({ color: v })} />;
    case 'strokeWidth': return <InlineSlider label="Width" unit="px" min={1} max={40} value={shape.strokeWidth} onChange={(v) => setShape({ strokeWidth: v })} />;
    case 'stroke': return <InlineColor label="Stroke" value={shape.stroke ?? '#ffffff'} iconOnly onChange={(v) => setShape({ stroke: v })} />;
    case 'fill': return <InlineColor label="Fill" value={shape.fill ?? '#d4f25a'} iconOnly onChange={(v) => setShape({ fill: v })} />;
    case 'fontSize': return <InlineSlider label="Size" unit="px" min={1} max={500} value={text.fontSize} onChange={(v) => setUi({ text: { ...useStore.getState().ui.text, fontSize: v } })} />;
    case 'textColor': return <InlineColor label="Color" value={text.color} iconOnly onChange={(v) => setUi({ text: { ...useStore.getState().ui.text, color: v } })} />;
    case 'rulerSnap': return <InlineToggle label="Snap" tip="Brush strokes follow the ruler guide" checked={!!r?.on} onChange={(on) => r && setRuler({ ...r, on })} />;
    case 'rulerClear': return <button type="button" className="opt" disabled={!r} onClick={() => setRuler(null)} data-tip="Removes the guide from the page">Clear</button>;
  }
}

/** The quick settings of `tool`: long sliders share the row, small controls follow. */
export function QuickControls({ tool, sessionId, doc }: { tool: DesignTool; sessionId: string; doc: DesignDoc }): ReactNode {
  const wandShape = useStore((s) => s.ui.selectShape) === 'wand';
  const kinds = QUICK[tool]?.filter((k) => !WAND_ONLY.has(k) || wandShape);
  if (!kinds) return null;
  const long = kinds.filter((k) => LONG.has(k));
  return <>
    {long.length ? <div className="tool-dock-quick-sliders">{long.map((k) => <Control key={k} kind={k} sessionId={sessionId} doc={doc} />)}</div> : null}
    {kinds.filter((k) => !LONG.has(k)).map((k) => <Control key={k} kind={k} sessionId={sessionId} doc={doc} />)}
  </>;
}

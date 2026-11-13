import type { ReactNode } from 'react';
import type { DesignDoc } from '../../engine/types';
import type { DesignTool } from '../../engine/design/rules';
import { getDoc } from '../../engine/design/actions';
import { GRADIENT_DEFAULT } from '../../engine/design/gradient';
import { record } from '../../engine/design/history';
import { getSelection, invertSelection, selectAll, useSelectionVersion } from '../../engine/design/pixelSelection';
import { setRuler } from '../../engine/design/strokeRuler';
import { setUi, useStore } from '../../store/store';
import { SelectionQuick } from './SelectionActions';
import { AutoSelectToggle, EditModeToggle, SELECT_MODES, WAND_DEFAULT } from './ToolSettings';
import { Layers } from '../ui/icons';
import { FlowMenu, BlendMenu, LockAlphaButton } from './BrushQuick';
import { ColorPair } from './ColorPair';
import { FillGapField, FillSourceField } from './FillSettings';
import { SampleRadiusField, SampleSourceField } from './SamplerSettings';
import { BrushSizeField } from './BrushSizeField';
import { InlineColor, InlineSelect, InlineSlider, InlineToggle } from './InlineControls';

/** What each control of the subtoolbox's quick settings edits. All of them exist in the tool's card already. */
export type QuickKind = 'gradientShape' | 'gradientColors' | 'selectMode' | 'wandTolerance' | 'wandExpand' | 'selectOps' | 'selectActions' | 'gradientReverse' | 'editMode' | 'autoSelect' | 'size' | 'opacity' | 'color' | 'threshold' | 'gradientOpacity' | 'lineartSize' | 'lineartOpacity' | 'lineartColor' | 'strokeWidth' | 'stroke' | 'fill' | 'fontSize' | 'textColor' | 'rulerSnap' | 'rulerClear' | 'flow' | 'blend' | 'lockAlpha' | 'colorPair' | 'fillGap' | 'fillSource' | 'sampleRadius' | 'sampleSource';
const SHAPES: QuickKind[] = ['strokeWidth', 'stroke', 'fill'], LINES: QuickKind[] = ['strokeWidth', 'stroke'];
/** Per tool: at most 2 long sliders first, then 1–2 small controls. A tool absent here has no quick settings (its card may still exist). */
export const QUICK: Partial<Record<DesignTool, QuickKind[]>> = {
  brush: ['size', 'opacity', 'flow', 'colorPair'], eraser: ['size', 'opacity'], fill: ['threshold', 'fillGap', 'fillSource', 'colorPair'], gradient: ['gradientShape', 'gradientOpacity', 'gradientColors', 'gradientReverse'], eyedropper: ['sampleRadius', 'sampleSource', 'colorPair'],
  lineart: ['lineartSize', 'lineartOpacity', 'lineartColor'], rect: SHAPES, ellipse: SHAPES, sector: SHAPES, arc: SHAPES, chord: SHAPES, polygon: SHAPES, star: SHAPES,
  line: LINES, arrow: LINES, curve: LINES, text: ['fontSize', 'textColor'], ruler: ['rulerSnap', 'rulerClear'],
  select: ['selectMode', 'wandTolerance', 'wandExpand', 'selectOps', 'selectActions'], move: ['editMode', 'autoSelect'],
};
const WAND_ONLY = new Set<QuickKind>(['wandTolerance', 'wandExpand']);
/** Controls that come before the long sliders. */
const LEADING = new Set<QuickKind>(['selectMode', 'gradientShape']);
const LONG = new Set<QuickKind>(['wandTolerance', 'wandExpand', 'size', 'opacity', 'threshold', 'gradientOpacity', 'lineartSize', 'lineartOpacity', 'strokeWidth', 'fontSize', 'fillGap', 'sampleRadius']);
/** Rectangle and lasso start from everything or its opposite; the wand starts from its click. */
function SelectQuick({ sessionId, doc }: { sessionId: string; doc: DesignDoc }) {
  useSelectionVersion();
  const cur = () => getDoc(sessionId, doc.id)!;
  return <>
    <button type="button" className="opt" onClick={() => { record(cur()); selectAll(cur()); }} data-tip="Selects the whole page · Ctrl+A">All</button>
    <button type="button" className="opt" onClick={() => { record(cur()); invertSelection(cur()); }} data-tip="Selects everything else · Ctrl+Shift+I">{getSelection(doc.id)?.inverted ? 'Inverted' : 'Invert'}</button>
  </>;
}

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
    case 'selectMode': return <InlineSelect label="Mode" value={wand.mode} options={SELECT_MODES} onChange={(v) => setUi({ wand: { ...wand, mode: v } })} />;
    case 'wandTolerance': return <InlineSlider label="Tolerance" tip="How different a color can be and still be picked" min={0} max={255} value={wand.threshold} onChange={(v) => setUi({ wand: { ...wand, threshold: v } })} />;
    case 'wandExpand': return <InlineSlider label="Grow / shrink" unit="px" tip="Widens each pick, or narrows it when negative" min={-50} max={50} value={wand.expand} onChange={(v) => setUi({ wand: { ...wand, expand: v } })} />;
    case 'selectOps': return <SelectQuick sessionId={sessionId} doc={doc} />;
    case 'selectActions': return <SelectionQuick sessionId={sessionId} doc={doc} />;
    case 'gradientReverse': return <InlineToggle label="Reverse" checked={!!gradient.reverse} onChange={(v) => setUi({ gradient: { ...gradient, reverse: v } })} />;
    case 'editMode': return <EditModeToggle />;
    case 'autoSelect': return <AutoSelectToggle />;
    case 'size': return <BrushSizeField />;
    case 'opacity': return <InlineSlider label="Opacity" unit="%" scale={100} min={0.01} max={1} step={0.01} value={brush.opacity} onChange={(v) => setBrush({ opacity: v })} />;
    case 'threshold': return <InlineSlider label="Threshold" min={0} max={255} value={brush.fillThreshold ?? 24} onChange={(v) => setBrush({ fillThreshold: v })} />;
    case 'color': return <InlineColor label="Color" value={brush.color} iconOnly onChange={(v) => setBrush({ color: v })} />;
    case 'gradientOpacity': return <InlineSlider label="Opacity" unit="%" scale={100} min={0.01} max={1} step={0.01} value={gradient.opacity} onChange={(v) => setUi({ gradient: { ...gradient, opacity: v } })} />;
    case 'gradientShape': return <InlineSelect label="Shape" value={gradient.shape} options={[{ value: 'linear' as const, label: 'Linear' }, { value: 'radial' as const, label: 'Radial' }]} onChange={(v) => setUi({ gradient: { ...gradient, shape: v } })} />;
    case 'gradientColors': return <>
      <ColorPair compact dimSecondary={gradient.mode !== 'two'} />
      <InlineToggle label="Second" tip="Off: from the color to transparent" checked={gradient.mode === 'two'} onChange={(on) => setUi({ gradient: { ...gradient, mode: on ? 'two' : 'fade' } })} />
    </>;
    case 'flow': return <FlowMenu />;
    case 'blend': return <BlendMenu />;
    case 'lockAlpha': return <LockAlphaButton />;
    case 'colorPair': return <ColorPair compact />;
    case 'fillGap': return <FillGapField />;
    case 'fillSource': return <FillSourceField icon={<Layers size={15} />} />;
    case 'sampleRadius': return <SampleRadiusField />;
    case 'sampleSource': return <SampleSourceField />;
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
  const kinds = QUICK[tool]?.filter((k) => (k === 'selectOps' ? !wandShape : !WAND_ONLY.has(k) || wandShape));
  if (!kinds) return null;
  const long = kinds.filter((k) => LONG.has(k));
  return <>
    {kinds.filter((k) => LEADING.has(k)).map((k) => <Control key={k} kind={k} sessionId={sessionId} doc={doc} />)}
    {long.length ? <div className="tool-dock-quick-sliders">{long.map((k) => <Control key={k} kind={k} sessionId={sessionId} doc={doc} />)}</div> : null}
    {kinds.filter((k) => !LONG.has(k) && !LEADING.has(k)).map((k) => <Control key={k} kind={k} sessionId={sessionId} doc={doc} />)}
  </>;
}

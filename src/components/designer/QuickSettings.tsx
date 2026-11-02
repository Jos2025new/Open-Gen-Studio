import type { ReactNode } from 'react';
import type { DesignTool } from '../../engine/design/rules';
import { setRuler } from '../../engine/design/strokeRuler';
import { setUi, useStore } from '../../store/store';
import { InlineColor, InlineSlider, InlineToggle } from './InlineControls';

/** What each control of the subtoolbox's quick settings edits. All of them exist in the tool's card already. */
export type QuickKind = 'size' | 'opacity' | 'color' | 'threshold' | 'gradientOpacity' | 'color2' | 'lineartSize' | 'lineartOpacity' | 'lineartColor' | 'strokeWidth' | 'stroke' | 'fill' | 'fontSize' | 'textColor' | 'rulerSnap' | 'rulerClear';
const SHAPES: QuickKind[] = ['strokeWidth', 'stroke', 'fill'], LINES: QuickKind[] = ['strokeWidth', 'stroke'];
/** Per tool: at most 2 long sliders first, then 1–2 small controls. A tool absent here has no quick settings (its card may still exist). */
export const QUICK: Partial<Record<DesignTool, QuickKind[]>> = {
  brush: ['size', 'opacity', 'color'], eraser: ['size', 'opacity'], fill: ['opacity', 'threshold', 'color'], gradient: ['gradientOpacity', 'color', 'color2'], eyedropper: ['color'],
  lineart: ['lineartSize', 'lineartOpacity', 'lineartColor'], rect: SHAPES, ellipse: SHAPES, sector: SHAPES, arc: SHAPES, chord: SHAPES, polygon: SHAPES, star: SHAPES,
  line: LINES, arrow: LINES, curve: LINES, text: ['fontSize', 'textColor'], ruler: ['rulerSnap', 'rulerClear'],
};
const LONG = new Set<QuickKind>(['size', 'opacity', 'threshold', 'gradientOpacity', 'lineartSize', 'lineartOpacity', 'strokeWidth', 'fontSize']);
/** Estimated width (px) of a tool's quick settings, and of the row with `subtools` buttons: decides inline or collapsed («). */
export const quickWidth = (tool: DesignTool | undefined) => (tool ? QUICK[tool] ?? [] : []).reduce((w, k) => w + (LONG.has(k) ? 150 : 44), 0);
export const ROW_BUDGET = 560;
export const rowFits = (tool: DesignTool | undefined, subtools: number) => subtools * 36 + quickWidth(tool) + 90 <= ROW_BUDGET;

function Control({ kind, docId }: { kind: QuickKind; docId: string }) {
  const brush = useStore((s) => s.ui.brush), gradient = useStore((s) => s.ui.gradient), lineart = useStore((s) => s.ui.lineart), shape = useStore((s) => s.ui.shape), text = useStore((s) => s.ui.text);
  const ruler = useStore((s) => s.ui.strokeRuler);
  const setBrush = (patch: object) => setUi({ brush: { ...useStore.getState().ui.brush, ...patch } });
  const setShape = (patch: object) => setUi({ shape: { ...useStore.getState().ui.shape, ...patch } });
  const setLine = (patch: object) => setUi({ lineart: { ...useStore.getState().ui.lineart, ...patch } });
  const r = ruler && ruler.docId === docId ? ruler : null;
  switch (kind) {
    case 'size': return <InlineSlider label="Size" unit="px" min={1} max={240} value={brush.size} onChange={(v) => setBrush({ size: v })} />;
    case 'opacity': return <InlineSlider label="Opacity" unit="%" scale={100} min={0.01} max={1} step={0.01} value={brush.opacity} onChange={(v) => setBrush({ opacity: v })} />;
    case 'threshold': return <InlineSlider label="Threshold" min={0} max={255} value={brush.fillThreshold ?? 24} onChange={(v) => setBrush({ fillThreshold: v })} />;
    case 'color': return <InlineColor label="Color" value={brush.color} iconOnly onChange={(v) => setBrush({ color: v })} />;
    case 'gradientOpacity': return gradient ? <InlineSlider label="Opacity" unit="%" scale={100} min={0.01} max={1} step={0.01} value={gradient.opacity} onChange={(v) => setUi({ gradient: { ...gradient, opacity: v } })} /> : null;
    case 'color2': return gradient ? <InlineColor label="Second" value={gradient.color2} iconOnly onChange={(v) => setUi({ gradient: { ...gradient, color2: v } })} /> : null;
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
export function QuickControls({ tool, docId }: { tool: DesignTool; docId: string }): ReactNode {
  const kinds = QUICK[tool];
  if (!kinds) return null;
  return <>
    <div className="tool-dock-quick-sliders">{kinds.filter((k) => LONG.has(k)).map((k) => <Control key={k} kind={k} docId={docId} />)}</div>
    {kinds.filter((k) => !LONG.has(k)).map((k) => <Control key={k} kind={k} docId={docId} />)}
  </>;
}

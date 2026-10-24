import { setUi, useStore } from '../../store/store';
import { ellipseTypeOfTool, ELLIPSE_TYPES, toolForEllipseType, type EllipseType } from '../../engine/design/shapeKinds';
import { InlineChoice, InlineSelect, InlineSlider, InlineToggle } from './InlineControls';

/* Settings of the merged shape tools, for the next shape (the selected shape's own fields are PrimFields). */

type Params = { inner?: number; round?: number; a0?: number; a1?: number };

function useShapeUi() {
  const shape = useStore((s) => s.ui.shape);
  const set = (p: Partial<typeof shape>) => setUi({ shape: { ...shape, ...p } });
  const setParams = (p: Params) => set({ primParams: { ...shape.primParams, ...p } });
  return { shape, set, setParams };
}

/** Ellipse tool: type (Whole, Slice, Arc, Chord), Start, End and «Make whole» (Inkscape's arc toolbar). */
export function EllipseToolFields({ tool }: { tool: string }) {
  const { shape, setParams } = useShapeUi();
  const type = ellipseTypeOfTool(tool as never) ?? 'whole';
  return <>
    <InlineSelect<EllipseType> label="Type" value={type} options={ELLIPSE_TYPES} onChange={(t) => setUi({ tool: toolForEllipseType(t) })} />
    {type !== 'whole' && <>
      <InlineSlider label="Start" unit="°" min={0} max={360} value={shape.primParams?.a0 ?? 0} onChange={(v) => setParams({ a0: v })} />
      <InlineSlider label="End" unit="°" min={0} max={360} value={shape.primParams?.a1 ?? 270} onChange={(v) => setParams({ a1: v })} />
      <button type="button" className="opt" data-tip="Back to a whole ellipse (Inkscape's Make whole)" onClick={() => setUi({ tool: 'ellipse' })}>Make whole</button>
    </>}
  </>;
}

/** Polygon/Star tool: the switch, Corners (3–24), Spoke ratio (star) and Rounded (Inkscape's star toolbar). */
export function CornerToolFields({ tool }: { tool: string }) {
  const { shape, set, setParams } = useShapeUi();
  return <>
    <InlineChoice label="Shape" value={tool === 'star' ? 'star' : 'polygon'} options={[{ value: 'polygon' as const, label: 'Polygon' }, { value: 'star' as const, label: 'Star' }]} onChange={(t) => setUi({ tool: t })} />
    <InlineSlider label="Corners" min={3} max={24} value={shape.sides ?? 5} onChange={(v) => set({ sides: v })} />
    {tool === 'star' && <InlineSlider label="Spoke ratio" unit="%" min={10} max={100} value={Math.round((shape.primParams?.inner ?? 0.5) * 100)} onChange={(v) => setParams({ inner: v / 100 })} />}
    <InlineSlider label="Rounded" unit="%" min={0} max={100} value={Math.round((shape.primParams?.round ?? 0) * 100)} onChange={(v) => setParams({ round: v / 100 })} />
  </>;
}

/** Line tool: the Arrow end option replaces the separate Arrow tool (same arrowPath geometry). */
export function LineToolFields({ tool }: { tool: string }) {
  return <InlineToggle label="Arrow" tip="Draw an arrowhead at the end of the line" checked={tool === 'arrow'} onChange={(on) => setUi({ tool: on ? 'arrow' : 'line' })} />;
}

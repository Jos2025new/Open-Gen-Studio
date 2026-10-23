import { useEffect, useReducer, useRef, useState, type CSSProperties, type KeyboardEvent, type Ref } from 'react';
import { AirVent, Blend, Brush, ChartPie, ChevronDown, ChevronUp, Circle, CircleHelp, Crop, DraftingCompass, Eraser, Eye, GripHorizontal, Grid3X3, Hand, LayoutPanelTop, LayoutTemplate, Lasso, Minus, MousePointer2, MoveUpRight, PaintBucket, PanelRight, PenTool, Pentagon, Pencil, Pipette, Ruler, Scissors, Settings2, Shapes, Square, SquareDashed, Star, Spline, Type, WandSparkles, type LucideIcon } from 'lucide-react';
import type { DesignDoc } from '../../engine/types';
import { paintModeOf } from '../../engine/design/paintMode';
import type { DesignTool } from '../../engine/design/rules';
import { toolBlockReason } from '../../engine/design/rules';
import { activeLayer } from '../../engine/design/doc';
import { setUi, useStore } from '../../store/store';
import { IconButton } from '../ui/primitives';
import { ToolSettings } from './ToolSettings';
import { PaintModeToggle } from './PaintModeToggle';
import { CanvasSize } from './CanvasSize';
import { TIP_PRESETS } from '../../engine/design/brushEngine';
import { initialToolboxState, reduceToolboxState, TOOLBOXES, type ToolboxFamily, type ToolboxVariant } from './toolboxModel';
import '../../styles/tool-dock.css';

const ICONS: Record<string, LucideIcon> = {
  airbrush: AirVent, blend: Blend, brush: Brush, 'chart-pie': ChartPie, circle: Circle, crop: Crop,
  'drafting-compass': DraftingCompass, eraser: Eraser, eye: Eye, 'grid-3x3': Grid3X3, hand: Hand,
  'layout-panel-top': LayoutPanelTop, 'layout-template': LayoutTemplate, lasso: Lasso, minus: Minus,
  'mouse-pointer-2': MousePointer2, 'move-up-right': MoveUpRight, 'paint-bucket': PaintBucket, 'pen-tool': PenTool,
  pencil: Pencil, pentagon: Pentagon, pipette: Pipette, scissors: Scissors, 'settings-2': Settings2, shapes: Shapes, square: Square,
  'square-dashed': SquareDashed, star: Star, spline: Spline, type: Type, 'wand-sparkles': WandSparkles,
  'ruler-dimension-line': Ruler,
};
const iconFor = (name: string): LucideIcon => ICONS[name] ?? CircleHelp;

function iconButton(name: string, label: string, active: boolean, onClick: () => void, disabled = false, ref?: Ref<HTMLButtonElement>) {
  const Icon = iconFor(name);
  return <button ref={ref} type="button" className={`icon-btn icon-btn-md tone-default ${active ? 'is-active' : ''}`} aria-label={label} aria-pressed={active} aria-disabled={label.includes('Soon:') || undefined} title={label.includes('Soon:') ? label : undefined} disabled={disabled} data-tip={label} onClick={onClick}><Icon size={16} strokeWidth={1.75} /></button>;
}

function toolFor(family: ToolboxFamily, current: DesignTool, shape: string, rulerKind: string, hardness: number): ToolboxVariant | undefined {
  const matches = family.variants.filter((variant) => variant.tool === current);
  return matches.find((variant) => variant.selectShape ? variant.selectShape === shape : variant.rulerKind ? variant.rulerKind === rulerKind : variant.preset === 'pencil' ? hardness === TIP_PRESETS[0] : variant.preset === 'airbrush' ? hardness === TIP_PRESETS[3] : !variant.preset) ?? matches[0];
}

function familyFor(families: ToolboxFamily[], tool: DesignTool, shape: string, rulerKind: string, hardness: number) {
  return families.find((family) => toolFor(family, tool, shape, rulerKind, hardness));
}

export function ToolDock({ sessionId, doc, selectedCurve = null }: { sessionId: string; doc: DesignDoc; selectedCurve?: { layerId: string; strokeId: string } | null }) {
  const currentTool = useStore((state) => state.ui.tool);
  const currentShape = useStore((state) => state.ui.selectShape ?? 'rect');
  const rulerKind = useStore((state) => state.ui.strokeRulerKind ?? 'line');
  const brushHardness = useStore((state) => state.ui.brush.hardness ?? TIP_PRESETS[0]);
  const mode = paintModeOf(doc);
  const families = TOOLBOXES[mode];
  const visitorFamilies = TOOLBOXES[mode === 'drawing' ? 'design' : 'drawing'];
  const currentFamily = familyFor(families, currentTool, currentShape, rulerKind, brushHardness);
  const visitor = !currentFamily ? familyFor(visitorFamilies, currentTool, currentShape, rulerKind, brushHardness) : undefined;
  const shownFamilies = visitor ? [...families, { ...visitor, id: `visitor-${visitor.id}`, label: `${visitor.label} · other mode` }] : families;
  const [dockState, dispatch] = useReducer(reduceToolboxState, initialToolboxState);
  const { depth, familyId } = dockState;
  const familyButtons = useRef(new Map<string, HTMLButtonElement>());
  const [height, setHeight] = useState(320);
  const selectedFamily = shownFamilies.find((family) => family.id === familyId) ?? (visitor ? shownFamilies.at(-1) : currentFamily);
  const selectedVariant = selectedFamily ? selectedFamily.variants.find((variant) => variant.id === dockState.variantId) ?? toolFor(selectedFamily, currentTool, currentShape, rulerKind, brushHardness) ?? selectedFamily.variants[0] : undefined;
  const activeLayerValue = activeLayer(doc);
  const disabledReason = (variant: ToolboxVariant) => variant.tool ? toolBlockReason(variant.tool, activeLayerValue) : undefined;

  useEffect(() => {
    const desiredId = visitor ? `visitor-${visitor.id}` : currentFamily?.id;
    if (desiredId && desiredId !== familyId) dispatch({ type: 'family', familyId: desiredId });
  }, [currentTool, mode, doc.id]);

  const chooseVariant = (variant: ToolboxVariant) => {
    if (variant.soon) return;
    if (!variant.tool) {
      if (variant.action) dispatch({ type: 'variant', familyId: selectedFamily?.id ?? '', variantId: variant.id });
      return;
    }
    if (variant.selectShape) setUi({ selectShape: variant.selectShape });
    if (variant.rulerKind) {
      const ruler = useStore.getState().ui.strokeRuler;
      setUi({ strokeRulerKind: variant.rulerKind, ...(ruler ? { strokeRuler: { ...ruler, kind: variant.rulerKind } } : {}) });
    }
    setUi({ tool: variant.tool });
    if (variant.preset === 'pencil') setUi({ brush: { ...useStore.getState().ui.brush, hardness: TIP_PRESETS[0] } });
    if (variant.preset === 'airbrush') setUi({ brush: { ...useStore.getState().ui.brush, hardness: TIP_PRESETS[3] } });
    dispatch({ type: 'variant', familyId: selectedFamily?.id ?? '', variantId: variant.id });
  };

  const moveToolbarFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    buttons[(index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    event.preventDefault();
  };

  const setHeightFrom = (next: number) => setHeight(Math.max(140, Math.min(window.innerHeight * 0.6, next)));
  const onGripKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    setHeightFrom(height + (event.key === 'ArrowUp' ? 16 : -16));
  };

  return <div className="tool-dock" style={{ '--tool-dock-card-height': `${height}px` } as CSSProperties} onKeyDown={(event) => {
    if (event.key !== 'Escape') return;
    if (depth === 'closed') return;
    dispatch({ type: 'escape' });
    event.preventDefault(); event.stopPropagation();
    if (familyId) familyButtons.current.get(familyId)?.focus();
  }}>
    <div className="tool-dock-stack">
      {depth !== 'closed' && selectedFamily && <div className="tool-dock-variants" role="toolbar" aria-label={`${selectedFamily.label} variants`} onKeyDown={moveToolbarFocus}>
        {selectedFamily.variants.map((variant) => {
          const active = (dockState.familyId === selectedFamily.id && dockState.variantId === variant.id) || (variant.tool === currentTool && (!variant.selectShape || variant.selectShape === currentShape) && (!variant.rulerKind || variant.rulerKind === rulerKind));
          return <span key={variant.id}>{iconButton(variant.icon, `${variant.label}${variant.soon ? ` · Soon: ${variant.soon}` : ''}`, active, () => chooseVariant(variant), !variant.soon && !!disabledReason(variant))}</span>;
        })}
        <span className="tool-dock-grow" />
        <button type="button" className="icon-btn icon-btn-md tone-default" aria-label={depth === 'open' ? 'Hide tool settings' : 'Show tool settings'} aria-expanded={depth === 'open'} onClick={() => dispatch({ type: 'settings', familyId: selectedFamily.id })}>
          {depth === 'open' ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
      </div>}
      {depth === 'open' && selectedVariant && <section className="tool-dock-card" aria-label={`${selectedVariant.label} settings`}>
        <button type="button" className="tool-dock-grip" role="separator" aria-orientation="horizontal" aria-label="Resize tool settings" tabIndex={0} onKeyDown={onGripKey} onPointerDown={(event) => {
          const startY = event.clientY; const startHeight = height; const el = event.currentTarget;
          el.setPointerCapture(event.pointerId);
          const move = (next: PointerEvent) => setHeightFrom(startHeight + startY - next.clientY);
          const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
          el.addEventListener('pointermove', move); el.addEventListener('pointerup', up, { once: true });
        }}><GripHorizontal size={14} /></button>
        <div className="tool-dock-settings-grid">
          {selectedVariant.action !== 'size' && <div className="tool-dock-settings"><ToolSettings sessionId={sessionId} doc={doc} selectedCurve={selectedCurve} /></div>}
          {selectedVariant.action === 'size' && <div className="tool-dock-actions"><CanvasSize sessionId={sessionId} doc={doc} /></div>}
        </div>
      </section>}
    </div>
    <div className="tool-dock-family" role="toolbar" aria-label={`${mode} tools`} onKeyDown={moveToolbarFocus}>
      {shownFamilies.map((family, index) => {
        const active = !!toolFor(family, currentTool, currentShape, rulerKind, brushHardness);
        const disabled = family.variants.every((variant) => !variant.tool && !variant.soon);
        return <span className={family.id.startsWith('visitor-') ? 'tool-dock-visitor' : ''} key={`${family.id}-${index}`}>
          {family.id.startsWith('visitor-') && <span className="tool-dock-separator" aria-hidden="true" />}
          {iconButton(family.icon, family.label, active || family.id === familyId, () => {
            if (family.id !== familyId) {
              const initial = family.variants.find((variant) => variant.tool);
              if (initial) chooseVariant(initial);
            }
            dispatch({ type: 'family', familyId: family.id });
          }, disabled, (element) => { if (element) familyButtons.current.set(family.id, element); else familyButtons.current.delete(family.id); })}
        </span>;
      })}
      <span className="tool-dock-separator" aria-hidden="true" />
      <IconButton icon={PanelRight} label="Show or hide right panel" size="md" onClick={() => window.dispatchEvent(new Event('ogs:layers-toggle'))} />
      <PaintModeToggle sessionId={sessionId} doc={doc} />
    </div>
  </div>;
}

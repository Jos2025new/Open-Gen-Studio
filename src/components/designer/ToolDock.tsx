import { useEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactElement, type Ref } from 'react';
import { applyBrushPreset, PENCIL_PRESETS } from '../../engine/design/brushPresets';
import { EyeOff, AirVent, Blend, Brush, ChartPie, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Circle, CircleDashed, CircleHelp, Crop, DraftingCompass, Eraser, Eye, GripHorizontal, Grid3X3, Hand, LayoutPanelTop, LayoutTemplate, Lasso, LassoSelect, Layers, Minus, MousePointer2, MoveUpRight, PaintBucket, PenTool, Pentagon, Pencil, Pipette, Ruler, Scissors, Settings2, Shapes, Square, SquareDashed, Star, Spline, Type, WandSparkles, SquaresUnite, type LucideIcon } from '../ui/icons';
import type { DesignDoc } from '../../engine/types';
import type { DesignTool } from '../../engine/design/rules';
import { toolBlockReason } from '../../engine/design/rules';
import { activeLayer } from '../../engine/design/doc';
import { createPortal } from 'react-dom';
import { setUi, useStore } from '../../store/store';
import { IconButton, MenuItem } from '../ui/primitives';
import { Popover, usePopover } from '../ui/Popover';
import { QUICK, QuickControls } from './QuickSettings';
import { ToolSettings } from './ToolSettings';
import { CanvasSize } from './CanvasSize';
import { GuidesCard } from './GuidesCard';
import { EditCard, useEditCount } from './EditCard';
import { ContextStrip } from './ContextStrip';
import { useObjectSelection } from '../../engine/design/objectSelection';
import { toolKey } from '../../engine/shortcuts';
import { TIP_PRESETS } from '../../engine/design/brushEngine';
import { entryVariant, initialToolboxState, reduceToolboxState, TOOLBOX, TOOLS_GRID_FAMILIES, variantKey, withKey, type ToolboxFamily, type ToolboxVariant } from './toolboxModel';
import '../../styles/tool-dock.css';

const ICONS: Record<string, LucideIcon> = {
  airbrush: AirVent, blend: Blend, brush: Brush, 'chart-pie': ChartPie, circle: Circle, 'circle-dashed': CircleDashed, 'lasso-select': LassoSelect, crop: Crop,
  'drafting-compass': DraftingCompass, eraser: Eraser, eye: Eye, 'grid-3x3': Grid3X3, hand: Hand,
  'layout-panel-top': LayoutPanelTop, 'layout-template': LayoutTemplate, lasso: Lasso, minus: Minus,
  'mouse-pointer-2': MousePointer2, 'move-up-right': MoveUpRight, 'paint-bucket': PaintBucket, 'pen-tool': PenTool,
  pencil: Pencil, pentagon: Pentagon, pipette: Pipette, scissors: Scissors, 'settings-2': Settings2, shapes: Shapes, square: Square,
  'square-dashed': SquareDashed, star: Star, spline: Spline, type: Type, 'wand-sparkles': WandSparkles,
  'ruler-dimension-line': Ruler, 'squares-unite': SquaresUnite,
};
const iconFor = (name: string): LucideIcon => ICONS[name] ?? CircleHelp;

/** Designer toolbox (side or in the prompt box): one popup at a time. Opening one (a tool's variants, Create or Conversation, Designs) closes the others. */
export type SidePopup = 'tools' | 'corner' | 'designs';
export const announceSidePopup = (which: SidePopup) => window.dispatchEvent(new CustomEvent<SidePopup>('ogs:side-popup', { detail: which }));
export function useSidePopup(which: SidePopup, close: () => void, active = true) {
  const latest = useRef(close);
  latest.current = close;
  useEffect(() => {
    if (!active) return;
    const on = (e: Event) => { if ((e as CustomEvent<SidePopup>).detail !== which) latest.current(); };
    window.addEventListener('ogs:side-popup', on);
    return () => window.removeEventListener('ogs:side-popup', on);
  }, [which, active]);
}

function iconButton(name: string, label: string, active: boolean, onClick: () => void, disabled = false, ref?: Ref<HTMLButtonElement>, key?: string) {
  const Icon = iconFor(name);
  return <button ref={ref} type="button" className={`icon-btn icon-btn-md tone-default ${active ? 'is-active' : ''}`} aria-label={label} aria-pressed={active} aria-disabled={label.includes('Soon:') || undefined} title={label.includes('Soon:') ? label : undefined} disabled={disabled} data-tip={withKey(label, key)} onClick={onClick}><Icon size={16} strokeWidth={1.75} /></button>;
}

/** The Tools button (Designer): the active one of Select, Ruler, Pen, Brush and Eraser as its icon, and a popup grid with every variant of those families. */
function ToolsGridButton({ icon, label, families, isActive, blockedReason, onPick, vertical }: { icon: string; label: string; families: ToolboxFamily[]; isActive: (family: ToolboxFamily, variant: ToolboxVariant) => boolean; blockedReason: (variant: ToolboxVariant) => string | null | undefined; onPick: (family: ToolboxFamily, variant: ToolboxVariant) => void; vertical: boolean }) {
  const pop = usePopover();
  useSidePopup('tools', pop.close);
  const active = families.some((family) => family.variants.some((variant) => isActive(family, variant)));
  return <>
    {iconButton(icon, `Tools · ${label}`, active, () => { if (!pop.open) announceSidePopup('tools'); pop.toggle(); }, false, pop.ref)}
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} placement={vertical ? 'right-start' : 'top-center'} width="content" label="Tools" className="tools-grid-pop">
      <div className="menu tool-grid">
        {families.flatMap((family) => family.variants.map((variant) => <MenuItem key={`${family.id}-${variant.id}`} icon={iconFor(variant.icon)} label={variant.label} active={isActive(family, variant)} disabled={!!variant.soon || (family.variants.length > 1 && !!blockedReason(variant))} tip={variant.soon ? `Soon: ${variant.soon}` : withKey(variant.label, variantKey(variant))} onClick={() => { pop.close(); onPick(family, variant); }} />))}
      </div>
    </Popover>
  </>;
}

function toolFor(family: ToolboxFamily, current: DesignTool, shape: string, rulerKind: string, hardness: number): ToolboxVariant | undefined {
  const matches = family.variants.filter((variant) => variant.tool === current || !!variant.also?.includes(current));
  return matches.find((variant) => variant.selectShape ? variant.selectShape === shape : variant.rulerKind ? variant.rulerKind === rulerKind : variant.preset === 'pencil' ? PENCIL_PRESETS.some((p) => p.values.hardness === hardness) : variant.preset === 'airbrush' ? hardness === TIP_PRESETS[3] : !variant.preset) ?? matches[0];
}

function familyFor(families: ToolboxFamily[], tool: DesignTool, shape: string, rulerKind: string, hardness: number) {
  return families.find((family) => toolFor(family, tool, shape, rulerKind, hardness));
}

/** Families with only the variants whose tool is in `tools` (Studio's board offers a subset); everything when `tools` is absent. */
function restrictToolbox(tools?: ReadonlySet<DesignTool>): ToolboxFamily[] {
  if (!tools) return TOOLBOX;
  return TOOLBOX.map((family) => ({ ...family, variants: family.variants.filter((variant) => variant.tool && tools.has(variant.tool)) })).filter((family) => family.variants.length > 0);
}

/**
 * `vertical`: the strip turned upright; arrows Up and Down also move along it. `designer`: the Designer's own toolbox: the active
 * tool's options go to `optionsSlot`, in the bar at the bottom, and nowhere while the prompt box is there instead.
 */
export function ToolDock({ sessionId, doc, selectedCurve = null, tools, vertical = false, designer: inDesigner = false, optionsSlot = null }: { sessionId: string; doc: DesignDoc; selectedCurve?: { layerId: string; strokeId: string } | null; tools?: ReadonlySet<DesignTool>; vertical?: boolean; designer?: boolean; optionsSlot?: HTMLElement | null }) {
  const currentTool = useStore((state) => state.ui.tool);
  const currentShape = useStore((state) => state.ui.selectShape ?? 'rect');
  const rulerKind = useStore((state) => state.ui.strokeRulerKind ?? 'line');
  const brushHardness = useStore((state) => state.ui.brush.hardness ?? TIP_PRESETS[0]);
  const lastVariant = useStore((state) => state.ui.lastVariant);
  const shownFamilies = useMemo(() => restrictToolbox(tools), [tools]);
  const currentFamily = familyFor(shownFamilies, currentTool, currentShape, rulerKind, brushHardness);
  const [dockState, dispatch] = useReducer(reduceToolboxState, initialToolboxState);
  const { depth, familyId } = dockState;
  const familyButtons = useRef(new Map<string, HTMLButtonElement>());
  const [height, setHeight] = useState(360);
  const promptHidden = useStore((state) => state.ui.promptHidden) ?? false;
  const bottom = inDesigner;
  const selectedFamily = shownFamilies.find((family) => family.id === familyId) ?? currentFamily;
  const selectedVariant = selectedFamily ? selectedFamily.variants.find((variant) => variant.id === dockState.variantId) ?? toolFor(selectedFamily, currentTool, currentShape, rulerKind, brushHardness) ?? selectedFamily.variants[0] : undefined;
  const activeLayerValue = activeLayer(doc);
  // A real pick (objects, or several layers): the active layer alone is always set, so it does not count.
  const editCount = useEditCount(doc), picked = useObjectSelection((st) => !!st.byDoc[doc.id]?.length) || editCount > 1;
  // Edit with a selection: one compact strip takes the variant row's place. The Edit button brings the variants back (and hides the strip); opening the Edit card, or picking something else, returns to the strip.
  const [variantsAsked, setVariantsAsked] = useState(false);
  useEffect(() => { setVariantsAsked(false); }, [picked, currentTool, doc.id]);
  useEffect(() => { if (depth === 'open') setVariantsAsked(false); }, [depth]);
  const stripShown = currentTool === 'move' && picked && !(depth === 'open' && selectedVariant?.id === 'edit') && !(variantsAsked && depth !== 'closed');
  const disabledReason = (variant: ToolboxVariant) => variant.tool ? toolBlockReason(variant.tool, activeLayerValue) : undefined;
  // The Designer's toolbox (either place; Studio's is not) shares one popup at a time with Designs and Create/Conversation.
  const designer = vertical || inDesigner;
  useSidePopup('tools', () => { dispatch({ type: 'escape' }); dispatch({ type: 'escape' }); }, designer);
  // Changing tool brings its options back in place of the prompt box.
  const shownTool = useRef(currentTool);
  useEffect(() => {
    if (inDesigner && shownTool.current !== currentTool) setUi({ designerDock: 'tools' });
    shownTool.current = currentTool;
  }, [currentTool, inDesigner]);

  useEffect(() => {
    const desiredId = currentFamily?.id;
    if (desiredId && desiredId !== familyId) dispatch({ type: 'family', familyId: desiredId });
  }, [currentTool, doc.id]);

  const chooseVariant = (variant: ToolboxVariant, ownerId = selectedFamily?.id ?? '') => {
    if (variant.soon) return;
    if (!variant.tool) {
      if (variant.action) dispatch({ type: 'variant', familyId: selectedFamily?.id ?? '', variantId: variant.id, open: true });
      return;
    }
    if (variant.selectShape) setUi({ selectShape: variant.selectShape });
    if (variant.rulerKind) {
      const ruler = useStore.getState().ui.strokeRuler;
      setUi({ strokeRulerKind: variant.rulerKind, ...(ruler ? { strokeRuler: { ...ruler, kind: variant.rulerKind } } : {}) });
    }
    // A merged tool keeps the type chosen in its settings (sector, arc, chord, star, arrow) when its button is pressed again.
    if (!variant.also?.includes(useStore.getState().ui.tool)) setUi({ tool: variant.tool });
    // HB only when Pencil is newly chosen: coming back to the family on Pencil keeps the user's tweaks.
    const changed = !ownerId || useStore.getState().ui.lastVariant?.[ownerId] !== variant.id;
    if (variant.preset === 'pencil' && changed) setUi({ brush: applyBrushPreset(useStore.getState().ui.brush, PENCIL_PRESETS[1]) });
    if (variant.preset === 'airbrush') setUi({ brush: { ...useStore.getState().ui.brush, hardness: TIP_PRESETS[3] } });
    if (ownerId && useStore.getState().ui.lastVariant?.[ownerId] !== variant.id) setUi({ lastVariant: { ...useStore.getState().ui.lastVariant, [ownerId]: variant.id } });
    dispatch({ type: 'variant', familyId: selectedFamily?.id ?? '', variantId: variant.id });
  };

  const moveToolbarFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' || (vertical && event.key === 'ArrowDown') ? 1 : event.key === 'ArrowLeft' || (vertical && event.key === 'ArrowUp') ? -1 : 0;
    if (!step) return;
    event.stopPropagation();
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    buttons[(index + step + buttons.length) % buttons.length]?.focus();
    event.preventDefault();
  };

  // The Designer's bottom toolbox has two rows above it. Quick settings (the tool's icon where the Tools grid holds its variants, its sliders and colors, Eraser toggle; the gear lives in the toolbox as Settings) are always there, as wide as their content.
  // The variants row sits above them for the families the Tools grid does not hold (Edit, Layout).
  const inGrid = designer && TOOLS_GRID_FAMILIES.includes(selectedFamily?.id ?? '');
  const subtools = (selectedFamily?.variants.length ?? 0) > 1;
  const hasQuick = !!QUICK[currentTool];
  // The eyedropper's settings (radius, source, colors) all sit in the row: no card to open.
  const noCard = bottom && selectedVariant?.tool === 'eyedropper';
  const showGear = !!selectedVariant && !selectedVariant.soon && currentTool !== 'hand' && !noCard;
  // The eye sits at the bar's very end, after the zoom rail (the composer's slot), not inside the scrolling tool list.
  const [eyeSlot, setEyeSlot] = useState<HTMLElement | null>(null);
  useEffect(() => { setEyeSlot(optionsSlot ? document.querySelector<HTMLElement>('.composer-tools-bar > .tool-dock-eye-slot') : null); }, [optionsSlot]);
  const hideButton = <button type="button" className={`tool-dock-hide-prompt${promptHidden ? ' is-pill' : ''}`} aria-label="Hide prompt box" aria-pressed={promptHidden} data-tip={promptHidden ? 'Show the prompt box' : 'Hide the prompt box'} onClick={() => setUi({ promptHidden: !promptHidden })}><EyeOff size={16} /></button>;
  const gear = showGear && <button type="button" className={`icon-btn icon-btn-md tone-default ${depth === 'open' ? 'is-active' : ''}`} aria-label="Settings" aria-pressed={depth === 'open'} data-tip="Advanced settings" onClick={() => dispatch({ type: 'settings', familyId: selectedFamily?.id ?? currentFamily?.id ?? '' })}><Settings2 size={16} /></button>;
  const cardOpen = depth === 'open' && !!selectedVariant && !selectedVariant.soon && !noCard;
  const variantsRow = bottom && selectedFamily && !stripShown && subtools && !inGrid && <div className="tool-dock-variants is-fixed" role="toolbar" aria-label={`${selectedFamily.label} variants`} onKeyDown={moveToolbarFocus}>
    {selectedFamily.variants.map((variant) => {
      const active = !!variant.tool && (variant.tool === currentTool || !!variant.also?.includes(currentTool)) && selectedVariant?.id === variant.id;
      return <span key={variant.id}>{iconButton(variant.icon, `${variant.label}${variant.soon ? ` · Soon: ${variant.soon}` : ''}`, active, () => { if (!active) chooseVariant(variant); else if (!noCard) dispatch({ type: 'settings', familyId: selectedFamily.id }); }, !variant.soon && !!disabledReason(variant), undefined, variantKey(variant))}</span>;
    })}
  </div>;
  const quickRow = bottom && selectedFamily && !stripShown && (hasQuick || (!designer && showGear)) && <div className="tool-dock-variants is-fixed is-quick" role="toolbar" aria-label="Quick settings" onKeyDown={moveToolbarFocus}>
    {inGrid && subtools && <>{iconButton(selectedVariant?.icon ?? 'brush', `${selectedVariant?.label ?? 'Brush'} tool`, true, () => undefined)}{hasQuick && <span className="tool-dock-separator" aria-hidden="true" />}</>}
    {hasQuick && <QuickControls tool={currentTool} sessionId={sessionId} doc={doc} />}
    {hasQuick && (currentTool === 'brush' || currentTool === 'eraser') && iconButton('eraser', 'Eraser', currentTool === 'eraser', () => { setUi({ tool: currentTool === 'eraser' ? 'brush' : 'eraser' }); }, false, undefined, toolKey('eraser'))}
    {!designer && gear}
  </div>;

  // The Tools button stands where the first of Select, Ruler, Pen, Brush and Eraser would; the others take no slot of their own.
  const gridFamilies = designer ? shownFamilies.filter((family) => TOOLS_GRID_FAMILIES.includes(family.id)) : [];
  const gridIcon = (() => {
    const family = gridFamilies.find((f) => f.id === currentFamily?.id);
    const variant = family ? toolFor(family, currentTool, currentShape, rulerKind, brushHardness) : undefined;
    const fallback = gridFamilies.find((f) => lastVariant?.[f.id]) ?? gridFamilies.find((f) => f.id === 'brush') ?? gridFamilies[0];
    const shown = variant ?? (fallback ? entryVariant(fallback, lastVariant) ?? fallback.variants[0] : undefined);
    return { icon: shown?.icon ?? 'brush', label: shown?.label ?? 'Brush' };
  })();
  const gridActive = (family: ToolboxFamily, variant: ToolboxVariant) => family.id === currentFamily?.id && !!variant.tool && (variant.tool === currentTool || !!variant.also?.includes(currentTool)) && toolFor(family, currentTool, currentShape, rulerKind, brushHardness)?.id === variant.id;

  const placeStack = (stack: ReactElement) => !bottom ? stack : optionsSlot ? createPortal(stack, optionsSlot) : null;
  const pillHome = optionsSlot?.closest('.composer');
  const setHeightFrom = (next: number) => setHeight(Math.max(140, Math.min(window.innerHeight * 0.6, next)));
  const onGripKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.stopPropagation();
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); return; }
    event.preventDefault();
    setHeightFrom(height + (event.key === (vertical ? 'ArrowDown' : 'ArrowUp') ? 16 : -16));
  };

  return <div className={vertical ? 'tool-dock is-vertical' : 'tool-dock'} style={{ '--tool-dock-card-height': `${height}px` } as CSSProperties} onKeyDown={(event) => {
    if (event.key !== 'Escape') return;
    if (depth === 'closed') return;
    dispatch({ type: 'escape' });
    event.preventDefault(); event.stopPropagation();
    if (familyId) familyButtons.current.get(familyId)?.focus();
  }}>
    {placeStack(<div className={`tool-dock-stack${bottom ? ' is-fixed' : ''}`} style={{ '--tool-dock-card-height': `${height}px` } as CSSProperties}>
      {/* Designer: the advanced settings show alone while open, never stacked over the variants and quick rows. */}
      {!(designer && cardOpen) && variantsRow}
      {!(designer && cardOpen) && quickRow}
      {!bottom && depth !== 'closed' && selectedFamily && !stripShown && <div className={`tool-dock-variants${bottom ? ' is-fixed' : ''}`} role="toolbar" aria-label={`${selectedFamily.label} variants`} aria-orientation={vertical ? 'vertical' : undefined} onKeyDown={moveToolbarFocus}>
        {selectedFamily.variants.map((variant) => {
          const active = !!variant.tool && (variant.tool === currentTool || !!variant.also?.includes(currentTool)) && selectedVariant?.id === variant.id;
          return <span key={variant.id}>{iconButton(variant.icon, `${variant.label}${variant.soon ? ` · Soon: ${variant.soon}` : ''}`, active, () => active ? dispatch({ type: 'settings', familyId: selectedFamily.id }) : chooseVariant(variant), !variant.soon && !!disabledReason(variant), undefined, variantKey(variant))}</span>;
        })}
        {!selectedVariant?.soon && <><span className="tool-dock-grow" />
        <button type="button" className="icon-btn icon-btn-md tone-default" aria-label={depth === 'open' ? 'Hide tool settings' : 'Show tool settings'} aria-expanded={depth === 'open'} onClick={() => dispatch({ type: 'settings', familyId: selectedFamily.id })}>
          {depth === 'open' ? (vertical ? <ChevronLeft size={16} /> : <ChevronDown size={16} />) : (vertical ? <ChevronRight size={16} /> : <ChevronUp size={16} />)}
        </button></>}
      </div>}
      {/* Edit with a selection and its card not open: the contextual strip alone, where the card would open. */}
      {stripShown && <section className="tool-dock-card tool-dock-strip" aria-label="Selection controls"><ContextStrip sessionId={sessionId} doc={doc} variant="strip" /></section>}
      {depth === 'open' && selectedVariant && !selectedVariant.soon && !noCard && <section className="tool-dock-card" aria-label={`${selectedVariant.label} settings`}>
        <button type="button" className="tool-dock-grip" role="separator" aria-orientation="horizontal" aria-label="Resize tool settings" tabIndex={0} onKeyDown={onGripKey} onPointerDown={(event) => {
          const startY = event.clientY; const startHeight = height; const el = event.currentTarget;
          el.setPointerCapture(event.pointerId);
          const move = (next: PointerEvent) => setHeightFrom(startHeight + (vertical ? next.clientY - startY : startY - next.clientY));
          const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
          el.addEventListener('pointermove', move); el.addEventListener('pointerup', up, { once: true });
        }}><GripHorizontal size={14} /></button>
        <div className="tool-dock-settings-grid">
          {selectedVariant.id === 'edit' && <div className="tool-dock-settings tool-dock-edit"><EditCard sessionId={sessionId} doc={doc} /></div>}
          {!selectedVariant.action && selectedVariant.id !== 'edit' && <div className="tool-dock-settings"><ToolSettings sessionId={sessionId} doc={doc} selectedCurve={selectedCurve} card /></div>}
          {selectedVariant.action === 'size' && <div className="tool-dock-actions"><CanvasSize sessionId={sessionId} doc={doc} inline /></div>}
          {selectedVariant.action === 'guides' && <div className="tool-dock-actions"><GuidesCard sessionId={sessionId} doc={doc} /></div>}
        </div>
      </section>}
    </div>)}
    {bottom && promptHidden && pillHome && createPortal(hideButton, pillHome)}
    <div className="tool-dock-family" role="toolbar" aria-label="Tools" aria-orientation={vertical ? 'vertical' : undefined} onKeyDown={moveToolbarFocus}>
      {shownFamilies.map((family) => {
        // Designer: the toolbox's Settings button is the active tool's advanced settings (the card the gear opened).
        if (designer && family.id === 'settings') {
          return <span key="settings"><button type="button" className={`icon-btn icon-btn-md tone-default ${showGear && depth === 'open' ? 'is-active' : ''}`} aria-label="Settings" aria-pressed={showGear && depth === 'open'} disabled={!showGear} data-tip={showGear ? 'Advanced settings of the active tool' : 'This tool has no advanced settings'} onClick={() => dispatch({ type: 'settings', familyId: selectedFamily?.id ?? currentFamily?.id ?? '' })}><Settings2 size={16} /></button></span>;
        }
        if (gridFamilies.some((f) => f.id === family.id)) {
          return family.id === gridFamilies[0].id ? <span key="tools-grid"><ToolsGridButton icon={gridIcon.icon} label={gridIcon.label} families={gridFamilies} isActive={gridActive} blockedReason={disabledReason} vertical={vertical} onPick={(owner, variant) => { setUi({ designerDock: 'tools' }); chooseVariant(variant, owner.id); if (!variant.soon && variant.tool) dispatch({ type: 'variant', familyId: owner.id, variantId: variant.id }); }} /></span> : null;
        }
        const active = !!toolFor(family, currentTool, currentShape, rulerKind, brushHardness);
        const soonReason = family.variants.every((variant) => variant.soon) ? family.variants.find((variant) => variant.soon)?.soon : undefined;
        return <span key={family.id}>
          {iconButton(family.icon, `${family.label}${soonReason ? ` · Soon: ${soonReason}` : ''}`, active || family.id === familyId, () => {
            if (soonReason) return;
            if (designer) { announceSidePopup('tools'); setUi({ designerDock: 'tools' }); }
            if (stripShown && family.id === currentFamily?.id) { setVariantsAsked(true); if (depth === 'closed') dispatch({ type: 'family', familyId: family.id }); return; }
            if (family.id !== familyId) {
              const initial = entryVariant(family, lastVariant);
              if (initial) chooseVariant(initial, family.id);
            }
            dispatch({ type: 'family', familyId: family.id });
          }, false, (element) => { if (element) familyButtons.current.set(family.id, element); else familyButtons.current.delete(family.id); }, variantKey(entryVariant(family, lastVariant) ?? family.variants[0]))}
        </span>;
      })}
      {shownFamilies.some((family) => family.id === 'settings') && <span key="panels" className="tool-dock-end">
        <span className="tool-dock-separator" aria-hidden="true" />
        <IconButton icon={Layers} label="Show or hide right panel" size="md" onClick={() => window.dispatchEvent(new Event('ogs:layers-toggle'))} />
      </span>}
      {!promptHidden && eyeSlot && createPortal(<><span className="tool-dock-separator" aria-hidden="true" />{hideButton}</>, eyeSlot)}
    </div>
  </div>;
}

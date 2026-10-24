import type { UiState } from './store';
import { PAGE_UNITS, type PageUnit } from '../engine/design/pageUnits';

/** Canvas size card: the unit the page is shown in and the DPI used for mm/in. */
export interface PageUiPrefs { pageUnit?: PageUnit; pageDpi?: number; showGuides?: boolean; lockGuides?: boolean }

/** A loaded value that is not a known unit / a DPI in 1..1200 is dropped (the card then uses px / 96). */
export function sanitizeUi<T extends PageUiPrefs>(ui: T): T {
  const unit = PAGE_UNITS.includes(ui.pageUnit as PageUnit) ? ui.pageUnit : undefined;
  const dpi = typeof ui.pageDpi === 'number' && Number.isFinite(ui.pageDpi) && ui.pageDpi >= 1 && ui.pageDpi <= 1200 ? ui.pageDpi : undefined;
  // Guide flags are booleans only; anything else falls back to the defaults (shown, unlocked).
  const showGuides = typeof ui.showGuides === 'boolean' ? ui.showGuides : true;
  const lockGuides = typeof ui.lockGuides === 'boolean' ? ui.lockGuides : false;
  return { ...ui, pageUnit: unit, pageDpi: dpi, showGuides, lockGuides };
}

/**
 * The `ui` slice that survives a reload: workspace, tools and the open Space. Listing it here (and not inside
 * store.ts) keeps the projection out of the 30 KB limit of that file.
 */
export type PersistedUi = Pick<
  UiState,
  | 'workspace'
  | 'brush'
  | 'lineart'
  | 'shape'
  | 'text'
  | 'tool'
  | 'swatches'
  | 'gradient'
  | 'rulers'
  | 'showGuides'
  | 'lockGuides'
  | 'pageUnit'
  | 'pageDpi'
  | 'selectShape'
  | 'wand'
  | 'strokeRuler'
  | 'strokeRulerKind'
  | 'toolHelp'
  | 'drawingChoice'
  | 'autoSelect'
  | 'homeDrafts'
  | 'home'
  | 'homeTab'
  | 'space'
  | 'toolOp'
  | 'toolAsset'
>;

export function pickUi(ui: UiState): PersistedUi {
  return {
    workspace: ui.workspace,
    brush: ui.brush,
    lineart: ui.lineart,
    shape: ui.shape,
    text: ui.text,
    tool: ui.tool,
    swatches: ui.swatches,
    gradient: ui.gradient,
    rulers: ui.rulers,
    showGuides: ui.showGuides,
    lockGuides: ui.lockGuides,
    pageUnit: ui.pageUnit,
    pageDpi: ui.pageDpi,
    selectShape: ui.selectShape,
    wand: ui.wand,
    strokeRuler: ui.strokeRuler,
    strokeRulerKind: ui.strokeRulerKind,
    toolHelp: ui.toolHelp,
    drawingChoice: ui.drawingChoice,
    autoSelect: ui.autoSelect,
    homeDrafts: ui.homeDrafts,
    home: ui.home,
    homeTab: ui.homeTab,
    space: ui.space,
    toolOp: ui.toolOp,
    toolAsset: ui.toolAsset,
  };
}

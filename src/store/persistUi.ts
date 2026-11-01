import type { UiState } from './store';
import { PAGE_UNITS, type PageUnit } from '../engine/design/pageUnits';

/** Canvas size card: the unit the page is shown in and the DPI used for mm/in. */
export interface PageUiPrefs { pageUnit?: PageUnit; pageDpi?: number; showGuides?: boolean; lockGuides?: boolean; /** Generations panel: the smallest a tile may be, in px (the tiles then grow to fill the row). */ tileSize?: number }

/** Generations tiles: the slider's range and default (two columns in a typical panel). */
export const TILE_MIN = 110;
export const TILE_MAX = 800;
export const TILE_DEFAULT = 280;

/** A saved tile size: a number is clamped to the range; the old 'small'/'large' choice becomes the minimum / the default; anything else is dropped. */
export function sanitizeTileSize(v: unknown): number | undefined {
  if (v === 'small') return TILE_MIN;
  if (v === 'large') return TILE_DEFAULT;
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(TILE_MAX, Math.max(TILE_MIN, Math.round(v))) : undefined;
}

/** A loaded value that is not a known unit / a DPI in 1..1200 is dropped (the card then uses px / 96). */
export function sanitizeUi<T extends PageUiPrefs>(ui: T): T {
  const unit = PAGE_UNITS.includes(ui.pageUnit as PageUnit) ? ui.pageUnit : undefined;
  const dpi = typeof ui.pageDpi === 'number' && Number.isFinite(ui.pageDpi) && ui.pageDpi >= 1 && ui.pageDpi <= 1200 ? ui.pageDpi : undefined;
  // Guide flags are booleans only; anything else falls back to the defaults (shown, unlocked).
  const showGuides = typeof ui.showGuides === 'boolean' ? ui.showGuides : true;
  const lockGuides = typeof ui.lockGuides === 'boolean' ? ui.lockGuides : false;
  return { ...ui, pageUnit: unit, pageDpi: dpi, showGuides, lockGuides, tileSize: sanitizeTileSize(ui.tileSize) };
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
  | 'tileSize'
  | 'selectShape'
  | 'lastVariant'
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
    tileSize: ui.tileSize,
    selectShape: ui.selectShape,
    lastVariant: ui.lastVariant,
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

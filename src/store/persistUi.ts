import type { UiState } from './store';

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

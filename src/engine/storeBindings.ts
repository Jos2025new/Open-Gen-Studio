// Boundary for the state store's Designer and Nodes integrations.
export { historyDepth } from './design/history';
export { pendingRaster } from './design/raster';
export { useLayerSelection } from './design/selection';
export { objectPicks } from './design/objectSelection';
export { recordGraph } from './flow/history';
export { graphEditProblem } from './flow/locks';
export { DEFAULT_TEXT_STYLE } from './design/doc';
export { pinPaintMode } from './design/paintMode';
export { DEFAULT_STROKE_STYLE } from './design/strokes';
export type { BrushPreset, BrushUi } from './design/brushPresets';
export type { SelectCombine } from './design/pixelSelection';
export type { DesignTool } from './design/rules';
export type { SelectShape } from './design/selectShape';
export type { SnapByMode } from './design/snap';
export type { RulerKind, StrokeRuler } from './design/strokeRuler';

// Keep the raster import at the same await boundary during an explicit save.
export const loadRaster = () => import('./design/raster');

import type { DesignTool } from '../../engine/design/rules';

/** Icon keys are names only so this table stays data-only and easy to inspect. */
export type ToolboxVariant = {
  id: string;
  label: string;
  icon: string;
  tool?: DesignTool;
  selectShape?: 'rect' | 'lasso' | 'wand';
  rulerKind?: 'line' | 'ellipse' | 'perspective';
  preset?: 'pencil' | 'airbrush';
  action?: 'size';
  soon?: string;
};
export type ToolboxFamily = { id: string; label: string; icon: string; variants: ToolboxVariant[] };

const v = (id: string, label: string, icon: string, tool?: DesignTool, extras: Partial<ToolboxVariant> = {}): ToolboxVariant => ({ id, label, icon, ...(tool ? { tool } : {}), ...extras });
const soon = (id: string, label: string, icon: string, reason: string): ToolboxVariant => v(id, label, icon, undefined, { soon: reason });
const family = (id: string, label: string, icon: string, variants: ToolboxVariant[]): ToolboxFamily => ({ id, label, icon, variants });

/** One toolbox for both paint modes, in the order of the mockup; Drawing/Design stays a document setting inside the brush card. */
export const TOOLBOX: ToolboxFamily[] = [
  family('edit', 'Edit', 'mouse-pointer-2', [v('edit', 'Edit', 'mouse-pointer-2', 'move'), v('hand', 'Pan', 'hand', 'hand'), v('rect', 'Rectangle', 'square', 'rect'), v('ellipse', 'Ellipse', 'circle', 'ellipse'), v('line', 'Straight line', 'minus', 'line'), v('arrow', 'Arrow', 'move-up-right', 'arrow'), v('polygon', 'Polygon', 'pentagon', 'polygon'), v('star', 'Star', 'star', 'star'), v('sector', 'Sector', 'chart-pie', 'sector'), v('arc', 'Arc', 'spline', 'arc'), v('chord', 'Chord', 'circle', 'chord')]),
  family('layout', 'Layout', 'layout-panel-top', [v('sizes', 'Sizes', 'crop', undefined, { action: 'size' }), soon('grid', 'Grid', 'grid-3x3', 'A layout grid is planned.'), soon('guides', 'Guides', 'ruler-dimension-line', 'Guides are planned.'), soon('templates', 'Templates', 'layout-template', 'Templates are planned.')]),
  family('pen', 'Pen', 'pen-tool', [v('lineart', 'Lineart', 'pen-tool', 'lineart'), v('curve', 'Curve', 'spline', 'curve'), soon('bezier-pen', 'Bezier pen', 'pen-tool', 'A vector Bezier pen is planned.'), soon('cutter', 'Cutter', 'scissors', 'A path cutter is planned.')]),
  family('brush', 'Brush', 'brush', [v('brush', 'Brush', 'brush', 'brush'), v('pencil', 'Pencil', 'pencil', 'brush', { preset: 'pencil' }), v('airbrush', 'Airbrush', 'airbrush', 'brush', { preset: 'airbrush' }), v('fill', 'Fill', 'paint-bucket', 'fill'), v('gradient', 'Gradient', 'blend', 'gradient'), v('selection-rect', 'Rectangular selection', 'square-dashed', 'select', { selectShape: 'rect' }), v('lasso', 'Lasso', 'lasso', 'select', { selectShape: 'lasso' }), v('wand', 'Magic wand', 'wand-sparkles', 'select', { selectShape: 'wand' }), v('eyedropper', 'Eyedropper', 'pipette', 'eyedropper'), soon('sculpt', 'Sculpt', 'sculpt', 'Sculpting brushes are planned.'), soon('blur', 'Blur', 'blend', 'Blur and smudge tools are planned.')]),
  family('eraser', 'Eraser', 'eraser', [v('eraser', 'Eraser', 'eraser', 'eraser')]),
  family('text', 'Text', 'type', [v('text', 'Text', 'type', 'text')]),
  family('ruler', 'Ruler', 'drafting-compass', [v('ruler-straight', 'Straight ruler', 'minus', 'ruler', { rulerKind: 'line' }), v('ruler-ellipse', 'Ellipse ruler', 'circle', 'ruler', { rulerKind: 'ellipse' }), v('ruler-perspective', 'Perspective ruler', 'ruler-dimension-line', 'ruler', { rulerKind: 'perspective' })]),
  family('settings', 'Settings', 'settings-2', [soon('settings', 'Toolbox settings', 'settings-2', 'Toolbox preferences are planned.')]),
];

/** Edit with two or more objects selected: these join Align and Distribute, disabled and explained until they exist. */
export const MULTI_SOON: ToolboxVariant[] = [soon('boolean', 'Boolean', 'combine', 'Boolean operations (union, subtract, intersect) are planned.'), soon('form-builder', 'Form builder', 'shapes', 'A form builder is planned.')];

/** Every implemented drawing tool has a home, including tools without shortcuts. */
export function toolboxTools(): DesignTool[] {
  return [...new Set(TOOLBOX.flatMap((item) => item.variants.flatMap((variant) => variant.tool ? [variant.tool] : [])))];
}

export type ToolboxState = { familyId: string | null; variantId: string | null; depth: 'closed' | 'folded' | 'open' };
export type ToolboxAction = { type: 'family'; familyId: string } | { type: 'variant'; familyId: string; variantId: string } | { type: 'settings'; familyId: string } | { type: 'escape' };
export const initialToolboxState: ToolboxState = { familyId: null, variantId: null, depth: 'closed' };

/** Transitions for the family → variants → full settings interaction. */
export function reduceToolboxState(state: ToolboxState, action: ToolboxAction): ToolboxState {
  if (action.type === 'escape') return state.depth === 'open' ? { ...state, depth: 'folded' } : state.depth === 'folded' ? { ...state, depth: 'closed' } : state;
  if (action.type === 'variant') return { familyId: action.familyId, variantId: action.variantId, depth: 'open' };
  if (action.type === 'settings') return { ...state, familyId: action.familyId, depth: state.depth === 'open' ? 'folded' : 'open' };
  if (action.familyId !== state.familyId || state.depth === 'closed') return { familyId: action.familyId, variantId: null, depth: 'folded' };
  return { ...state, depth: 'closed' };
}

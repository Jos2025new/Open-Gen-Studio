import { HelpCircle, Ruler, X } from 'lucide-react';
import { setUi, useStore } from '../../store/store';
import type { DesignTool } from '../../engine/design/rules';
import { TOOL_NAMES } from '../../engine/shortcuts';
import { IconButton } from '../ui/primitives';

/*
 * Help for the active tool, as SketchUp's status bar (docs/plan-designer-ux.md, step 5): one discreet line above the
 * canvas with what the tool does and its keys. It can be closed and turned back on from the view group. The texts
 * are one complete record: the inventory test fails if a tool has none.
 */
export const TOOL_HELP: Record<DesignTool, string> = {
  move: 'Click to pick a layer or object · drag to move · Shift- or Ctrl-click adds more · drag a picked one to move them all · double-click a stroke to edit its points',
  hand: 'Drag to pan the page · hold Space to pan with any tool · Ctrl+wheel zooms',
  select: 'Drag a rectangle or lasso, or click with the wand · Shift adds · Alt subtracts · Ctrl+J copies it to a layer · Ctrl+D deselects',
  eyedropper: 'Click to pick the visible colour · Alt-click does the same with the Brush or Fill',
  brush: 'Paint on the layer named in the strip · Alt-click picks a colour · with a stroke ruler on (Ruler, K), strokes follow it',
  fill: 'Click to fill the area of similar colour, on a new layer · Alt-click picks a colour · Threshold is in the strip',
  gradient: 'Drag a line from the first colour to the second · inside the selection if there is one',
  lineart: 'Draw editable pressure strokes · Alt-drag bends a stroke · switch to Edit mode to move points',
  eraser: 'Erase on the active layer · size and opacity are in the strip',
  rect: 'Drag to draw a rectangle',
  ellipse: 'Drag to draw an ellipse',
  polygon: 'Drag to draw a polygon · Sides is in the strip',
  line: 'Drag to draw a straight line',
  curve: 'Drag to draw a curve · Bend sets how far it bows',
  arrow: 'Drag to draw an arrow',
  text: 'Click on the page to add a text · font, size and colour are in the strip',
  ruler: 'Drag to place a straight, ellipse or perspective guide · drag its round handles to adjust it · the Brush follows it while on',
};

export function ToolHelpLine() {
  const tool = useStore((s) => s.ui.tool);
  const on = useStore((s) => s.ui.toolHelp ?? true);
  if (!on) return null;
  return <div className="tool-help" role="status" aria-live="polite">
    <strong>{TOOL_NAMES[tool]}</strong><span>{TOOL_HELP[tool]}</span>
    <button type="button" className="tool-help-close" aria-label="Hide tool help" data-tip="Hide tool help · turn it back on with ? in the view controls" onClick={() => setUi({ toolHelp: false })}><X size={12} /></button>
  </div>;
}

/** The view group's switches (what you see, not how tools act): page rulers and guides, and the tool help line. */
export function ViewToggles() {
  const rulers = useStore((s) => s.ui.rulers ?? false);
  const help = useStore((s) => s.ui.toolHelp ?? true);
  return <>
    <IconButton icon={Ruler} label={`${rulers ? 'Hide' : 'Show'} page rulers and guides (Shift+R)`} size="sm" active={rulers} aria-pressed={rulers} onClick={() => setUi({ rulers: !rulers })} />
    <IconButton icon={HelpCircle} label={`${help ? 'Hide' : 'Show'} tool help`} size="sm" active={help} aria-pressed={help} onClick={() => setUi({ toolHelp: !help })} />
  </>;
}

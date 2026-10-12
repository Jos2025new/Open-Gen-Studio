import type { DesignTool } from './design/rules';

/** Designer tool keys: the keyboard handler and Settings → Shortcuts both read this map, so they never drift. */
export const DESIGN_TOOL_KEYS: Record<string, DesignTool> = { v: 'move', h: 'hand', m: 'select', i: 'eyedropper', b: 'brush', g: 'fill', u: 'gradient', p: 'lineart', e: 'eraser', r: 'rect', o: 'ellipse', l: 'line', t: 'text', k: 'ruler' };

/** One name per tool; typed as a complete record, so a new tool cannot be left out (the inventory test reads it). */
export const TOOL_NAMES: Record<DesignTool, string> = {
  move: 'Edit', hand: 'Pan', select: 'Select pixels', eyedropper: 'Eyedropper', brush: 'Brush', fill: 'Fill', gradient: 'Gradient', lineart: 'Lineart', eraser: 'Eraser', rect: 'Rectangle', ellipse: 'Ellipse', polygon: 'Polygon', line: 'Line', curve: 'Curve', arrow: 'Arrow', text: 'Text', ruler: 'Ruler',
};

export interface ShortcutGroup {
  title: string;
  items: Array<{ keys: string; action: string }>;
}

/** Every keyboard shortcut of the app, by canvas (shown in Settings → Shortcuts). "Mod" = Ctrl, or ⌘ on a Mac. */
export function shortcutGroups(): ShortcutGroup[] {
  return [
    {
      title: 'Testing',
      items: [{ keys: 'Mod + Alt + P', action: 'Start or stop a performance trace (logs/trace-…jsonl)' }],
    },
    {
      title: 'Prompt and chat',
      items: [
        { keys: 'Enter', action: 'Send or generate' },
        { keys: 'Shift + Enter', action: 'New line' },
      ],
    },
    {
      title: 'Viewer',
      items: [
        { keys: '← →', action: 'Previous / next result' },
        { keys: 'Esc', action: 'Close' },
      ],
    },
    {
      title: 'Nodes',
      items: [
        { keys: 'Mod + Z', action: 'Undo' },
        { keys: 'Mod + Y', action: 'Redo (also Mod + Shift + Z)' },
        { keys: 'Mod + C / X / V', action: 'Copy, cut, paste nodes (paste also takes images)' },
        { keys: 'Mod + G', action: 'Group the selected nodes' },
        { keys: 'Mod + Shift + G', action: 'Ungroup' },
        { keys: 'Delete or Backspace', action: 'Delete the selection' },
      ],
    },
    {
      title: 'Designer',
      items: [
        ...Object.entries(DESIGN_TOOL_KEYS).map(([key, tool]) => ({ keys: key.toUpperCase(), action: TOOL_NAMES[tool] })),
        { keys: 'Space (hold)', action: 'Pan' },
        { keys: 'Alt-click (Brush, Fill)', action: 'Pick a color from the canvas' },
        { keys: 'Ctrl+A / Ctrl+D', action: 'Select all pixels / deselect' },
        { keys: 'Ctrl+Shift+I', action: 'Invert the selection' },
        { keys: 'Ctrl+J', action: 'Selected pixels to a new layer' },
        { keys: 'Ctrl+G', action: 'Group the selected layers' },
        { keys: 'Shift+R', action: 'Show or hide rulers and guides' },
        { keys: 'Delete (with a selection)', action: 'Erase the selected pixels' },
        { keys: 'Mod + Z', action: 'Undo' },
        { keys: 'Mod + Shift + Z', action: 'Redo' },
        { keys: 'Delete', action: 'Delete the active layer' },
        { keys: 'Mod + C / V', action: 'Copy a layer\'s pixels, paste images' },
        { keys: 'Alt (while moving)', action: 'Move without snapping' },
        { keys: 'Alt + drag (Lineart)', action: 'Bend a stroke' },
        { keys: 'Double-click (Edit)', action: 'Edit a shape\'s handles or a path\'s nodes; Esc to finish' },
        { keys: 'Shift-click / Shift-drag (nodes)', action: 'Toggle a node / add nodes with a marquee; Ctrl-drag selects outside; Ctrl+Shift-drag removes inside' },
        { keys: 'Mod+A (nodes)', action: 'Select every path node' },
        { keys: 'Arrow keys (nodes)', action: 'Move selected nodes 2 document px; Shift: 20 px; Alt: 1 screen px' },
        { keys: 'Esc (nodes)', action: 'Clear selected nodes; Esc again finishes editing' },
        { keys: 'Ctrl + drag a corner handle', action: 'Both corner radii together' },
        { keys: 'Shift+C / Shift+S / Shift+Y (nodes)', action: 'Cusp, smooth or symmetric node' },
        { keys: 'Shift+L / Shift+U (nodes)', action: 'Segments between selected nodes to line / curve' },
        { keys: 'Shift+J / Alt+J (nodes)', action: 'Join selected ends or weld adjacent nodes / join ends with a segment' },
        { keys: 'Shift+B (nodes)', action: 'Break the path at the selected nodes' },
        { keys: 'Delete / Ctrl+Delete (nodes)', action: 'Delete selected nodes keeping the shape / joining straight' },
      ],
    },
    {
      title: 'Sketch',
      items: [
        { keys: 'Mod + Z', action: 'Undo' },
        { keys: 'Mod + Shift + Z', action: 'Redo' },
        { keys: 'Esc', action: 'Close' },
      ],
    },
  ];
}

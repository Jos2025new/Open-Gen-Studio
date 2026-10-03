import type { DesignTool } from './design/rules';

/** Designer tool keys: the keyboard handler and Settings → Shortcuts both read this map, so they never drift. */
export const DESIGN_TOOL_KEYS: Record<string, DesignTool> = { v: 'move', h: 'hand', i: 'eyedropper', b: 'brush', g: 'fill', p: 'lineart', e: 'eraser', r: 'rect', o: 'ellipse', l: 'line', t: 'text' };

const TOOL_NAMES: Record<DesignTool, string> = {
  move: 'Edit', hand: 'Pan', eyedropper: 'Eyedropper', brush: 'Brush', fill: 'Fill', lineart: 'Lineart', eraser: 'Eraser', rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line', text: 'Text',
};

export interface ShortcutGroup {
  title: string;
  items: Array<{ keys: string; action: string }>;
}

/** Every keyboard shortcut of the app, by canvas (shown in Settings → Shortcuts). "Mod" = Ctrl, or ⌘ on a Mac. */
export function shortcutGroups(): ShortcutGroup[] {
  return [
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
        { keys: 'Mod + Z', action: 'Undo' },
        { keys: 'Mod + Shift + Z', action: 'Redo' },
        { keys: 'Delete', action: 'Delete the active layer' },
        { keys: 'Mod + C / V', action: 'Copy a layer\'s pixels, paste images' },
        { keys: 'Alt (while moving)', action: 'Move without snapping' },
        { keys: 'Alt + drag (Lineart)', action: 'Bend a stroke' },
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

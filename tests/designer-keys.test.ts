// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

const fx = vi.hoisted(() => ({
  ui: { rulers: false }, setUi: vi.fn(), deleteLayers: vi.fn(() => 0),
}));
vi.mock('../src/store/store', () => ({ toast: vi.fn(), saveNow: vi.fn(), setUi: fx.setUi, useStore: { getState: () => ({ ui: fx.ui }) } }));
vi.mock('../src/engine/design/objectOps', () => ({ deletePickedObjects: vi.fn(), layerObjects: () => [] }));
vi.mock('../src/engine/design/objectSelection', () => ({ objectPick: () => null, setObjectPick: vi.fn(), useShapeEdit: { getState: () => ({ byDoc: {} }) } }));
vi.mock('../src/engine/design/nudge', () => ({ nudgeObjects: vi.fn() }));
vi.mock('../src/engine/design/groups', () => ({ groupLayers: vi.fn() }));
vi.mock('../src/engine/design/selection', () => ({ layerSelection: () => ['layer'] }));
vi.mock('../src/engine/design/pixelSelection', () => ({ clearSelected: vi.fn(), getSelection: () => null, invertSelection: vi.fn(), selectAll: vi.fn(), selectionToLayer: vi.fn(), setSelection: vi.fn() }));
vi.mock('../src/components/designer/PathNodes', () => ({ deletePickedNode: () => false }));
vi.mock('../src/engine/design/actions', () => ({ deleteLayers: fx.deleteLayers, mergeDown: vi.fn(), redoDoc: vi.fn(), undoDoc: vi.fn() }));
vi.mock('../src/engine/design/doc', () => ({ activeLayer: (doc: any) => doc.layers[0] }));
vi.mock('../src/engine/design/history', () => ({ record: vi.fn() }));
vi.mock('../src/engine/design/rules', () => ({ toolBlockReason: () => null }));

import { designerKey } from '../src/components/designer/designerKeys';
import { DESIGN_TOOL_KEYS } from '../src/engine/shortcuts';

const doc = { id: 'doc', paintMode: 'design', activeLayerId: 'layer', layers: [{ id: 'layer', name: 'Layer' }] } as any;
function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = document) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}
function listen() { const listener = (event: Event) => designerKey(event as KeyboardEvent, 'session', doc); document.addEventListener('keydown', listener); return () => document.removeEventListener('keydown', listener); }
afterEach(() => { fx.setUi.mockClear(); fx.deleteLayers.mockClear(); document.body.innerHTML = ''; });

describe('Designer keyboard shortcuts', () => {
  it('runs every tool shortcut from a real keydown, even from another paint mode, without changing the document mode', () => {
    const stop = listen();
    try {
      for (const [key, tool] of Object.entries(DESIGN_TOOL_KEYS)) {
        fx.setUi.mockClear();
        press(key);
        expect(fx.setUi).toHaveBeenCalledWith({ tool });
        expect(doc.paintMode).toBe('design');
      }
    } finally { stop(); }
  });

  it.each(['Delete', 'Backspace'])('deletes picked layers on %s from a real keydown', (key) => {
    fx.deleteLayers.mockReturnValue(0);
    const stop = listen();
    try { expect(press(key).defaultPrevented).toBe(true); expect(fx.deleteLayers).toHaveBeenCalledWith('session', 'doc', ['layer']); }
    finally { stop(); }
  });

  it('keeps tool keys out of inputs, popovers, and modified shortcuts', () => {
    const stop = listen();
    try {
      const input = document.createElement('input'); document.body.append(input); input.focus();
      press('b', {}, input); expect(fx.setUi).not.toHaveBeenCalled(); input.remove();
      const popover = document.createElement('div'); popover.className = 'popover'; document.body.append(popover);
      press('b'); expect(fx.setUi).not.toHaveBeenCalled(); popover.remove();
      press('b', { ctrlKey: true }); press('b', { altKey: true }); press('b', { shiftKey: true });
      expect(fx.setUi).not.toHaveBeenCalled();
    } finally { stop(); }
  });

  it('honors the embedded tool allowlist', () => {
    const listener = (event: Event) => designerKey(event as KeyboardEvent, 'session', doc, new Set(['brush'] as any));
    document.addEventListener('keydown', listener);
    try { press('k'); expect(fx.setUi).not.toHaveBeenCalled(); }
    finally { document.removeEventListener('keydown', listener); }
  });
});

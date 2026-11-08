// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

const fx = vi.hoisted(() => ({
  ui: { rulers: false }, setUi: vi.fn(), deleteLayers: vi.fn(() => 0),
}));
vi.mock('../src/store/store', () => ({ toast: vi.fn(), saveNow: vi.fn(), setUi: fx.setUi, useStore: { getState: () => ({ ui: fx.ui }) } }));
vi.mock('../src/engine/design/multiObjectOps', () => ({ deletePicks: vi.fn(), lockedPickLayer: () => undefined, pickGroups: () => [] }));
vi.mock('../src/engine/design/objectSelection', () => ({ objectPicks: () => [], setObjectPick: vi.fn(), useShapeEdit: { getState: () => ({ byDoc: {} }) } }));
vi.mock('../src/engine/design/nudge', () => ({ nudgePicks: vi.fn() }));
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
  it('[ and ] step the brush and eraser size, AltGr included, and only in those tools', () => {
    const stop = listen();
    try {
      fx.ui = { rulers: false, tool: 'brush', brush: { size: 30, color: '#fff', opacity: 1 } } as any;
      expect(press(']').defaultPrevented).toBe(true);
      expect(fx.setUi).toHaveBeenLastCalledWith({ brush: expect.objectContaining({ size: 32 }) });
      press('[', { ctrlKey: true, altKey: true });
      expect(fx.setUi).toHaveBeenCalledTimes(1);
      press('[', { ctrlKey: true, altKey: true, modifierAltGraph: true });
      expect(fx.setUi).toHaveBeenCalledTimes(2);
      fx.ui = { rulers: false, tool: 'move', brush: { size: 30 } } as any;
      fx.setUi.mockClear();
      press(']');
      expect(fx.setUi).not.toHaveBeenCalled();
    } finally { fx.ui = { rulers: false } as any; stop(); }
  });

  it('Ctrl + / - / 0 zoom and fit, cancelled; not with Alt', () => {
    const stop = listen();
    const seen: Array<[string, unknown]> = [];
    const grab = (name: string) => (ev: Event) => seen.push([name, (ev as CustomEvent).detail]);
    const zoom = grab('zoom'), fit = grab('fit');
    window.addEventListener('ogs:designer-zoom', zoom); window.addEventListener('ogs:designer-fit', fit);
    try {
      expect(press('=', { ctrlKey: true }).defaultPrevented).toBe(true);
      press('+', { ctrlKey: true, shiftKey: true });
      press('-', { metaKey: true });
      press('0', { ctrlKey: true });
      press('x', { ctrlKey: true, code: 'NumpadAdd' });
      press('=', { ctrlKey: true, altKey: true });
      expect(seen).toEqual([['zoom', 1.25], ['zoom', 1.25], ['zoom', 0.8], ['fit', undefined], ['zoom', 1.25]]);
      seen.length = 0;
      const inInput = document.body.appendChild(document.createElement('input'));
      press('=', { ctrlKey: true }, inInput);
      expect(seen).toEqual([]);
    } finally { window.removeEventListener('ogs:designer-zoom', zoom); window.removeEventListener('ogs:designer-fit', fit); stop(); }
  });

  it('opens Export with Ctrl or Command plus Shift+E and keeps editable fields out of board shortcuts', () => {
    const stop = listen();
    const open = vi.fn();
    window.addEventListener('ogs:designer-export', open);
    try {
      expect(press('E', { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true);
      expect(press('E', { metaKey: true, shiftKey: true }).defaultPrevented).toBe(true);
      expect(press('E', { ctrlKey: true, shiftKey: true, altKey: true }).defaultPrevented).toBe(false);
      const input = document.body.appendChild(document.createElement('input'));
      expect(press('E', { ctrlKey: true, shiftKey: true }, input).defaultPrevented).toBe(false);
      expect(open).toHaveBeenCalledTimes(2);
    } finally { window.removeEventListener('ogs:designer-export', open); stop(); }
  });

  it('M in Select cycles its shape; elsewhere it picks Select', () => {
    const stop = listen();
    try {
      fx.ui = { rulers: false, tool: 'select', selectShape: 'rect' } as any;
      press('m');
      expect(fx.setUi).toHaveBeenLastCalledWith({ selectShape: 'ellipse' });
      fx.ui = { rulers: false, tool: 'select', selectShape: 'wand' } as any;
      press('m');
      expect(fx.setUi).toHaveBeenLastCalledWith({ selectShape: 'rect' });
      fx.ui = { rulers: false, tool: 'brush' } as any;
      press('m');
      expect(fx.setUi).toHaveBeenLastCalledWith({ tool: 'select' });
    } finally { fx.ui = { rulers: false } as any; stop(); }
  });

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

  it.each(['Delete', 'Backspace'])('holding %s deletes the picked layers once, not one layer per key repeat', (key) => {
    const stop = listen();
    try {
      press(key);
      press(key, { repeat: true });
      press(key, { repeat: true });
      expect(fx.deleteLayers).toHaveBeenCalledTimes(1);
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

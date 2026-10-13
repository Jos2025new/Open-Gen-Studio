import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesignDoc, Layer } from '../src/engine/types';

const fx = vi.hoisted(() => ({ doc: null as unknown as DesignDoc, updates: [] as Array<(d: DesignDoc) => DesignDoc>, recorded: 0 }));
vi.mock('../src/store/store', () => ({ setDoc: (_s: string, _d: string, fn: (d: DesignDoc) => DesignDoc) => { fx.updates.push(fn); } }));
vi.mock('../src/engine/design/actions', () => ({ getDoc: () => fx.doc }));
vi.mock('../src/engine/design/history', () => ({ record: () => { fx.recorded++; } }));

import { nudgeLayers } from '../src/engine/design/nudge';

const layer = (id: string, locked = false) => ({ id, type: 'raster', name: id, visible: true, locked, opacity: 1, blend: 'normal', x: 10, y: 10, width: 10, height: 10, pxWidth: 10, pxHeight: 10, rev: 0 } as unknown as Layer);

beforeEach(() => { fx.recorded = 0; fx.updates = []; fx.doc = { id: 'd', width: 100, height: 100, layers: [layer('a'), layer('b', true)] } as unknown as DesignDoc; });

describe('arrow keys nudge layers', () => {
  it('moves the unlocked picked layers and leaves a locked one where it is', () => {
    const r = nudgeLayers('s', 'd', ['a', 'b'], 1, 0);
    expect(r).toEqual({ moved: 1, locked: 1 });
    const out = fx.updates[0](fx.doc);
    expect((out.layers[0] as { x: number }).x).toBe(11);
    expect((out.layers[1] as { x: number }).x).toBe(10);
  });

  it('a burst of presses is one undo step; a pause starts a new one', () => {
    vi.useFakeTimers();
    fx.doc = { ...fx.doc, id: 'burst' };
    nudgeLayers('s', 'burst', ['a'], 1, 0);
    vi.advanceTimersByTime(100);
    nudgeLayers('s', 'burst', ['a'], 1, 0);
    expect(fx.recorded).toBe(1);
    vi.advanceTimersByTime(2000);
    nudgeLayers('s', 'burst', ['a'], 1, 0);
    expect(fx.recorded).toBe(2);
    vi.useRealTimers();
  });

  it('nothing moves and nothing is recorded when every picked layer is locked', () => {
    const r = nudgeLayers('s', 'd', ['b'], 5, 5);
    expect(r).toEqual({ moved: 0, locked: 1 });
    expect(fx.updates).toHaveLength(0);
    expect(fx.recorded).toBe(0);
  });
});

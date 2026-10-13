import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesignDoc, Layer } from '../src/engine/types';

// Arrows: the picked objects move in one undo step per burst; with nothing picked they pan the view.
const fx = vi.hoisted(() => ({ doc: null as unknown as DesignDoc, recorded: 0, committed: [] as Array<{ first: boolean; dx: number }> }));
vi.mock('../src/store/store', () => ({ setDoc: () => undefined }));
vi.mock('../src/engine/design/actions', () => ({ getDoc: () => fx.doc }));
vi.mock('../src/engine/design/history', () => ({ record: () => { fx.recorded++; } }));
vi.mock('../src/engine/design/objectOps', () => ({
  translateObjects: (l: Layer, _ids: string[], dx: number) => ({ ...l, dx }),
  commitObjects: (_s: string, _d: string, _next: Layer, first: boolean) => { fx.committed.push({ first, dx: 0 }); if (first) fx.recorded++; },
}));

import { nudgeObjects, panOffset } from '../src/engine/design/nudge';

const shape = (id: string, locked = false) => ({ id, type: 'vector', name: id, visible: true, locked, opacity: 1, blend: 'normal', shapes: [] } as unknown as Layer);

beforeEach(() => { fx.recorded = 0; fx.committed = []; fx.doc = { id: 'd', width: 100, height: 100, layers: [shape('a')] } as unknown as DesignDoc; });

describe('arrow keys on picked objects', () => {
  it('a burst of presses is one undo step; a pause starts a new one', () => {
    vi.useFakeTimers();
    fx.doc = { ...fx.doc, id: 'burst' };
    expect(nudgeObjects('s', 'burst', 'a', ['o1'], 1, 0)).toBe(true);
    vi.advanceTimersByTime(100);
    nudgeObjects('s', 'burst', 'a', ['o1'], 1, 0);
    expect(fx.committed.map((c) => c.first)).toEqual([true, false]);
    vi.advanceTimersByTime(2000);
    nudgeObjects('s', 'burst', 'a', ['o1'], 1, 0);
    expect(fx.committed.at(-1)!.first).toBe(true);
    vi.useRealTimers();
  });
  it('a locked layer does not move', () => {
    fx.doc = { ...fx.doc, id: 'lock', layers: [shape('a', true)] };
    expect(nudgeObjects('s', 'lock', 'a', ['o1'], 1, 0)).toBe(false);
    expect(fx.committed).toHaveLength(0);
  });
});

describe('arrow keys with nothing picked pan the view', () => {
  it('one step is 20 screen px, Shift 100 px, in the arrow direction', () => {
    expect(panOffset({ x: 0, y: 0 }, 1, 0, false)).toEqual({ x: 20, y: 0 });
    expect(panOffset({ x: 5, y: 5 }, 0, -1, true)).toEqual({ x: 5, y: -95 });
  });
});

import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { captureLines } from '../src/engine/agent/captureContext';
import type { GenSettings, Subject } from '../src/engine/types';

describe('the agent sees which saved style is selected', () => {
  it('names each', () => {
    const mk = (name: string, camera: string): Subject => ({ id: name, kind: 'style', name, capture: { camera, tone: 'warm', light: 'l', texture: 'x' } } as unknown as Subject);
    const lib = [mk('Alpha', 'cam A'), mk('Beta', 'cam B')];
    const comp = (style: string, camera: string) => ({ image: { settings: { count: 1, capture: { style, custom: { camera, tone: 'warm', light: 'l', texture: 'x' } } } as GenSettings }, video: { settings: { count: 1 } as GenSettings } });
    const a = captureLines(lib, comp('Alpha', 'cam A')).find((l) => l.startsWith('selected image'))!;
    const b = captureLines(lib, comp('Beta', 'cam B')).find((l) => l.startsWith('selected image'))!;
    expect(a).toContain('Alpha');
    expect(b).toContain('Beta');
    expect(a).not.toContain('a saved style');
  });
});

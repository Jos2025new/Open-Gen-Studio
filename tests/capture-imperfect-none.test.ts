import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { captureClause, cleanCapture } from '../src/engine/captureStyles';

describe('an explicit empty imperfect list means none', () => {
  it('survives cleanCapture and removes the preset timestamp', () => {
    const base = captureClause({ style: 'disposable' }, 'image')!;
    expect(base).toContain('date stamp');
    const sel = cleanCapture({ style: 'disposable', imperfect: [] })!;
    expect(sel.imperfect).toEqual([]);
    expect(captureClause(sel, 'image')).not.toContain('date stamp');
  });
  it('undefined still uses the preset; custom empty list survives', () => {
    expect(cleanCapture({ style: 'disposable' })!.imperfect).toBeUndefined();
    const cam = { camera: 'cam', tone: 't', light: 'l', texture: 'x' };
    expect(cleanCapture({ custom: { ...cam, imperfect: [] } })!.custom!.imperfect).toEqual([]);
    expect(cleanCapture({ custom: cam })!.custom).not.toHaveProperty('imperfect');
  });
});


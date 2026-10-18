import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { captureLines } from '../src/engine/agent/captureContext';
import { captureClause, cleanCapture } from '../src/engine/captureStyles';
import { normalizePlan, type PlanContext } from '../src/engine/plan';
import { local, LOCAL_IMAGE_REF, LOCAL_VIDEO_REF } from '../src/engine/providers/demo';
import type { GenSettings, MediaKind, Subject } from '../src/engine/types';

const models = await local.listModels(undefined);
const ctx = (): PlanContext => ({
  workspace: 'chat',
  getModel: async (ref) => {
    const model = models.find((m) => m.ref === ref);
    return model ? { model, schema: await local.loadSchema(model, undefined) } : null;
  },
  defaultModel: (kind: MediaKind) => (kind === 'image' ? LOCAL_IMAGE_REF : LOCAL_VIDEO_REF),
  defaultSettings: () => ({}),
  asset: () => undefined,
  layer: () => undefined,
});

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


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

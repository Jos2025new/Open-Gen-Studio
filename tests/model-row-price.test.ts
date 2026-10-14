import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined, setInterval, clearInterval }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { priceHint } from '../src/components/composer/ModelList';
import type { ModelSummary } from '../src/engine/types';

const base: ModelSummary = { ref: 'openrouter::acme/pic-1', provider: 'openrouter', id: 'acme/pic-1', name: 'Pic 1', kind: 'image', acceptsText: true, acceptsImage: false, tags: [] };

describe('price text in a model row (fix 1 display)', () => {
  it('an exact listed price has no mark', () => {
    expect(priceHint({ ...base, price: { skus: [{ unit: 'output', usd: 0.04 }] } })).toBe('$0.04/img');
  });
  it('an estimate is marked ≈ and a floor ≥', () => {
    expect(priceHint({ ...base, price: { skus: [{ unit: 'output', usd: 0.04 }], approximate: true } })).toMatch(/^≈ /);
    expect(priceHint({ ...base, price: { skus: [{ unit: 'output', usd: 0.04 }], lowerBound: true } })).toMatch(/^≥ /);
  });
  it('no price yet gives empty text (the row shows its loading state instead)', () => {
    expect(priceHint(base)).toBe('');
  });
});

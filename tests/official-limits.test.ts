import { afterEach, describe, expect, it } from 'vitest';
import { OFFICIAL_SHEETS, refsCap, withOfficialLimits } from '../src/engine/officialLimits';
import type { ModelSchema } from '../src/engine/types';

/*
 * The provider's own figure wins; the model maker's sheet stands in where the provider is silent (user, 2026-10-25:
 * «apostar por lo que la doc oficial dice sobre el modelo cuando no se puedan obtener los params exactos del proveedor»).
 */
const SHEET = { model: 'Test Model', kind: 'image' as const, match: /test-model/i, refsMax: 14, totalMax: 15, source: 'https://example.com/official' };
const saved = [...OFFICIAL_SHEETS];
afterEach(() => OFFICIAL_SHEETS.splice(0, OFFICIAL_SHEETS.length, ...saved));

const schema = (images: NonNullable<ModelSchema['slots']['images']>): ModelSchema => ({ ref: 'fal::test-model', params: [], slots: { prompt: 'prompt', images }, source: 'openapi' });
const model = { id: 'test-model/edit', name: 'Test Model', kind: 'image' as const };

describe('official sheet', () => {
  it('fills an assumed max and adds the per-call budget', () => {
    OFFICIAL_SHEETS.push(SHEET);
    const got = withOfficialLimits(schema({ key: 'image_urls', max: 10, min: 0, multiple: true, format: 'url', from: 'assumed' }), model).slots.images!;
    expect(got).toMatchObject({ max: 14, from: 'official', total: 15 });
  });
  it('never overrides what the provider declares', () => {
    OFFICIAL_SHEETS.push(SHEET);
    const got = withOfficialLimits(schema({ key: 'image_urls', max: 6, min: 0, multiple: true, format: 'url' }), model).slots.images!;
    expect(got.max).toBe(6);
    expect(got.from).toBeUndefined();
    expect(got.total).toBe(15);
  });
  it('no sheet: unchanged', () => {
    const s = schema({ key: 'image_urls', max: 10, min: 0, multiple: true, format: 'url', from: 'assumed' });
    expect(withOfficialLimits(s, model)).toBe(s);
  });
  it('references + results share the budget', () => {
    expect(refsCap({ max: 14, total: 15 }, 1)).toBe(14);
    expect(refsCap({ max: 14, total: 15 }, 6)).toBe(9);
    expect(refsCap({ max: 4 }, 6)).toBe(4);
  });
});

describe('the sheets that ship', () => {
  const sheet = (id: string, name = '') => OFFICIAL_SHEETS.find((s) => s.kind === 'image' && (s.match.test(id) || s.match.test(name)));
  it('Seedream: Lite takes 14, Pro or an unnamed variant 10, 4.x 14; all share 15 per call', () => {
    expect(sheet('bytedance-seed/seedream-5-lite')?.refsMax).toBe(14);
    expect(sheet('fal-ai/bytedance/seedream/v5/edit')?.refsMax).toBe(10);
    expect(sheet('bytedance-seed/seedream-4.5')).toMatchObject({ refsMax: 14, totalMax: 15 });
  });
  it('Nano Banana Pro by id or name; an unknown model has no sheet', () => {
    expect(sheet('google/gemini-3-pro-image')?.refsMax).toBe(14);
    expect(sheet('x', 'Nano Banana Pro')?.refsMax).toBe(14);
    expect(sheet('acme/unknown-image')).toBeUndefined();
  });
});

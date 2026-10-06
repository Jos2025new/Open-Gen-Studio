import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ layers: [] as string[], exists: true, targets: [] as string[], failFirst: false }));
vi.mock('../src/engine/design/actions', () => ({
  getDoc: () => state.exists ? { layers: [...state.layers] } : null,
  placeAsset: async (_sid: string, _doc: string, id: string, target: string) => {
    state.targets.push(target);
    if (state.failFirst && id === 'first') return null;
    if (target === 'base' && state.layers.length) state.layers[0] = id;
    else state.layers.push(id);
    return id;
  },
}));
import { placeImportedImages } from '../src/engine/design/importImages';

beforeEach(() => { state.layers = []; state.targets = []; state.exists = true; state.failFirst = false; });
describe('imported image placement', () => {
  it('keeps every image when importing into an empty document', async () => {
    await placeImportedImages('s', 'd', ['first', 'second', 'third']);
    expect(state.layers).toEqual(['first', 'second', 'third']);
    expect(state.targets).toEqual(['base', 'new', 'new']);
  });
  it('preserves an existing layer', async () => {
    state.layers = ['original'];
    await placeImportedImages('s', 'd', ['first', 'second']);
    expect(state.layers).toEqual(['original', 'first', 'second']);
  });
  it('still uses the base after the first placement fails', async () => {
    state.failFirst = true;
    await placeImportedImages('s', 'd', ['first', 'second', 'third']);
    expect(state.layers).toEqual(['second', 'third']);
    expect(state.targets).toEqual(['base', 'base', 'new']);
  });
  it('does not place images in a removed document', async () => {
    state.exists = false;
    await placeImportedImages('s', 'd', ['first']);
    expect(state.targets).toEqual([]);
  });
});

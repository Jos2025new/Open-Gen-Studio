import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  Object.assign(globalThis, {
    window: { setTimeout, clearTimeout, addEventListener: () => undefined },
    document: { addEventListener: () => undefined, visibilityState: 'visible' },
  });
  const blobs = new Map<string, Blob>();
  return {
    blobs,
    blobDb: {
      async get(key: string): Promise<Blob | undefined> { return blobs.get(key); },
      async set(key: string, value: Blob): Promise<void> { blobs.set(key, value); },
      async del(key: string): Promise<void> { blobs.delete(key); },
      async delMany(keys: string[]): Promise<void> { for (const k of keys) blobs.delete(k); },
    },
  };
});

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  blobDb: hoisted.blobDb,
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
  deleteAssetBlobs: async () => undefined,
}));

import { parseTokenAlias, validateTokens } from '../src/engine/libraryTokens';
import { createItem, saveItem } from '../src/engine/libraryVersions';
import type { KitTokens } from '../src/engine/libraryTypes';
import { createSession, useStore } from '../src/store/store';

beforeEach(() => {
  hoisted.blobs.clear();
  const s = createSession('S1');
  useStore.setState({ sessions: { [s.id]: s }, activeSessionId: s.id, library: [], assets: {}, generations: {} });
});

describe('Library tokens: flat grouped validation and alias checks', () => {
  it('validates coherent types/values and rejects bad values, missing/mismatched aliases, and cycles', () => {
    const tokens: KitTokens = {
      'color.brand': { type: 'color', value: '#ff5500', description: 'Brand orange' },
      'color.primario': { type: 'color', value: '{color.brand}' },
      'color.cta': { type: 'color', value: '{color.primario}' },
      'space.base': { type: 'dimension', value: '8px' },
      'space.md': { type: 'dimension', value: 16 },
      'space.card': { type: 'dimension', value: '{space.base}' },
      'font.heading': { type: 'fontFamily', value: 'Inter' },
      'scale.ratio': { type: 'number', value: 1.25 },
      'copy.brand': { type: 'string', value: 'Acme' },
    };

    expect(parseTokenAlias('{color.brand}')).toBe('color.brand');
    expect(parseTokenAlias('#ff5500')).toBeNull();
    expect(() => validateTokens(tokens)).not.toThrow();

    expect(() => validateTokens({ 'color.bad': { type: 'color', value: 42 } })).toThrow(/color/i);
    expect(() => validateTokens({ 'color.bad2': { type: 'color', value: 'not a color!' } })).toThrow(/color/i);
    expect(() => validateTokens({ 'space.bad': { type: 'dimension', value: 'Inter' } })).toThrow(/dimension/i);
    expect(() => validateTokens({ 'font.bad': { type: 'fontFamily', value: 12 } })).toThrow(/fontFamily/i);
    expect(() => validateTokens({ 'num.bad': { type: 'number', value: '12px' } })).toThrow(/number/i);
    expect(() => validateTokens({ 'str.bad': { type: 'string', value: 99 } })).toThrow(/string/i);
    expect(() => validateTokens({ 'bad..name': { type: 'string', value: 'x' } })).toThrow(/name/i);
    expect(() => validateTokens({ '': { type: 'string', value: 'x' } })).toThrow(/name/i);
    expect(() => validateTokens({ 'color.a': { type: 'color', value: '{color.missing}' } })).toThrow(/missing|exist/i);
    expect(() => validateTokens({ 'space.sm': { type: 'dimension', value: '4px' }, 'color.a': { type: 'color', value: '{space.sm}' } })).toThrow(/type/i);
    expect(() => validateTokens({ 'color.a': { type: 'color', value: '{color.a}' } })).toThrow(/cycle/i);
    expect(() => validateTokens({ 'color.a': { type: 'color', value: '{color.b}' }, 'color.b': { type: 'color', value: '{color.c}' }, 'color.c': { type: 'color', value: '{color.a}' } })).toThrow(/cycle/i);
  });

  it('validates tokens on createItem and saveItem', async () => {
    await expect(createItem({ name: 'BadDS', kind: 'design-system', space: 'library', by: 'user', tokens: { 'color.a': { type: 'color', value: '{color.nope}' } } })).rejects.toThrow(/missing|exist/i);
    const { subject: kit } = await createItem({ name: 'GoodDS', kind: 'design-system', space: 'library', by: 'user', tokens: { 'color.primario': { type: 'color', value: '#2244ff' } } });
    await expect(saveItem({ subjectId: kit.id, mode: 'overwrite', space: 'library', by: 'user', tokens: { 'color.a': { type: 'color', value: '{color.b}' }, 'color.b': { type: 'color', value: '{color.a}' } } })).rejects.toThrow(/cycle/i);
    await expect(saveItem({ subjectId: kit.id, mode: 'overwrite', space: 'library', by: 'user', tokens: { 'num.x': { type: 'number', value: 'bad' } } })).rejects.toThrow(/number/i);
  });
});

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

import { deleteToken, parseTokenAlias, renameToken, resolveTokens, validateTokens } from '../src/engine/libraryTokens';
import { createKit, saveKit, updateKit } from '../src/engine/libraryVersions';
import type { KitTokens } from '../src/engine/libraryTypes';
import { createSession, useStore } from '../src/store/store';
import { run } from '../src/engine/commands';

beforeEach(() => {
  hoisted.blobs.clear();
  const s = createSession('S1');
  useStore.setState({ sessions: { [s.id]: s }, activeSessionId: s.id, library: [], assets: {}, generations: {} });
});

describe('Part 1: flat grouped tokens, validation, pure resolution, delete & rename', () => {
  it('validates coherent types/values, resolves chained aliases purely, and rejects bad values, missing/mismatched aliases, and cycles', () => {
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

    const resolved = resolveTokens(tokens);
    expect(resolved).toEqual({
      'color.brand': '#ff5500',
      'color.primario': '#ff5500',
      'color.cta': '#ff5500',
      'space.base': '8px',
      'space.md': 16,
      'space.card': '8px',
      'font.heading': 'Inter',
      'scale.ratio': 1.25,
      'copy.brand': 'Acme',
    });

    // Incoherent type/value rejected
    expect(() => validateTokens({ 'color.bad': { type: 'color', value: 42 } })).toThrow(/color/i);
    expect(() => validateTokens({ 'color.bad2': { type: 'color', value: 'not a color!' } })).toThrow(/color/i);
    expect(() => validateTokens({ 'space.bad': { type: 'dimension', value: 'Inter' } })).toThrow(/dimension/i);
    expect(() => validateTokens({ 'font.bad': { type: 'fontFamily', value: 12 } })).toThrow(/fontFamily/i);
    expect(() => validateTokens({ 'num.bad': { type: 'number', value: '12px' } })).toThrow(/number/i);
    expect(() => validateTokens({ 'str.bad': { type: 'string', value: 99 } })).toThrow(/string/i);

    // Invalid token name rejected
    expect(() => validateTokens({ 'bad..name': { type: 'string', value: 'x' } })).toThrow(/name/i);
    expect(() => validateTokens({ '': { type: 'string', value: 'x' } })).toThrow(/name/i);

    // Missing alias target rejected
    expect(() => validateTokens({ 'color.a': { type: 'color', value: '{color.missing}' } })).toThrow(/missing|exist/i);

    // Type mismatch on alias rejected
    expect(() => validateTokens({
      'space.sm': { type: 'dimension', value: '4px' },
      'color.a': { type: 'color', value: '{space.sm}' },
    })).toThrow(/type/i);

    // Self-cycle and indirect cycle rejected
    expect(() => validateTokens({ 'color.a': { type: 'color', value: '{color.a}' } })).toThrow(/cycle/i);
    expect(() => validateTokens({
      'color.a': { type: 'color', value: '{color.b}' },
      'color.b': { type: 'color', value: '{color.c}' },
      'color.c': { type: 'color', value: '{color.a}' },
    })).toThrow(/cycle/i);
  });

  it('deleteToken inlines resolved value into referring aliases; renameToken updates all aliases', () => {
    const tokens: KitTokens = {
      'color.brand': { type: 'color', value: '#112233' },
      'color.primary': { type: 'color', value: '{color.brand}' },
      'color.cta': { type: 'color', value: '{color.primary}' },
    };

    // Deleting a referenced token replaces referring aliases with the resolved value
    const afterDel = deleteToken(tokens, 'color.brand');
    expect(afterDel['color.brand']).toBeUndefined();
    expect(afterDel['color.primary']).toEqual({ type: 'color', value: '#112233' });
    expect(afterDel['color.cta']).toEqual({ type: 'color', value: '{color.primary}' });
    expect(resolveTokens(afterDel)['color.cta']).toBe('#112233');

    // Deleting middle alias also inlines its resolved value into direct referrers
    const afterDelMid = deleteToken(tokens, 'color.primary');
    expect(afterDelMid['color.primary']).toBeUndefined();
    expect(afterDelMid['color.cta']).toEqual({ type: 'color', value: '#112233' });

    // Renaming updates all aliases referencing oldName
    const afterRename = renameToken(tokens, 'color.brand', 'color.accent');
    expect(afterRename['color.brand']).toBeUndefined();
    expect(afterRename['color.accent']).toEqual({ type: 'color', value: '#112233' });
    expect(afterRename['color.primary']).toEqual({ type: 'color', value: '{color.accent}' });
    expect(resolveTokens(afterRename)['color.cta']).toBe('#112233');

    // Renaming to colliding or invalid name rejected
    expect(() => renameToken(tokens, 'color.brand', 'color.primary')).toThrow(/exists/i);
    expect(() => renameToken(tokens, 'color.missing', 'color.x')).toThrow(/not found|exist/i);
  });

  it('validates tokens on createKit, updateKit, saveKit, and library.kit.* commands', async () => {
    await expect(createKit({
      name: 'BadDS', kind: 'design-system', space: 'library', by: 'user',
      tokens: { 'color.a': { type: 'color', value: '{color.nope}' } },
    })).rejects.toThrow(/missing|exist/i);

    const { subject: kit } = await createKit({
      name: 'GoodDS', kind: 'design-system', space: 'library', by: 'user',
      tokens: { 'color.primario': { type: 'color', value: '#2244ff' } },
    });

    await expect(updateKit(kit.id, {
      tokens: {
        'color.a': { type: 'color', value: '{color.b}' },
        'color.b': { type: 'color', value: '{color.a}' },
      },
    })).rejects.toThrow(/cycle/i);

    await expect(saveKit({
      subjectId: kit.id, mode: 'overwrite', space: 'library', by: 'user',
      tokens: { 'num.x': { type: 'number', value: 'bad' } },
    })).rejects.toThrow(/number/i);

    const cmdOk = await run({
      cmd: 'library.kit.update',
      args: {
        id: kit.id,
        tokens: {
          'color.primario': { type: 'color', value: '#2244ff' },
          'color.cta': { type: 'color', value: '{color.primario}', description: 'Button fill' },
        },
      },
    }, { caller: 'agent' });
    expect(cmdOk.ok).toBe(true);
  });
});

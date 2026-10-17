import { describe, expect, it, vi } from 'vitest';
import { DRAFT, HQ, draftAnswer, draftGate, draftMode, highestResolution, lowestResolution, modeResolution, unlockNote } from '../src/engine/agent/draftFirst';
import { improvePlan } from '../src/engine/improveShot';
import { useStore } from '../src/store/store';
import type { DraftMode } from '../src/engine/agent/draftFirst';
import type { FeedItem, Generation, ModelSchema } from '../src/engine/types';

vi.hoisted(() => {
  Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } });
});
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async (id: string) => id,
}));

const card = (draft: DraftMode | undefined, status: 'confirmed' | 'skipped' | 'pending' = 'confirmed'): FeedItem => ({ id: 's', createdAt: 1, workspace: 'chat', type: 'settings', sections: [], status, ...(draft ? { draft } : {}) }) as FeedItem;
const user = { id: 'u', createdAt: 1, workspace: 'chat', type: 'user', text: 'haz un video' } as FeedItem;
const video = { kind: 'video' };

describe('borrador primero (todo video), en la tarjeta de ajustes', () => {
  it('un plan con video espera la tarjeta confirmada; una imagen no', () => {
    expect(draftGate([video], [user], 'auto', false)).toMatch(/confirm_settings/);
    expect(draftGate([{ kind: 'image' }], [user], 'auto', false)).toBeNull();
  });
  it('omitida o pendiente no cuenta; Direct no tiene tarjetas', () => {
    expect(draftGate([video], [user, card(draftMode('draft'), 'skipped')], 'guided', false)).not.toBeNull();
    expect(draftGate([video], [user, card(draftMode('draft'), 'pending')], 'guided', false)).not.toBeNull();
    expect(draftGate([video], [user], 'direct', false)).toBeNull();
  });
  it('Borrador, Alta calidad y texto libre pasan; texto libre vacío no', () => {
    for (const m of [draftMode('draft'), draftMode('hq'), draftMode('other', 'mejor un plano más largo')]) expect(draftGate([video], [user, card(m)], 'auto', false)).toBeNull();
    expect(draftGate([video], [user, card(draftMode('other', '  '))], 'auto', false)).not.toBeNull();
  });
  it('la respuesta de una petición anterior no vale, salvo en una revisión', () => {
    const feed = [card(draftMode('hq')), user];
    expect(draftAnswer(feed)).toBeUndefined();
    expect(draftGate([video], feed, 'auto', false)).not.toBeNull();
    expect(draftGate([video], feed, 'auto', true)).toBeNull();
  });
  it('la app fija la resolución: Borrador la más baja (480p) y bloqueada; Alta calidad desbloqueada', () => {
    expect(draftMode('draft').locked).toBe(true);
    expect(draftMode('hq').locked).toBe(false);
    expect(draftMode('other', 'x').locked).toBe(false);
    expect(lowestResolution(['720p', '480p', '1080p'])).toBe('480p');
    expect(lowestResolution(['1080p', '720p'])).toBe('720p');
    expect(highestResolution(['480p', '1080p', '720p'])).toBe('1080p');
    expect(modeResolution(draftMode('draft'), ['480p', '720p'], '720p')).toBe('480p');
    expect(modeResolution(draftMode('hq'), ['480p', '720p', '1080p'], '720p')).toBe('720p');
    expect(modeResolution(draftMode('hq'), ['480p', '720p'], '480p')).toBe('720p');
    expect(modeResolution(draftMode('other', 'x'), ['480p', '720p'])).toBeUndefined();
    expect(DRAFT).toBe('Borrador');
    expect(HQ).toBe('Alta calidad');
  });
  it('la nota de desbloqueo es un hecho con la resolución elegida', () => {
    expect(unlockNote('720p')).toMatch(/desbloqueó la resolución de borrador y eligió 720p/);
    expect(unlockNote('720p')).toMatch(/no la cuestiones/);
  });
});

describe('Mejorar esta toma', () => {
  const ref = 'fal::veo/test';
  const schema = (options: string[]) => ({ ref, params: [{ key: 'resolution', label: 'Resolution', role: 'resolution', type: 'enum', options, default: options[0] }], source: 'openapi' }) as unknown as ModelSchema;
  const gen = (resolution: string | undefined, over: Partial<Generation> = {}) => ({ id: 'g', kind: 'video', modelRef: ref, status: 'done', assetIds: ['a'], settings: { count: 1, resolution, seed: 7 }, inputs: { refs: [] }, ...over }) as Generation;
  const install = (options: string[]) => { const st = useStore.getState(); useStore.setState({ catalog: { ...st.catalog, schemas: { ...st.catalog.schemas, [ref]: schema(options) } } }); };
  it('mismo prompt y semilla a 1080p cuando el modelo lo tiene', () => {
    install(['480p', '720p', '1080p']);
    expect(improvePlan(gen('480p'))).toEqual({ mode: 'rerender', resolution: '1080p' });
  });
  it('no ofrece mejora en 1080p, en operaciones, sin terminar ni en imágenes', () => {
    install(['480p', '1080p']);
    expect(improvePlan(gen('1080p'))).toBeNull();
    expect(improvePlan(gen('480p', { status: 'running' }))).toBeNull();
    expect(improvePlan(gen('480p', { op: { id: 'video_upscale', params: {}, sourceAssetId: 'a' } }))).toBeNull();
    expect(improvePlan(gen('480p', { kind: 'image' }))).toBeNull();
    expect(improvePlan(gen(undefined))).toBeNull();
  });
});

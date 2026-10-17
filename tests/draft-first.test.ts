import { describe, expect, it, vi } from 'vitest';
import { DRAFT_ID, DRAFT, HQ, draftAnswer, draftCanon, draftGate, isDraftCard } from '../src/engine/agent/draftFirst';
import { improvePlan } from '../src/engine/improveShot';
import { useStore } from '../src/store/store';
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

const card = (answer: string | undefined, status: 'answered' | 'skipped' | 'pending' = 'answered'): FeedItem => ({ id: 'q', createdAt: 1, workspace: 'chat', type: 'questions', questions: [], round: 1, maxRounds: 1, status, ...(answer ? { answers: { [DRAFT_ID]: answer } } : {}) }) as FeedItem;
const user = { id: 'u', createdAt: 1, workspace: 'chat', type: 'user', text: 'haz un video' } as FeedItem;
const video = { kind: 'video', purpose: 'draft' };

describe('borrador primero (todo video)', () => {
  it('un plan con video espera la tarjeta; una imagen no', () => {
    expect(draftGate([video], [user], 'auto', false)).toMatch(/draft_first/);
    expect(draftGate([{ kind: 'image' }], [user], 'auto', false)).toBeNull();
  });
  it('omitida o pendiente no cuenta; Direct no tiene tarjetas', () => {
    expect(draftGate([video], [user, card(undefined, 'skipped')], 'guided', false)).not.toBeNull();
    expect(draftGate([video], [user, card(DRAFT, 'pending')], 'guided', false)).not.toBeNull();
    expect(draftGate([video], [user], 'direct', false)).toBeNull();
  });
  it('Borrador exige purpose draft o resolución; Alta calidad y texto libre pasan', () => {
    expect(draftGate([{ kind: 'video' }], [user, card(DRAFT)], 'auto', false)).toMatch(/lowest resolution/);
    expect(draftGate([{ kind: 'video', resolution: '480p' }], [user, card(DRAFT)], 'auto', false)).toBeNull();
    expect(draftGate([{ kind: 'video' }], [user, card(HQ)], 'auto', false)).toBeNull();
    expect(draftGate([{ kind: 'video' }], [user, card('mejor un plano más largo')], 'auto', false)).toBeNull();
  });
  it('la respuesta de una petición anterior no vale, salvo en una revisión', () => {
    const feed = [card(HQ), user];
    expect(draftAnswer(feed)).toBeUndefined();
    expect(draftGate([video], feed, 'auto', false)).not.toBeNull();
    expect(draftGate([video], feed, 'auto', true)).toBeNull();
  });
  it('la app fija opciones y campo libre; la pregunta no gasta ronda', () => {
    const [q] = draftCanon([{ id: DRAFT_ID, question: 'x', options: ['a', 'b'] }]);
    expect(q.options).toEqual([DRAFT, HQ]);
    expect(q.allow_custom).toBe(true);
    expect(q.default).toBe(DRAFT);
    expect(isDraftCard({ questions: [{ id: DRAFT_ID }] })).toBe(true);
    expect(isDraftCard({ questions: [{ id: 'style' }] })).toBe(false);
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

import { describe, expect, it } from 'vitest';
import { describeAsset, findAssets, sinceTime, viewTargets } from '../src/engine/agent/assetSearch';
import type { Asset, Generation, Session } from '../src/engine/types';

const now = Date.parse('2026-10-02T12:00:00');
const asset = (id: string, extra: Partial<Asset>): Asset => ({ id, kind: 'image', mime: 'image/png', width: 832, height: 1248, sessionId: 's1', origin: 'generated', stored: true, favorite: false, createdAt: now - 3600e3, ...extra }) as Asset;
const assets: Record<string, Asset> = {
  img: asset('img', { generationId: 'g1' }),
  img2: asset('img2', { generationId: 'g1', createdAt: now - 3 * 86400e3 }),
  glb: asset('glb', { kind: 'model3d', mime: 'model/gltf-binary', generationId: 'g2', viewImageId: 'v1', createdAt: now - 600e3 }),
  v1: asset('v1', { origin: 'view3d', mime: 'image/jpeg', width: 1024, height: 1024, createdAt: now - 300e3 }),
  other: asset('other', { sessionId: 's2' }),
  mask: asset('mask', { origin: 'mask' }),
};
const generations = {
  g1: { id: 'g1', prompt: 'heroine character sheet', modelName: 'Nano Banana', modelRef: 'atlas::nb', settings: { count: 2, aspect: '3:2' }, inputs: { refs: [] }, assetIds: ['img', 'img2'], stepId: 's1' },
  g2: { id: 'g2', prompt: 'the heroine as a 3D model', modelName: 'TRELLIS.2', modelRef: 'nanogpt::trellis', settings: { count: 1 }, inputs: { refs: ['img'] }, assetIds: ['glb'] },
} as unknown as Record<string, Generation>;
const session = { id: 's1', feed: [], graph: { nodes: [], edges: [] } } as unknown as Session;
const find = (q: Parameters<typeof findAssets>[4]) => findAssets(session, 'chat', assets, generations, q, now);

describe('find_assets', () => {
  it('filters by kind, words (prompt, model, extension) and date; this session only, no masks', () => {
    expect(find({}).rows.map((a) => a.id)).toEqual(['v1', 'glb', 'img', 'img2']);
    expect(find({ kind: ['model3d'] }).rows.map((a) => a.id)).toEqual(['glb']);
    expect(find({ query: 'glb' }).rows.map((a) => a.id)).toEqual(['glb']);
    expect(find({ query: 'nano banana' }).rows.map((a) => a.id)).toEqual(['img', 'img2']);
    expect(find({ since: '24h' }).rows.map((a) => a.id)).toEqual(['v1', 'glb', 'img']);
    expect(find({ sort: 'oldest', limit: 1 }).text).toMatch(/^4 matches \(showing 1–1; use offset for more\)/);
    expect(sinceTime('7d', now)).toBe(now - 7 * 86400e3);
  });

  it('says what each thing is: a view image is the viewer\'s, a 3D model names its view image', () => {
    expect(describeAsset(assets.v1, assets, generations)).toMatch(/view image of 3D model asset:glb, rendered by the app's 3D viewer \(not by the 3D model provider\)/);
    expect(describeAsset(assets.glb, assets, generations)).toMatch(/3D model \.glb .*TRELLIS\.2 · "the heroine as a 3D model" · .*inputs asset:img · its view image: asset:v1/);
    expect(describeAsset(assets.img2, assets, generations)).toMatch(/Nano Banana #2 of 2 .*aspect 3:2, count 2 · plan step s1/);
  });

  it('view shows images as they are and a 3D model by its view image', () => {
    expect(viewTargets([assets.glb, assets.img])).toEqual([{ show: 'v1', note: '3D model asset:glb, shown by its view image asset:v1' }, { show: 'img', note: 'asset:img' }]);
  });
});

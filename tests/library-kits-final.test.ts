import { beforeEach, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  Object.assign(globalThis, {
    window: { setTimeout, clearTimeout, addEventListener: () => undefined },
    document: { addEventListener: () => undefined, visibilityState: 'visible' },
  });
  const blobs = new Map<string, Blob>();
  const assetBlobs = new Map<string, Blob>();
  const dims = new Map<Blob, { w: number; h: number }>();
  let onSetHook: ((key: string) => void | Promise<void>) | null = null;
  let onGetAssetHook: ((id: string) => void | Promise<void>) | null = null;
  return {
    blobs,
    assetBlobs,
    dims,
    setOnSet: (fn: ((key: string) => void | Promise<void>) | null) => { onSetHook = fn; },
    setOnGetAsset: (fn: ((id: string) => void | Promise<void>) | null) => { onGetAssetHook = fn; },
    blobDb: {
      async get(key: string): Promise<Blob | undefined> { return blobs.get(key); },
      async set(key: string, value: Blob): Promise<void> { if (onSetHook) await onSetHook(key); blobs.set(key, value); },
      async del(key: string): Promise<void> { blobs.delete(key); },
      async delMany(keys: string[]): Promise<void> { for (const k of keys) blobs.delete(k); },
    },
    getAssetBlob: async (id: string) => {
      if (onGetAssetHook) await onGetAssetHook(id);
      return assetBlobs.get(id);
    },
  };
});

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  blobDb: hoisted.blobDb,
  getAssetBlob: hoisted.getAssetBlob,
  putAssetBlob: async (id: string, b: Blob) => { hoisted.assetBlobs.set(id, b); },
  deleteAssetBlobs: async (ids: string[]) => { for (const id of ids) hoisted.assetBlobs.delete(id); },
}));

vi.mock('../src/lib/media', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/media')>('../src/lib/media');
  const fakeCanvas = (w: number, h: number) => ({
    width: w,
    height: h,
    getContext: () => ({ drawImage: () => undefined, clearRect: () => undefined }),
    toBlob: (cb: (b: Blob | null) => void) => cb(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })),
  }) as unknown as HTMLCanvasElement;
  return {
    ...actual,
    createCanvas: (w: number, h: number) => fakeCanvas(w, h),
    ctx2d: (c: HTMLCanvasElement) => c.getContext('2d'),
    blobToCanvas: async (blob: Blob) => {
      const d = hoisted.dims.get(blob);
      if (!d) throw new Error('corrupt image blob');
      return fakeCanvas(d.w, d.h);
    },
  };
});

vi.mock('../src/engine/design/render', async (orig) => ({
  ...await orig<typeof import('../src/engine/design/render')>(),
  drawDoc: () => undefined,
}));

import { createItem, libraryToDesigner, restoreItemVersion, saveItem } from '../src/engine/libraryVersions';
import { addTextLayer, getDoc, undoDoc } from '../src/engine/design/actions';
import { createSession, useStore } from '../src/store/store';
import { run } from '../src/engine/commands';
import type { Graph, Layer } from '../src/engine/types';

function resetStore() {
  const s = createSession('S1');
  useStore.setState({ sessions: { [s.id]: s }, activeSessionId: s.id, library: [], assets: {}, generations: {}, ui: { ...useStore.getState().ui, toasts: [] } });
  return s;
}

beforeEach(() => {
  hoisted.blobs.clear();
  hoisted.assetBlobs.clear();
  hoisted.dims.clear();
  hoisted.setOnSet(null);
  hoisted.setOnGetAsset(null);
});

const text = (id: string, t: string, x: number, y: number) => ({ id, position: { x, y }, data: { kind: 'text' as const, title: id, text: t } });

const graphOf = (...nodes: Graph['nodes']): Graph => ({ nodes, edges: [] });
const notesOf = (s: string, d: string) => getDoc(s, d)!.layers.flatMap(l => l.type === 'text' ? [l.text] : []);
it('opening a revision undoes its moves, additions and page growth together', async () => {
  const s = resetStore();
  const {subject} = await createItem({name:'Undo',kind:'moodboard',space:'library',by:'user',graph:graphOf(text('a','A',100,100),text('b','B',500,150))});
  const doc = await libraryToDesigner(s.id,subject.id), b = doc.layers[1] as Extract<Layer,{type:'text'}>;
  await saveItem({subjectId:subject.id,mode:'overwrite',space:'library',by:'user',graph:graphOf(text('a','A',100,100),text('b','B',540,150),text('c','C',900,450))});
  await libraryToDesigner(s.id,subject.id);
  const x = () => (getDoc(s.id,doc.id)!.layers[1] as typeof b).x;
  expect(notesOf(s.id,doc.id)).toEqual(['A','B','C']);
  expect(x()).toBeGreaterThan(b.x);
  expect(getDoc(s.id,doc.id)!.width).toBeGreaterThan(doc.width);
  undoDoc(s.id,doc.id);
  expect(notesOf(s.id,doc.id)).toEqual(['A','B']);
  expect(x()).toBe(b.x);
  expect(getDoc(s.id,doc.id)).toMatchObject({width:doc.width,height:doc.height});
});

for (const kind of ['design-system','brand-kit'] as const) it(`preserves separate layers for equal text in ${kind}`, async () => {
  const s = resetStore();
  const {subject} = await createItem({name:'Twins',kind,space:'library',by:'user',graph:graphOf(text('t1','Original',100,100))});
  const doc = await libraryToDesigner(s.id,subject.id);
  const own = addTextLayer(s.id,doc.id,'Same',{x:40,y:60,width:200},{});
  await saveItem({subjectId:subject.id,mode:'overwrite',space:'library',by:'user',graph:graphOf(text('t1','Original',100,100),text('t2','Same',500,500))});
  await libraryToDesigner(s.id,subject.id);
  const live = getDoc(s.id,doc.id)!;
  expect(notesOf(s.id,doc.id)).toEqual(['Original','Same','Same']);
  expect(live.board!.at.t2.layer).not.toBe(own);
});

it('rejects duplicate node IDs before publishing', async () => {
  const s = resetStore();
  const graph = { ...graphOf(text('dup','primero',100,100), text('dup','segundo',500,100),text('to','destino',100,500)), edges:[{id:'e',source:'dup',target:'to',sourceHandle:'out_ref',targetHandle:'sys_ref'}] };
  const res = await run({cmd:'library.item.create',on:{session:s.id},args:{name:'Dup',kind:'moodboard',space:'library',graph}},{caller:'agent'});
  expect(res).toMatchObject({ok:false,error:{message:expect.stringMatching(/duplicate.*dup/i)}});
  expect(useStore.getState().library).toEqual([]);
  expect(hoisted.blobs.size).toBe(0);
});

it.each(['missing','character'])('rejects new kit references to %s', async (id) => {
  const s = resetStore();
  useStore.setState({library:[{id:'character',name:'Character',kind:'character',refAssetIds:[]}]});
  const res = await run({cmd:'library.item.create',on:{session:s.id},args:{name:'A',kind:'brand-kit',space:'library',kits:[id]}},{caller:'agent'});
  expect(res.ok).toBe(false);
  expect(useStore.getState().library.map(x=>x.id)).toEqual(['character']);
  expect(hoisted.blobs.size).toBe(0);
});

it('revalidates a new kit reference at publication', async () => {
  resetStore();
  const {subject:child} = await createItem({name:'Child',kind:'brand-kit',space:'library',by:'user'});
  const {subject:parent} = await createItem({name:'Parent',kind:'brand-kit',space:'library',by:'user'});
  const keys = [...hoisted.blobs.keys()];
  hoisted.setOnSet(() => useStore.setState({library:[parent]}));
  await expect(saveItem({subjectId:parent.id,mode:'overwrite',space:'library',by:'user',kits:[child.id]})).rejects.toThrow(child.id);
  expect(useStore.getState().library).toEqual([parent]);
  expect([...hoisted.blobs.keys()]).toEqual(keys);
});

it('saves and restores a historical reference after the kit is deleted', async () => {
  resetStore();
  const {subject:child} = await createItem({name:'Child',kind:'brand-kit',space:'library',by:'user'});
  const {subject:parent} = await createItem({name:'Parent',kind:'brand-kit',space:'library',by:'user',kits:[child.id]});
  useStore.setState({library:[parent]});
  const saved = await saveItem({subjectId:parent.id,mode:'overwrite',space:'library',by:'user',name:'Renamed'});
  expect(saved.kits).toEqual([child.id]);
  await saveItem({subjectId:parent.id,mode:'overwrite',space:'library',by:'user',kits:[]});
  const restored = await restoreItemVersion({subjectId:parent.id,versionId:parent.versionId!,space:'library',by:'user'});
  expect(restored.kits).toEqual([child.id]);
});

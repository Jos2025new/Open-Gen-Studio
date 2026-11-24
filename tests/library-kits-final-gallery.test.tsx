// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const blobs = new Map<string, Blob>();
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  blobDb: {
    get: async (k: string) => blobs.get(k),
    set: async (k: string, b: Blob) => { blobs.set(k, b); },
    del: async (k: string) => { blobs.delete(k); },
    delMany: async (ks: string[]) => { for (const k of ks) blobs.delete(k); },
  },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
  peekAssetUrl: () => undefined,
  loadAssetUrl: async () => undefined,
  deleteAssetBlobs: async () => undefined,
}));
vi.mock('../src/components/ui/AssetMedia', () => ({
  AssetMedia: ({ assetId }: { assetId: string }) => createElement('span', { 'data-asset': assetId }),
}));

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createItem, saveItem } from '../src/engine/libraryVersions';
import { createSession, setUi, useStore } from '../src/store/store';
import { GalleryPanel } from '../src/components/gallery/GalleryPanel';
import type { Asset, Graph, Subject } from '../src/engine/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

let host: HTMLDivElement;
let root: Root;
const sid = () => useStore.getState().activeSessionId;
const q = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel)!;
beforeEach(() => {
  blobs.clear();
  localStorage.clear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const s = createSession('Gallery Kit Test');
  act(() => {
    useStore.setState({
      sessions: { [s.id]: s }, activeSessionId: s.id, library: [], assets: {}, generations: {},
    });
    setUi({ workspace: 'designer', home: false, panel: 'gallery', panelExpanded: true });
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = '';
});

import { SaveToLibrary } from '../src/components/gallery/SaveToLibrary';
import { libraryToNodes } from '../src/engine/flow/fromLibrary';
import { readKitVersion } from '../src/engine/libraryVersions';

it.each(['missing', 'stale', 'current'])('shows the appropriate Save warning for a %s group revision', async (revision) => {
  const sessionId = sid();
  const graph:Graph = {nodes:[{id:'t',position:{x:100,y:100},data:{kind:'text',title:'Nota',text:'antes'}}],edges:[]};
  const {subject} = await createItem({name:'Legacy',kind:'moodboard',space:'library',by:'user',graph});
  const {groupId} = libraryToNodes(sessionId,subject.id);
  const sess = useStore.getState().sessions[sessionId];
  const changed = await saveItem({subjectId:subject.id,mode:'overwrite',space:'library',by:'user',graph:{...graph,nodes:[{...graph.nodes[0],data:{...graph.nodes[0].data,kind:'text',text:'ahora'}}]}});
  const versionId = revision === 'missing' ? undefined : revision === 'stale' ? subject.versionId : changed.versionId;
  const group = { ...sess.graph.groups!.find(g => g.id === groupId)!, library: { subjectId: subject.id, ...(versionId ? { versionId } : {}) } };
  useStore.setState(st => ({ sessions: { ...st.sessions, [sessionId]: { ...sess, graph: { ...sess.graph, groups: [group] } } } }));
  let finish!:()=>void;
  const saved = new Promise<void>(r=>{finish=r});
  await act(async()=>root.render(createElement(SaveToLibrary,{space:'nodes',sessionId,group,onDone:finish})));
  expect(host.textContent?.includes('Changed since it was opened here')).toBe(revision !== 'current');
  await act(async()=>{q('button[type=submit]').click();await saved});
  const live = useStore.getState().library[0];
  expect(live.graph?.nodes[0].data).toMatchObject({text:'antes'});
  expect((await readKitVersion(changed.versionId!))?.graph?.nodes[0].data).toMatchObject({text:'ahora'});
});


it('uses the current cover without reading old assets, then falls back when the cover is gone', async () => {
  const image = (id: string): Asset => ({ id, sessionId: sid(), kind: 'image', mime: 'image/png', name: id, width: 200, height: 100, createdAt: 1, origin: 'upload', stored: true, favorite: false });
  let oldReads = 0;
  const board: Subject = {
    id: 'board', name: 'Board', kind: 'moodboard', refAssetIds: [], versionId: 'new',
    versions: [
      { id: 'old', at: 1, by: 'user', space: 'library', get assetIds() { oldReads++; return ['older']; } },
      { id: 'new', at: 2, by: 'user', space: 'library', assetIds: ['current'] },
    ],
  };
  await act(async () => {
    useStore.setState({ library: [board], assets: { current: image('current'), older: image('older') } });
    root.render(createElement(GalleryPanel));
  });
  oldReads = 0;
  await act(async () => q('.pc-source').click());
  await act(async () => {
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(b => b.textContent?.includes('Moodboards'))!.click();
  });
  expect(q('.lib-tile [data-asset="current"]')).toBeTruthy();
  expect(oldReads).toBe(0);
  await act(async () => useStore.setState({ assets: { older: image('older') } }));
  expect(q('.lib-tile [data-asset="older"]')).toBeTruthy();
  expect(oldReads).toBeGreaterThan(0);
});

it('omits the save warning when a draft has never had a version', async () => {
  const sessionId = sid();
  const graph: Graph = { nodes: [{ id: 't', position: { x: 100, y: 100 }, data: { kind: 'text', title: 'Note', text: 'Hi' } }], edges: [] };
  const { subject } = await createItem({ name: 'Draft', kind: 'moodboard', space: 'studio', by: 'user', sessionId, graph, draft: true });
  const { groupId } = libraryToNodes(sessionId, subject.id);
  const group = useStore.getState().sessions[sessionId].graph.groups!.find(g => g.id === groupId)!;
  expect([subject.versionId, group.library?.versionId]).toEqual([undefined, undefined]);
  await act(async () => root.render(createElement(SaveToLibrary, { space: 'nodes', sessionId, group, onDone: () => undefined })));
  expect(host.textContent).not.toContain('Changed since it was opened here');
});

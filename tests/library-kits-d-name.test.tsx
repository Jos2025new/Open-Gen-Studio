// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DocumentPicker } from '../src/components/designer/DocumentPicker';
import { EmbeddedDesigner } from '../src/components/studio/EmbeddedDesigner';
import { createDoc } from '../src/engine/design/doc';
import { addDoc } from '../src/engine/design/actions';
import { createItem, libraryToDesigner, libraryToStudio, renameItem, saveItem } from '../src/engine/libraryVersions';
import { createSession, useStore } from '../src/store/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

let host: HTMLDivElement;
let root: Root;
const sid = () => useStore.getState().activeSessionId;

beforeEach(() => {
  blobs.clear();
  localStorage.clear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const s = createSession('Doc Name Test');
  act(() => {
    useStore.setState({ sessions: { [s.id]: s }, activeSessionId: s.id, library: [], assets: {}, generations: {} });
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = '';
});

describe('Lote D Parte 4: document opened from Library carries the entry name', () => {
  it('sets doc.name to the Library entry name on open and on reopen after rename, shown in Designer and Studio', async () => {
    const srcDoc = createDoc('Poster Draft', 1080, 1080, null);
    addDoc(sid(), srcDoc);
    const created = await createItem({ name: 'Acme System', kind: 'design-system', space: 'designer', by: 'user', draft: true, open: false });
    await saveItem({ subjectId: created.subject.id, mode: 'overwrite', space: 'designer', by: 'user', sessionId: sid(), docId: srcDoc.id });

    const s2 = createSession('Open Target');
    act(() => { useStore.setState((st) => ({ sessions: { ...st.sessions, [s2.id]: s2 }, activeSessionId: s2.id })); });

    const openedD = await libraryToDesigner(s2.id, created.subject.id);
    expect(openedD.name).toBe('Acme System');
    await act(async () => root.render(createElement(DocumentPicker, { sessionId: s2.id, docs: [openedD], active: openedD })));
    expect(host.querySelector('.document-picker-toggle')?.textContent).toContain('Acme System');

    renameItem(created.subject.id, { name: 'Acme System v2' });
    const reopened = await libraryToStudio(s2.id, created.subject.id);
    expect(reopened.name).toBe('Acme System v2');
    await act(async () => root.render(createElement(EmbeddedDesigner)));
    expect(host.querySelector('.studio-designer-name')?.textContent).toBe('Acme System v2');
  });
});

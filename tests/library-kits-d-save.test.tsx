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
vi.mock('../src/components/ui/AssetMedia', () => ({
  AssetMedia: ({ assetId }: { assetId: string }) => createElement('span', { 'data-asset': assetId }),
}));
vi.mock('@xyflow/react', () => ({
  Handle: () => null,
  NodeToolbar: ({ children }: { children?: unknown }) => createElement('div', { className: 'mock-toolbar' }, children as never),
  Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
  useConnection: () => false,
  useUpdateNodeInternals: () => () => undefined,
  useStore: (sel: (s: { transform: [number, number, number] }) => unknown) => sel({ transform: [0, 0, 1] }),
}));

import { readFileSync } from 'node:fs';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EmbeddedFileMenu } from '../src/components/studio/EmbeddedFileMenu';
import { DesignerWorkspace } from '../src/components/designer/DesignerWorkspace';
import { GroupNode, Operations } from '../src/components/node/Operations';
import { StudioNode } from '../src/components/node/nodes';
import { AddNodeItems, NodeLibrary } from '../src/components/node/AddNodeItems';
import { createDoc } from '../src/engine/design/doc';
import { addDoc } from '../src/engine/design/actions';
import { renameGroup, setGroupColor } from '../src/engine/flow/arrange';
import { libraryToNodes, nodesToLibrary } from '../src/engine/flow/fromLibrary';
import { createItem, deleteItem, libraryToDesigner, libraryToStudio } from '../src/engine/libraryVersions';
import { createSession, setUi, useStore } from '../src/store/store';
import type { Graph, GraphNode } from '../src/engine/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

let host: HTMLDivElement;
let root: Root;
const sid = () => useStore.getState().activeSessionId;
const click = async (el: Element | null | undefined) => {
  await act(async () => { (el as HTMLElement).click(); });
};
const setVal = async (input: HTMLInputElement, v: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const findBtn = (text: string, rootEl: ParentNode = document) =>
  [...rootEl.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes(text));

beforeEach(() => {
  blobs.clear();
  localStorage.clear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const s = createSession('Save Kit Test');
  act(() => {
    useStore.setState({
      sessions: { [s.id]: s }, activeSessionId: s.id, library: [], assets: {}, generations: {},
    });
    setUi({ workspace: 'designer', home: false, panel: null });
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = '';
});

describe('Lote D Parte 2: SaveToLibrary, 3 integrations, GraphGroup.library, and part node body', () => {
  it('keeps SaveToLibrary in its own file under 90 lines', () => {
    const lines = readFileSync('src/components/gallery/SaveToLibrary.tsx', 'utf8').trimEnd().split('\n');
    expect(lines.length).toBeLessThanOrEqual(90);
  });

  it('2a: EmbeddedFileMenu saves new and linked docs to Library, prevents double-click, and Escape keeps work', async () => {
    const doc = createDoc('Studio Draft', 1080, 1080, null);
    addDoc(sid(), doc);
    await act(async () => root.render(createElement(EmbeddedFileMenu, { sessionId: sid(), docs: [doc], doc })));

    await click(host.querySelector('button[aria-label="File"]'));
    await click(findBtn('Save to Library'));
    const form = document.querySelector<HTMLFormElement>('form.subject-new')!;
    expect(form).not.toBeNull();

    // Escape closes without losing doc work
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.querySelector('form.subject-new')).toBeNull();
    expect(useStore.getState().sessions[sid()].docs.find((d) => d.id === doc.id)).toBeDefined();

    // Save new (double click must only save once)
    await click(host.querySelector('button[aria-label="File"]'));
    await click(findBtn('Save to Library'));
    const input = document.querySelector<HTMLInputElement>('form.subject-new input')!;
    await setVal(input, 'Studio Board');
    const submit = findBtn('Save to Library', document.querySelector('form.subject-new')!)!;
    await act(async () => {
      submit.click();
      submit.click();
    });
    const saved = useStore.getState().library.filter((s) => s.name === 'Studio Board');
    expect(saved).toHaveLength(1);
    expect(saved[0].versions?.length).toBe(1);

    // Linked doc offers Save (overwrite) and Save a copy
    const linkedDoc = await libraryToStudio(sid(), saved[0].id);
    await act(async () => root.render(createElement(EmbeddedFileMenu, { sessionId: sid(), docs: [linkedDoc], doc: linkedDoc })));
    await click(host.querySelector('button[aria-label="File"]'));
    await click(findBtn('Save to Library'));
    const f2 = document.querySelector('form.subject-new')!;
    expect(findBtn('Save a copy', f2)).toBeDefined();
    await click([...f2.querySelectorAll('button')].find((b) => b.textContent === 'Save'));
    expect(useStore.getState().library.find((s) => s.id === saved[0].id)?.versions?.length).toBe(2);
  });

  it('2b: DesignerWorkspace Save to gallery popover offers Save to Library as second option without extra topbar button', async () => {
    const slot = document.createElement('div');
    slot.id = 'workspace-actions';
    document.body.append(slot);
    const kit = await createItem({ name: 'Design Kit', kind: 'design-system', space: 'designer', by: 'user', sessionId: sid(), draft: false });
    await libraryToDesigner(sid(), kit.subject.id);
    await act(async () => root.render(createElement(DesignerWorkspace)));

    // Open existing Save to gallery popover (no extra Save to Library button on topbar)
    expect(slot.querySelector('button[aria-label="Save to Library"]')).toBeNull();
    await click(slot.querySelector('button[aria-label="Save to gallery"]'));
    await click(findBtn('Save to Library'));
    const form = document.querySelector('form.subject-new')!;
    expect(form).not.toBeNull();
    await click(findBtn('Save a copy', form));
    const copies = useStore.getState().library.filter((s) => s.copiedFrom === kit.subject.id);
    expect(copies).toHaveLength(1);
  });

  it('2c: GraphGroup.library is set by libraryToNodes/nodesToLibrary, preserved on edits, and Operations/GroupNode gate overwrite on whole group', async () => {
    const graph: Graph = {
      nodes: [
        { id: 'n1', position: { x: 0, y: 0 }, data: { kind: 'text', title: 'Note 1', text: 'Alpha' } },
        { id: 'n2', position: { x: 260, y: 0 }, data: { kind: 'text', title: 'Note 2', text: 'Beta' } },
      ],
      edges: [],
    };
    const { subject } = await createItem({ name: 'Flow Kit', kind: 'moodboard', space: 'nodes', by: 'user', graph, draft: false });
    const placed = libraryToNodes(sid(), subject.id);
    const curGraph = () => useStore.getState().sessions[sid()].graph;
    const grp = curGraph().groups!.find((g) => g.id === placed.groupId)!;
    expect(grp.library).toMatchObject({ subjectId: subject.id });

    // Preserved across group edits
    renameGroup(sid(), grp.id, 'Flow Kit Renamed');
    setGroupColor(sid(), grp.id, '#5ec8ff');
    const editedGrp = curGraph().groups!.find((g) => g.id === grp.id)!;
    expect(editedGrp.library).toMatchObject({ subjectId: subject.id });

    // Loose selection (plus extra node, not whole group): Save to Library offers only new, not overwrite/copy
    const extra: GraphNode = { id: 'extra', position: { x: 500, y: 0 }, data: { kind: 'text', title: 'Loose', text: 'Hi' } };
    useStore.setState((st) => ({
      sessions: { ...st.sessions, [sid()]: { ...st.sessions[sid()], graph: { ...curGraph(), nodes: [...curGraph().nodes, extra] } } },
    }));
    await act(async () => root.render(createElement(Operations, {
      sessionId: sid(), graph: curGraph(), ids: [placed.added[0].id, extra.id], sizes: new Map(), onSelect: () => undefined,
    })));
    await click(findBtn('Operations', host));
    await click(findBtn('Save to Library', host));
    const looseForm = document.querySelector('form.subject-new')!;
    expect(findBtn('Save a copy', looseForm)).toBeUndefined();
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });

    // Whole group in Operations: offers Save (overwrite) and Save a copy
    await act(async () => root.render(createElement(Operations, {
      sessionId: sid(), graph: curGraph(), ids: editedGrp.nodeIds, sizes: new Map(), onSelect: () => undefined,
    })));
    await click(findBtn('Save to Library', host));
    const grpForm = document.querySelector('form.subject-new')!;
    expect(findBtn('Save a copy', grpForm)).toBeDefined();
    await click([...grpForm.querySelectorAll('button')].find((b) => b.textContent === 'Save'));
    expect(useStore.getState().library.find((s) => s.id === subject.id)?.versions?.length).toBe(2);

    // GroupNode header also shows Save to Library when group came from Library, and survives deletion
    await act(async () => root.render(createElement(GroupNode, {
      id: editedGrp.id, type: 'group', selected: false, dragging: false, zIndex: 0,
      selectable: true, deletable: true, draggable: true, isConnectable: false,
      positionAbsoluteX: 0, positionAbsoluteY: 0,
      data: { group: editedGrp, sessionId: sid(), collapsed: false, problems: 0, toggle: () => undefined },
    })));
    expect(findBtn('Save to Library', host)).toBeDefined();

    // Saving an unlinked group via nodesToLibrary stamps library.subjectId on the group
    const plainGrpId = 'plain-grp';
    useStore.setState((st) => ({
      sessions: {
        ...st.sessions,
        [sid()]: {
          ...st.sessions[sid()],
          graph: { ...curGraph(), groups: [...(curGraph().groups ?? []), { id: plainGrpId, title: 'Plain', nodeIds: [extra.id] }] },
        },
      },
    }));
    const newSaved = await nodesToLibrary({ sessionId: sid(), mode: 'new', kind: 'moodboard', groupId: plainGrpId, name: 'Plain Saved' });
    expect(curGraph().groups?.find((g) => g.id === plainGrpId)?.library).toMatchObject({ subjectId: newSaved.id });

    // Deleting the linked Library item while open does not break GroupNode Save to Library
    await deleteItem(subject.id);
    await click(findBtn('Save to Library', host));
    const fallbackForm = document.querySelector('form.subject-new')!;
    expect(findBtn('Save a copy', fallbackForm)).toBeUndefined();
  });

  it('2d: renders part node body for color, style, and component without media placeholder, and keeps part out of add menus', async () => {
    const mkProps = (node: GraphNode) => ({
      id: node.id, type: 'studio', selected: false, dragging: false, zIndex: 0,
      selectable: true, deletable: true, draggable: true, isConnectable: true,
      positionAbsoluteX: 0, positionAbsoluteY: 0, data: { node, solo: false },
    });
    const colorNode: GraphNode = { id: 'p1', position: { x: 0, y: 0 }, data: { kind: 'part', partKind: 'color', title: 'Accent', color: '#ff3366' } };
    const styleNode: GraphNode = { id: 'p2', position: { x: 0, y: 0 }, data: { kind: 'part', partKind: 'style', title: 'Heading', styleType: 'text', values: { font: 'Inter', size: 24 } } };
    const compNode: GraphNode = { id: 'p3', position: { x: 0, y: 0 }, data: { kind: 'part', partKind: 'component', title: 'Hero Card', groupId: 'g1' } };

    await act(async () => root.render(createElement('div', null,
      createElement(StudioNode, mkProps(colorNode)),
      createElement(StudioNode, mkProps(styleNode)),
      createElement(StudioNode, mkProps(compNode)),
    )));
    expect(host.querySelector('.nc-empty')).toBeNull();
    const bodies = [...host.querySelectorAll('.nc .nc-text')];
    expect(bodies).toHaveLength(3);
    expect(bodies[0].querySelector<HTMLElement>('.group-swatch')?.style.background).toBeTruthy();
    expect(bodies[0].textContent).toContain('#ff3366');
    expect(bodies[1].textContent).toContain('font: Inter');
    expect(bodies[1].textContent).toContain('size: 24');
    expect(bodies[2].textContent).toContain('Hero Card');

    // part never appears in AddNodeItems or NodeLibrary
    await act(async () => root.render(createElement('div', null,
      createElement(AddNodeItems, { onPick: () => undefined }),
      createElement(NodeLibrary, { onPick: () => undefined }),
    )));
    expect(host.textContent?.toLowerCase()).not.toContain('part');
  });
});

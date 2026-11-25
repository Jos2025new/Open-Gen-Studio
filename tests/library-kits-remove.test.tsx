// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DesignerWorkspace } from '../src/components/designer/DesignerWorkspace';
import { EmbeddedFileMenu } from '../src/components/studio/EmbeddedFileMenu';
import { runDesignOutput } from '../src/components/designer/designerFile';
import { addDoc } from '../src/engine/design/actions';
import { createDoc } from '../src/engine/design/doc';
import { createSession, setUi, useStore } from '../src/store/store';

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  blobDb: { get: async () => undefined },
}));
vi.mock('../src/components/designer/Stage', () => ({ Stage: () => null }));
vi.mock('../src/components/designer/designerFile', async (original) => ({
  ...await original<typeof import('../src/components/designer/designerFile')>(),
  runDesignOutput: vi.fn(),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

let root: Root;
let host: HTMLDivElement;
let slot: HTMLDivElement;
const click = async (button?: Element | null) => {
  expect(button).toBeTruthy();
  await act(async () => { (button as HTMLButtonElement).click(); });
};
const button = (name: string, parent: ParentNode = document) =>
  [...parent.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? b.textContent?.trim()) === name);

beforeEach(() => {
  vi.mocked(runDesignOutput).mockClear();
  host = document.createElement('div');
  slot = document.createElement('div');
  slot.id = 'workspace-actions';
  document.body.append(host, slot);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  slot.remove();
});

it.each(['designer', 'studio'] as const)('%s offers one Save to Library flow with document-specific defaults', async (space) => {
  const s = createSession('Document save');
  const doc = createDoc('Draft', 640, 640, null);
  const linked = { ...createDoc('Board', 640, 640, null), library: { subjectId: 'board', versionId: 'v1' } };
  await act(async () => {
    useStore.setState({ sessions: { [s.id]: s }, activeSessionId: s.id, library: [{ id: 'board', name: 'Board', kind: 'moodboard', refAssetIds: [] }] });
    setUi({ home: false, panel: null, workspace: space === 'designer' ? 'designer' : 'chat' });
    addDoc(s.id, doc);
  });
  const open = async () => {
    if (space === 'studio') await click(button('File', host));
    const container = space === 'studio' ? document.querySelector('.popover')! : slot;
    const entries = [...container.querySelectorAll('button')].filter((b) => /^Save to (Library|gallery)/i.test(b.getAttribute('aria-label') ?? b.textContent?.trim() ?? ''));
    expect(entries.map((b) => b.getAttribute('aria-label') ?? b.textContent?.trim())).toEqual([space === 'studio' ? 'Save to Library…' : 'Save to Library']);
    await click(entries[0]);
  };
  const render = async (active: typeof doc) => {
    await act(async () => {
      root.render(space === 'designer' ? createElement(DesignerWorkspace) : createElement(EmbeddedFileMenu, { sessionId: s.id, doc: active, docs: [active] }));
    });
  };
  await render(doc);
  await open();
  expect(button('Image')?.getAttribute('aria-checked')).toBe('true');
  expect(runDesignOutput).not.toHaveBeenCalled();
  await click(button('Save'));
  expect(runDesignOutput).toHaveBeenCalledWith(s.id, doc.id, true, undefined);

  await act(async () => addDoc(s.id, linked));
  await render(linked);
  await open();
  expect(button('Editable')?.getAttribute('aria-checked')).toBe('true');
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Library item name');
  expect(button('Save a copy')).toBeDefined();
  await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  expect(document.querySelector('[aria-label="Library item name"]')).toBeNull();
  expect(document.activeElement).toBe(button(space === 'studio' ? 'File' : 'Save to Library'));
});

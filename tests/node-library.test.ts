// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  blobDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  getAssetBlob: async () => undefined,
  peekAssetUrl: () => undefined,
  loadAssetUrl: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NodeLibrary } from '../src/components/node/AddNodeItems';
import { readFileSync } from 'node:fs';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const onPick = vi.fn();
const onAsset = vi.fn();
const onImport = vi.fn();
beforeEach(async () => {
  onPick.mockReset(); onAsset.mockReset(); onImport.mockReset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(NodeLibrary, { onPick, onAsset, onImport })));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const sections = () => [...host.querySelectorAll('.node-lib-sec')].map((s) => s.getAttribute('aria-label'));
const labels = (section?: string) => [...host.querySelectorAll(`${section ? `.node-lib-sec[aria-label="${section}"] ` : ''}[role="option"]`)].map((o) => o.querySelector('.node-lib-text > span')?.textContent);
const field = () => host.querySelector<HTMLInputElement>('input[type="search"]')!;
const type = async (text: string) => act(async () => {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  set.call(field(), text);
  field().dispatchEvent(new Event('input', { bubbles: true }));
});
const key = async (k: string) => act(async () => { field().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); });
const chip = async (name: string) => act(async () => [...host.querySelectorAll<HTMLElement>('.node-lib-chip')].find((c) => c.textContent === name)!.click());

describe('Nodes library panel (Add node in the toolbox)', () => {
  it('lists Media, Nodes and Tools, each under a head with its count, with the search field focused', async () => {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(document.activeElement).toBe(field());
    expect(sections()).toEqual(['Media', 'Nodes', 'Tools']);
    expect(labels('Media')).toEqual(['Import images', 'Asset']);
    expect(labels('Nodes')).toEqual(['Text', 'Image', 'Video', 'Audio', '3D model']);
    expect(labels('Tools').length).toBeGreaterThan(3);
    const head = host.querySelector('.node-lib-sec[aria-label="Nodes"] .node-lib-head');
    expect(head?.textContent).toBe('Nodes5');
    expect(host.querySelector('[role="option"]')?.getAttribute('aria-selected')).toBe('true');
  });

  it('a kind chip keeps only that kind and its tools; search filters by name and keywords', async () => {
    await chip('Video');
    expect(host.querySelector('.node-lib-chip.is-on')?.textContent).toBe('Video');
    expect(labels('Nodes')).toEqual(['Video']);
    expect(sections()).not.toContain('Media');
    expect(host.querySelectorAll('[role="option"]:not(.k-video)').length).toBe(0);
    await chip('All');
    await type('song');
    expect(labels()).toEqual(['Audio']);
    await type('zzzz');
    expect(host.querySelector('.node-lib-empty')?.textContent).toBe('No nodes or tools match.');
  });

  it('↑↓ move the highlight (wrapping) and Enter adds the highlighted entry', async () => {
    await type('image');
    const first = labels()[0];
    expect(first).toBe('Import images');
    await key('ArrowDown');
    const at = () => host.querySelector('[role="option"][aria-selected="true"] .node-lib-text > span')?.textContent;
    expect(at()).toBe(labels()[1]);
    await key('ArrowUp'); await key('ArrowUp');
    expect(at()).toBe(labels().at(-1));
    await chip('All'); await type('');
    await key('ArrowDown'); await key('ArrowDown');
    expect(at()).toBe('Text');
    await key('Enter');
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0][0]).toMatchObject({ kind: 'text' });
  });

  it('Import images and Asset call their own handlers; a tool adds a tool node with its op', async () => {
    await act(async () => (host.querySelector('[role="option"]') as HTMLElement).click());
    expect(onImport).toHaveBeenCalledTimes(1);
    await act(async () => ([...host.querySelectorAll<HTMLElement>('[role="option"]')][1]).click());
    expect(onAsset).toHaveBeenCalledTimes(1);
    await act(async () => host.querySelector<HTMLElement>('.node-lib-sec[aria-label="Tools"] [role="option"]')!.click());
    expect(onPick.mock.calls[0][0]).toMatchObject({ kind: 'tool' });
    expect(onPick.mock.calls[0][0].op).toBeTruthy();
  });

  it('the toolbox popover hosts the library, and each kind tints its icon', () => {
    const ws = readFileSync('src/components/node/NodeWorkspace.tsx', 'utf8');
    expect(ws).toMatch(/className="node-lib-pop">\s*<NodeLibrary/);
    const css = readFileSync('src/styles/node.css', 'utf8');
    expect(css).toMatch(/\.node-lib-item\.k-video \{[^}]*--k:/);
  });
});

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
import { renderToStaticMarkup } from 'react-dom/server';
import { ReactFlowProvider } from '@xyflow/react';
import { AddNodeItems, NodeLibrary } from '../src/components/node/AddNodeItems';
import { KIND_ICON, StudioNode } from '../src/components/node/nodes';
import { NODE_UIS } from '../src/components/node/nodeUi';
import { newNodeData } from '../src/engine/flow/actions';
import { descriptorOf } from '../src/engine/nodecore/registry';
import type { GraphNodeData, PortType } from '../src/engine/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CREATIVE_KINDS = ['text', 'image', 'video', 'audio', 'model3d'] as const;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const mountMenu = async (props: { accepts?: PortType | null; onPick?: (data: GraphNodeData) => void; searchable?: boolean }) => {
  const onPick = vi.fn<(data: GraphNodeData) => void>(props.onPick);
  await act(async () => root.render(createElement(AddNodeItems, { accepts: props.accepts, onPick, searchable: props.searchable })));
  return onPick;
};

const menuItems = () => [...host.querySelectorAll<HTMLElement>('.menu-item')];
const menuLabels = () => menuItems().map((el) => el.querySelector('.menu-label')?.textContent);
const menuTip = (label: string) => menuItems().find((el) => el.querySelector('.menu-label')?.textContent === label)?.getAttribute('data-tip');
const libraryNodeItems = () => [...host.querySelectorAll<HTMLElement>('.node-lib-sec[aria-label="Nodes"] [role="option"]')];
const libraryNodeLabels = () => libraryNodeItems().map((el) => el.querySelector('.node-lib-text > span')?.textContent);

const typeQuery = async (text: string) => act(async () => {
  const input = host.querySelector<HTMLInputElement>('input[type="search"]')!;
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  set.call(input, text);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});

describe('node UI catalog (NODE_UIS)', () => {
  it('lists every addable creative kind exactly once, in menu/library order, backed by a descriptor', () => {
    expect(NODE_UIS.map((ui) => ui.kind)).toEqual([...CREATIVE_KINDS]);
    for (const kind of CREATIVE_KINDS) {
      expect(NODE_UIS.filter((ui) => ui.kind === kind)).toHaveLength(1);
      const ui = NODE_UIS.find((entry) => entry.kind === kind);
      expect(ui?.kind).toBe(kind);
      expect(ui?.chip).toBe(kind);
      expect(ui?.icon).toBe(KIND_ICON[kind]);
      expect(descriptorOf(kind)).toBeDefined();
    }
  });

  it('keeps the menu order, labels and port filtering for every accepts port type', async () => {
    await mountMenu({ accepts: null });
    expect(menuLabels()).toEqual(['Text', 'Image', 'Video', 'Audio', '3D model', 'Tool']);

    await mountMenu({ accepts: 'image' });
    expect(menuLabels()).toEqual(['Image', 'Video', '3D model', 'Tool']);

    await mountMenu({ accepts: 'audio' });
    expect(menuLabels()).toEqual(['Video', 'Tool']);

    await mountMenu({ accepts: 'text' });
    expect(menuLabels()).toEqual(['Image', 'Video', 'Audio', '3D model']);

    await mountMenu({ accepts: 'video' });
    expect(menuLabels()).toEqual(['Image', 'Video', 'Tool']);

    await mountMenu({ accepts: 'model3d' });
    expect(menuLabels()).toEqual(['Image', 'Video', '3D model', 'Tool']);
  });

  it('keeps contextual tips for every accepts port type', async () => {
    await mountMenu({ accepts: null });
    expect(menuTip('Text')).toBe('Prompt or copy that feeds other nodes');
    expect(menuTip('Image')).toBe('Generate images');
    expect(menuTip('Video')).toBe('Generate video');
    expect(menuTip('Audio')).toBe('Generate music or song lyrics');
    expect(menuTip('3D model')).toBe('Generate a GLB model from text or image');

    await mountMenu({ accepts: 'image' });
    expect(menuTip('Image')).toBe('Use it as a reference');
    expect(menuTip('Video')).toBe('Use it as the first frame');
    expect(menuTip('3D model')).toBe('Generate a GLB model from text or image');

    await mountMenu({ accepts: 'audio' });
    expect(menuTip('Video')).toBe('Use it as speech or soundtrack');

    await mountMenu({ accepts: 'text' });
    expect(menuTip('Image')).toBe('Generate images');
    expect(menuTip('Video')).toBe('Generate video');
    expect(menuTip('Audio')).toBe('Use it as the prompt of a song');
    expect(menuTip('3D model')).toBe('Generate a GLB model from text or image');

    await mountMenu({ accepts: 'video' });
    expect(menuTip('Image')).toBe('Generate images');
    expect(menuTip('Video')).toBe('Generate video');

    await mountMenu({ accepts: 'model3d' });
    expect(menuTip('Image')).toBe('Generate images');
    expect(menuTip('Video')).toBe('Generate video');
    expect(menuTip('3D model')).toBe('Generate a GLB model from text or image');
  });

  it('renders every catalog entry subline in NodeLibrary in order', async () => {
    await act(async () => root.render(createElement(NodeLibrary, { onPick: vi.fn() })));
    const rows = libraryNodeItems().map((el) => [
      el.querySelector('.node-lib-text > span')?.textContent,
      el.querySelector('.node-lib-text > small')?.textContent,
    ]);
    expect(rows).toEqual([
      ['Text', 'Prompt or copy that feeds other nodes'],
      ['Image', 'Generate images'],
      ['Video', 'Generate video'],
      ['Audio', 'Generate music or song lyrics'],
      ['3D model', 'Generate a GLB model from text or image'],
    ]);
  });

  it('filters every entry by its own menuKeywords in AddNodeItems and keywords in NodeLibrary', async () => {
    const allCreativeLabels = ['Text', 'Image', 'Video', 'Audio', '3D model'] as const;
    const menuKeywordCases: Array<[string, (typeof allCreativeLabels)[number]]> = [
      ['copy', 'Text'],
      ['reference', 'Image'],
      ['motion', 'Video'],
      ['lyrics', 'Audio'],
      ['glb', '3D model'],
    ];
    expect(menuKeywordCases).toHaveLength(NODE_UIS.length);

    await mountMenu({ accepts: null, searchable: true });
    for (const [query, expectedLabel] of menuKeywordCases) {
      await typeQuery(query);
      const shown = menuLabels();
      expect(shown, `menu query "${query}"`).toContain(expectedLabel);
      for (const other of allCreativeLabels) {
        if (other !== expectedLabel) expect(shown, `menu query "${query}" should exclude ${other}`).not.toContain(other);
      }
    }

    // Menu keeps its narrower menuKeywords (without 'voice'), while the library keeps 'voice'.
    await typeQuery('voice');
    expect(menuLabels()).not.toContain('Audio');

    await mountMenu({ accepts: 'audio', searchable: true });
    await typeQuery('frame');
    expect(menuLabels()).toEqual(['Video']);

    const libraryKeywordCases: Array<[string, (typeof allCreativeLabels)[number]]> = [
      ['copy', 'Text'],
      ['reference', 'Image'],
      ['motion', 'Video'],
      ['voice', 'Audio'],
      ['glb', '3D model'],
    ];
    expect(libraryKeywordCases).toHaveLength(NODE_UIS.length);

    await act(async () => root.render(createElement(NodeLibrary, { onPick: vi.fn() })));
    for (const [query, expectedLabel] of libraryKeywordCases) {
      await typeQuery(query);
      expect(libraryNodeLabels(), `library query "${query}"`).toEqual([expectedLabel]);
    }
  });

  it('clicking each creative entry calls onPick with newNodeData for that kind', async () => {
    const onPick = await mountMenu({ accepts: null });
    const expected: Array<[string, (typeof CREATIVE_KINDS)[number]]> = [
      ['Text', 'text'],
      ['Image', 'image'],
      ['Video', 'video'],
      ['Audio', 'audio'],
      ['3D model', 'model3d'],
    ];
    for (const [label, kind] of expected) {
      onPick.mockClear();
      const item = menuItems().find((el) => el.querySelector('.menu-label')?.textContent === label);
      expect(item, `menu item ${label}`).toBeDefined();
      await act(async () => item!.click());
      expect(onPick).toHaveBeenCalledTimes(1);
      expect(onPick).toHaveBeenCalledWith(newNodeData(kind));
    }
  });

  it('renders StudioNode cards for every catalog creative kind using its KIND_ICON SVG', () => {
    const seenIcons = new Set<string>();
    for (const kind of CREATIVE_KINDS) {
      const data = newNodeData(kind);
      const html = renderToStaticMarkup(createElement(
        ReactFlowProvider,
        null,
        createElement(StudioNode, { id: `n-${kind}`, data: { node: { id: `n-${kind}`, position: { x: 0, y: 0 }, data }, solo: false }, selected: false } as never),
      ));
      expect(html).toContain(`k-${kind}`);

      const expectedMarkup = renderToStaticMarkup(createElement(KIND_ICON[kind], { size: 12 }));
      expect(html).toContain(expectedMarkup);

      const card = document.createElement('div');
      card.innerHTML = html;
      const expected = document.createElement('div');
      expected.innerHTML = expectedMarkup;
      const expectedSvg = expected.firstElementChild!.outerHTML;
      const labelSvgs = [...card.querySelectorAll('.nc-label > svg')];
      expect(labelSvgs.length).toBeGreaterThanOrEqual(1);
      expect(labelSvgs.at(-1)!.outerHTML).toBe(expectedSvg);
      seenIcons.add(expectedSvg);
    }
    expect(seenIcons.size).toBe(CREATIVE_KINDS.length);
  });
});

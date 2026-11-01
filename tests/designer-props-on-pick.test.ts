// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));
import { usePropsOnPick } from '../src/components/designer/usePropsOnPick';
import { useStore } from '../src/store/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function setup(tab: string, selected: string[], tool = 'move') {
  useStore.setState((s) => ({ ui: { ...s.ui, tool: tool as typeof s.ui.tool } }));
  const setTab = vi.fn();
  const host = document.createElement('div');
  const root = createRoot(host);
  const Probe = (p: { tab: string; sel: string[] }) => { usePropsOnPick(p.tab, setTab, p.sel); return null; };
  const show = (sel: string[], t = tab) => act(async () => root.render(createElement(Probe, { tab: t, sel })));
  await show(selected);
  return { setTab, show, done: () => act(async () => root.unmount()) };
}

it('a new pick on the Tool tab opens Properties; the first render does not', async () => {
  const t = await setup('tool', ['a']);
  expect(t.setTab).not.toHaveBeenCalled();
  await t.show(['b']);
  expect(t.setTab).toHaveBeenCalledWith('props');
  await t.done();
});

it('the Layers and Properties tabs stay put on a new pick', async () => {
  for (const tab of ['layers', 'props']) {
    const t = await setup(tab, ['a']);
    await t.show(['b']);
    expect(t.setTab).not.toHaveBeenCalled();
    await t.done();
  }
});

it('clearing the selection or changing only the tab does not switch', async () => {
  const t = await setup('tool', ['a']);
  await t.show([]);
  await t.show([], 'layers');
  await t.show([], 'tool');
  expect(t.setTab).not.toHaveBeenCalled();
  await t.done();
});

it('other tools keep their settings in view: choosing a layer to paint on does not open Properties', async () => {
  const t = await setup('tool', ['a'], 'brush');
  await t.show(['b']);
  expect(t.setTab).not.toHaveBeenCalled();
  await t.done();
});

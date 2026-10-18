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
import { AddNodeItems } from '../src/components/node/AddNodeItems';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

const findItem = (label: string) => [...host.querySelectorAll('.menu-item')].find((el) => el.querySelector('.menu-label')?.textContent === label) as HTMLElement | undefined;
const click = async (el: Element) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

describe('Nodes context menu import placement', () => {
  it('keeps Import images out of Tools and restores it on Back without adding a node', async () => {
    const onImport = vi.fn();
    const onPick = vi.fn();
    await act(async () => root.render(createElement(AddNodeItems, { onImport, onPick })));

    expect(findItem('Import images')).toBeDefined();
    await click(findItem('Tool')!);
    expect(findItem('Import images')).toBeUndefined();

    await click(host.querySelector('.menu-back')!);
    expect(findItem('Import images')).toBeDefined();
    await click(findItem('Import images')!);
    expect(onImport).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();
  });

  it('does not show Import images when no import callback is supplied', async () => {
    await act(async () => root.render(createElement(AddNodeItems, { onPick: vi.fn() })));
    expect(findItem('Import images')).toBeUndefined();
  });
});

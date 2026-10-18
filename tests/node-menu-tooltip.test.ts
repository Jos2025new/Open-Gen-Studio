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
import { TooltipLayer } from '../src/components/ui/TooltipLayer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const mount = async () => act(async () => root.render(createElement('div', null, createElement(AddNodeItems, { onPick: () => {} }), createElement(TooltipLayer))));
const hover = async (el: Element) => act(async () => { el.dispatchEvent(new Event('pointerover', { bubbles: true })); });
const advance = async (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const item = (label: string) => [...document.querySelectorAll('.menu-item')].find((el) => el.querySelector('.menu-label')?.textContent === label) as HTMLElement;

describe('Node add menu delayed tooltips', () => {
  it('hides primary menu details and shows them after 2.5 seconds, canceling when the pointer leaves', async () => {
    await mount();
    const text = item('Text');
    expect(text.querySelector('.menu-detail')).toBeNull();
    expect(text.getAttribute('data-tip')).toBe('Prompt or copy that feeds other nodes');
    expect(text.getAttribute('data-tip-delay')).toBe('2500');

    await hover(text);
    await advance(1200);
    await hover(document.body);
    await advance(2000);
    expect(document.querySelector('.tooltip')).toBeNull();

    await hover(text);
    await advance(2499);
    expect(document.querySelector('.tooltip')).toBeNull();
    await advance(1);
    expect(document.querySelector('.tooltip')?.textContent).toBe('Prompt or copy that feeds other nodes');
  });

  it('shows tool input/output in the delayed tooltip inside the Tools submenu', async () => {
    await mount();
    await act(async () => item('Tool').click());
    const relight = item('Relight');
    expect(relight.querySelector('.menu-detail')).toBeNull();
    expect(relight.getAttribute('data-tip')).toBe('image → image');
    expect(relight.getAttribute('data-tip-delay')).toBe('2500');
    await hover(relight);
    await advance(2500);
    expect(document.querySelector('.tooltip')?.textContent).toBe('image → image');
  });

  it('keeps the default hover delay unchanged for other tooltips', async () => {
    await act(async () => root.render(createElement(TooltipLayer, null)));
    const button = document.createElement('button');
    button.setAttribute('data-tip', 'Default tooltip');
    document.body.append(button);
    await hover(button);
    await advance(379);
    expect(document.querySelector('.tooltip')).toBeNull();
    await advance(1);
    expect(document.querySelector('.tooltip')?.textContent).toBe('Default tooltip');
    button.remove();
  });
});

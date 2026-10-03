// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { AgentAttachToggle } from '../src/components/assets/AgentAttachToggle';
import type { Asset } from '../src/engine/types';
import { useStore } from '../src/store/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const image = (id: string, name: string): Asset => ({
  id,
  name,
  kind: 'image',
  mime: 'image/png',
  width: 640,
  height: 480,
  sessionId: 's',
  origin: 'generated',
  stored: true,
  favorite: false,
  createdAt: 1,
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  const st = useStore.getState();
  useStore.setState({
    assets: {
      first: image('first', 'Primera vista'),
      second: image('second', 'Segunda vista'),
      clip: { ...image('clip', 'Clip'), kind: 'video', mime: 'video/mp4' },
    },
    composer: { ...st.composer, attachments: [] },
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

/** Render one checkbox and read it back the way the user meets it (a real checkbox in the page). */
const renderBox = async (assetId: string) => {
  await act(async () => {
    root.render(createElement(AgentAttachToggle, { assetId }));
  });
  return host.querySelector<HTMLButtonElement>('button.attach-toggle');
};

describe('the overlay checkbox', () => {
  it('marks existing images with their position in the selection, and ignores non-images', async () => {
    const first = await renderBox('first');
    expect(first?.getAttribute('role')).toBe('checkbox');
    expect(first?.getAttribute('aria-checked')).toBe('false');

    // Ticked in reverse asset order: the number shows the click order, not the asset order.
    await act(async () => {
      first?.click();
    });
    const second = await renderBox('second');
    await act(async () => {
      second?.click();
    });

    expect(useStore.getState().composer.attachments).toEqual(['first', 'second']);
    expect((await renderBox('first'))?.textContent).toBe('1');
    expect((await renderBox('second'))?.textContent).toBe('2');

    // Unticking takes the id out and the other keeps its place.
    const back = await renderBox('first');
    await act(async () => {
      back?.click();
    });
    expect(useStore.getState().composer.attachments).toEqual(['second']);
    expect((await renderBox('second'))?.textContent).toBe('1');

    // Videos (and audio, 3D) have the box too; a deleted asset and an unknown id do not.
    expect(await renderBox('clip')).not.toBeNull();
    expect(await renderBox('missing')).toBeNull();
  });

  it('never creates, copies or deletes anything (the asset object is the very same one)', async () => {
    const before = useStore.getState().assets;
    const box = await renderBox('second');
    await act(async () => {
      box?.click();
    });
    expect(useStore.getState().assets).toBe(before);
    expect(Object.keys(useStore.getState().assets).sort()).toEqual(['clip', 'first', 'second']);
  });
});

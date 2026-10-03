import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, {
  window: { setTimeout, clearTimeout, addEventListener: () => undefined },
  document: { addEventListener: () => undefined, visibilityState: 'visible' },
}));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { toggleAgentAttachment } from '../src/engine/actions';
import { attachmentParts } from '../src/engine/agent/attachments';
import { buildContext } from '../src/engine/agent/context';
import type { Asset } from '../src/engine/types';
import { useStore } from '../src/store/store';

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
});

describe('agent image selection', () => {
  it('keeps click order, toggles cleanly and never duplicates or copies assets', () => {
    const assets = useStore.getState().assets;

    toggleAgentAttachment('second');
    toggleAgentAttachment('first');
    toggleAgentAttachment('second');
    toggleAgentAttachment('second');
    toggleAgentAttachment('clip');
    toggleAgentAttachment('missing');

    expect(useStore.getState().composer.attachments).toEqual(['first', 'second']);
    expect(useStore.getState().assets).toBe(assets);
  });

  it('names attached images in selection order in both text and vision context', async () => {
    const st = useStore.getState();
    const session = st.sessions[st.activeSessionId];
    const context = buildContext(session, { workspace: 'chat', style: 'auto', round: 0, maxRounds: 1, attachments: ['second', 'first'] });
    const selected = context.slice(context.indexOf('attached by the user'));

    expect(selected.indexOf('name="Segunda vista"')).toBeLessThan(selected.indexOf('name="Primera vista"'));

    const parts = await attachmentParts(['second', 'first'], { dataUrl: async (id) => `data:image/jpeg;base64,${id}` });
    expect(parts.filter((p) => p.type === 'text').map((p) => p.type === 'text' ? p.text : '')).toEqual([
      'asset:second name="Segunda vista" (image 640×480):',
      'asset:first name="Primera vista" (image 640×480):',
    ]);
  });
});

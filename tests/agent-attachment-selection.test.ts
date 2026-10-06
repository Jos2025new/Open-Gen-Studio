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

    expect(useStore.getState().composer.attachments).toEqual(['first', 'second', 'clip']);
    expect(useStore.getState().assets).toBe(assets);
  });

  it('shows a 3D model to the agent by its current view image', async () => {
    useStore.setState((st) => ({
      assets: {
        ...st.assets,
        hero: { ...image('hero', 'Heroine'), kind: 'model3d', mime: 'model/gltf-binary', viewImageId: 'heroView' },
        heroView: image('heroView', 'Heroine view'),
        song: { ...image('song', 'Song'), kind: 'audio', mime: 'audio/mpeg', duration: 12 },
      },
    }));
    toggleAgentAttachment('hero');
    toggleAgentAttachment('song');
    expect(useStore.getState().composer.attachments).toContain('hero');
    expect(useStore.getState().composer.attachments).toContain('song');
    const parts = await attachmentParts(['hero', 'song'], { dataUrl: async (id) => `data:image/jpeg;base64,${id}` });
    expect((parts[0] as { text: string }).text).toMatch(/^asset:hero name="Heroine" \(3D model, current view image: asset:heroView/);
    expect(parts[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,heroView' } });
    // Audio stays text: no image part for it.
    expect(parts).toHaveLength(2);
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

it.each([true, false])('a request with only a 3D attachment respects agent vision=%s', async (vision) => {
  const { sendAgentMessage } = await import('../src/engine/agent/runtime');
  const st = useStore.getState(), sid = st.activeSessionId;
  const thumbnailUrl = 'data:image/jpeg;base64,Y3VycmVudA==';
  useStore.setState({
    assets: { hero: { ...image('hero', 'Heroine'), sessionId: sid, kind: 'model3d', mime: 'model/gltf-binary', viewImageId: 'current', thumbnailUrl }, current: { ...image('current', 'Current view'), sessionId: sid, origin: 'view3d' } },
    settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'fixture' }, agent: { ...st.settings.agent, provider: 'nanogpt', model: 'fixture' } },
    catalog: { ...st.catalog, llm: { ...st.catalog.llm, nanogpt: [{ id: 'fixture', name: 'Fixture', tools: true, vision }] } },
    ui: { ...st.ui, workspace: 'chat' },
    sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], feed: [], agent: { busy: false, history: [], questionRound: 0, notes: [] } } },
  });
  let messages: Array<{ role: string; content: unknown }> = [];
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (!body.messages) return new Response('{"data":[]}');
    messages = body.messages;
    return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  });
  try { await sendAgentMessage('Dame una vista usando la referencia del modelo 3D', { attachments: ['hero'] }); }
  finally { vi.unstubAllGlobals(); }
  const sent = JSON.stringify(messages.filter(m => m.role === 'user'));
  if (vision) {
    expect(sent).toContain(thumbnailUrl);
    expect(sent).toContain('asset:current');
  } else {
    expect(sent).not.toContain(thumbnailUrl);
    expect(useStore.getState().sessions[sid].feed).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'notice', text: expect.stringContaining('cannot see images') })]));
  }
});

it('selected and recent 3D context identifies the current view instead of choosing the newest image', () => {
  const st = useStore.getState(), session = st.sessions[st.activeSessionId], sid = session.id;
  useStore.setState({ assets: {
    hero: { ...image('hero', 'Heroine'), sessionId: sid, kind: 'model3d', viewImageId: 'current' },
    current: { ...image('current', 'Current view'), sessionId: sid, origin: 'view3d', createdAt: 2 },
    saved: { ...image('saved', 'Saved view'), sessionId: sid, origin: 'view3d', createdAt: 3 },
    saved2: { ...image('saved2', 'Saved view 2'), sessionId: sid, origin: 'view3d', createdAt: 5 },
    saved3: { ...image('saved3', 'Saved view 3'), sessionId: sid, origin: 'view3d', createdAt: 6 },
    saved4: { ...image('saved4', 'Saved view 4'), sessionId: sid, origin: 'view3d', createdAt: 7 },
    other: { ...image('other', 'Another model'), sessionId: sid, kind: 'model3d', viewImageId: 'newer' },
    newer: { ...image('newer', 'Newest but another model'), sessionId: sid, origin: 'view3d', createdAt: 4 },
    foreign: { ...image('foreign', 'Foreign model'), sessionId: 'another-session', kind: 'model3d', viewImageId: 'saved' },
  } });
  const context = buildContext(session, { workspace: 'chat', style: 'auto', round: 0, maxRounds: 1, attachments: ['hero'] });
  const attached = context.slice(context.indexOf('attached by the user'), context.indexOf('recent assets'));
  expect(attached).toContain('current view image: asset:current');
  expect(attached).not.toContain('asset:newer');
  expect(context).toMatch(/asset:current[^\n]*current view image of 3D model asset:hero/);
  expect(context).toMatch(/asset:newer[^\n]*current view image of 3D model asset:other/);
  expect(context).toMatch(/asset:saved[^\n]*not identified as a current view/);
  expect(context).not.toContain('asset:foreign');
});

it('does not advertise a missing 3D view as a usable image reference', () => {
  const st = useStore.getState(), session = st.sessions[st.activeSessionId];
  useStore.setState({ assets: { hero: { ...image('hero', 'Heroine'), sessionId: session.id, kind: 'model3d', viewImageId: 'missing' } } });
  const context = buildContext(session, { workspace: 'chat', style: 'auto', round: 0, maxRounds: 1, attachments: ['hero'] });
  expect(context).toContain('no current view image reference available');
  expect(context).not.toContain('current view image: asset:missing');
});

it('a 3D attachment does not send a view from another session or name it as usable', async () => {
  const ownThumbnail = 'data:image/jpeg;base64,b3du';
  useStore.setState(st => ({ assets: {
    ...st.assets,
    hero: { ...image('hero', 'Heroine'), kind: 'model3d', viewImageId: 'foreignView', thumbnailUrl: ownThumbnail },
    foreignView: { ...image('foreignView', 'Foreign'), sessionId: 'another-session' },
  } }));
  const dataUrl = vi.fn(async () => 'data:image/jpeg;base64,Zm9yZWlnbg==');
  const parts = await attachmentParts(['hero'], { dataUrl });
  expect(dataUrl).not.toHaveBeenCalled();
  expect(parts).toContainEqual({ type: 'image_url', image_url: { url: ownThumbnail } });
  expect(JSON.stringify(parts)).toContain('no current view image reference available');
  expect(JSON.stringify(parts)).not.toContain('asset:foreignView');
});

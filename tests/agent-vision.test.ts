import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
const blobs = new Map<string, Blob>();
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async (id: string) => blobs.get(id),
  putAssetBlob: async () => undefined,
}));
// No canvas in node: the reduction is stubbed, the rest of the path is real.
const drawn: Array<[number, number]> = [];
vi.mock('../src/lib/media', async (orig) => ({
  ...(await orig<typeof import('../src/lib/media')>()),
  blobToCanvas: async () => ({ width: 2000, height: 1000 }),
  createCanvas: (w: number, h: number) => (drawn.push([Math.round(w), Math.round(h)]), { width: Math.round(w), height: Math.round(h) }),
  ctx2d: () => ({ drawImage: () => undefined }),
  canvasToBlob: async () => new Blob(['x'], { type: 'image/jpeg' }),
  blobToDataUrl: async () => 'data:image/jpeg;base64,QQ==',
}));

import { sendAgentMessage } from '../src/engine/agent/runtime';
import { useStore } from '../src/store/store';
import type { LlmMessage } from '../src/engine/types';

const sent: LlmMessage[][] = [];
const text = () => new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });

function setup(vision: boolean | undefined) {
  sent.length = 0;
  drawn.length = 0;
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (!body.messages) return new Response(JSON.stringify({ data: [] }));
    sent.push(body.messages);
    return text();
  });
  const st = useStore.getState();
  const sid = st.activeSessionId;
  blobs.set('img1', new Blob(['png'], { type: 'image/png' }));
  useStore.setState({
    assets: { img1: { id: 'img1', kind: 'image', mime: 'image/png', width: 2000, height: 1000, sessionId: sid, origin: 'upload', stored: true, favorite: false, createdAt: 0 } },
    settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'k' }, agent: { ...st.settings.agent, provider: 'nanogpt', model: 'm' } },
    catalog: { ...st.catalog, llm: { nanogpt: [{ id: 'm', name: 'm', tools: true, ...(vision === undefined ? {} : { vision }) } as never] } },
    composer: { ...st.composer, agentStyle: 'guided', attachments: [] },
    sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], feed: [], agent: { history: [], questionRound: 0, notes: [], busy: false } } },
  });
}

const attach = () => useStore.setState((s) => ({ composer: { ...s.composer, attachments: ['img1'] } }));
const lastUser = (msgs: LlmMessage[]) => [...msgs].reverse().find((m) => m.role === 'user')!;

beforeEach(() => setup(true));
afterEach(() => vi.unstubAllGlobals());

describe('the agent sees the attached references', () => {
  it('sends the image, reduced and labeled with its asset id, in the message that attaches it', async () => {
    attach();
    await sendAgentMessage('animate this character');
    const msg = lastUser(sent[0]);
    expect(Array.isArray(msg.content)).toBe(true);
    const parts = msg.content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
    expect(parts[0]).toMatchObject({ type: 'text' });
    expect(parts[0].text).toMatch(/^animate this character/);
    expect(parts.some((p) => p.type === 'text' && /asset:img1 \(image 2000×1000\)/.test(p.text!))).toBe(true);
    expect(parts.some((p) => p.type === 'image_url' && p.image_url!.url.startsWith('data:image/jpeg'))).toBe(true);
    expect(drawn).toContainEqual([768, 384]);
  });

  it('a new request sends earlier images as a note, not again', async () => {
    attach();
    await sendAgentMessage('animate this');
    await sendAgentMessage('now write a slogan');
    const second = sent[1];
    expect(second.every((m) => !Array.isArray(m.content))).toBe(true);
    expect(second.some((m) => typeof m.content === 'string' && m.content.includes('[image shown earlier]'))).toBe(true);
  });

  it('messages without attachments are unchanged (plain text)', async () => {
    await sendAgentMessage('a poster idea');
    expect(typeof lastUser(sent[0]).content).toBe('string');
    expect(drawn).toEqual([]);
  });

  it('with a model that has no vision it says so and sends text only', async () => {
    setup(false);
    attach();
    await sendAgentMessage('animate this');
    expect(typeof lastUser(sent[0]).content).toBe('string');
    const feed = useStore.getState().sessions[useStore.getState().activeSessionId].feed;
    expect(feed.some((f) => f.type === 'notice' && /cannot see images/.test(f.text))).toBe(true);
  });
});

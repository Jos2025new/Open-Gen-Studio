import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  Object.assign(globalThis, {
    window: { setTimeout, clearTimeout, addEventListener: () => undefined, setInterval, clearInterval },
    document: { addEventListener: () => undefined, visibilityState: 'visible' },
  });
  const blobs = new Map<string, Blob>();
  let failSetAt: ((key: string) => Error | null) | null = null;
  return {
    blobs,
    setFailSet: (fn: ((key: string) => Error | null) | null) => { failSetAt = fn; },
    blobDb: {
      async get(key: string): Promise<Blob | undefined> { return blobs.get(key); },
      async set(key: string, value: Blob): Promise<void> {
        const err = failSetAt?.(key);
        if (err) throw err;
        blobs.set(key, value);
      },
      async del(key: string): Promise<void> { blobs.delete(key); },
      async delMany(keys: string[]): Promise<void> { for (const k of keys) blobs.delete(k); },
    },
  };
});

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  blobDb: hoisted.blobDb,
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
  deleteAssetBlobs: async () => undefined,
}));

import { sendAgentMessage, stopAgent } from '../src/engine/agent/runtime';
import { readKitVersion, saveItem } from '../src/engine/libraryVersions';
import { useStore } from '../src/store/store';
import { mainThread } from './helpers/threads';
import type { NoticeFeedItem } from '../src/engine/types';

type Call = { name: string; args: unknown };
const enc = new TextEncoder();
const sse = (chunks: unknown[]) =>
  new Response(new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(enc.encode(`data: ${JSON.stringify(x)}\n\n`)); c.enqueue(enc.encode('data: [DONE]\n\n')); c.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
const text = (t: string) => sse([{ choices: [{ delta: { content: t } }] }]);
const tool = (c: Call) => sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: `c${Math.random()}`, function: { name: c.name, arguments: JSON.stringify(c.args) } }] }, finish_reason: 'tool_calls' }] }]);

let replies: Array<Response | ((signal?: AbortSignal | null) => Promise<Response>)> = [];
let sid = '';

const settle = () => new Promise((resolve) => setTimeout(resolve, 40));
const versions = (kitId: string) => useStore.getState().library.find((x) => x.id === kitId)!.versions?.length;

beforeEach(() => {
  hoisted.blobs.clear();
  hoisted.setFailSet(null);
  replies = [];
  vi.stubGlobal('fetch', async (_u: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (!body.messages) return new Response(JSON.stringify({ data: [] }));
    const next = replies.shift();
    if (typeof next === 'function') return next(init?.signal);
    return next ?? text('ok');
  });
  const st = useStore.getState();
  sid = st.activeSessionId;
  useStore.setState({
    library: [],
    settings: { ...st.settings, budgetOn: false, keys: { ...st.settings.keys, nanogpt: 'k' }, agent: { ...st.settings.agent, provider: 'nanogpt', model: 'm', showThinking: false } },
    composer: { ...st.composer, agentStyle: 'auto', attachments: [] },
    sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], docs: [], activeDocId: null, feed: [], agentMetrics: [], agents: mainThread({ history: [], questionRound: 0, notes: [], busy: false }) } },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('Part 5: automatic draft kit versioning at agent turn end', () => {
  it('saves 1 version on create/change, 0 when unchanged, saves on failure/cancel, warns without breaking turn on save error, and stops once user names/saves', async () => {
    // Turn 1: agent creates draft kit in studio and composes 2 layers -> 1 auto version, stays draft: true
    replies = [
      tool({
        name: 'run_commands',
        args: {
          seq: [
            { cmd: 'library.item.create', args: { name: 'AutoDS', kind: 'design-system', space: 'studio' } },
            { cmd: 'designer.layer.add_text', args: { text: 'Hero', x: 10, y: 10, width: 120 } },
            { cmd: 'designer.layer.add_shapes', args: { shapes: [{ type: 'rect', x: 0, y: 0, w: 100, h: 40, fill: '#111' }] } },
          ],
        },
      }),
      text('Draft ready.'),
    ];
    await sendAgentMessage('Create a design system draft');
    const kit = useStore.getState().library.find((x) => x.name === 'AutoDS')!;
    expect(kit).toBeDefined();
    await vi.waitFor(() => expect(versions(kit.id)).toBe(1));

    const afterT1 = useStore.getState().library.find((x) => x.id === kit.id)!;
    expect(afterT1.draft).toBe(true);
    expect(afterT1.versions?.length).toBe(1);
    const snap1 = await readKitVersion(afterT1.versionId!);
    expect(snap1?.doc?.layers.length).toBe(2);

    // Turn 2: agent chats without changing the kit doc -> 0 new versions
    replies = [text('No changes made.')];
    await sendAgentMessage('Just checking in');
    await settle();
    expect(useStore.getState().library.find((x) => x.id === kit.id)!.versions?.length).toBe(1);

    // Turn 3: agent edits doc twice then turn FAILS (400 error from provider) -> STILL saves 1 version for the turn!
    const docId = useStore.getState().sessions[sid].docs.find((d) => d.library?.subjectId === kit.id)!.id;
    replies = [
      tool({
        name: 'run_commands',
        args: {
          seq: [
            { cmd: 'designer.layer.add_text', on: { doc: docId }, args: { text: 'Sub 1', x: 10, y: 60, width: 120 } },
            { cmd: 'designer.layer.add_text', on: { doc: docId }, args: { text: 'Sub 2', x: 10, y: 100, width: 120 } },
          ],
        },
      }),
      new Response('bad request', { status: 400 }),
    ];
    await sendAgentMessage('Add two subtitles');
    await vi.waitFor(() => expect(versions(kit.id)).toBe(2));
    const afterT3 = useStore.getState().library.find((x) => x.id === kit.id)!;
    expect(afterT3.versions?.length).toBe(2);
    expect((await readKitVersion(afterT3.versionId!))?.doc?.layers.length).toBe(4);

    // Turn 4: agent edits doc then turn is CANCELED via stopAgent -> STILL saves 1 version!
    replies = [
      tool({
        name: 'run_commands',
        args: { seq: [{ cmd: 'designer.layer.add_text', on: { doc: docId }, args: { text: 'CanceledEdit', x: 10, y: 140, width: 120 } }] },
      }),
      (signal) => new Promise<Response>((_res, rej) => {
        signal?.addEventListener('abort', () => rej(Object.assign(new Error('Aborted'), { name: 'AbortError' })), { once: true });
        setTimeout(() => stopAgent(sid, 'main'), 5);
      }),
    ];
    await sendAgentMessage('Add canceled edit');
    await vi.waitFor(() => expect(versions(kit.id)).toBe(3));
    const afterT4 = useStore.getState().library.find((x) => x.id === kit.id)!;
    expect(afterT4.versions?.length).toBe(3);

    // Turn 5: auto-save fails (disk full) -> does NOT throw or hang, appends notice with reason
    hoisted.setFailSet(() => new Error('storage full'));
    replies = [
      tool({
        name: 'run_commands',
        args: { seq: [{ cmd: 'designer.layer.add_text', on: { doc: docId }, args: { text: 'FailSave', x: 10, y: 180, width: 120 } }] },
      }),
      text('Done editing.'),
    ];
    await expect(sendAgentMessage('Edit with failing storage')).resolves.toBeUndefined();
    const failedSave = () => useStore.getState().sessions[sid].feed.some((item) => item.type === 'notice' && /storage full/i.test(item.text));
    await vi.waitFor(() => expect(failedSave()).toBe(true));
    hoisted.setFailSet(null);
    expect(useStore.getState().sessions[sid].agents[Object.keys(useStore.getState().sessions[sid].agents)[0]].busy).toBe(false);
    const notices = useStore.getState().sessions[sid].feed.filter((f): f is NoticeFeedItem => f.type === 'notice');
    expect(notices.some((n) => /storage full/i.test(n.text))).toBe(true);
    expect(useStore.getState().library.find((x) => x.id === kit.id)!.versions?.length).toBe(3);

    // Turn 6: user names the kit -> draft becomes false -> agent edits NO LONGER auto-save!
    const named = await saveItem({ subjectId: kit.id, name: 'Named DS', mode: 'overwrite', space: 'studio', by: 'user' });
    expect(named.draft).toBe(false);
    replies = [
      tool({
        name: 'run_commands',
        args: { seq: [{ cmd: 'designer.layer.add_text', on: { doc: docId }, args: { text: 'PostNameEdit', x: 10, y: 220, width: 120 } }] },
      }),
      text('Edited non-draft.'),
    ];
    await sendAgentMessage('Edit named kit');
    await settle();
    expect(versions(kit.id)).toBe(named.versions?.length);
  });
});

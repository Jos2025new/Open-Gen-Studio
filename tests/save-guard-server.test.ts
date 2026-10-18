import { mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sha256 as sha } from '../server/save-guard.js';
import { createStoreV2 } from '../server/store-v2.js';
import { localStore } from '../server/local-store.js';

// Phase 1 of the save-protection plan, server half: the per-session shrink guard measures user content only.
const text = 'x'.repeat(2000);
type Doc = { id: string; layers: unknown[] };
const doc = (id: string, nLayers: number, pad = 300): Doc => ({ id, layers: Array.from({ length: nLayers }, (_, i) => ({ id: `${id}l${i}`, data: text.slice(0, pad) })) });
function ses(o: { feed?: number; nodes?: number; docs?: Doc[]; agent?: unknown; pad?: number; feedText?: string } = {}) {
  return JSON.stringify({
    id: 'ses_a', title: 'T',
    feed: Array.from({ length: o.feed ?? 0 }, (_, i) => ({ id: `f${i}`, text: o.feedText ?? text.slice(0, o.pad ?? 400) })),
    graph: { nodes: Array.from({ length: o.nodes ?? 0 }, (_, i) => ({ id: `n${i}`, data: text.slice(0, o.pad ?? 400) })), edges: [] },
    docs: o.docs ?? [], agent: o.agent ?? { history: [] },
  });
}
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'ogs-guard-'));
  const v2 = createStoreV2(dir);
  let at = 1000;
  const send = async (sessions: Record<string, string>, extra: Record<string, unknown> = {}, baseAt = at) => {
    const savedAt = baseAt === 0 ? 1000 : at + 1;
    const r = await v2.commit({ savedAt, baseAt, version: 1, globals: '{}', order: Object.keys(sessions), sessions, ...extra } as never) as { status: number; savedAt?: number; reason?: string; sessionId?: string; rejectedFile?: string };
    if (r.status === 204) at = savedAt;
    return r;
  };
  const onDisk = () => readFileSync(join(dir, 'store-v2', 'sessions', 'ses_a.json'), 'utf8');
  return { dir, v2, send, onDisk, at: () => at };
}
const seed = async (s: ReturnType<typeof setup>, t: string) => { const r = await s.send({ ses_a: t }, {}, 0); expect(r.status).toBe(204); return r; };
const big = (n: number) => ({ history: ['h'.repeat(n)] });

describe('save guard: what counts as a loss', () => {
  it('sha256 is the standard digest (hex)', () => {
    expect(sha('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('1a: deleting one big document of a 12-element session is not a loss (3 layers, 20 layers)', async () => {
    for (const layers of [3, 20]) {
      const s = setup();
      await seed(s, ses({ feed: 6, nodes: 4, docs: [doc('d1', 0, 0), doc('d2', layers, 1500)] }));
      const next = ses({ feed: 6, nodes: 4, docs: [doc('d1', 0, 0)] });
      expect((await s.send({ ses_a: next })).status).toBe(204);
    }
  });

  it('1a: a surviving document that loses 15 of 20 layers, with the bytes halved, is possible-loss', async () => {
    const s = setup();
    await seed(s, ses({ feed: 2, docs: [doc('d1', 20, 1500)] }));
    const r = await s.send({ ses_a: ses({ feed: 2, docs: [doc('d1', 5, 1500)] }) });
    expect(r.status).toBe(409);
    expect(r.reason).toBe('possible-loss');
    expect(r.sessionId).toBe('ses_a');
  });

  it('1a: an emptied session is possible-loss; same elements with emptied content is accepted (written limit)', async () => {
    const s = setup();
    await seed(s, ses({ feed: 10, nodes: 4, docs: [doc('d1', 5, 1500)] }));
    const empty = await s.send({ ses_a: ses() });
    expect(empty.status).toBe(409);
    expect(empty.reason).toBe('possible-loss');
    expect((await s.send({ ses_a: ses({ feed: 10, nodes: 4, docs: [doc('d1', 5, 0)], pad: 1 }) })).status).toBe(204);
  });

  it('1: the real agent cleanup (history 424 KB to 144 KB, feed unchanged) is saved', async () => {
    const s = setup();
    await seed(s, ses({ feed: 8, agent: big(424_000) }));
    expect((await s.send({ ses_a: ses({ feed: 8, agent: big(144_000) }) })).status).toBe(204);
    expect(JSON.parse(s.onDisk()).agent.history[0].length).toBe(144_000);
  });

  it('1: dropping the whole agent field and cutting its messages is saved too', async () => {
    const s = setup();
    await seed(s, ses({ feed: 8, agent: { history: Array.from({ length: 200 }, () => 'm'.repeat(2000)) } }));
    expect((await s.send({ ses_a: ses({ feed: 8, agent: { history: ['m'.repeat(2000)] } }) })).status).toBe(204);
  });

  it('2: real UTF-8 bytes: wide characters that shrink in code units but not in bytes are saved', async () => {
    const s = setup();
    // 4000 ASCII code units (4000 bytes) replaced by 1500 CJK units (4500 bytes): fewer chars, more bytes.
    await seed(s, ses({ feed: 4, feedText: 'a'.repeat(4000), pad: 4000 }));
    const next = JSON.stringify({ ...JSON.parse(ses({ feed: 4 })), feed: Array.from({ length: 4 }, (_, i) => ({ id: `f${i}`, text: '漢'.repeat(1500) })) });
    expect(next.length).toBeLessThan(s.onDisk().length / 2 + 1);
    expect(new TextEncoder().encode(next).length).toBeGreaterThan(new TextEncoder().encode(s.onDisk()).length / 2);
    expect((await s.send({ ses_a: next })).status).toBe(204);
  });

  it('3: an old baseAt is a conflict, with or without a keep', async () => {
    const s = setup();
    await seed(s, ses({ feed: 3 }));
    const r = await s.send({ ses_a: ses({ feed: 3 }) }, {}, 500);
    expect(r).toMatchObject({ status: 409, reason: 'conflict', savedAt: 1000 });
    const keep = { sessionId: 'ses_a', diskHash: sha(s.onDisk()), candidateHash: sha(ses({ feed: 3 })) };
    expect((await s.send({ ses_a: ses({ feed: 3 }) }, { keep }, 500)).reason).toBe('conflict');
  });

  it('4: a refused session leaves disk, order and globals untouched and keeps a rejected copy', async () => {
    const s = setup();
    await seed(s, ses({ feed: 10, nodes: 5, docs: [doc('d1', 5, 1500)] }));
    const before = { head: readFileSync(s.v2.headFile, 'utf8'), ses: s.onDisk(), g: readFileSync(join(s.dir, 'store-v2', 'globals.json'), 'utf8') };
    const r = await s.send({ ses_a: ses(), ses_b: ses() }, { globals: '{"changed":1}' });
    expect(r.status).toBe(409);
    expect(readFileSync(s.v2.headFile, 'utf8')).toBe(before.head);
    expect(s.onDisk()).toBe(before.ses);
    expect(readFileSync(join(s.dir, 'store-v2', 'globals.json'), 'utf8')).toBe(before.g);
    expect(readdirSync(join(s.dir, 'backups'))).toContain(r.rejectedFile);
  });

  it('the total-loss rule still comes first and has no sessionId', async () => {
    const s = setup();
    const a = ses({ feed: 3 });
    await s.send({ ses_a: a, ses_b: a, ses_c: a, ses_d: a }, {}, 0);
    const r = await s.send({ ses_a: a }, {});
    expect(r.status).toBe(409);
    expect(r.reason).toBe('possible-loss');
    expect(r.sessionId).toBeUndefined();
    expect(r.rejectedFile).toMatch(/^rejected-/);
  });
});

describe('save guard: keep this version', () => {
  const lossSetup = async () => {
    const s = setup();
    await seed(s, ses({ feed: 10, nodes: 5, docs: [doc('d1', 5, 1500)] }));
    return { s, cand: ses() };
  };
  const keepOf = (s: ReturnType<typeof setup>, cand: string) => ({ sessionId: 'ses_a', diskHash: sha(s.onDisk()), candidateHash: sha(cand) });

  it('11: correct hashes back up the disk version and write the candidate', async () => {
    const { s, cand } = await lossSetup();
    const disk = s.onDisk();
    const r = await s.send({ ses_a: cand }, { keep: keepOf(s, cand) });
    expect(r.status).toBe(204);
    expect(s.onDisk()).toBe(cand);
    const kept = readdirSync(join(s.dir, 'backups')).filter((f) => f.startsWith('kept-before-ses_a-'));
    expect(kept).toHaveLength(1);
    expect(readFileSync(join(s.dir, 'backups', kept[0]), 'utf8')).toBe(disk);
  });

  it('11: a wrong diskHash or candidateHash is possible-loss and writes nothing', async () => {
    const { s, cand } = await lossSetup();
    const disk = s.onDisk();
    for (const bad of [{ diskHash: 'a'.repeat(64) }, { candidateHash: 'b'.repeat(64) }, { sessionId: 'ses_zzz' }]) {
      const r = await s.send({ ses_a: cand }, { keep: { ...keepOf(s, cand), ...bad } });
      expect(r).toMatchObject({ status: 409, reason: 'possible-loss' });
    }
    expect(s.onDisk()).toBe(disk);
  });

  it('11: the keep is single use: after the write it no longer matches a later loss', async () => {
    const { s, cand } = await lossSetup();
    const keep = keepOf(s, cand);
    expect((await s.send({ ses_a: cand }, { keep })).status).toBe(204);
    // The user rebuilds a big session and a later shrink tries to reuse the same keep.
    await s.send({ ses_a: ses({ feed: 11, nodes: 5, docs: [doc('d1', 5, 1500)] }) });
    const r = await s.send({ ses_a: cand }, { keep });
    expect(r).toMatchObject({ status: 409, reason: 'possible-loss' });
  });

  it('a keep never lifts the total-loss rule', async () => {
    const s = setup();
    const a = ses({ feed: 3 });
    await s.send({ ses_a: a, ses_b: a, ses_c: a, ses_d: a }, {}, 0);
    const r = await s.send({ ses_a: a }, { keep: { sessionId: 'ses_a', diskHash: sha(a), candidateHash: sha(a) } });
    expect(r.status).toBe(409);
  });
});

describe('save guard: the 409 bodies through the HTTP layer', () => {
  function server() {
    const root = mkdtempSync(join(tmpdir(), 'ogs-guard-http-'));
    mkdirSync(join(root, 'data'));
    let mw: (req: unknown, res: unknown, next: () => void) => void = () => undefined;
    (localStore(root).configureServer as unknown as (s: unknown) => void)({ middlewares: { use: (fn: typeof mw) => (mw = fn) } });
    const put = (url: string, body: string) => new Promise<{ status: number; body: string }>((resolve) => {
      const req = { method: 'PUT', url, headers: { 'x-ogs': '1', host: 'localhost:5173' }, socket: { remoteAddress: '127.0.0.1' }, async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(body); } };
      const res = { statusCode: 0, setHeader: () => undefined, end: (b?: string) => resolve({ status: res.statusCode, body: String(b ?? '') }) };
      mw(req, res, () => resolve({ status: 404, body: '' }));
    });
    return { put };
  }
  const state = (savedAt: number, baseAt: number, s: string) => `{"savedAt":${savedAt},"baseAt":${baseAt},"state":{"sessions":{"ses_a":${s}}},"version":1}`;

  it('v2 commit: conflict and possible-loss carry a reason', async () => {
    const { put } = server();
    const big = ses({ feed: 10, nodes: 5, docs: [doc('d1', 5, 1500)] });
    const c = (savedAt: number, baseAt: number, s: string) => JSON.stringify({ savedAt, baseAt, version: 1, globals: '{}', order: ['ses_a'], sessions: { ses_a: s } });
    expect((await put('/x/store/v2/commit', c(1000, 0, big))).status).toBe(204);
    const conflict = await put('/x/store/v2/commit', c(1001, 5, big));
    expect(conflict.status).toBe(409);
    expect(JSON.parse(conflict.body)).toEqual({ reason: 'conflict', savedAt: 1000 });
    const loss = await put('/x/store/v2/commit', c(1001, 1000, ses()));
    expect(loss.status).toBe(409);
    expect(JSON.parse(loss.body)).toMatchObject({ reason: 'possible-loss', sessionId: 'ses_a', savedAt: 1000 });
    expect(JSON.parse(loss.body).rejectedFile).toMatch(/^rejected-session-ses_a-\d+\.json$/);
  });

  it('14: the legacy PUT /state path gives the same reasons', async () => {
    const { put } = server();
    const big = ses({ feed: 10, nodes: 5, docs: [doc('d1', 5, 1500)] });
    // Format 2 must exist for the legacy PUT to go through commitLegacy.
    await put('/x/store/v2/commit', JSON.stringify({ savedAt: 1000, baseAt: 0, version: 1, globals: '{}', order: ['ses_a'], sessions: { ses_a: big } }));
    const conflict = await put('/x/store/state', state(1001, 5, big));
    expect(JSON.parse(conflict.body)).toEqual({ reason: 'conflict', savedAt: 1000 });
    const loss = await put('/x/store/state', state(1001, 1000, ses()));
    expect(loss.status).toBe(409);
    expect(JSON.parse(loss.body)).toMatchObject({ reason: 'possible-loss', sessionId: 'ses_a' });
    // The cleanup of the agent through the legacy path is saved.
    const withAgent = ses({ feed: 8, agent: { history: ['h'.repeat(424_000)] } });
    expect((await put('/x/store/state', state(1001, 1000, withAgent))).status).toBe(204);
    expect((await put('/x/store/state', state(1002, 1001, ses({ feed: 8, agent: { history: ['h'.repeat(144_000)] } })))).status).toBe(204);
  });
});

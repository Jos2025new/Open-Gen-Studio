import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createStoreV2, exportToFormat1, splitText } from '../server/store-v2.js';

const session = (id: string, pad = 0) => ({ id, title: `T ${id}`, messages: Array.from({ length: pad }, (_, i) => `m${i}`.repeat(10)) });
function format1(sessions: Record<string, unknown>, savedAt = 100, settings = { theme: 'dark' }) {
  return JSON.stringify({ savedAt, baseAt: 0, state: { settings, sessions }, version: 1 }).replace(/^\{/, '{');
}
function setup(text?: string) {
  const dir = mkdtempSync(join(tmpdir(), 'ogs-v2-'));
  if (text !== undefined) writeFileSync(join(dir, 'state.json'), text);
  return { dir, v2: createStoreV2(dir) };
}
const commitOf = (text: string, baseAt: number, changed?: Record<string, string>) => {
  const p = splitText(text);
  return { savedAt: p.savedAt + 1, baseAt, version: p.version, globals: p.globals, order: p.order, sessions: changed ?? p.sessions };
};

describe('store format 2: migration, commit and reading', () => {
  it('refuses a commit without a valid version and writes nothing', async () => {
    const legacy = format1({ ses_a: session('ses_a') });
    const { dir, v2 } = setup(legacy);
    for (const version of [undefined, null, 'x', 0, 1.5]) {
      const bad = { ...commitOf(legacy, 100), version } as never;
      const res = await v2.commit(bad);
      expect(res.status).toBe(400);
      expect((res as { reason?: string }).reason).toMatch(/version/);
    }
    expect(existsSync(join(dir, 'store-v2', 'HEAD.json'))).toBe(false);
  });

  it('the first write copies state.json whole and leaves it untouched', async () => {
    const legacy = format1({ ses_a: session('ses_a') });
    const { dir, v2 } = setup(legacy);
    expect((await v2.commit(commitOf(legacy, 100))).status).toBe(204);
    expect(readFileSync(join(dir, 'state.json'), 'utf8')).toBe(legacy);
    expect(readdirSync(join(dir, 'backups')).some((f) => f.startsWith('format1-'))).toBe(true);
    expect(existsSync(join(dir, 'store-v2', 'HEAD.json'))).toBe(true);
  });

  it('reads back exactly the state that was saved (reload gives the same state)', async () => {
    const legacy = format1({ ses_a: session('ses_a', 3), ses_b: session('ses_b') });
    const { v2 } = setup(legacy);
    await v2.commit(commitOf(legacy, 100));
    const once = JSON.parse((await v2.read())!), twice = JSON.parse((await v2.read())!);
    expect(twice).toEqual(once);
    expect(once.state.sessions).toEqual(JSON.parse(legacy).state.sessions);
    expect(once.state.settings).toEqual({ theme: 'dark' });
    expect(once.version).toBe(1);
  });

  it('a change to one session writes that session only (the others are not rewritten)', async () => {
    const legacy = format1({ ses_a: session('ses_a'), ses_b: session('ses_b') });
    const { dir, v2 } = setup(legacy);
    await v2.commit(commitOf(legacy, 100));
    // Mark session b on disk: if a later commit rewrote it, the mark would disappear.
    const fileB = join(dir, 'store-v2', 'sessions', 'ses_b.json');
    writeFileSync(fileB, readFileSync(fileB, 'utf8').replace('"title":"T ses_b"', '"title":"MARK"'));
    const changedA = { ses_a: JSON.stringify({ ...session('ses_a'), title: 'changed' }) };
    const next = commitOf(legacy, 101, changedA);
    expect((await v2.commit({ ...next, savedAt: 200, baseAt: 101 })).status).toBe(204);
    expect(readFileSync(fileB, 'utf8')).toContain('"title":"MARK"');
    expect(readFileSync(join(dir, 'store-v2', 'sessions', 'ses_a.json'), 'utf8')).toContain('"title":"changed"');
  });

  it('a commit based on an older savedAt is refused with 409 and nothing changes', async () => {
    const legacy = format1({ ses_a: session('ses_a') });
    const { dir, v2 } = setup(legacy);
    await v2.commit(commitOf(legacy, 100));
    const before = readFileSync(join(dir, 'store-v2', 'HEAD.json'), 'utf8');
    const r = await v2.commit({ ...commitOf(legacy, 100), savedAt: 300, baseAt: 7 });
    expect(r.status).toBe(409);
    expect(r.savedAt).toBe(101);
    expect(readFileSync(join(dir, 'store-v2', 'HEAD.json'), 'utf8')).toBe(before);
  });

  it('refuses a total loss of sessions (below half, from two or more) and keeps the attempt aside', async () => {
    const legacy = format1({ ses_a: session('ses_a'), ses_b: session('ses_b'), ses_c: session('ses_c'), ses_d: session('ses_d') });
    const { dir, v2 } = setup(legacy);
    await v2.commit(commitOf(legacy, 100));
    const one = format1({ ses_a: session('ses_a') }, 200);
    const r = await v2.commit({ ...commitOf(one, 101), savedAt: 201, baseAt: 101 });
    expect(r.status).toBe(409);
    expect(readdirSync(join(dir, 'backups')).some((f) => f.startsWith('rejected-'))).toBe(true);
    expect(JSON.parse((await v2.read())!).state.sessions).toHaveProperty('ses_d');
  });

  it('refuses a session that shrinks below half of its size (over 4 KB)', async () => {
    const legacy = format1({ ses_big: session('ses_big', 300) });
    const { v2 } = setup(legacy);
    await v2.commit(commitOf(legacy, 100));
    const small = JSON.stringify(session('ses_big', 2));
    const r = await v2.commit({ savedAt: 300, baseAt: 200, version: 1, globals: '{"settings":{"theme":"dark"}}', order: ['ses_big'], sessions: { ses_big: small } });
    expect(r.status).toBe(409);
  });

  it('a legacy whole-state PUT becomes a commit when format 2 exists', async () => {
    const legacy = format1({ ses_a: session('ses_a') });
    const { v2 } = setup(legacy);
    await v2.commit(commitOf(legacy, 100));
    const newer = format1({ ses_a: session('ses_a', 2), ses_z: session('ses_z') }, 200, { theme: 'light' });
    expect((await v2.commitLegacy(newer.replace('"baseAt":0', '"baseAt":101'))).status).toBe(204);
    expect(JSON.parse((await v2.read())!).state).toEqual(JSON.parse(newer).state);
  });

  it('rejects malformed commits without touching the store', async () => {
    const { v2 } = setup(format1({ ses_a: session('ses_a') }));
    expect((await v2.commit({ savedAt: 1, baseAt: 0, version: 1, globals: '{}', order: ['../evil'], sessions: {} })).status).toBe(400);
    expect((await v2.commit({ savedAt: 1, baseAt: 0, version: 1, globals: 'nope', order: [], sessions: {} })).status).toBe(400);
    expect((await v2.commit({ savedAt: 1, baseAt: 0, version: 1, globals: '{}', order: ['ses_a'], sessions: { ses_x: '{}' } })).status).toBe(400);
  });
});

describe('store format 2: reversal', () => {
  it('exporting restores a format-1 state.json with the latest state, keeping the previous file', async () => {
    const legacy = format1({ ses_a: session('ses_a') });
    const { dir, v2 } = setup(legacy);
    await v2.commit(commitOf(legacy, 100));
    const newer = format1({ ses_a: session('ses_a', 4) }, 200);
    await v2.commitLegacy(newer.replace('"baseAt":0', '"baseAt":101'));
    expect((await exportToFormat1(dir)).exported).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')).state).toEqual(JSON.parse(newer).state);
    expect(readdirSync(join(dir, 'backups')).some((f) => f.startsWith('before-export-'))).toBe(true);
  });

  it('removing store-v2 returns the app to the format-1 file it still has', async () => {
    const legacy = format1({ ses_a: session('ses_a') });
    const { dir, v2 } = setup(legacy);
    await v2.commit(commitOf(legacy, 100));
    mkdirSync(join(dir, 'backups', 'reverted'), { recursive: true });
    expect(await createStoreV2(dir).readHead()).not.toBeNull();
    writeFileSync(join(dir, 'state.json'), legacy);
    expect(readFileSync(join(dir, 'state.json'), 'utf8')).toBe(legacy);
  });
});

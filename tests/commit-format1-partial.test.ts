// @ts-nocheck -- a real server store in a temporary folder (like state-conflict.test.ts); the project has no @types/node.
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createStoreV2 } from '../server/store-v2.js';

const SESSION = (id, name) => `{"id":"${id}","name":"${name}","layers":[]}`;

describe('format 1 on disk, the first format-2 commit', () => {
  function formatOneDir() {
    const dir = mkdtempSync(join(tmpdir(), 'ogs-v2-'));
    // The state the app wrote before format 2: one state.json, two sessions, no store-v2 folder yet.
    const text = `{"savedAt":1000,"state":{"sessions":{"ses_a":${SESSION('ses_a', 'A')},"ses_b":${SESSION('ses_b', 'B')}}},"version":1}`;
    writeFileSync(join(dir, 'state.json'), text);
    mkdirSync(join(dir, 'backups'), { recursive: true });
    return dir;
  }
  const globals = '{"ui":{"tool":"brush"}}';

  it('a partial commit (only the changed session) is refused with the reason', async () => {
    const v2 = createStoreV2(formatOneDir());
    const r = await v2.commit({ savedAt: 2000, baseAt: 1000, version: 1, globals, order: ['ses_a', 'ses_b'], sessions: { ses_b: SESSION('ses_b', 'B2') } });
    expect(r.status).toBe(400);
    expect(r.reason).toMatch(/^missing session ses_a/);
  });

  it('the full commit (every session) is accepted and loses no session', async () => {
    const dir = formatOneDir();
    const v2 = createStoreV2(dir);
    const r = await v2.commit({ savedAt: 2000, baseAt: 1000, version: 1, globals, order: ['ses_a', 'ses_b'], sessions: { ses_a: SESSION('ses_a', 'A'), ses_b: SESSION('ses_b', 'B2') } });
    expect(r.status).toBe(204);
    const saved = await v2.read();
    expect(saved).toContain('"ses_a"');
    expect(saved).toContain('"B2"');
    expect(readFileSync(join(dir, 'state.json'), 'utf8')).toContain('"ses_b"');
  });

  it('a commit whose globals arrive as an object is refused, and says so', async () => {
    const v2 = createStoreV2(formatOneDir());
    const r = await v2.commit({ savedAt: 2000, baseAt: 1000, version: 1, globals: { ui: {} }, order: [], sessions: {} });
    expect(r.status).toBe(400);
    expect(r.reason).toMatch(/globals must be a JSON text/);
  });
});

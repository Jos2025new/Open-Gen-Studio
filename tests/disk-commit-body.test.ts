import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The commit body carries globals and session texts as JSON strings; a refused partial commit is retried once with every session.
describe('disk commit body and retry', () => {
  let puts: string[] = [];
  let answers: Array<{ status: number; text?: string }> = [];
  beforeEach(() => {
    vi.resetModules();
    puts = []; answers = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      if (String(url).endsWith('/ping')) return new Response('ok', { status: 200 });
      puts.push(init?.body ?? '');
      const a = answers.shift() ?? { status: 204 };
      return new Response(a.text ?? null, { status: a.status });
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  const commit = (all?: boolean) => ({
    savedAt: 2000, version: 1, globals: '{"ui":{}}', order: ['ses_a', 'ses_b'],
    changed: [['ses_b', '{"id":"ses_b"}']] as Array<[string, string]>,
    ...(all ? { all: [['ses_a', '{"id":"ses_a"}'], ['ses_b', '{"id":"ses_b"}']] as Array<[string, string]> } : {}),
  });

  it('globals and sessions are sent as strings the server can read', async () => {
    const { disk } = await import('../src/lib/disk');
    answers = [{ status: 204 }];
    await disk.setCommit(commit());
    const body = JSON.parse(puts[0]);
    expect(typeof body.globals).toBe('string');
    expect(body.sessions.ses_b).toBe('{"id":"ses_b"}');
  });

  it('a refused partial commit is retried once with every session, then accepted', async () => {
    const { disk } = await import('../src/lib/disk');
    answers = [{ status: 400, text: 'missing session ses_a: send every session' }, { status: 204 }];
    expect(await disk.setCommit(commit(true))).toBe('ok');
    expect(puts).toHaveLength(2);
    expect(Object.keys(JSON.parse(puts[1]).sessions).sort()).toEqual(['ses_a', 'ses_b']);
  });

  it('another 400 is not retried', async () => {
    const { disk } = await import('../src/lib/disk');
    answers = [{ status: 400, text: 'globals must be a JSON text' }];
    expect(await disk.setCommit(commit(true))).toBe('fail');
    expect(puts).toHaveLength(1);
  });
});

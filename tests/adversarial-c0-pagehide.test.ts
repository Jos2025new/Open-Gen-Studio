// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const commit = () => ({
  savedAt: 2000,
  version: 1,
  globals: '{"ui":{}}',
  order: ['ses_a'],
  changed: [['ses_a', '{"id":"ses_a"}']] as Array<[string, string]>,
});

describe('C0 pagehide warning boundary', () => {
  let saveResponse: (url: string, init?: RequestInit) => Response | Promise<Response>;
  let disk: typeof import('../src/lib/disk').disk;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    // Modules from earlier cases retain their window listeners after resetModules().
    window.dispatchEvent(new PageTransitionEvent('pageshow'));
    vi.resetModules();
    saveResponse = () => new Response(null, { status: 204 });
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (url === '/x/store/ping') return Promise.resolve(new Response('ok'));
      return Promise.resolve(saveResponse(url, init));
    }));
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    ({ disk } = await import('../src/lib/disk'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const hide = () => window.dispatchEvent(new PageTransitionEvent('pagehide'));
  const show = () => window.dispatchEvent(new PageTransitionEvent('pageshow'));

  it.each([418, 500])('warns for HTTP %i after pagehide on v2 commits', async (status) => {
    saveResponse = () => new Response('upstream failure', { status });
    hide();

    expect(await disk.setCommit(commit())).toBe('fail');
    expect(warn).toHaveBeenCalledWith('Disk copy: could not save state', `HTTP ${status}`);
  });

  it('warns for an HTTP failure after pagehide on setState', async () => {
    saveResponse = () => new Response('unavailable', { status: 503 });
    hide();

    expect(await disk.setState('{"savedAt":2000,"state":{}}')).toBe('fail');
    expect(warn).toHaveBeenCalledWith('Disk copy: could not save state', 'HTTP 503');
  });

  it('warns for the v2 network TypeError during pagehide only by suppressing that network failure', async () => {
    saveResponse = () => { throw new TypeError('Failed to fetch'); };
    hide();

    expect(await disk.setCommit(commit())).toBe('fail');
    expect(warn).not.toHaveBeenCalled();
  });

  it('applies the same pagehide TypeError suppression to setState', async () => {
    saveResponse = () => { throw new TypeError('Failed to fetch'); };
    hide();

    expect(await disk.setState('{"savedAt":2000,"state":{}}')).toBe('fail');
    expect(warn).not.toHaveBeenCalled();
  });

  it('does not suppress TypeError when pagehide did not happen', async () => {
    saveResponse = () => { throw new TypeError('Failed to fetch'); };

    expect(await disk.setCommit(commit())).toBe('fail');
    expect(warn).toHaveBeenCalledWith('Disk copy: could not save state', expect.any(TypeError));
  });

  it('restores warnings after pagehide followed by pageshow', async () => {
    saveResponse = () => { throw new TypeError('Failed to fetch'); };
    hide();
    show();

    expect(await disk.setState('{"savedAt":2000,"state":{}}')).toBe('fail');
    expect(warn).toHaveBeenCalledWith('Disk copy: could not save state', expect.any(TypeError));
  });

  it('warns for every HTTP failure in a series after pagehide', async () => {
    const statuses = [502, 503];
    saveResponse = () => new Response('server failure', { status: statuses.shift() });
    hide();

    expect(await disk.setCommit(commit())).toBe('fail');
    expect(await disk.setCommit({ ...commit(), savedAt: 3000 })).toBe('fail');
    expect(warn.mock.calls.map(([message, detail]) => [message, detail])).toEqual([
      ['Disk copy: could not save state', 'HTTP 502'],
      ['Disk copy: could not save state', 'HTTP 503'],
    ]);
  });

  it('does not classify AbortError as the quiet network TypeError during pagehide', async () => {
    saveResponse = () => { throw new DOMException('request aborted', 'AbortError'); };
    hide();

    expect(await disk.setCommit(commit())).toBe('fail');
    expect(warn).toHaveBeenCalledWith('Disk copy: could not save state', expect.any(DOMException));
  });

  it('warns for a non-JSON HTTP error response during pagehide', async () => {
    saveResponse = () => new Response('<html>gateway error</html>', { status: 502 });
    hide();

    expect(await disk.setCommit(commit())).toBe('fail');
    expect(warn).toHaveBeenCalledWith('Disk copy: could not save state', 'HTTP 502');
  });

  it.each(['commit', 'state'] as const)('warns for HTTP 409 on %s after pagehide, including a non-JSON body', async (kind) => {
    saveResponse = () => new Response('conflict', { status: 409 });
    hide();

    const result = kind === 'commit'
      ? await disk.setCommit(commit())
      : await disk.setState('{"savedAt":2000,"state":{}}');
    expect(result).toBe('conflict');
    expect(warn).toHaveBeenCalledWith('Disk copy: could not save state', 'HTTP 409');
  });
});

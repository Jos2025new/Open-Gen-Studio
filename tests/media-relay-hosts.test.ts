import { afterEach, describe, expect, it, vi } from 'vitest';
import { mediaHostAllowed } from '../src/lib/mediaHosts';
import { fetchBlob } from '../src/lib/media';
import { notKept } from '../src/engine/keepResult';
import { useAlerts } from '../src/engine/alerts';

afterEach(() => { vi.unstubAllGlobals(); useAlerts.setState({ alerts: [] }); });
const NANO = '1582531d6020f89735962a5d51046adb.r2.cloudflarestorage.com';

describe('media relay hosts', () => {
  it("relays NanoGPT's R2 bucket by its exact host, not every R2 bucket or a look-alike", () => {
    expect(mediaHostAllowed(NANO)).toBe(true);
    expect(mediaHostAllowed('ark-content.volces.com')).toBe(true);
    expect(mediaHostAllowed('otherbucket.r2.cloudflarestorage.com')).toBe(false);
    expect(mediaHostAllowed(`${NANO}.evil.example`)).toBe(false);
    expect(mediaHostAllowed('evil.example')).toBe(false);
  });
  it('a host the relay refuses gives an error that names it', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response('host not allowed', { status: 403 })));
    await expect(fetchBlob('https://cdn.unknown.example/a.png')).rejects.toThrow('Download failed (403): the local server does not relay downloads from cdn.unknown.example');
  });
  it("a refusal from the provider's storage through the relay says so", async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response('upstream failed', { status: 403 })));
    await expect(fetchBlob(`https://${NANO}/a.png`)).rejects.toThrow(`Download failed (403): ${NANO} refused the download`);
  });
  it('a result that could not be kept is said once per reason, not only logged', () => {
    notKept('keep a remote result')(new Error('Download failed (403): x'));
    notKept('keep a remote result')(new Error('Download failed (403): x'));
    notKept('download result')(new Error('Download failed (500)'));
    const alerts = useAlerts.getState().alerts;
    expect(alerts).toHaveLength(2);
    expect(alerts[0].level).toBe('warn');
    expect(alerts[0].text).toContain('could not be saved on this computer');
  });
});

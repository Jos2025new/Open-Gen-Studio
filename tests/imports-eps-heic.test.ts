import { describe, expect, it, vi } from 'vitest';

vi.mock('heic2any', () => ({ default: async () => new Blob(['png'], { type: 'image/png' }) }));
import { EPS_NEEDS_GHOSTSCRIPT, EPS_PREVIEW_ONLY, convertEps, prepareImportFile } from '../src/lib/imports';

const eps = new File(['%!PS'], 'logo.eps', { type: 'application/postscript' });
const reply = (status: number, body: unknown = null) => (async () => new Response(body === null ? new Blob(['png']) : JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('EPS import', () => {
  it('converts through the local store and names the PNG after the file', async () => {
    const out = await convertEps(eps, reply(200));
    expect(out).toBeInstanceOf(File);
    expect((out as File).name).toBe('logo.png');
    expect((out as File).type).toBe('image/png');
  });
  it('without Ghostscript and with no preview, says to install it', async () => {
    expect(await convertEps(eps, reply(501, { preview: null }))).toBe(EPS_NEEDS_GHOSTSCRIPT);
  });
  it('with only a TIFF preview, says it is low resolution and what to install', async () => {
    expect(await convertEps(eps, reply(501, { preview: 'tiff' }))).toBe(EPS_PREVIEW_ONLY);
  });
  it('without a reachable store, says to install Ghostscript', async () => {
    const down = (async () => { throw new TypeError('offline'); }) as unknown as typeof fetch;
    expect(await convertEps(eps, down)).toBe(EPS_NEEDS_GHOSTSCRIPT);
  });
  it('an image the browser shows passes through untouched', async () => {
    const png = new File(['x'], 'a.png', { type: 'image/png' });
    expect(await prepareImportFile(png)).toBe(png);
  });
  it('a HEIC is decoded in the browser by the lazily loaded decoder', async () => {
    const out = await prepareImportFile(new File(['h'], 'photo.heic', { type: 'image/heic' }));
    expect((out as File).name).toBe('photo.png');
    expect((out as File).type).toBe('image/png');
  });
});

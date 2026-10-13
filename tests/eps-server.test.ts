// @ts-nocheck -- Node fs and Buffer in a test; the project has no @types/node (same as debug-info.test.ts).
import { describe, expect, it } from 'vitest';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { convertEps, epsPreview, handleEps } from '../server/eps.js';

// A fake `gs`: records the arguments and writes a PNG where -sOutputFile points.
function fakeGs(opts: { fail?: boolean } = {}) {
  const calls: Array<{ cmd: string; args: string[] }> = [];
  const exec = (cmd: string, args: string[], _o: unknown, cb: (err: Error | null) => void) => {
    calls.push({ cmd, args });
    const out = args.find((a) => a.startsWith('-sOutputFile='))!.slice('-sOutputFile='.length);
    if (opts.fail) return cb(new Error('gs failed'));
    writeFile(out, Buffer.from('PNGDATA')).then(() => cb(null));
  };
  return { exec, calls };
}

// A small DOS EPS: magic, PS at 30, TIFF at 30+4 (preview of 4 bytes at offset 34).
function dosEps(): Buffer {
  const head = Buffer.alloc(30);
  head.writeUInt32LE(0xc6d3d0c5 >>> 0, 0);
  head.writeUInt32LE(30, 4); head.writeUInt32LE(4, 8);
  head.writeUInt32LE(0, 12); head.writeUInt32LE(0, 16);
  head.writeUInt32LE(34, 20); head.writeUInt32LE(4, 24);
  return Buffer.concat([head, Buffer.from('%!PS'), Buffer.from('TIFF')]);
}

describe('EPS conversion (server)', () => {
  it('runs gs in safe mode on a file it made, and removes its folder afterwards', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'eps-test-'));
    const gs = fakeGs();
    const png = await convertEps(Buffer.from('%!PS'), { exec: gs.exec, tmp });
    expect(png.toString()).toBe('PNGDATA');
    const args = gs.calls[0].args;
    expect(gs.calls[0].cmd).toBe('gs');
    expect(args).toContain('-dSAFER');
    expect(args).toContain('-sDEVICE=pngalpha');
    expect(args.find((a) => a.endsWith('.eps'))).toMatch(/in\.eps$/);
    expect(await readdir(tmp)).toEqual([]);
  });
  it('removes its folder even when gs fails, and reports the failure', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'eps-test-'));
    await expect(convertEps(Buffer.from('%!PS'), { exec: fakeGs({ fail: true }).exec, tmp })).rejects.toThrow();
    expect(await readdir(tmp)).toEqual([]);
  });
});

describe('EPS preview and the answer without gs', () => {
  it('reads the TIFF preview a DOS EPS carries', () => {
    const p = epsPreview(dosEps());
    expect(p?.kind).toBe('tiff');
    expect(p?.bytes.toString()).toBe('TIFF');
  });
  it('a plain EPS has no preview', () => {
    expect(epsPreview(Buffer.from('%!PS-Adobe-3.0 EPSF-3.0'))).toBeNull();
  });
  it('without gs: 501 with the preview kind, or null', async () => {
    const withPreview = await handleEps(dosEps(), { hasGs: async () => false });
    expect(withPreview.status).toBe(501);
    expect(JSON.parse(withPreview.body)).toEqual({ preview: 'tiff' });
    const plain = await handleEps(Buffer.from('%!PS'), { hasGs: async () => false });
    expect(JSON.parse(plain.body)).toEqual({ preview: null });
  });
  it('refuses an empty or oversize body', async () => {
    expect((await handleEps(Buffer.alloc(0), { hasGs: async () => true })).status).toBe(400);
    expect((await handleEps(Buffer.alloc(25 * 1024 * 1024 + 1), { hasGs: async () => true })).status).toBe(413);
  });
  it('with gs: converts and answers PNG', async () => {
    const r = await handleEps(Buffer.from('%!PS'), { hasGs: async () => true, convert: async () => Buffer.from('PNG') });
    expect(r.status).toBe(200);
    expect(r.type).toBe('image/png');
  });
});

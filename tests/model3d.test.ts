import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { GLB_MIME, unpackModel, validateGlb } from '../src/lib/model3d';

function glb(json: Record<string, unknown> = { asset: { version: '2.0' } }): Blob {
  const text = JSON.stringify(json);
  const padded = `${text}${' '.repeat((4 - (text.length % 4)) % 4)}`;
  const bytes = new Uint8Array(20 + padded.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.length, true);
  view.setUint32(12, padded.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.set(strToU8(padded), 20);
  return new Blob([bytes], { type: GLB_MIME });
}

describe('3D asset input', () => {
  it('accepts a self-contained GLB and rejects external resources', async () => {
    await expect(validateGlb(glb())).resolves.toBeUndefined();
    await expect(validateGlb(glb({ asset: { version: '2.0' }, buffers: [{ uri: 'https://example.test/model.bin' }] }))).rejects.toThrow('external');
  });

  it('extracts exactly one GLB from a ZIP without trusting its filename', async () => {
    const source = glb();
    const zipped = new Blob([zipSync({ 'model.glb': new Uint8Array(await source.arrayBuffer()) })], { type: 'application/zip' });
    const out = await unpackModel(zipped);
    expect(out.type).toBe(GLB_MIME);
    expect(await out.arrayBuffer()).toEqual(await source.arrayBuffer());
  });

  it('rejects ZIPs without one safe GLB', async () => {
    const bad = new Blob([zipSync({ '../model.glb': new Uint8Array(await glb().arrayBuffer()) })]);
    await expect(unpackModel(bad)).rejects.toThrow('unsafe');
  });
});

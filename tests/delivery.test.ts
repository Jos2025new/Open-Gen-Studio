import { describe, expect, it } from 'vitest';
import { deliveryNotes, hasAudioTrack } from '../src/engine/delivery';
import type { Asset, Generation } from '../src/engine/types';

const mp4 = (...handlers: string[]) =>
  new Blob([new Uint8Array([0, 0, 0, 8, 0x66, 0x74, 0x79, 0x70]), ...handlers.map((h) => new TextEncoder().encode(`\0\0\0\x21hdlr\0\0\0\0\0\0\0\0${h}rest`))], { type: 'video/mp4' });

const gen = (over: Partial<Generation>): Generation =>
  ({ id: 'g', kind: 'video', settings: { count: 1, advanced: {} }, assetIds: [], inputs: { refs: [] }, ...over }) as Generation;
const asset = (over: Partial<Asset>): Asset => ({ id: 'a', kind: 'video', mime: 'video/mp4', width: 1080, height: 1920, ...over }) as Asset;

describe('delivered vs requested (O3)', () => {
  it('reads the sound track from the MP4 handler boxes', async () => {
    expect(await hasAudioTrack(mp4('vide', 'soun'))).toBe(true);
    expect(await hasAudioTrack(mp4('vide'))).toBe(false);
    expect(await hasAudioTrack(new Blob(['webm'], { type: 'video/webm' }))).toBeNull();
  });

  it('notes shape, length, sound and count that differ', async () => {
    const g = gen({ settings: { count: 1, aspect: '9:16', duration: 8, audio: true, advanced: {} } });
    const notes = await deliveryNotes(g, [asset({ width: 640, height: 640, duration: 5 })], async () => mp4('vide'));
    expect(notes).toEqual(['asked 9:16, got 1:1 (640×640)', 'asked 8s, got 5s', 'asked with sound, came silent']);
    const img = gen({ kind: 'image', settings: { count: 4, aspect: '16:9', advanced: {} } });
    expect(await deliveryNotes(img, [asset({ kind: 'image', width: 1920, height: 1080 })], async () => undefined)).toEqual(['asked 4 images, got 1']);
  });

  it('says nothing when it matches, for Auto shapes and for ops that keep the source shape', async () => {
    const ok = gen({ settings: { count: 1, aspect: '9:16', duration: 5, audio: true, advanced: {} } });
    expect(await deliveryNotes(ok, [asset({ duration: 5.04 })], async () => mp4('vide', 'soun'))).toEqual([]);
    expect(await deliveryNotes(gen({ settings: { count: 1, aspect: 'auto', advanced: {} } }), [asset({ width: 640, height: 640 })], async () => undefined)).toEqual([]);
    const relight = gen({ kind: 'image', op: { id: 'relight', params: {}, sourceAssetId: 's' }, settings: { count: 1, aspect: '16:9', advanced: {} } });
    expect(await deliveryNotes(relight, [asset({ kind: 'image', width: 640, height: 640 })], async () => undefined)).toEqual([]);
  });
});

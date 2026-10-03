import { aspectLabel, ratioOf } from './params';
import type { Asset, Generation } from './types';

/*
 * O3 · Delivered vs requested (OpenMontage "delivery promise"): after a result is saved, compare what came back
 * with what was asked — shape, length, sound and count. Local reads of the saved file; no network, no model call.
 */

const COMMON: Array<[number, number]> = [[1, 1], [4, 3], [3, 4], [3, 2], [2, 3], [16, 9], [9, 16], [21, 9], [9, 21], [5, 4], [4, 5]];

/** "1:1", "16:9"… for a pixel size; the reduced pair when no common ratio is close. */
export function shapeLabel(w: number, h: number): string {
  const r = w / h;
  const near = COMMON.find(([a, b]) => Math.abs(Math.log(a / b / r)) < 0.03);
  if (near) return `${near[0]}:${near[1]}`;
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const g = gcd(w, h);
  return `${w / g}:${h / g}`;
}

/**
 * Whether an MP4/MOV file has a sound track: a `hdlr` box whose handler type is `soun`. null when the container
 * cannot be read this way (WebM, a truncated file).
 */
export async function hasAudioTrack(blob: Blob): Promise<boolean | null> {
  if (!/mp4|quicktime|mov/.test(blob.type) && blob.type !== '') return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let video = false;
  for (let i = 0; i + 16 <= bytes.length; i++) {
    // 'hdlr' = 68 64 6c 72; the handler type sits 8 bytes after the box type (version/flags, pre_defined).
    if (bytes[i] !== 0x68 || bytes[i + 1] !== 0x64 || bytes[i + 2] !== 0x6c || bytes[i + 3] !== 0x72) continue;
    const type = String.fromCharCode(bytes[i + 12], bytes[i + 13], bytes[i + 14], bytes[i + 15]);
    if (type === 'soun') return true;
    if (type === 'vide') video = true;
  }
  return video ? false : null;
}

/** What came back different from what was asked, in plain words ("asked 9:16, got 1:1 (640×640)"). */
export async function deliveryNotes(g: Generation, assets: Asset[], blobOf: (id: string) => Promise<Blob | undefined>): Promise<string[]> {
  const notes: string[] = [];
  const media = assets.filter((a) => a.kind === g.kind);
  if (g.kind !== 'image' && g.kind !== 'video') return notes;
  const want = g.settings.count;
  if (want > 1 && media.length < want) notes.push(`asked ${want} ${g.kind === 'image' ? 'images' : 'clips'}, got ${media.length}`);
  const first = media[0];
  if (!first) return notes;
  const wantRatio = g.op && g.op.id !== 'reframe' ? null : ratioOf(g.settings.aspect);
  if (wantRatio && first.width && first.height && Math.abs(Math.log(first.width / first.height / wantRatio)) > 0.04) {
    notes.push(`asked ${aspectLabel(g.settings.aspect)}, got ${shapeLabel(first.width, first.height)} (${first.width}×${first.height})`);
  }
  if (g.kind === 'video') {
    const asked = g.settings.duration;
    if (asked && asked > 0 && first.duration && Math.abs(first.duration - asked) > Math.max(1, asked * 0.15)) {
      notes.push(`asked ${asked}s, got ${Math.round(first.duration * 10) / 10}s`);
    }
    if (g.settings.audio === true) {
      const blob = await blobOf(first.id).catch(() => undefined);
      if (blob && (await hasAudioTrack(blob)) === false) notes.push('asked with sound, came silent');
    }
  }
  return notes;
}

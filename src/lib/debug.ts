/*
 * What a request debug record may contain (T5): the endpoint and the mapped parameters, never a key and never the
 * media. A provider that refuses a request ("Upstream access denied") tells nothing about what it received, and
 * without this there is no way to find out. Everything here is for reading, never for re-sending.
 */

/** Fields whose value is a secret whatever it is called. */
const SECRET_KEY = /^(key|api[-_]?key|apikey|token|access[-_]?token|refresh[-_]?token|authorization|auth|secret|password|passwd|signature|bearer)$/i;
/** A data URL or anything that smells like a key or a long blob. */
const BLOB = /^(data:[\w/+.-]+;base64,)|^[A-Za-z0-9+/_-]{120,}={0,2}$/;
const LONG_TEXT = 600;

export interface SentRequest {
  url: string;
  /** Which request this is, counting from 1: a retry or a further candidate is a later one. */
  attempt: number;
  /** The parameters as the provider will read them, with media replaced by what it was. */
  params: Record<string, unknown>;
  /** The provider's job id, once it answers. */
  jobId?: string;
}

/** What a piece of media looked like, so the record says "<image 1024×1024>" instead of its bytes. */
export interface MediaInfoLite {
  mime?: string;
  width?: number;
  height?: number;
}

/** "<image 1024×1024>", "<video 1280×720>"…; anything unknown is just "<media>". */
export function mediaLabel(m: MediaInfoLite | undefined): string {
  const kind = m?.mime?.startsWith('video') ? 'video' : m?.mime?.startsWith('image') ? 'image' : m?.mime?.startsWith('audio') ? 'audio' : 'media';
  const size = m?.width && m?.height ? ` ${m.width}×${m.height}` : '';
  return `<${kind}${size}>`;
}

/** Width and height from the first bytes of a PNG, JPEG, WebP or GIF; undefined for anything else. */
export function imageSize(b: Uint8Array): { width: number; height: number } | undefined {
  const at = (i: number, s: string) => [...s].every((ch, k) => b[i + k] === ch.charCodeAt(0));
  const be16 = (i: number) => (b[i] << 8) | b[i + 1];
  const le16 = (i: number) => b[i] | (b[i + 1] << 8);
  if (b[0] === 0x89 && at(1, 'PNG')) return { width: (be16(16) << 16) | be16(18), height: (be16(20) << 16) | be16(22) };
  if (at(0, 'GIF8')) return { width: le16(6), height: le16(8) };
  if (at(0, 'RIFF') && at(8, 'WEBP')) {
    if (at(12, 'VP8X')) return { width: 1 + (le16(24) | (b[26] << 16)), height: 1 + (le16(27) | (b[29] << 16)) };
    if (at(12, 'VP8 ')) return { width: le16(26) & 0x3fff, height: le16(28) & 0x3fff };
    if (at(12, 'VP8L')) return { width: 1 + (le16(21) & 0x3fff), height: 1 + (((b[22] >> 6) | (b[23] << 2) | (b[24] << 10)) & 0x3fff) };
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length && b[i] === 0xff; i += 2 + be16(i + 2)) {
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { width: be16(i + 7), height: be16(i + 5) };
    }
  }
  return undefined;
}

/** "<image 1376×768, 1.2 MB>" read from the data itself, so each image of a request is named for what it is. */
function inlineLabel(value: string): string | undefined {
  const prefix = /^data:([\w/+.-]+);base64,/.exec(value);
  const b64 = prefix ? value.slice(prefix[0].length) : value;
  const decode = (chars: number) => {
    const bin = atob(b64.slice(0, chars - (chars % 4)).replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  };
  let dims: { width: number; height: number } | undefined;
  try {
    // The first ~64 KB hold the header almost always; a JPEG whose metadata (EXIF, ICC) runs past them is read whole.
    dims = imageSize(decode(87_380)) ?? (b64.length > 87_380 ? imageSize(decode(b64.length)) : undefined);
  } catch {
    return undefined;
  }
  const kind = prefix?.[1].split('/')[0];
  if (!dims) return kind ? `<${kind}, ${sizeText(b64)}>` : undefined;
  return `<image ${dims.width}×${dims.height}, ${sizeText(b64)}>`;
}

function sizeText(b64: string): string {
  const n = Math.floor((b64.length * 3) / 4);
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`;
}

/** Keys, media and endless base64 never reach a file: they become a marker or a label. */
export function redact(value: unknown, media?: MediaInfoLite): unknown {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    // Undecodable: the kind only. Sizes from `media` would be one input's, not necessarily this one's.
    if (BLOB.test(value)) return inlineLabel(value) ?? mediaLabel(media && { mime: media.mime });
    return value.length > LONG_TEXT ? `${value.slice(0, LONG_TEXT)}… (${value.length} chars)` : value;
  }
  if (Array.isArray(value)) return value.slice(0, 12).map((v) => redact(v, media));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = SECRET_KEY.test(k) ? '[redacted]' : redact(v, media);
    return out;
  }
  return String(value);
}

/** The record a generation keeps: what went out, on which try. Keys and media are already out of the way. */
export function describeRequest(input: { url: string; attempt: number; body: unknown; media?: MediaInfoLite[] }): SentRequest {
  const one = input.media?.[0];
  return {
    url: input.url.slice(0, 300),
    attempt: input.attempt,
    params: redact(input.body, one) as Record<string, unknown>,
  };
}

/** The same rules for anything else that gets written down (a log line, an error report). */
export function safeData(data: unknown): unknown {
  return redact(data);
}

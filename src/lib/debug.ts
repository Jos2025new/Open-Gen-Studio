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

/** Keys, media and endless base64 never reach a file: they become a marker or a label. */
export function redact(value: unknown, media?: MediaInfoLite): unknown {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (BLOB.test(value)) return mediaLabel(media);
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

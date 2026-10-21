/*
 * Hosts the local media relay (/x/media, vite.config.ts) downloads from: some providers hand back results on storage
 * without CORS, so the browser can neither save nor read them. A fixed list, not an open proxy (docs/seguridad.md).
 * - Atlas/BytePlus/Alibaba storage by domain.
 * - NanoGPT's results bucket on Cloudflare R2 by its exact host only (not every R2 bucket).
 */
const MEDIA_DOMAINS = /(^|\.)(volces\.com|bytepluses\.com|atlascloud\.ai|aliyuncs\.com)$/;
const MEDIA_EXACT = new Set(['1582531d6020f89735962a5d51046adb.r2.cloudflarestorage.com']);

export function mediaHostAllowed(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return MEDIA_DOMAINS.test(h) || MEDIA_EXACT.has(h);
}

/** A URL the relay may download: https, an allowed host and the default port (url.port is '' for 443), never an allowed host's other ports. */
export function mediaUrlAllowed(url: URL): boolean {
  return url.protocol === 'https:' && url.port === '' && mediaHostAllowed(url.hostname);
}

/** The relay's answer for a host outside the list (the client turns it into a readable error). */
export const HOST_NOT_ALLOWED = 'host not allowed';

/** Redirects the relay follows itself (each hop is checked like the first URL): 20, the limit browsers and fetch use. */
export const MAX_HOPS = 20;

/** The relay's answer when a download redirects more than MAX_HOPS times (a loop, not a refused host). */
export const TOO_MANY_REDIRECTS = 'too many redirects';

/**
 * Where a relayed download goes next: `location` resolved against `current`, only if it is https and an allowed host.
 * The refusal carries the host to name (the relay answers `host not allowed: <host>` for a hop, the client names it).
 */
export function nextHop(current: URL, location: string, hop: number): { url: URL } | { refused: string } | { tooMany: true } {
  if (hop > MAX_HOPS) return { tooMany: true };
  let url: URL;
  try { url = new URL(location, current); } catch { return { refused: current.hostname }; }
  if (!mediaUrlAllowed(url)) return { refused: url.hostname || current.hostname };
  return { url };
}

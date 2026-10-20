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

/** The relay's answer for a host outside the list (the client turns it into a readable error). */
export const HOST_NOT_ALLOWED = 'host not allowed';

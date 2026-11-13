import { LOCAL_WRITE } from './disk';

/**
 * Provider hosts whose calls carry an API key. With a stored key the page holds only a marker (`ogs:****1234`) and the
 * local server adds the real key (server/provider-proxy.js, which keeps its own copy of this list; a test compares them).
 */
export const KEYED_HOSTS: Record<string, string> = {
  'api.fal.ai': 'fal',
  'queue.fal.run': 'fal',
  'openrouter.ai': 'openrouter',
  'nano-gpt.com': 'nanogpt',
  'api.atlascloud.ai': 'atlas',
};

/** What the page keeps instead of a key. ASCII: it can travel in a header. */
export const KEY_MARKER = 'ogs:';
export const isKeyMarker = (v: unknown): v is string => typeof v === 'string' && v.startsWith(KEY_MARKER);
const MARKED = /(^|\s)ogs:\*{4}/;

/**
 * `fetch` for provider calls. A request that carries a key marker goes through the local server (POST /x/store/proxy),
 * which adds the real key; the request keeps its method, body (also uploads) and signal, and the answer streams back with
 * the provider's status and text. Anything else (no key, a real key held in the page because the server is not there, any
 * other host) is a plain fetch, as before.
 */
export function providerFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const auth = `${headers.get('authorization') ?? ''} ${headers.get('x-api-key') ?? ''}`;
  let url: URL | null = null;
  try { url = new URL(input, typeof location === 'undefined' ? undefined : location.href); } catch { /* plain fetch decides */ }
  if (!url || url.protocol !== 'https:' || !(url.hostname in KEYED_HOSTS) || !MARKED.test(auth)) return fetch(input, init);
  headers.delete('authorization');
  headers.delete('x-api-key');
  headers.set('X-OGS-Target', url.href);
  headers.set('X-OGS-Method', (init.method ?? 'GET').toUpperCase());
  headers.set('X-OGS-Auth', '1');
  for (const [k, v] of Object.entries(LOCAL_WRITE)) headers.set(k, v);
  const { method: _m, headers: _h, ...rest } = init;
  return fetch('/x/store/proxy', { ...rest, method: 'POST', headers, body: ['GET', 'HEAD'].includes((init.method ?? 'GET').toUpperCase()) ? undefined : init.body });
}

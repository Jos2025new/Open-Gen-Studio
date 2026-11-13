// Provider calls go through here so the page never holds an API key (docs/seguridad.md). The page POSTs to
// /x/store/proxy with the real target in X-OGS-Target (and X-OGS-Method); the server adds the provider's key by host and
// relays the answer as it came (status, error text, streamed body). Closed list of hosts: not an open proxy.
import { Readable } from 'node:stream';

/** host → provider whose key it takes. Exact hosts only; keep in step with src/lib/providerHosts.ts (a test compares them). */
export const KEYED_HOSTS = {
  'api.fal.ai': 'fal',
  'queue.fal.run': 'fal',
  'openrouter.ai': 'openrouter',
  'nano-gpt.com': 'nanogpt',
  'api.atlascloud.ai': 'atlas',
};

const METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']);
/** Request headers the server sets itself or must never carry on: the page's own auth, cookies, origin and local markers. */
const DROP_REQUEST = /^(host|connection|content-length|transfer-encoding|authorization|x-api-key|proxy-authorization|cookie|origin|referer|x-ogs.*|sec-.*|accept-encoding|keep-alive|upgrade)$/i;
const DROP_RESPONSE = /^(set-cookie|set-cookie2|content-encoding|content-length|transfer-encoding|connection|keep-alive|www-authenticate|strict-transport-security)$/i;

/** The headers a provider wants for its key. */
export function authHeaders(provider, key) {
  if (provider === 'fal') return { Authorization: `Key ${key}` };
  if (provider === 'nanogpt') return { Authorization: `Bearer ${key}`, 'x-api-key': key };
  return { Authorization: `Bearer ${key}` };
}

/**
 * Handles one proxied request (already past the loopback and X-OGS checks).
 * @returns {Promise<void>}
 */
export async function handleProxy(req, res, keys) {
  const fail = (status, msg) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ error: msg }));
  };
  let target;
  try { target = new URL(String(req.headers['x-ogs-target'] ?? '')); } catch { return fail(400, 'bad target'); }
  // https, the default port, no credentials in the URL, and a host from the list: nothing else is ever contacted.
  const provider = KEYED_HOSTS[target.hostname.toLowerCase()];
  if (target.protocol !== 'https:' || target.port !== '' || target.username || target.password || !provider) {
    return fail(403, `host not allowed: ${target.hostname || 'unknown'}`);
  }
  const method = String(req.headers['x-ogs-method'] ?? 'GET').toUpperCase();
  if (!METHODS.has(method)) return fail(400, 'bad method');
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) if (!DROP_REQUEST.test(k) && typeof v === 'string') headers[k] = v;
  if (req.headers['x-ogs-auth'] === '1') {
    const key = await keys.get(provider);
    if (!key) return fail(401, `No ${provider} key is stored. Add it in Settings.`);
    Object.assign(headers, authHeaders(provider, key));
  }
  const hasBody = method !== 'GET' && method !== 'DELETE';
  const abort = new AbortController();
  res.on('close', () => { if (!res.writableEnded) abort.abort(); });
  let upstream;
  try {
    upstream = await fetch(target, {
      method,
      headers,
      redirect: 'manual',
      signal: abort.signal,
      ...(hasBody ? { body: Readable.toWeb(req), duplex: 'half' } : {}),
    });
  } catch (err) {
    // Never the request (it carries the key): only that the provider was not reached.
    return fail(502, `Could not reach ${target.hostname}${err?.name === 'AbortError' ? ' (cancelled)' : ''}`);
  }
  res.statusCode = upstream.status;
  upstream.headers.forEach((v, k) => { if (!DROP_RESPONSE.test(k)) res.setHeader(k, v); });
  res.setHeader('Cache-Control', 'no-store');
  if (!upstream.body) return void res.end();
  const stream = Readable.fromWeb(upstream.body);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

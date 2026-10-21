import { defineConfig, type Plugin } from 'vitest/config';
import type { Connect } from 'vite';
import { localStore } from './server/local-store.js';
import react from '@vitejs/plugin-react';
import { HOST_NOT_ALLOWED, TOO_MANY_REDIRECTS, mediaHostAllowed, nextHop } from './src/lib/mediaHosts';

// Provider schema documents are served without CORS headers, so the dev and
// preview servers relay them. Generation and chat calls go direct (CORS ok).
const proxy = {
  '/x/atlas-static': {
    target: 'https://static.atlascloud.ai',
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/x\/atlas-static/, ''),
  },
  '/x/fal-web': {
    target: 'https://fal.ai',
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/x\/fal-web/, ''),
  },
};

// Some providers hand back results on storage without CORS (Atlas/BytePlus: *.volces.com), so the browser can
// neither save nor read them. The dev/preview servers relay downloads from the hosts in mediaHosts.ts only (not an open proxy).
function mediaRelay(): Plugin {
  // Node's http types are not installed in this browser project; only these members are used.
  type Res = { statusCode: number; setHeader(name: string, value: string): void; end(body?: string | Uint8Array): void };
  const handler: Connect.NextHandleFunction = async (rawReq, rawRes, next) => {
    const reqUrl = (rawReq as unknown as { url?: string }).url;
    const res = rawRes as unknown as Res;
    if (!reqUrl?.startsWith('/x/media?')) return next();
    const target = new URL(reqUrl, 'http://local').searchParams.get('url') ?? '';
    let url: URL;
    try {
      url = new URL(target);
    } catch {
      res.statusCode = 400;
      return res.end('bad url');
    }
    if (url.protocol !== 'https:' || !mediaHostAllowed(url.hostname)) {
      res.statusCode = 403;
      return res.end(HOST_NOT_ALLOWED);
    }
    // Redirects are followed here, not by fetch: every hop must pass the same https + allow-list check as the first URL.
    // One 30 s budget for the whole chain, however many hops it takes.
    const signal = AbortSignal.timeout(30_000);
    let upstream = await fetch(url, { redirect: 'manual', signal }).catch(() => null);
    for (let hop = 1; upstream && upstream.status >= 300 && upstream.status < 400 && upstream.headers.get('location'); hop++) {
      const next = nextHop(url, upstream.headers.get('location')!, hop);
      if ('tooMany' in next) {
        res.statusCode = 508;
        return res.end(TOO_MANY_REDIRECTS);
      }
      if ('refused' in next) {
        res.statusCode = 403;
        return res.end(`${HOST_NOT_ALLOWED}: ${next.refused}`);
      }
      url = next.url;
      upstream = await fetch(url, { redirect: 'manual', signal }).catch(() => null);
    }
    if (!upstream?.ok || !upstream.body) {
      res.statusCode = upstream?.status ?? 502;
      return res.end('upstream failed');
    }
    // Relayed bytes are media, never a page of the app: only media types pass as they came, nothing is sniffed, and a
    // document opened from here runs sandboxed (no effect on <img>, <video> or fetch).
    const type = upstream.headers.get('content-type') ?? '';
    res.setHeader('Content-Type', /^(image|video|audio|model)\/|^application\/(octet-stream|zip)\b/i.test(type) ? type : 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', 'sandbox');
    try { res.end(new Uint8Array(await upstream.arrayBuffer())); }
    catch { res.statusCode = 504; res.end('media download timed out'); }
  };
  return {
    name: 'media-relay',
    configureServer: (s) => void s.middlewares.use(handler),
    configurePreviewServer: (s) => void s.middlewares.use(handler),
  };
}

export default defineConfig({
  // localStore: disk copy of state and media in ./data (dev/preview only; the app has no backend).
  plugins: [react(), mediaRelay(), localStore(undefined, process.env.DATA_DIR)],
  // data/ (state with the API keys, media, backups) lives in the project folder: never serve it as a static file.
  // Vite's own defaults are kept (the list replaces them).
  server: { port: 5173, proxy, fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/data/**', '**/data.bak-*/**'] } },
  preview: { port: 4173, proxy },
  test: {
    // 20 s, not the 5 s default: on a busy machine the first test of a file pays for loading its modules and went
    // past 5 s (false failures). Tests that simulate time run on fake clocks, so this budget only covers real CPU work.
    testTimeout: 20_000,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup-writer-lock.ts'],
  },
});

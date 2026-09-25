import { defineConfig, type Plugin } from 'vitest/config';
import type { Connect } from 'vite';
import { localStore } from './server/local-store.js';
import react from '@vitejs/plugin-react';

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
// neither save nor read them. The dev/preview servers relay downloads from these hosts only (not an open proxy).
const MEDIA_HOSTS = /(^|\.)(volces\.com|bytepluses\.com|atlascloud\.ai)$/;
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
    if (url.protocol !== 'https:' || !MEDIA_HOSTS.test(url.hostname)) {
      res.statusCode = 403;
      return res.end('host not allowed');
    }
    const upstream = await fetch(url).catch(() => null);
    if (!upstream?.ok || !upstream.body) {
      res.statusCode = upstream?.status ?? 502;
      return res.end('upstream failed');
    }
    res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/octet-stream');
    res.end(new Uint8Array(await upstream.arrayBuffer()));
  };
  return {
    name: 'media-relay',
    configureServer: (s) => void s.middlewares.use(handler),
    configurePreviewServer: (s) => void s.middlewares.use(handler),
  };
}

export default defineConfig({
  // localStore: disk copy of state and media in ./data (dev/preview only; the app has no backend).
  plugins: [react(), mediaRelay(), localStore()],
  server: { port: 5173, proxy },
  preview: { port: 4173, proxy },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});

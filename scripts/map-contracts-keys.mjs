/** Checked by map.mjs: API keys and the provider proxy. */
export default [
  {
    id: 'provider-keys',
    what: 'La página no tiene claves: marcador ogs:****1234; el servidor (llavero o keys.json) las añade en /x/store/proxy a una lista cerrada de hosts.',
    sides: [
      ['src/lib/providerFetch.ts', "headers.set('X-OGS-Target', url.href);"],
      ['src/lib/providerFetch.ts', "'api.fal.ai': 'fal',"],
      ['server/provider-proxy.js', "'api.fal.ai': 'fal',"],
      ['server/provider-proxy.js', 'host not allowed'],
      ['server/local-store.js', "path === '/proxy' && req.method === 'POST'"],
      ['server/keys.js', "['store', '--label'"],
      ['src/engine/providerKeys.ts', 'export async function syncKeys'],
      ['src/lib/http.ts', 'res = await providerFetch(url'],
      ['src/lib/media.ts', 'await providerFetch(target'],
      ['src/engine/providers/llm.ts', 'await providerFetch(ENDPOINTS'],
      ['src/engine/providers/nanogptAudio.ts', 'await providerFetch(`${BASE}/v1/audio/speech`'],
    ],
    tests: ['tests/provider-proxy.test.ts'],
  },
];

/* Serves the recorded provider catalogs and schemas of tests/fixtures/live, as the providers would. */
import atlasSnapshot from './atlas.json';
import falSnapshot from './fal.json';
import nanoSnapshot from './nanogpt.json';

// The snapshot files are raw provider JSON.
type Loose = any;
export const A: Loose = atlasSnapshot;
export const F: Loose = falSnapshot;
export const N: Loose = nanoSnapshot;

export function serve(url: string): unknown {
  const u = new URL(url);
  if (u.host === 'api.atlascloud.ai' && u.pathname === '/api/v1/models') return { data: A.models };
  const atlasDoc = A.models.find((m: { schema?: string }) => m.schema === url);
  if (atlasDoc) return atlasDoc.schemaDoc;
  if (u.host === 'api.fal.ai' && u.pathname === '/v1/models') return { models: F.models.filter((m: { category: string }) => m.category === u.searchParams.get('category')), has_more: false };
  if (u.pathname.endsWith('/openapi.json')) return F.models.find((m: { endpoint_id: string }) => m.endpoint_id === u.searchParams.get('endpoint_id'))?.schemaDoc;
  if (u.pathname.endsWith('/v1/video-models')) return { data: N.video };
  if (u.pathname.endsWith('/v1/images/models')) return { data: N.image };
  if (u.pathname.endsWith('/v1/audio-models')) return { data: N.audio ?? [] };
  throw new Error(`unexpected fetch ${url}`);
}


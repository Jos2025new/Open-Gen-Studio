import { describe, expect, it, vi } from 'vitest';
import { atlas } from '../src/engine/providers/atlas';
import { fal } from '../src/engine/providers/fal';
import { nanogpt } from '../src/engine/providers/nanogpt';
import { capabilityHints } from '../src/engine/params';
import type { ProviderAdapter } from '../src/engine/providers/types';
import type { ModelSchema, ModelSummary } from '../src/engine/types';
import atlasSnapshot from './fixtures/live/atlas.json';
import falSnapshot from './fixtures/live/fal.json';
import nanoSnapshot from './fixtures/live/nanogpt.json';

/**
 * Regression net for provider parsing. tests/fixtures/live holds the real catalogs and input schemas of the
 * priority model families (scripts/model-snapshot.mjs). Every model goes through the real adapter
 * (listModels + loadSchema) and the result is compared with tests/fixtures/live/expected.txt.
 * A code change that alters how any model is read shows up as a diff there; accept it with
 * `npx vitest run -u tests/live-snapshot.test.ts` only when the change is intended.
 */
vi.mock('../src/lib/idb', () => ({ cacheDb: { get: async () => undefined, set: async () => undefined } }));

// The snapshot files are raw provider JSON.
type Loose = any;
const A: Loose = atlasSnapshot;
const F: Loose = falSnapshot;
const N: Loose = nanoSnapshot;

function serve(url: string): unknown {
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

function describeModel(m: ModelSummary, s: ModelSchema | string): string {
  const caps = [m.acceptsText && 'text', m.acceptsImage && 'image', m.acceptsVideo && 'video-in', m.needsVideo && 'NEEDS-VIDEO'].filter(Boolean).join(',');
  const lines = [`${m.ref} [${m.kind}] ${caps}`];
  if (typeof s === 'string') return [...lines, `  ERROR ${s}`].join('\n');
  const slot = (name: string, v: unknown) => {
    if (!v || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    return `${name}=${o.key}${o.multiple ? '[]' : ''}${o.max != null ? `≤${o.max}` : ''}${o.min ? ` min${o.min}` : ''}${o.format ? ` ${o.format}` : ''}`;
  };
  const slots = Object.entries(s.slots)
    .map(([k, v]) => (k === 'prompt' ? `prompt=${v}${s.slots.promptRequired ? '*' : ''}` : k === 'promptRequired' ? null : slot(k, v)))
    .filter(Boolean);
  lines.push(`  slots: ${slots.join(' ') || '-'}`);
  lines.push(`  inputs (as the agent reads them): ${capabilityHints(s, m.kind).join('; ')}`);
  for (const p of s.params) {
    const range = p.options ? `[${p.options.join(',')}]` : p.min != null || p.max != null ? `(${p.min ?? ''}..${p.max ?? ''})` : '';
    lines.push(`  ${p.key}: ${p.role} ${p.type}${range}${p.default !== undefined ? ` =${p.default}` : ''}${p.omit ? ` omit=${p.omit}` : ''}`);
  }
  if (s.fixed) lines.push(`  fixed: ${JSON.stringify(s.fixed)}`);
  if (s.missing) lines.push(`  MISSING: ${s.missing.join(', ')}`);
  return lines.join('\n');
}

async function snapshot(adapter: ProviderAdapter): Promise<string> {
  const models = (await adapter.listModels(undefined)).sort((a, b) => a.ref.localeCompare(b.ref));
  const blocks: string[] = [];
  for (const m of models) {
    let s: ModelSchema | string;
    try {
      s = await adapter.loadSchema(m, undefined);
    } catch (err) {
      s = (err as Error).message;
    }
    blocks.push(describeModel(m, s));
  }
  return blocks.join('\n');
}

describe('live provider snapshot', () => {
  it('parses every priority model as recorded', async () => {
    vi.stubGlobal('location', { href: 'http://localhost/' });
    vi.stubGlobal('fetch', async (url: string) => {
      const body = serve(url);
      return body === undefined ? new Response('not in snapshot', { status: 404 }) : new Response(JSON.stringify(body));
    });
    const header = `# Parse of the live snapshot (Atlas ${A.date}, fal ${F.date}, NanoGPT ${N.date}). Regenerate: see tests/live-snapshot.test.ts`;
    const transcribers = (await nanogpt.listTranscribers!())
      .sort((a, b) => a.ref.localeCompare(b.ref))
      .map((t) => `${t.ref} — ${t.name} · $${t.usdPerMinute ?? '?'}/min · direct ≤${(t.maxDirectBytes / 1048576).toFixed(1)} MB${t.video ? ' · video' : ''}${t.diarization ? ' · speakers' : ''}`)
      .join('\n');
    const text = [header, '', '## Atlas', await snapshot(atlas), '', '## fal', await snapshot(fal), '', '## NanoGPT', await snapshot(nanogpt), '', '## NanoGPT speech-to-text (Transcribe)', transcribers, ''].join('\n');
    await expect(text).toMatchFileSnapshot('fixtures/live/expected.txt');
    vi.unstubAllGlobals();
  }, 60_000);
});

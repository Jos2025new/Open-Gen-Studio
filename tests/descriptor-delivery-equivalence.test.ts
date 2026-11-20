import { describe, expect, it } from 'vitest';
import { normalizeAssetRevisions } from '../src/engine/assetRevisions';
import { digest } from '../src/engine/nodecore/address';
import { sourceValue, type ResolveEnv } from '../src/engine/nodecore/resolver';
import type { GraphEdge, GraphNode } from '../src/engine/types';

/* Equivalence oracle: the per-kind `if` chain `sourceValue` had before each descriptor's `evaluate` took it over. */
function legacy(src: GraphNode | undefined, edge: Pick<GraphEdge, 'outputIndex'>, env: ResolveEnv) {
  const data = src?.data;
  if (!data) return { value: null, revision: null };
  const gen = 'generationId' in data && data.generationId ? env.generations[data.generationId] : undefined;
  let value: string | null | undefined;
  let revision: string | null = null;
  let edited: true | undefined;
  if (data.kind === 'text') value = data.text;
  else if (data.kind === 'ref') value = env.chatText(src!);
  else if (data.kind === 'asset') {
    value = data.sketchAssetId ?? data.assetId;
    const rev = data.assetId ? normalizeAssetRevisions(env.assets?.[data.assetId]) : undefined;
    if (value) revision = `${value}@${rev ? `${rev.index}/${rev.versions.length}` : '0'}`;
    if (rev && rev.versions.length > 1) edited = true;
  } else {
    value = gen?.text ?? ('outputIndex' in data ? data.sketchAssetId ?? gen?.assetIds[edge.outputIndex ?? data.outputIndex] : null);
    if (value && gen) revision = `${gen.id}:${value}`;
  }
  if (value == null) return { value: null, revision: null };
  return { value, revision: revision ?? digest(value), ...(edited ? { edited } : {}) };
}

const n = (data: Record<string, unknown>): GraphNode => ({ id: 'n', position: { x: 0, y: 0 }, data: { title: 't', ...data } as never });
const env = {
  generations: {
    g1: { id: 'g1', assetIds: ['x0', 'x1'] },
    g2: { id: 'g2', assetIds: [], text: 'song words' },
    g3: { id: 'g3', assetIds: [] },
  },
  assets: {
    a1: { id: 'a1', kind: 'image' },
    a2: { id: 'a2', kind: 'image', versions: [{ id: 'v1' }, { id: 'v2' }], versionIndex: 1 },
  },
  chatText: (node: GraphNode) => (node.id === 'chat' ? 'hello' : node.id === 'empty' ? '' : undefined),
} as unknown as ResolveEnv;

describe('what a node delivers equals the former sourceValue chain', () => {
  it('delivers an asset and its base revision when the inventory is omitted', () => {
    const src = n({ kind: 'asset', assetId: 'a1' });
    const { generations, chatText } = env;
    expect(sourceValue(src, {}, { generations, chatText })).toEqual({ value: 'a1', revision: 'a1@0/0' });
  });

  const cases: [string, GraphNode | undefined][] = [
    ['no source', undefined],
    ['text', n({ kind: 'text', text: 'abc' })],
    ['empty text', n({ kind: 'text', text: '' })],
    ['chat with text', { ...n({ kind: 'ref', type: 'chat', ref: 's' }), id: 'chat' }],
    ['prompt, empty string', { ...n({ kind: 'ref', type: 'prompt', ref: 's' }), id: 'empty' }],
    ['ref without text', n({ kind: 'ref', type: 'agent', ref: 's' })],
    ['asset none', n({ kind: 'asset', assetId: null })],
    ['asset', n({ kind: 'asset', assetId: 'a1' })],
    ['asset edited', n({ kind: 'asset', assetId: 'a2' })],
    ['asset missing', n({ kind: 'asset', assetId: 'zz' })],
    ['asset sketch', n({ kind: 'asset', assetId: 'a1', sketchAssetId: 'sk' })],
    ['image pending', n({ kind: 'image', prompt: '', outputIndex: 0 })],
    ['image result', n({ kind: 'image', prompt: '', outputIndex: 0, generationId: 'g1' })],
    ['image sketch', n({ kind: 'image', prompt: '', outputIndex: 0, generationId: 'g1', sketchAssetId: 'sk' })],
    ['image no results', n({ kind: 'image', prompt: '', outputIndex: 0, generationId: 'g3' })],
    ['audio text', n({ kind: 'audio', prompt: '', outputIndex: 0, generationId: 'g2' })],
    ['tool result', n({ kind: 'tool', op: 'upscale', params: {}, outputIndex: 0, generationId: 'g1' })],
    ['unknown generation id', n({ kind: 'video', prompt: '', outputIndex: 0, generationId: 'nope' })],
  ];
  for (const [name, src] of cases) {
    for (const outputIndex of [undefined, 0, 1, 5]) {
      it(`${name}, edge index ${outputIndex}`, () => {
        expect(sourceValue(src, { outputIndex }, env)).toEqual(legacy(src, { outputIndex }, env));
      });
    }
  }
});

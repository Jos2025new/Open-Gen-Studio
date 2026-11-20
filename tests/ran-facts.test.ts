import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../src/store/store';
import { ranFacts } from '../src/engine/agent/ranFacts';
import type { Generation, ModelSummary } from '../src/engine/types';

const mk = (provider: 'atlas' | 'nanogpt', id: string, name: string) => ({ ref: `${provider}::${id}`, provider, id, name, kind: 'image', acceptsText: true, acceptsImage: true, tags: [], price: { skus: [{ unit: 'output', usd: 0.07 }] } }) as unknown as ModelSummary;
const ATLAS = mk('atlas', 'google/nano-banana-2/text-to-image', 'Nano Banana 2');
const NANO = mk('nanogpt', 'nano-banana-2', 'Nano Banana 2');

describe('ranFacts: what the agent hears about a finished step', () => {
  beforeEach(() => {
    const s = useStore.getState();
    useStore.setState({ catalog: { ...s.catalog, models: { [ATLAS.ref]: ATLAS, [NANO.ref]: NANO } } });
  });

  it('a credit switch to another provider is not "the same model, not a change", and carries the app note', () => {
    const gen = { modelRef: NANO.ref, provider: 'atlas', notes: ['Atlas Cloud had no credit, so this ran on NanoGPT (same model, same price or less).'] } as unknown as Generation;
    const text = ranFacts(gen, [{ modelRef: ATLAS.ref }], undefined).join(' | ');
    expect(text).toContain('made with Nano Banana 2 at NanoGPT');
    expect(text).toContain('NOT the confirmed provider');
    expect(text).toContain('confirmed at Atlas Cloud');
    expect(text).toContain('Atlas Cloud had no credit');
    expect(text).not.toContain('not a change');
  });

  it('the confirmed model at its own provider keeps the usual line', () => {
    const gen = { modelRef: ATLAS.ref, provider: 'atlas' } as unknown as Generation;
    expect(ranFacts(gen, [{ modelRef: ATLAS.ref }], undefined).join(' ')).toContain('made with Nano Banana 2 at Atlas Cloud');
  });
});

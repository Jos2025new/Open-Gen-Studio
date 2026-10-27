import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));

import { namesModel, requestWords } from '../src/engine/agent/userChoice';
import type { FeedItem } from '../src/engine/types';

const SEED = 'nanogpt::bytedance/seedream-v5.0-pro';
const KLEIN = 'nanogpt::blackforestlabs/flux-3/klein/text-to-image';
const ASK = 'Prueba 3 con seedream 5 y 3 con flux 2 fhas';
const PICK = 'FLUX 3 Image Klein (más barato)';

describe('namesModel: the user short way of naming a model matches its catalog entry', () => {
  it('the real run: seedream 5 names seedream-v5.0-pro', () => expect(namesModel(ASK, SEED, 'image')).toBe(true));
  it('the answer FLUX 3 Image Klein names flux-3/klein', () => expect(namesModel(`${ASK}\n${PICK}`, KLEIN, 'image')).toBe(true));
  it('seedream 4 is another model than v5.0', () => expect(namesModel('Prueba con seedream 4', SEED, 'image')).toBe(false));
  it('flux 2 is not flux 3, even with a 3 elsewhere in the text', () => expect(namesModel(ASK, KLEIN, 'image')).toBe(false));
  it('no model named: false', () => expect(namesModel('Haz una casa', SEED, 'image')).toBe(false));
  it('a bare brand without version does not choose a versioned model', () => expect(namesModel('con seedream', SEED, 'image')).toBe(false));
  it('glued and dotted forms: seedream5, Seedream v5.0', () => { expect(namesModel('seedream5', SEED, 'image')).toBe(true); expect(namesModel('Seedream v5.0 pro', SEED, 'image')).toBe(true); });
});

describe('requestWords spans the request message and the answers after it', () => {
  const feed = [
    { id: 'u0', type: 'user', text: 'otra cosa antiguo' },
    { id: 'u1', type: 'user', text: ASK },
    { id: 'q1', type: 'questions', status: 'answered', answers: { m: PICK } },
  ] as unknown as FeedItem[];
  it('includes the message and the later answer, not older messages', () => {
    const w = requestWords(feed, undefined);
    expect(w).toContain('seedream 5');
    expect(w).toContain('FLUX 3 Image Klein');
    expect(w).not.toContain('antiguo');
    expect(namesModel(w, KLEIN, 'image')).toBe(true);
    expect(namesModel(w, SEED, 'image')).toBe(true);
  });
});

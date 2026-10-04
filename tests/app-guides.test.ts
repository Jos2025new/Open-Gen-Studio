import { expect, it, vi } from 'vitest';
import canvas from '../src/engine/skills/app/canvas.md?raw';
import nodes from '../src/engine/skills/app/nodes.md?raw';
import designer from '../src/engine/skills/app/designer.md?raw';
import { guideIndex, readGuide } from '../src/engine/skills';

vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));

it.each([['canvas', canvas], ['nodes', nodes], ['designer', designer]])('read_guide returns app:%s exactly and within 2 KB', (id, text) => {
  expect(readGuide(`app:${id}`)).toBe(text);
  expect(readGuide(` app:${id} `)).toBe(text);
  expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(2000);
  expect(guideIndex()).toContain(`  app:${id} — `);
});

it('includes all app guide IDs in the system prompt and refuses an unknown ID', async () => {
  const { SYSTEM_PROMPT } = await import('../src/engine/agent/context');
  for (const id of ['canvas', 'nodes', 'designer']) expect(SYSTEM_PROMPT).toContain(`app:${id} — `);
  expect(readGuide('app:unknown')).toBeUndefined();
});

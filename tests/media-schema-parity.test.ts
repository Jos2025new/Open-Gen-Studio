import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { allCommands, argsSchema, command } from '../src/engine/commands';
import { confirmSettingsSchema, findAssetsSchema, findModelsSchema, TOOLS } from '../src/engine/agent/tools';
import { COMPOSER_MODES, MEDIA_KINDS, MODEL_MEDIA_KINDS, VIEWABLE_MEDIA_KINDS, VISUAL_MEDIA_KINDS } from '../src/engine/types';
import { AGENT_ATTACHABLE } from '../src/engine/assetActions';

async function sha256(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

// Recorded before Part 5 replaced literal media enums with MEDIA_KINDS-derived tuples;
// `commands` updated after task/brand-easy added library.item.auto_link.
const BEFORE_HASHES = {
  tools: '1e2b5d023641bd0576dd81ef88b5adba8c9f811dda61cfe83e600acf81447da7',
  commands: 'de36443ac706e0378e423b7b60d2d220b84b027e0e76413b5f69814a60d5908b',
  findModels: 'bc71d19692f96f5c81151b1f2ac85694a11800259c5fc448c6bb9c8346a8332f',
  findAssets: '9a26a4fa02ec1123d71f36d8774024e087e392762fa65dc3ec1cb1cb4eaaac5c',
};

describe('media tuple & published JSON schema parity (before/after Part 5)', () => {
  it('keeps every derived media tuple in its exact canonical order', () => {
    expect(MEDIA_KINDS).toEqual(['image', 'video', 'audio', 'model3d']);
    expect(COMPOSER_MODES).toEqual(['agent', 'image', 'video', 'audio', 'model3d']);
    expect(MODEL_MEDIA_KINDS).toEqual(['llm', 'image', 'video', 'audio', 'model3d']);
    expect(VISUAL_MEDIA_KINDS).toEqual(['image', 'video']);
    expect(VIEWABLE_MEDIA_KINDS).toEqual(['image', 'video', 'model3d']);
    expect(AGENT_ATTACHABLE).toEqual(['image', 'video', 'audio', 'model3d']);
  });

  it('produces the exact same JSON for every agent tool and every command schema as before refactoring', async () => {
    const commandSchemas = Object.fromEntries(
      allCommands().map((c): [string, unknown] => [c.id, argsSchema(c)]).sort(([a], [b]) => a.localeCompare(b)),
    );
    expect(await sha256(TOOLS)).toBe(BEFORE_HASHES.tools);
    expect(await sha256(commandSchemas)).toBe(BEFORE_HASHES.commands);
    expect(await sha256(z.toJSONSchema(findModelsSchema))).toBe(BEFORE_HASHES.findModels);
    expect(await sha256(z.toJSONSchema(findAssetsSchema))).toBe(BEFORE_HASHES.findAssets);
  });

  it('keeps exact enum order on touched tool and command schemas', () => {
    const tool = (name: string) => TOOLS.find((t) => t.function.name === name)?.function.parameters as Record<string, unknown>;
    expect(tool('confirm_settings')).toMatchObject({
      properties: { parts: { items: { properties: { kind: { enum: ['video', 'image'] } } } } },
    });
    expect(tool('propose_plan')).toMatchObject({
      properties: { steps: { items: { properties: { kind: { enum: ['image', 'video', 'audio', 'model3d', 'op', 'text', 'layer'] } } } } },
    });
    expect(confirmSettingsSchema.safeParse({ parts: [{ kind: 'video' }, { kind: 'image' }] }).success).toBe(true);
    expect(confirmSettingsSchema.safeParse({ parts: [{ kind: 'audio' }] }).success).toBe(false);

    expect(argsSchema(command('studio.asset.run_op')!)).toHaveProperty('properties.mode.enum', ['image', 'video', 'audio', 'model3d', 'agent']);
    expect(argsSchema(command('nodes.system.add')!)).toHaveProperty('properties.media_kind.enum', ['llm', 'image', 'video', 'audio', 'model3d']);
    expect(argsSchema(command('nodes.system.attach_model')!)).toHaveProperty('properties.media_kind.enum', ['llm', 'image', 'video', 'audio', 'model3d']);
    expect(argsSchema(command('nodes.node.edit')!)).toHaveProperty('properties.patch.properties.mediaKind.enum', ['llm', 'image', 'video', 'audio', 'model3d']);
    expect(argsSchema(command('nodes.node.add')!)).toHaveProperty('properties.data.oneOf', expect.arrayContaining([
      expect.objectContaining({
        properties: expect.objectContaining({
          kind: expect.objectContaining({ const: 'ref' }),
          mediaKind: expect.objectContaining({ enum: ['llm', 'image', 'video', 'audio', 'model3d'] }),
        }),
      }),
    ]));
  });
});

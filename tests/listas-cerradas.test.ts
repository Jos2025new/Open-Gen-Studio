import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { argsSchema, command, run } from '../src/engine/commands';
import { findAssetsSchema, findModelsSchema, TOOLS } from '../src/engine/agent/tools';
import { BASE_NODE_KINDS, LINK_KINDS, MODEL_ATTACH_MODES } from '../src/engine/graphTypes';
import { createSession, useStore } from '../src/store/store';

const systemTypes = ['chat', 'agent', 'provider', 'model', 'session', 'space', 'designer.doc', 'library', 'toolset'];
const nodeTypes = [...systemTypes, 'prompt', 'mediaSettings'];
const mediaKinds = ['image', 'video', 'audio', 'model3d'];

describe.each([
  {
    cmd: 'nodes.node.add',
    accepted: nodeTypes,
    rejected: ['unknown-system-type'],
    args: (type: string) => ({ data: { kind: 'ref', type, ref: 'test-ref', title: 'Reference' }, position: { x: 0, y: 0 } }),
    schema: {
      properties: {
        data: {
          oneOf: expect.arrayContaining([expect.objectContaining({
            properties: expect.objectContaining({
              kind: expect.objectContaining({ const: 'ref' }),
              type: expect.objectContaining({ enum: nodeTypes }),
            }),
          })]),
        },
      },
    },
  },
  {
    cmd: 'nodes.system.add',
    accepted: systemTypes,
    rejected: ['prompt', 'mediaSettings', 'unknown-system-type'],
    args: (type: string) => ({ type }),
    schema: { properties: { type: { enum: systemTypes } } },
  },
])('$cmd system type contract', ({ cmd, accepted, rejected, args, schema }) => {
  it('publishes the accepted values in order and validates them before any write', async () => {
    expect(argsSchema(command(cmd)!)).toMatchObject(schema);
    const session = createSession('Closed lists');
    useStore.setState((state) => ({ sessions: { ...state.sessions, [session.id]: session } }));
    const graph = () => useStore.getState().sessions[session.id].graph;
    const before = structuredClone(graph());
    const on = { session: session.id };
    const approver = vi.fn(() => false);

    // Reaching approval proves validation succeeded without running the write commands.
    const seq = accepted.map((type) => ({ cmd, args: args(type) }));
    expect(await run({ seq, on }, { caller: 'external', approver })).toMatchObject({
      ok: false, error: { code: 'denied' }, results: [], rolledBack: false,
    });
    expect(approver).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      steps: seq.map((call) => expect.objectContaining(call)),
    }));
    expect(graph()).toEqual(before);

    for (const type of rejected) {
      approver.mockClear();
      expect(await run({ cmd, args: args(type), on }, { caller: 'external', approver }), type).toMatchObject({
        ok: false, error: { code: 'invalid' }, results: [], rolledBack: false,
      });
      expect(approver).not.toHaveBeenCalled();
      expect(graph()).toEqual(before);
    }
  });
});

it('publishes the same ordered media kinds that find_models and find_assets validate', () => {
  const tools = TOOLS.map((tool) => tool.function);
  const models = { properties: { kind: { enum: mediaKinds } } };
  const assets = { properties: { kind: { items: { enum: mediaKinds } } } };

  expect(tools.find((tool) => tool.name === 'find_models')?.parameters).toMatchObject(models);
  expect(z.toJSONSchema(findModelsSchema)).toMatchObject(models);
  expect(tools.find((tool) => tool.name === 'find_assets')?.parameters).toMatchObject(assets);
  expect(z.toJSONSchema(findAssetsSchema)).toMatchObject(assets);
});

it.each([
  'studio.direct.check',
  'studio.images.accepts',
  'studio.param.has',
  'studio.generate.start',
  'models.kind.list',
  'models.composer.pick',
  'models.composer.reset',
])('%s publishes media kinds in order', (cmd) => {
  expect(argsSchema(command(cmd)!)).toHaveProperty('properties.kind.enum', mediaKinds);
});

it.each([
  ['nodes.node.add', 'properties.data.oneOf'],
  ['nodes.node.add_connected', 'properties.data.oneOf'],
  ['nodes.node.restore', 'properties.deleted.properties.nodes.items.properties.data.oneOf'],
])('%s publishes generation node kinds in order', (cmd, path) => {
  expect(argsSchema(command(cmd)!)).toHaveProperty(path, expect.arrayContaining([
    expect.objectContaining({
      properties: expect.objectContaining({ kind: expect.objectContaining({ enum: mediaKinds }) }),
    }),
  ]));
});

it('keeps the base node kinds, link kinds and model attachment modes in order', () => {
  const baseKinds = ['text', 'image', 'video', 'audio', 'model3d', 'tool', 'asset', 'ref'];
  const linkKinds = ['data', 'ref', 'control'];
  const attachModes = ['wired', 'docked', 'grouped', 'merged'];
  expect(BASE_NODE_KINDS).toEqual(baseKinds);
  expect(LINK_KINDS).toEqual(linkKinds);
  expect(MODEL_ATTACH_MODES).toEqual(attachModes);
  expect(argsSchema(command('nodes.node.new_data')!)).toHaveProperty('properties.kind.enum', baseKinds);
  expect(argsSchema(command('nodes.edge.connect')!)).toHaveProperty('properties.kind.enum', linkKinds);
  expect(argsSchema(command('nodes.node.edit')!)).toHaveProperty('properties.patch.properties.attachMode.enum', attachModes);
});

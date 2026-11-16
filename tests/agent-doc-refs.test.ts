import { describe, it, expect } from 'vitest';
import { COMMAND_TOOLS, runCommandsSchema } from '../src/engine/agent/commandTools';

function collectTypeArrays(node: unknown, path = ''): string[] {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap((item, i) => collectTypeArrays(item, `${path}[${i}]`));
  const rec = node as Record<string, unknown>;
  const hits = Array.isArray(rec.type) ? [`${path}.type`] : [];
  for (const [k, v] of Object.entries(rec)) {
    if (k !== 'type') hits.push(...collectTypeArrays(v, path ? `${path}.${k}` : k));
  }
  return hits;
}

describe('agent document references', () => {
  const props = (COMMAND_TOOLS.find(t => t.function.name === 'run_commands')!.function.parameters as any).properties.seq.items.properties;
  it('advertises the documented string target in the provider schema via anyOf', () => {
    expect(runCommandsSchema.safeParse({seq:[{cmd:'designer.layer.list',on:'$1.doc'}]}).success).toBe(true);
    expect(props.on.type).toBeUndefined();
    expect(props.on.anyOf).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'object', properties: expect.objectContaining({ doc: { type: 'string' } }) }),
        expect.objectContaining({ type: 'string' }),
      ]),
    );
  });
  it('has no type arrays anywhere in the command tool schemas', () => {
    for (const tool of COMMAND_TOOLS) {
      expect(collectTypeArrays(tool.function.parameters, tool.function.name)).toEqual([]);
    }
  });
  it('accepts object references and rejects cross-session targets', () => {
    expect(runCommandsSchema.safeParse({seq:[{cmd:'designer.layer.list',on:{doc:'$1.doc'}}]}).success).toBe(true);
    expect(runCommandsSchema.safeParse({seq:[{cmd:'designer.layer.list',on:{session:'other',doc:'$1.doc'}}]}).success).toBe(false);
  });
});

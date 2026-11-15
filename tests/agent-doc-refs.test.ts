import { describe, it, expect } from 'vitest';
import { COMMAND_TOOLS, runCommandsSchema } from '../src/engine/agent/commandTools';

describe('agent document references', () => {
  const props = (COMMAND_TOOLS.find(t => t.function.name === 'run_commands')!.function.parameters as any).properties.seq.items.properties;
  it('advertises the documented string target in the provider schema', () => {
    expect(runCommandsSchema.safeParse({seq:[{cmd:'designer.layer.list',on:'$1.doc'}]}).success).toBe(true);
    expect(props.on.type).toEqual(expect.arrayContaining(["object", "string"]));
  });
  it('accepts object references and rejects cross-session targets', () => {
    expect(runCommandsSchema.safeParse({seq:[{cmd:'designer.layer.list',on:{doc:'$1.doc'}}]}).success).toBe(true);
    expect(runCommandsSchema.safeParse({seq:[{cmd:'designer.layer.list',on:{session:'other',doc:'$1.doc'}}]}).success).toBe(false);
  });
});

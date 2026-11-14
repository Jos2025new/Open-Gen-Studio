import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { collect } from '../src/engine/commands/collect';
import { clearEcho, ECHO_SIZE, lastCommands, subscribeEcho } from '../src/engine/commands/echo';
import { registerHistory, resetHistories } from '../src/engine/commands/history';
import { argsSchema, command, findCommands, register, resetRegistry } from '../src/engine/commands/registry';
import { invoke, run, setApprover, type ApprovalRequest } from '../src/engine/commands/run';
import { CommandError, defineCommand } from '../src/engine/commands/types';

/* The command core (ADR 0030) on a toy document: no app code. */

interface Layer { id: string; name: string; opacity: number }
let layers: Layer[] = [];
let log: string[] = [];

const add = defineCommand({
  id: 'toy.layer.add',
  title: 'Add layer',
  description: 'Adds a layer and returns it.',
  aliases: ['toy.add'],
  args: z.object({ name: z.string().min(1) }).strict(),
  effect: 'write',
  needs: ['doc'],
  history: (on) => `toy:${on.doc}`,
  run: (_ctx, args) => {
    const layer = { id: `l${layers.length + 1}`, name: args.name, opacity: 1 };
    layers.push(layer);
    return { layer };
  },
});
const opacity = defineCommand({
  id: 'toy.layer.opacity',
  title: 'Layer opacity',
  args: z.object({ layer: z.string(), value: z.number().min(0).max(1) }).strict(),
  effect: 'write',
  needs: ['doc'],
  history: (on) => `toy:${on.doc}`,
  available: () => (layers.length ? true : 'There is no layer.'),
  run: (_ctx, args) => {
    const layer = layers.find((l) => l.id === args.layer);
    if (!layer) throw new Error(`No layer ${args.layer}.`);
    layer.opacity = args.value;
  },
});
const count = defineCommand({ id: 'toy.layer.count', title: 'Count layers', args: z.object({}).strict(), effect: 'read', run: () => layers.length });
const slow = defineCommand({ id: 'toy.slow', title: 'Slow', args: z.object({ fail: z.boolean().optional() }).strict(), effect: 'write', run: async (_ctx, args) => {
  await Promise.resolve();
  if (args.fail) throw new Error('slow failed');
  return 'done';
} });
/** A step that really waits (a decode, a download) before it changes the document. */
const bring = defineCommand({ id: 'toy.layer.import', title: 'Import layer', args: z.object({ name: z.string(), fail: z.boolean().optional() }).strict(), effect: 'write', needs: ['doc'], history: (on) => `toy:${on.doc}`, run: async (_ctx, args) => {
  await new Promise((resolve) => setTimeout(resolve, 15));
  if (args.fail) throw new Error('import failed');
  layers.push({ id: `l${layers.length + 1}`, name: args.name, opacity: 1 });
} });
const generate = defineCommand({ id: 'toy.generate', title: 'Generate', args: z.object({ prompt: z.string() }).strict(), effect: 'spend', run: (_ctx, args) => ({ image: `img:${args.prompt}` }) });
const remove = defineCommand({ id: 'toy.layer.delete', title: 'Delete layer', args: z.object({ layer: z.string() }).strict(), effect: 'delete', run: (_ctx, args) => { layers = layers.filter((l) => l.id !== args.layer); } });
const other = defineCommand({ id: 'toy.other.touch', title: 'Touch the graph', args: z.object({}).strict(), effect: 'write', needs: ['session'], history: (on) => `graph:${on.session}`, run: () => 'touched' });

/** A history that records what the core asks of it and can put the toy document back. */
function toyHistory(kind: string) {
  registerHistory(kind, {
    begin(id) {
      const before = layers.map((l) => ({ ...l }));
      log.push(`begin ${kind}:${id}`);
      return {
        commit: () => { log.push(`commit ${kind}:${id}`); },
        rollback: () => { if (kind === 'toy') layers = before; log.push(`rollback ${kind}:${id}`); },
      };
    },
  });
}

beforeEach(() => {
  resetRegistry();
  resetHistories();
  clearEcho();
  setApprover(null);
  layers = [];
  log = [];
  for (const spec of [add, opacity, count, slow, bring, generate, remove, other]) register(spec, 'tests/toy.ts');
  toyHistory('toy');
  toyHistory('graph');
});

describe('registry', () => {
  it('finds a command by id and by alias', () => {
    expect(command('toy.layer.add')).toBe(add);
    expect(command('toy.add')).toBe(add);
    expect(command('toy.nothing')).toBeUndefined();
  });

  it('refuses a malformed id and a name used twice, saying where the first one is', () => {
    const base = { title: 'x', args: z.object({}), effect: 'read' as const, run: () => 1 };
    expect(() => register({ ...base, id: 'NoDots' })).toThrow(/lower-case words joined by dots/);
    expect(() => register({ ...base, id: 'toy.layer.add' }, 'src/b.ts')).toThrow(/already a command \(tests\/toy\.ts\)/);
    expect(() => register({ ...base, id: 'toy.new', aliases: ['toy.add'] })).toThrow(/already an alias of toy\.layer\.add/);
    expect(command('toy.new')).toBeUndefined();
  });

  it('lists an area with whether each command can run now, and why not', () => {
    const found = findCommands({ area: 'toy', on: { doc: 'd1' } });
    expect(found.map((f) => f.id)).toEqual(['toy.generate', 'toy.layer.add', 'toy.layer.count', 'toy.layer.delete', 'toy.layer.import', 'toy.layer.opacity', 'toy.other.touch', 'toy.slow']);
    const by = Object.fromEntries(found.map((f) => [f.id, f.available]));
    expect(by['toy.layer.add']).toBe(true);
    expect(by['toy.layer.opacity']).toBe('There is no layer.');
    expect(by['toy.other.touch']).toBe('toy.other.touch needs on.session.');
    expect(findCommands({ area: 'to' })).toEqual([]);
    expect(findCommands({ text: 'opacity layer' }).map((f) => f.id)).toEqual(['toy.layer.opacity']);
    expect(findCommands({ text: 'toy.add' })[0]).toMatchObject({ id: 'toy.layer.add', aliases: ['toy.add'], effect: 'write', needs: ['doc'] });
  });

  it('gives the arguments as JSON Schema', () => {
    expect(argsSchema(opacity)).toMatchObject({ type: 'object', required: ['layer', 'value'], additionalProperties: false, properties: { value: { type: 'number', minimum: 0, maximum: 1 } } });
    expect(findCommands({ text: 'count', schemas: true })[0].args).toMatchObject({ type: 'object' });
  });
});

describe('invoke (typed code)', () => {
  it('returns what the command returns, synchronously, and echoes it', () => {
    const result = invoke(add, { name: 'Sky' }, { doc: 'd1' });
    expect(result.layer).toEqual({ id: 'l1', name: 'Sky', opacity: 1 });
    expect(invoke(count, {})).toBe(1);
    const [first, second] = lastCommands();
    expect(first).toMatchObject({ cmd: 'toy.layer.add', args: { name: 'Sky' }, on: { doc: 'd1' }, caller: 'ui', ok: true });
    expect(first.ms).toBeGreaterThanOrEqual(0);
    expect(second.cmd).toBe('toy.layer.count');
  });

  it('is one undo step in the history it touches', () => {
    invoke(add, { name: 'Sky' }, { doc: 'd1' });
    expect(log).toEqual(['begin toy:d1', 'commit toy:d1']);
  });

  it('throws the reason when it cannot run, and what the command throws, undoing its history', () => {
    expect(() => invoke(opacity, { layer: 'l1', value: 0.5 }, { doc: 'd1' })).toThrow('There is no layer.');
    expect(() => invoke(add, { name: 'Sky' })).toThrow('toy.layer.add needs on.doc.');
    expect(log).toEqual([]);
    invoke(add, { name: 'Sky' }, { doc: 'd1' });
    log = [];
    expect(() => invoke(opacity, { layer: 'nope', value: 0.5 }, { doc: 'd1' })).toThrow('No layer nope.');
    expect(log).toEqual(['begin toy:d1', 'rollback toy:d1']);
    expect(lastCommands(1)[0]).toMatchObject({ cmd: 'toy.layer.opacity', ok: false, error: 'No layer nope.' });
  });

  it('gives a promise only for an asynchronous command, and echoes when it settles', async () => {
    const pending = invoke(slow, {});
    expect(lastCommands()).toEqual([]);
    await expect(pending).resolves.toBe('done');
    await expect(invoke(slow, { fail: true })).rejects.toThrow('slow failed');
    expect(lastCommands().map((e) => e.ok)).toEqual([true, false]);
  });

  it('a command that calls another on the same history joins its undo step', () => {
    const both = defineCommand({ id: 'toy.layer.pair', title: 'Two layers', args: z.object({}), effect: 'write', needs: ['doc'], history: (on) => `toy:${on.doc}`, run: (ctx) => {
      invoke(add, { name: 'A' }, ctx.on);
      invoke(add, { name: 'B' }, ctx.on);
    } });
    invoke(both, {}, { doc: 'd1' });
    expect(layers).toHaveLength(2);
    expect(log).toEqual(['begin toy:d1', 'commit toy:d1']);
  });

  it('does not ask for approval and does not check arguments: the interface is typed', () => {
    const ask = vi.fn(() => false);
    setApprover(ask);
    expect(invoke(generate, { prompt: 'cat' })).toEqual({ image: 'img:cat' });
    expect(ask).not.toHaveBeenCalled();
  });

  it('costs far less than a frame', () => {
    const n = 20000;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) invoke(count, {});
    const each = (performance.now() - t0) / n;
    if (process.env.COMMANDS_BENCH) console.log(`invoke: ${(each * 1000).toFixed(2)} µs per call`);
    expect(each).toBeLessThan(0.05);
  });
});

describe('echo', () => {
  it('keeps the last commands only and tells who listens', () => {
    const heard = vi.fn();
    const stop = subscribeEcho(heard);
    for (let i = 0; i < ECHO_SIZE + 5; i++) invoke(count, {});
    expect(lastCommands()).toHaveLength(ECHO_SIZE);
    expect(lastCommands(3)).toHaveLength(3);
    expect(heard).toHaveBeenCalledTimes(ECHO_SIZE + 5);
    stop();
    invoke(count, {});
    expect(heard).toHaveBeenCalledTimes(ECHO_SIZE + 5);
  });
});

describe('run (the boundary)', () => {
  it('runs one call, by alias too, and never throws', async () => {
    expect(await run({ cmd: 'toy.add', args: { name: 'Sky' }, on: { doc: 'd1' } }, { caller: 'agent' })).toEqual({ ok: true, results: [{ layer: { id: 'l1', name: 'Sky', opacity: 1 } }] });
    expect(await run({ cmd: 'toy.layer.count' }, { caller: 'cli' })).toEqual({ ok: true, results: [1] });
    expect(lastCommands(1)[0]).toMatchObject({ cmd: 'toy.layer.count', caller: 'cli', ok: true });
    for (const bad of [null, 'toy.add', {}, { cmd: 'toy.add', extra: 1 }, { seq: [] }, { cmd: 'toy.add', on: { layer: 'x' } }]) {
      expect(await run(bad, { caller: 'agent' })).toMatchObject({ ok: false, error: { code: 'invalid' } });
    }
  });

  it('checks arguments against the schema and says what is wrong', async () => {
    const result = await run({ cmd: 'toy.layer.opacity', args: { layer: 'l1', value: 3, more: true }, on: { doc: 'd1' } }, { caller: 'agent' });
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid', step: 1 }, rolledBack: false });
    expect(!result.ok && result.error.message).toMatch(/^toy\.layer\.opacity: .*value/);
    expect(await run({ cmd: 'toy.nothing' }, { caller: 'agent' })).toMatchObject({ ok: false, error: { code: 'unknown', message: 'No command "toy.nothing".' } });
    expect(await run({ cmd: 'toy.add', args: { name: 'x' } }, { caller: 'agent' })).toMatchObject({ ok: false, error: { code: 'target', message: 'toy.layer.add needs on.doc.' } });
    expect(await run({ cmd: 'toy.layer.opacity', args: { layer: 'l1', value: 1 }, on: { doc: 'd1' } }, { caller: 'agent' })).toMatchObject({ ok: false, error: { code: 'unavailable', message: 'There is no layer.' } });
    expect(log).toEqual([]);
  });

  it('passes results forward with $n and is one undo step per history', async () => {
    const result = await run({
      on: { doc: 'd1' },
      seq: [
        { cmd: 'toy.layer.add', args: { name: 'Sky' } },
        { cmd: 'toy.layer.opacity', args: { layer: '$1.layer.id', value: 0.4 } },
        { cmd: 'toy.other.touch', on: { session: 's1' } },
        { cmd: 'toy.layer.add', args: { name: '$$1' } },
        { cmd: 'toy.layer.count' },
      ],
    }, { caller: 'agent' });
    expect(result).toMatchObject({ ok: true, results: [{ layer: { id: 'l1' } }, null, 'touched', { layer: { name: '$1' } }, 2] });
    expect(layers[0].opacity).toBe(0.4);
    expect(log).toEqual(['begin toy:d1', 'begin graph:s1', 'commit graph:s1', 'commit toy:d1']);
    const said = lastCommands();
    expect(said.map((e) => e.cmd)).toEqual(['toy.layer.add', 'toy.layer.opacity', 'toy.other.touch', 'toy.layer.add', 'toy.layer.count']);
    expect(new Set(said.map((e) => e.seq)).size).toBe(1);
    expect(said[1].args).toEqual({ layer: 'l1', value: 0.4 });
  });

  it('checks the whole sequence before the first step runs', async () => {
    const forward = await run({ on: { doc: 'd1' }, seq: [{ cmd: 'toy.layer.add', args: { name: 'Sky' } }, { cmd: 'toy.layer.opacity', args: { layer: '$2.id', value: 1 } }] }, { caller: 'agent' });
    expect(forward).toMatchObject({ ok: false, error: { code: 'ref', step: 2 }, results: [], rolledBack: false });
    const invalid = await run({ on: { doc: 'd1' }, seq: [{ cmd: 'toy.layer.add', args: { name: 'Sky' } }, { cmd: 'toy.layer.add', args: {} }] }, { caller: 'agent' });
    expect(invalid).toMatchObject({ ok: false, error: { code: 'invalid', step: 2 }, results: [] });
    const unknown = await run({ seq: [{ cmd: 'toy.layer.count' }, { cmd: 'toy.gone' }] }, { caller: 'agent' });
    expect(unknown).toMatchObject({ ok: false, error: { code: 'unknown', step: 2 }, results: [] });
    expect(layers).toEqual([]);
    expect(lastCommands()).toEqual([]);
  });

  it('puts every history back when a step fails, and says which steps ran', async () => {
    const result = await run({
      on: { doc: 'd1' },
      seq: [
        { cmd: 'toy.layer.add', args: { name: 'Sky' } },
        { cmd: 'toy.layer.opacity', args: { layer: '$1.layer.nothing', value: 0.4 } },
      ],
    }, { caller: 'agent' });
    expect(result).toMatchObject({ ok: false, error: { code: 'ref', step: 2 }, results: [{ layer: { id: 'l1' } }], rolledBack: true });
    expect(layers).toEqual([]);
    expect(log).toEqual(['begin toy:d1', 'rollback toy:d1']);

    log = [];
    const thrown = await run({ on: { doc: 'd1' }, seq: [{ cmd: 'toy.layer.add', args: { name: 'Sky' } }, { cmd: 'toy.layer.opacity', args: { layer: 'nope', value: 0.4 } }] }, { caller: 'agent' });
    expect(thrown).toMatchObject({ ok: false, error: { code: 'failed', message: 'No layer nope.', step: 2 }, rolledBack: true });
    expect(layers).toEqual([]);
    expect(lastCommands(1)[0]).toMatchObject({ ok: false, error: 'No layer nope.' });
  });

  it('does not put back a sequence that waited: the edit the user made meanwhile would go with it', async () => {
    const pending = run({
      on: { doc: 'd1' },
      seq: [
        { cmd: 'toy.layer.add', args: { name: 'A' } },
        { cmd: 'toy.layer.import', args: { name: 'B' } },
        { cmd: 'toy.layer.opacity', args: { layer: 'nope', value: 1 } },
      ],
    }, { caller: 'agent' });
    // The user edits the same document while step 2 waits.
    await new Promise((resolve) => setTimeout(resolve, 2));
    layers.push({ id: 'user', name: 'User', opacity: 1 });
    const result = await pending;
    expect(result).toMatchObject({ ok: false, error: { code: 'failed', step: 3 }, rolledBack: false, kept: ['toy:d1'] });
    expect(layers.map((l) => l.name)).toEqual(['A', 'User', 'B']);
    expect(log).toEqual(['begin toy:d1', 'commit toy:d1']);
  });

  it('still puts back a sequence whose asynchronous step never waited, and typed code follows the same rule', async () => {
    const quick = await run({ on: { doc: 'd1' }, seq: [{ cmd: 'toy.layer.add', args: { name: 'A' } }, { cmd: 'toy.slow', args: { fail: true } }] }, { caller: 'agent' });
    expect(quick).toMatchObject({ ok: false, error: { step: 2 }, rolledBack: true });
    expect(quick).not.toHaveProperty('kept');
    expect(layers).toEqual([]);
    log = [];
    await expect(invoke(bring, { name: 'B', fail: true }, { doc: 'd1' })).rejects.toThrow('import failed');
    expect(log).toEqual(['begin toy:d1', 'commit toy:d1']);
  });

  it('refuses a history nobody registered', async () => {
    resetHistories();
    expect(await run({ cmd: 'toy.add', args: { name: 'x' }, on: { doc: 'd1' } }, { caller: 'agent' })).toMatchObject({ ok: false, error: { code: 'history' } });
    expect(layers).toEqual([]);
  });

  it('stops between steps when asked', async () => {
    const stop = new AbortController();
    stop.abort();
    expect(await run({ cmd: 'toy.layer.count' }, { caller: 'agent', signal: stop.signal })).toMatchObject({ ok: false, error: { code: 'failed', message: 'Stopped.' } });
  });
});

describe('approval by effect', () => {
  const plan = { seq: [{ cmd: 'toy.generate', args: { prompt: 'cat' } }, { cmd: 'toy.layer.add', args: { name: '$1.image' }, on: { doc: 'd1' } }, { cmd: 'toy.layer.delete', args: { layer: '$2.layer.id' } }] };

  it('asks once for a whole sequence, with every step that spends or deletes', async () => {
    const asked: ApprovalRequest[] = [];
    setApprover((request) => { asked.push(request); return true; });
    expect(await run(plan, { caller: 'agent' })).toMatchObject({ ok: true });
    expect(asked).toHaveLength(1);
    expect(asked[0].caller).toBe('agent');
    expect(asked[0].steps.map((s) => [s.step, s.cmd, s.effect])).toEqual([[1, 'toy.generate', 'spend'], [3, 'toy.layer.delete', 'delete']]);
    expect(layers).toEqual([]);
  });

  it('runs nothing when the user says no, or when nobody can ask', async () => {
    expect(await run(plan, { caller: 'agent' })).toMatchObject({ ok: false, error: { code: 'denied', step: 1 }, results: [] });
    setApprover(async () => false);
    expect(await run(plan, { caller: 'agent' })).toMatchObject({ ok: false, error: { code: 'denied', message: 'The user did not approve it.' } });
    expect(lastCommands()).toEqual([]);
  });

  it('asks for writes too when the caller is outside the app', async () => {
    const ask = vi.fn(() => true);
    setApprover(ask);
    await run({ cmd: 'toy.add', args: { name: 'x' }, on: { doc: 'd1' } }, { caller: 'agent' });
    expect(ask).not.toHaveBeenCalled();
    await run({ cmd: 'toy.add', args: { name: 'x' }, on: { doc: 'd1' } }, { caller: 'external' });
    expect(ask).toHaveBeenCalledTimes(1);
    await run({ cmd: 'toy.layer.count' }, { caller: 'external' });
    expect(ask).toHaveBeenCalledTimes(1);
  });
});

describe('the automatic index', () => {
  it('registers the commands each file exports and lists the files that export none', () => {
    resetRegistry();
    const found = collect({ '/src/b/commands.ts': { commands: [count] }, '/src/a/commands.ts': { commands: [add, opacity] }, '/src/fx/commands.ts': { applyFx: () => 0 } });
    expect(found).toEqual({ loaded: [{ file: '/src/a/commands.ts', count: 2 }, { file: '/src/b/commands.ts', count: 1 }], skipped: ['/src/fx/commands.ts'] });
    expect(command('toy.add')).toBe(add);
    expect(() => collect({ '/src/c/commands.ts': { commands: [{ id: 'toy.broken' }] } })).toThrow('/src/c/commands.ts: commands[0] is not a command');
    expect(() => collect({ '/src/d/commands.ts': { commands: [count] } })).toThrow(/toy\.layer\.count.*already a command \(\/src\/b\/commands\.ts\)/);
  });

  it('finds the real files by name', async () => {
    resetRegistry();
    const { collected } = await import('../src/engine/commands');
    const files = [...collected.loaded.map((l) => l.file), ...collected.skipped];
    expect(files).toContain('/src/engine/fx/commands.ts');
    expect(files.every((file) => /(^|\/|\.)commands\.ts$/.test(file))).toBe(true);
  });
});

it('CommandError carries its code and step', () => {
  const error = new CommandError('ref', 'bad', 2);
  expect(error).toBeInstanceOf(Error);
  expect([error.code, error.step, error.name]).toEqual(['ref', 2, 'CommandError']);
});

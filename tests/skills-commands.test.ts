import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));
import { command, run } from '../src/engine/commands';
import { useStore } from '../src/store/store';
import { SKILLS_ACTIONS } from '../src/engine/skills/commands';
import * as catalog from '../src/engine/skills/catalog';
import * as workflows from '../src/engine/skills/workflows';
import * as guides from '../src/engine/skills/guides';
import * as cards from '../src/engine/skills/workflowCard';

describe('skills commands', () => {
  it('accounts for every exported function and registers every command', () => {
    const functions = Object.entries({ ...catalog, ...workflows, ...guides, ...cards }).filter(([, value]) => typeof value === 'function').map(([name]) => name).sort();
    expect(Object.keys(SKILLS_ACTIONS).sort()).toEqual(functions);
    for (const id of Object.values(SKILLS_ACTIONS)) if (!id.startsWith('-')) expect(command(id), id).toBeDefined();
  });
  it.each(['skill', 'workflow'])('chains %s list and get', async (kind) => {
    const result = await run({ seq: [{ cmd: `skills.${kind}.list`, args: {} }, { cmd: `skills.${kind}.get`, args: { [kind]: '$1.0.id' } }] }, { caller: 'agent' });
    expect(result.ok).toBe(true);
    expect(result.results[1]).toBeTruthy();
  });
  it.each(['skill', 'workflow'])('selects and clears a %s', async (kind) => {
    const id = kind === 'skill' ? catalog.SKILLS[0].id : workflows.WORKFLOWS[0].id;
    const key = kind === 'skill' ? 'skillId' : 'workflowId';
    expect((await run({ cmd: `skills.${kind}.select`, args: { [kind]: id } }, { caller: 'agent' })).ok).toBe(true);
    expect(useStore.getState().composer[key]).toBe(id);
    expect((await run({ cmd: `skills.${kind}.select`, args: { [kind]: null } }, { caller: 'agent' })).ok).toBe(true);
    expect(useStore.getState().composer[key]).toBeNull();
  });
  it('rejects missing ids and extra fields without changing the composer', async () => {
    const before = useStore.getState().composer;
    expect(await run({ cmd: 'skills.skill.select', args: { skill: 'nope' } }, { caller: 'agent' })).toMatchObject({ ok: false, error: { code: 'unavailable', message: 'No skill "nope".' } });
    expect(await run({ cmd: 'skills.skill.select', args: { skill: null, extra: 1 } }, { caller: 'agent' })).toMatchObject({ ok: false, error: { code: 'invalid' } });
    expect(useStore.getState().composer).toEqual(before);
  });
  it('lists and reads guides', async () => {
    expect((await run({ cmd: 'skills.guide.list', args: {} }, { caller: 'agent' })).results[0]).toBe(guides.guideIndex());
    expect((await run({ cmd: 'skills.guide.read', args: { guide: `skill:${catalog.SKILLS[0].id}` } }, { caller: 'agent' })).results[0]).toBe(guides.readGuide(`skill:${catalog.SKILLS[0].id}`));
  });
});

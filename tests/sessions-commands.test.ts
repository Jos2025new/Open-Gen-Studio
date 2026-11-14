import { beforeEach, describe, expect, it, vi } from 'vitest';

/* The sessions through the command registry (ADR 0030, step 5): the store functions as commands, with the target in `on`. */
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));
import { allCommands, collected, command, run } from '../src/engine/commands';
import * as store from '../src/store/store';
import { SESSION_ACTIONS } from '../src/store/commands';
import * as archive from '../src/store/sessionArchive';
import * as space from '../src/store/spaceSession';

const modules: Record<string, object> = { store, archive, space };
const sid = () => store.useStore.getState().activeSessionId;
const titleOf = (id: string) => store.useStore.getState().sessions[id]?.title;

beforeEach(() => {
  const fresh = store.createSession('Base');
  store.useStore.setState({ sessions: { [fresh.id]: fresh }, activeSessionId: fresh.id });
});

describe('the sessions as commands', () => {
  it('covers every store action with a registered command', () => {
    const exported = new Set(Object.values(modules).flatMap((m) => Object.keys(m)));
    for (const [action, id] of Object.entries(SESSION_ACTIONS)) {
      expect(exported, action).toContain(action);
      expect(command(id), id).toBeDefined();
    }
    expect(allCommands().filter((c) => c.id.startsWith('sessions.')).map((c) => c.id).sort()).toEqual(Object.values(SESSION_ACTIONS).sort());
    expect(collected.loaded.map((l) => l.file)).toContain('/src/store/commands.ts');
  });

  it('creates a titled session and lists it as active', async () => {
    const made = await run({ cmd: 'sessions.new', args: { title: 'Project A' } }, { caller: 'agent' });
    expect(made.ok).toBe(true);
    const id = (made.results[0] as { session: string }).session;
    expect(titleOf(id)).toBe('Project A');
    expect(sid()).toBe(id);
    const listed = await run({ cmd: 'sessions.list', args: {} }, { caller: 'agent' });
    expect(listed.results[0]).toContainEqual({ id, title: 'Project A', pinned: false, archived: false, active: true });
  });

  it('chains new, rename and pin over $n', async () => {
    const result = await run({
      seq: [
        { cmd: 'sessions.new', args: { title: 'A' } },
        { cmd: 'sessions.rename', on: { session: '$1.session' }, args: { title: 'B' } },
        { cmd: 'sessions.pin', on: { session: '$1.session' }, args: { pinned: true } },
      ],
    }, { caller: 'agent' });
    expect(result.ok).toBe(true);
    const id = (result.results[0] as { session: string }).session;
    expect(titleOf(id)).toBe('B');
    expect(store.useStore.getState().sessions[id].pinned).toBe(true);
  });

  it('pins to the state asked for, never toggling twice', async () => {
    const id = sid();
    expect(await run({ cmd: 'sessions.pin', on: { session: id }, args: { pinned: true } }, { caller: 'agent' })).toMatchObject({ ok: true });
    expect(store.useStore.getState().sessions[id].pinned).toBe(true);
    expect(await run({ cmd: 'sessions.pin', on: { session: id }, args: { pinned: true } }, { caller: 'agent' })).toMatchObject({ ok: true });
    expect(store.useStore.getState().sessions[id].pinned).toBe(true);
    expect(await run({ cmd: 'sessions.pin', on: { session: id }, args: { pinned: false } }, { caller: 'agent' })).toMatchObject({ ok: true });
    expect(store.useStore.getState().sessions[id].pinned).toBe(false);
  });

  it('refuses a session that does not exist, with the reason, and changes nothing', async () => {
    const before = store.useStore.getState().sessions;
    expect(await run({ cmd: 'sessions.rename', on: { session: 'nope' }, args: { title: 'X' } }, { caller: 'agent' })).toMatchObject({ ok: false, error: { code: 'unavailable', message: 'No session "nope".' } });
    expect(store.useStore.getState().sessions).toEqual(before);
  });

  it('archives a session and lists it only when asked for the archived ones', async () => {
    const id = sid();
    expect(await run({ cmd: 'sessions.archive', args: { sessions: [id], archived: true } }, { caller: 'agent' })).toMatchObject({ ok: true });
    const open = await run({ cmd: 'sessions.list', args: {} }, { caller: 'agent' });
    expect(open.results[0]).not.toContainEqual(expect.objectContaining({ id }));
    const archivedList = await run({ cmd: 'sessions.list', args: { archived: true } }, { caller: 'agent' });
    expect(archivedList.results[0]).toContainEqual({ id, title: 'Base', pinned: false, archived: true, active: false });
  });

  it('fails with invalid for an extra field or an empty title', async () => {
    const id = sid();
    expect(await run({ cmd: 'sessions.archive', args: { sessions: [id], archived: true, extra: 1 } }, { caller: 'agent' })).toMatchObject({ ok: false, error: { code: 'invalid' } });
    expect(await run({ cmd: 'sessions.rename', on: { session: id }, args: { title: '   ' } }, { caller: 'agent' })).toMatchObject({ ok: false, error: { code: 'invalid' } });
    expect(titleOf(id)).toBe('Base');
  });

  it('titles a session from the first request and answers with the title', async () => {
    const id = sid();
    const result = await run({ cmd: 'sessions.auto_title', on: { session: id }, args: { text: 'a red circle' } }, { caller: 'agent' });
    expect(result).toMatchObject({ ok: true });
    expect((result.results[0] as { title: string }).title).toBe(titleOf(id));
    expect(titleOf(id)).toBe('A red circle');
  });
});

// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined, putAssetBlob: async () => undefined,
}));
import { z } from 'zod';
import { allCommands, defineCommand } from '../src/engine/commands';
import { register, resetRegistry } from '../src/engine/commands/registry';
import { CommandPalette } from '../src/components/shell/CommandPalette';
import { buildArgs, clearRecent, fieldsOf, offered, paletteSections, rememberRun } from '../src/components/shell/commandPaletteModel';
import { useStore } from '../src/store/store';
import { commands as themeCommands } from '../src/lib/theme.commands';
import { SEARCH_MAX } from '../src/components/shell/commandPaletteModel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.fetch = (() => { throw new Error('no network in tests'); }) as typeof fetch;

/** The real registry, read before the test commands replace it. */
const real = offered();
const realTotal = allCommands().length;
const calls: string[] = [];
const noArgs = defineCommand({ id: 'designer.test.ping', title: 'Ping layer', aliases: ['designer.test.pong'], args: z.object({}), effect: 'write', run: () => { calls.push('ping'); } });
const withArgs = defineCommand({ id: 'nodes.test.rename', title: 'Rename thing', args: z.object({ name: z.string(), size: z.number().optional(), mode: z.enum(['a', 'b']).optional(), flag: z.boolean().optional() }), effect: 'write', run: (_c, a) => { calls.push(`rename:${JSON.stringify(a)}`); } });
const doomed = defineCommand({ id: 'studio.test.wipe', title: 'Wipe all', args: z.object({}), effect: 'delete', run: () => { calls.push('wipe'); } });
const costly = defineCommand({ id: 'studio.test.make', title: 'Make image', args: z.object({}), effect: 'spend', run: () => { calls.push('make'); } });
const blocked = defineCommand({ id: 'studio.test.nope', title: 'Nope', args: z.object({}), effect: 'write', available: () => 'nothing selected', run: () => { calls.push('nope'); } });
const complex = defineCommand({ id: 'studio.test.many', title: 'Many things', args: z.object({ ids: z.array(z.string()) }), effect: 'write', run: () => undefined });
const fails = defineCommand({ id: 'studio.test.fail', title: 'Fails always', args: z.object({}), effect: 'write', run: () => { throw new Error('it broke'); } });

beforeAll(() => {
  resetRegistry();
  for (const spec of [noArgs, withArgs, doomed, costly, blocked, complex, fails, ...themeCommands]) register(spec);
});
afterEach(() => { clearRecent(); calls.length = 0; });

const on = { session: 's' };
const ids = (q: string, workspace: 'chat' | 'node' | 'designer' = 'chat') => paletteSections({ query: q, on, workspace }).flatMap((s) => s.rows.map((r) => r.id));

describe('model', () => {
  it('lists what can run now in the area on screen, then recent runs', () => {
    expect(ids('', 'designer')).toEqual(['designer.test.ping']);
    expect(ids('', 'node')).toEqual(['nodes.test.rename']);
    expect(ids('', 'chat')).toEqual(['studio.test.fail', 'studio.test.make', 'studio.test.wipe']);
    rememberRun('designer.test.ping');
    expect(paletteSections({ query: '', on, workspace: 'node' }).map((s) => s.label)).toEqual(['Here', 'Recent']);
  });
  it('searches every area by title, id and alias', () => {
    expect(ids('ping')).toEqual(['designer.test.ping']);
    expect(ids('pong')).toEqual(['designer.test.ping']);
    expect(ids('rename')).toEqual(['nodes.test.rename']);
    expect(ids('zzz')).toEqual([]);
  });
  it('shows the area, or the effect, and dims what cannot run with its reason', () => {
    const rows = Object.fromEntries(paletteSections({ query: 'test', on, workspace: 'chat' })[0].rows.map((r) => [r.id, r]));
    expect(rows['designer.test.ping'].detail).toBe('Designer');
    expect(rows['studio.test.wipe'].detail).toBe('Studio · deletes');
    expect(rows['studio.test.make'].detail).toBe('Studio · spends');
    expect(rows['studio.test.nope'].available).toBe('nothing selected');
    expect(rows['studio.test.nope'].detail).toBe('nothing selected');
  });
  it('leaves out commands whose arguments are not plain values', () => {
    expect(fieldsOf(complex)).toBeNull();
    expect(offered().leftOut).toEqual(['studio.test.many']);
    expect(ids('many')).toEqual([]);
  });
  it('turns a schema into fields and drops empty optional ones', () => {
    const fields = fieldsOf(withArgs)!;
    expect(fields.map((f) => [f.name, f.kind, f.required])).toEqual([['name', 'text', true], ['size', 'number', false], ['mode', 'enum', false], ['flag', 'boolean', false]]);
    expect(buildArgs(fields, { name: 'x', size: '', mode: 'b' })).toEqual({ name: 'x', mode: 'b' });
    expect(buildArgs(fields, { name: 'x', size: '3' })).toEqual({ name: 'x', size: 3 });
  });
  it('step two is needed for arguments, spend and delete only', () => {
    const rows = Object.fromEntries(paletteSections({ query: 'test', on, workspace: 'chat' })[0].rows.map((r) => [r.id, r.needsStep]));
    expect(rows).toMatchObject({ 'designer.test.ping': false, 'nodes.test.rename': true, 'studio.test.wipe': true, 'studio.test.make': true });
  });
  it('offers most of the real registry and names what it leaves out', () => {
    expect(real.commands.length + real.leftOut.length).toBe(realTotal);
    expect(real.commands.length).toBeGreaterThan(realTotal / 2);
  });
});

describe('component', () => {
  const mount = () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    act(() => root.render(createElement(CommandPalette)));
    return { host, root };
  };
  const key = (init: KeyboardEventInit, target: EventTarget = window) => act(() => { target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })); });
  const type = (input: HTMLInputElement, value: string) => act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const panel = () => document.querySelector('.cmd-palette');
  const search = () => document.querySelector<HTMLInputElement>('.cp-search input')!;
  const enter = () => key({ key: 'Enter' }, document.activeElement ?? search());

  it('opens with Ctrl+K, filters, runs a no-argument command and closes', () => {
    useStore.setState((s) => ({ ui: { ...s.ui, workspace: 'designer' } }));
    const { root } = mount();
    expect(panel()).toBeNull();
    key({ key: 'k', ctrlKey: true });
    expect(panel()?.getAttribute('role')).toBe('dialog');
    type(search(), 'ping');
    expect([...document.querySelectorAll('.menu-item')].map((b) => b.textContent)).toEqual(['Ping layerDesigner']);
    enter();
    expect(calls).toEqual(['ping']);
    expect(panel()).toBeNull();
    act(() => root.unmount());
  });
  it('an argument command shows fields and runs with them; Escape goes back, then closes', () => {
    const { root } = mount();
    key({ key: 'k', metaKey: true });
    type(search(), 'rename');
    enter();
    expect(document.querySelector('.cp-head')).not.toBeNull();
    key({ key: 'Escape' }, document.activeElement ?? document.body);
    expect(document.querySelector('.cp-search')).not.toBeNull();
    enter();
    type(document.querySelector<HTMLInputElement>('.cp-field input')!, 'Ann');
    act(() => document.querySelector<HTMLButtonElement>('.cp-foot .btn-primary')!.click());
    expect(calls).toEqual(['rename:{"name":"Ann"}']);
    expect(panel()).toBeNull();
    act(() => root.unmount());
  });
  it('a delete command needs the second step; an unavailable one does nothing; Escape closes; errors stay', () => {
    const { root } = mount();
    key({ key: 'k', ctrlKey: true });
    type(search(), 'wipe');
    enter();
    expect(calls).toEqual([]);
    expect(document.querySelector('.cp-title')?.textContent).toBe('Wipe all · deletes');
    act(() => document.querySelector<HTMLButtonElement>('.cp-foot .btn-primary')!.click());
    expect(calls).toEqual(['wipe']);
    key({ key: 'k', ctrlKey: true });
    type(search(), 'nope');
    enter();
    expect(calls).toEqual(['wipe']);
    expect(document.querySelector('.cp-head')).toBeNull();
    type(search(), 'fails');
    enter();
    expect(document.querySelector('.cp-error')?.textContent).toBe('it broke');
    key({ key: 'Escape' }, document.activeElement ?? document.body);
    expect(document.querySelector('.cp-search')).not.toBeNull();
    key({ key: 'Escape' }, search());
    expect(panel()).toBeNull();
    act(() => root.unmount());
  });
});

describe('search reads well', () => {
  it('finds the theme and accent commands by theme or tema', () => {
    expect(ids('theme')).toEqual(expect.arrayContaining(['appearance.theme.set', 'appearance.accent.set']));
    expect(ids('tema')).toEqual(expect.arrayContaining(['appearance.theme.set', 'appearance.accent.set']));
    expect(paletteSections({ query: 'theme', on, workspace: 'chat' })[0].rows.find((r) => r.id === 'appearance.theme.set')?.title).toBe('Set base theme');
  });
  it('caps a broad search and shows labels, never raw ids', () => {
    resetRegistry();
    for (const spec of [...themeCommands, ...Array.from({ length: 16 }, (_, i) => defineCommand({ id: `nodes.test.many${i}`, title: `Nodes thing ${i}`, args: z.object({}), effect: 'write', run: () => undefined }))]) register(spec);
    const rows = paletteSections({ query: 'nodes', on, workspace: 'chat' }).flatMap((s) => s.rows);
    expect(rows.length).toBeLessThanOrEqual(SEARCH_MAX);
    expect(rows.every((r) => !/^[a-z]+\.[a-z.]+$/.test(r.title))).toBe(true);
  });
});

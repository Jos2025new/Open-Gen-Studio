// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
  peekAssetUrl: () => undefined,
  loadAssetUrl: async () => undefined,
}));
vi.mock('../src/engine/catalog', async (orig) => ({ ...(await orig<typeof import('../src/engine/catalog')>()), ensureSchema: async () => undefined }));

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SpaceBoard } from '../src/components/space/SpaceBoard';
import { attachProblem, routeFor, toolTakes } from '../src/components/space/actionRoute';
import { suggestedOps } from '../src/components/space/boardModel';
import { ALL_TOOLS } from '../src/components/shell/navModel';
import { OPS, OP_IDS } from '../src/engine/ops';
import { setComposer, setUi, useStore } from '../src/store/store';
import type { Asset, Generation, InputSlots } from '../src/engine/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const ui = () => useStore.getState().ui;

describe('action routes', () => {
  it('creations go to Create in their mode, everything else is a tool', () => {
    expect(routeFor('animate')).toEqual({ to: 'create', mode: 'video' });
    expect(routeFor('continue')).toEqual({ to: 'create', mode: 'video' });
    for (const op of ['variations', 'edit', 'reference_sheet', 'contact_sheet'] as const) expect(routeFor(op)).toEqual({ to: 'create', mode: 'image' });
    for (const op of ['relight', 'upscale', 'remove_bg', 'reframe', 'angle', 'replace_background', 'video_upscale', 'video_edit', 'video_extend', 'extract_frame', 'grid_split', 'fx'] as const) expect(routeFor(op)).toEqual({ to: 'tools', op });
  });
  it('every suggested action lands somewhere real: a listed tool that takes the asset, or a Create mode', () => {
    for (const id of OP_IDS) {
      if (OPS[id].viaSketch || OPS[id].multiInput) continue;
      const r = routeFor(id);
      if (r.to === 'tools') { expect(ALL_TOOLS.some((t) => t.id === id)).toBe(true); expect(toolTakes(id, OPS[id].input)).toBe(true); }
    }
    expect(suggestedOps({ kind: 'image' } as Asset).length).toBeGreaterThan(0);
  });
  it('attach rules follow the composer', () => {
    const none = {} as InputSlots;
    expect(attachProblem('image', 'video', { firstFrame: {} } as unknown as InputSlots, false)).toBeNull();
    expect(attachProblem('image', 'video', none, false)).toMatch(/images/);
    expect(attachProblem('image', 'video', none, true)).toBeNull();
    expect(attachProblem('image', 'image', { images: {} } as unknown as InputSlots, false)).toBeNull();
    expect(attachProblem('video', 'image', none, true)).toMatch(/videos/);
    expect(attachProblem('video', 'video', { clips: {} } as unknown as InputSlots, false)).toBeNull();
    expect(attachProblem('audio', 'video', none, false)).toMatch(/audio/);
    expect(attachProblem('model3d', 'image', none, false)).toMatch(/3D/);
  });
});

const asset = (id: string, kind: Asset['kind']) => ({ id, kind, origin: 'generated', createdAt: 1, favorite: false, width: 10, height: 10 }) as unknown as Asset;
const gen = (id: string, assetIds: string[]) => ({ id, sessionId: 's', kind: 'image', prompt: id, modelName: 'm', provider: 'demo', status: 'done', assetIds, estimate: { usd: 0 }, createdAt: 1 }) as unknown as Generation;

describe('Go on the board', () => {
  let host: HTMLDivElement;
  let root: Root;
  const q = (sel: string) => host.querySelector<HTMLElement>(sel);
  const chip = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('.space-ops .chip')].find((c) => c.textContent?.trim() === label)!;
  const go = () => host.querySelector('.space-go');
  const select = () => { act(() => q('[aria-label="Select"]')!.click()); act(() => q('.space-tile')!.click()); };
  beforeEach(() => {
    useStore.setState((s) => ({ assets: { a1: asset('a1', 'image') }, generations: { g1: gen('g1', ['a1']) }, ui: { ...s.ui, toasts: [] } }));
    setUi({ space: undefined, toolOp: undefined, toolAsset: undefined });
    setComposer({ mode: 'image', attachments: [] });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => root.render(createElement(SpaceBoard, { kind: 'image' })));
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  it('lists the same actions; clicking one with no asset selected only shows a hint', () => {
    expect(chip('Relight')).toBeDefined();
    act(() => chip('Relight').click());
    expect(q('.space-hint-note')?.textContent).toContain('Pick an image');
    expect(chip('Relight').getAttribute('aria-pressed')).toBe('false');
    expect(go()).toBeNull();
  });
  it('Go appears only with an asset selected AND an action chosen; clicking again unchooses', () => {
    select();
    expect(go()).toBeNull();
    act(() => chip('Upscale').click());
    expect(chip('Upscale').getAttribute('aria-pressed')).toBe('true');
    expect(go()).not.toBeNull();
    act(() => chip('Upscale').click());
    expect(go()).toBeNull();
  });
  it('clearing the selection clears the chosen action', () => {
    select();
    act(() => chip('Upscale').click());
    act(() => q('[aria-label="Select"]')!.click());
    expect(go()).toBeNull();
    expect(host.querySelector('.space-ops .chip.is-active')).toBeNull();
  });
  it('Go to a tool opens Tools with the tool and the asset as input', () => {
    select();
    act(() => chip('Upscale').click());
    act(() => (go() as HTMLElement).click());
    expect(ui()).toMatchObject({ space: 'tools', toolOp: 'upscale', toolAsset: 'a1' });
  });
  it('Go to a creation opens Create in that mode and attaches the asset when the model takes it', async () => {
    const ref = useStore.getState().composer.video.modelRef;
    useStore.setState((s) => ({ catalog: { ...s.catalog, schemas: { ...s.catalog.schemas, [ref]: { slots: { firstFrame: {} } } as never } } }));
    select();
    act(() => chip('Animate').click());
    await act(async () => { (go() as HTMLElement).click(); });
    expect(ui().space).toBe('create');
    expect(useStore.getState().composer.mode).toBe('video');
    expect(useStore.getState().composer.attachments).toEqual(['a1']);
  });
  it('an unsupported attach still navigates, attaches nothing and says why', async () => {
    const ref = useStore.getState().composer.video.modelRef;
    useStore.setState((s) => ({ catalog: { ...s.catalog, schemas: { ...s.catalog.schemas, [ref]: { slots: {} } as never } } }));
    select();
    act(() => chip('Animate').click());
    await act(async () => { (go() as HTMLElement).click(); });
    expect(ui().space).toBe('create');
    expect(useStore.getState().composer.attachments).toEqual([]);
    expect(ui().toasts.at(-1)?.text).toMatch(/not attached/);
  });
});

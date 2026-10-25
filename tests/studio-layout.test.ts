// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/engine/jobs', async (orig) => ({ ...(await orig<typeof import('../src/engine/jobs')>()), checkStatusNow: vi.fn() }));
vi.mock('../src/engine/actions', async (orig) => ({ ...(await orig<typeof import('../src/engine/actions')>()), downloadAsset: vi.fn() }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
  peekAssetUrl: () => undefined,
  loadAssetUrl: async () => undefined,
}));

import { Fragment, act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { StudioBoard } from '../src/components/studio/StudioBoard';
import { StudioReopen } from '../src/components/studio/StudioReopen';
import { BOARD_MAX, BOARD_MIN, boardMax, getStudioBoard, reloadStudioBoard, setStudioBoard } from '../src/lib/studioBoard';
import { StudioGeneration } from '../src/components/chat/StudioGeneration';
import { SpaceBoard } from '../src/components/space/SpaceBoard';
import { batchCells, batchStart, doneMode, keepBatch } from '../src/components/space/boardModel';
import { useStore } from '../src/store/store';
import { checkStatusNow } from '../src/engine/jobs';
import { downloadAsset } from '../src/engine/actions';
import type { Asset, Generation } from '../src/engine/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const asset = (id: string, kind: Asset['kind'] = 'image') => ({ id, kind, origin: 'generated', createdAt: 1, favorite: false, width: 10, height: 10 }) as unknown as Asset;
const gen = (id: string, status: Generation['status'], assetIds: string[] = [], extra: Partial<Generation> = {}) =>
  ({ id, sessionId: useStore.getState().activeSessionId, kind: 'image', prompt: `prompt ${id}`, modelName: 'm', provider: 'demo', status, assetIds, settings: { count: 1 }, estimate: { usd: 0 }, createdAt: 1, ...extra }) as unknown as Generation;

let host: HTMLDivElement;
let root: Root;
const q = (s: string) => host.querySelector<HTMLElement>(s);
const render = (el: ReturnType<typeof createElement>) => act(() => root.render(el));
const setData = (gens: Generation[], assets: Asset[] = [asset('a1'), asset('a2')]) => act(() => useStore.setState({ generations: Object.fromEntries(gens.map((g) => [g.id, g])), assets: Object.fromEntries(assets.map((a) => [a.id, a])) }));

beforeEach(() => { vi.mocked(downloadAsset).mockClear(); localStorage.clear(); reloadStudioBoard(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe('Studio board layout state', () => {
  it('opens by default, closes, clamps its width and keeps both', () => {
    expect(getStudioBoard()).toEqual({ open: true, width: 400, view: 'assets' });
    setStudioBoard({ open: false, width: 9999 });
    expect(getStudioBoard()).toEqual({ open: false, width: BOARD_MAX, view: 'assets' });
    setStudioBoard({ width: 10 });
    expect(getStudioBoard().width).toBe(BOARD_MIN);
    reloadStudioBoard();
    expect(getStudioBoard()).toEqual({ open: false, width: BOARD_MIN, view: 'assets' });
  });
  it('lets the board grow to 60% of a wide window and clamps again when the window shrinks or reloads', () => {
    const w = window.innerWidth;
    try {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1500 });
      expect(boardMax()).toBe(900);
      setStudioBoard({ open: true, width: 880 });
      expect(getStudioBoard().width).toBe(880);
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 });
      window.dispatchEvent(new Event('resize'));
      expect(getStudioBoard().width).toBe(BOARD_MAX);
      reloadStudioBoard();
      expect(getStudioBoard().width).toBe(BOARD_MAX);
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
    }
  });
  it('the X closes the board, a small control reopens it', () => {
    setData([]);
    render(createElement(Fragment, null, createElement(StudioBoard), createElement(StudioReopen)));
    expect(q('.studio-board')).not.toBeNull();
    act(() => q('[aria-label="Close board"]')!.click());
    expect(q('.studio-board')).toBeNull();
    expect(getStudioBoard().open).toBe(false);
    expect(q('[aria-label="Show generations"]')?.getAttribute('aria-pressed')).toBe('false');
    act(() => q('[aria-label="Show generations"]')!.click());
    expect(q('.studio-board')).not.toBeNull();
    expect(q('[aria-label="Hide generations"]')?.getAttribute('aria-pressed')).toBe('true');
    act(() => q('[aria-label="Hide generations"]')!.click());
    expect(q('.studio-board')).toBeNull();
  });
  it('has Done and Ongoing only: no Actions suggested; empty, it is one line (ADR 0024 M)', () => {
    setData([]);
    render(createElement(StudioBoard));
    expect(q('[aria-label="Done"]')).not.toBeNull();
    expect(q('.space-fold')).toBeNull();
    expect(q('[aria-label="Ongoing"]')).toBeNull();
    expect(host.querySelectorAll('.space-empty')).toHaveLength(1);
    expect(q('[aria-label="Actions suggested"]')).toBeNull();
    setData([gen('g1', 'running')]);
    expect(q('[aria-label="Ongoing"]')).not.toBeNull();
    expect(q('.space-fold')).not.toBeNull();
  });
});

describe('board views', () => {
  beforeEach(() => {
    class RO { observe() {} unobserve() {} disconnect() {} }
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = RO;
    (globalThis as { DOMMatrixReadOnly?: unknown }).DOMMatrixReadOnly = class { m22 = 1; constructor() {} };
  });
  it('has a view switcher (Generations, Nodes, Designer); switching keeps the workspace', () => {
    setData([]);
    render(createElement(StudioBoard));
    const tabs = [...host.querySelectorAll<HTMLButtonElement>('.studio-view')];
    expect(tabs.map((t) => t.textContent)).toEqual(['Generations', 'Nodes', 'Designer']);
    expect(tabs.every((t) => !t.disabled)).toBe(true);
    const ws = useStore.getState().ui.workspace;
    act(() => tabs[1].click());
    expect(getStudioBoard().view).toBe('nodes');
    expect(useStore.getState().ui.workspace).toBe(ws);
    act(() => host.querySelectorAll<HTMLButtonElement>('.studio-view')[0].click());
    expect(q('[aria-label="Done"]')).not.toBeNull();
  });
  it('the Nodes view is the embedded canvas: zoom and fit only, no Add node or Operations', () => {
    setData([]);
    setStudioBoard({ view: 'nodes' });
    render(createElement(StudioBoard));
    expect(q('.node-canvas.is-embedded')).not.toBeNull();
    expect(q('[aria-label="Fit view"]')).not.toBeNull();
    expect(q('[aria-label="Zoom in"]')).not.toBeNull();
    expect(host.textContent).not.toContain('Add node');
    expect(q('.node-ops, .operations')).toBeNull();
    expect(host.textContent).toContain('No nodes yet');
  });
});

describe('Done / Ongoing rule', () => {
  it('pure rule: while running Done shows the batch; the hand toggle wins (true = all, false = folded)', () => {
    expect(doneMode({ running: true, override: null })).toBe('batch');
    expect(doneMode({ running: false, override: null })).toBe('all');
    expect(doneMode({ running: true, override: true })).toBe('all');
    expect(doneMode({ running: false, override: false })).toBe('folded');
    const done = [{ type: 'asset' as const, assetId: 'a1', generationId: 'g1' }, { type: 'asset' as const, assetId: 'a2', generationId: 'g2' }];
    expect(batchCells(done, { g1: { createdAt: 1 }, g2: { createdAt: 10 } }, 10).map((c) => c.generationId)).toEqual(['g2']);
    expect(batchCells(done, { g1: { createdAt: 1 }, g2: { createdAt: 10 } }, null)).toEqual([]);
  });
  it('F-07: the batch start is read from the store: a board mounted mid-plan keeps the step the plan already finished', () => {
    const g = (id: string, createdAt: number, planId?: string, sessionId = 's1') => ({ id, createdAt, planId, sessionId });
    const gens = { g1: g('g1', 1, 'P'), g2: g('g2', 5, 'P'), g3: g('g3', 0, 'OTHER'), g4: g('g4', 0, 'P', 's2') };
    const start = batchStart(gens, [gens.g2]);
    expect(start).toBe(1);
    const done = [{ type: 'asset' as const, assetId: 'a1', generationId: 'g1' }, { type: 'asset' as const, assetId: 'a3', generationId: 'g3' }];
    expect(batchCells(done, gens, start).map((c) => c.generationId)).toEqual(['g1']);
    // Without a plan, only the running ones count; nothing running, no batch.
    expect(batchStart({ g3: gens.g3 }, [gens.g3])).toBe(0);
    expect(batchStart(gens, [])).toBeNull();
  });
  it('F-07: a session or scope switch does not reuse the old start; the same key keeps the earliest', () => {
    const a = keepBatch({ key: 's1|session', at: null }, 's1|session', 5);
    expect(a).toEqual({ key: 's1|session', at: 5 });
    expect(keepBatch(a, 's1|session', 9).at).toBe(5);
    expect(keepBatch(a, 's2|session', 9)).toEqual({ key: 's2|session', at: 9 });
    expect(keepBatch(a, 's1|all', 9).at).toBe(9);
  });
  it('Studio: while a batch runs, Ongoing comes first and Done shows what the batch finished, the rest behind Show all', () => {
    vi.useFakeTimers();
    try {
      const assets = [asset('a1'), asset('a2'), asset('a3')];
      setData([gen('g1', 'done', ['a1'])], assets);
      render(createElement(SpaceBoard, { studio: true }));
      expect(q('.space-fold')!.getAttribute('aria-expanded')).toBe('true');
      expect(host.querySelectorAll('.space-tile')).toHaveLength(1);
      // The batch starts: nothing of it finished yet, so Done is just its line; Ongoing has the room.
      setData([gen('g1', 'done', ['a1']), gen('g2', 'running', [], { createdAt: 10 }), gen('g3', 'queued', [], { createdAt: 11 })], assets);
      expect(q('.space-board')!.classList.contains('is-running')).toBe(true);
      expect(q('.space-fold')!.getAttribute('aria-expanded')).toBe('false');
      expect(host.querySelectorAll('.space-done .space-tile')).toHaveLength(0);
      expect(q('.space-ongoing .space-tile.is-pending')).not.toBeNull();
      // One step of the batch finishes: it shows in Done at once, the older result stays behind Show all.
      setData([gen('g1', 'done', ['a1']), gen('g2', 'done', ['a2'], { createdAt: 10 }), gen('g3', 'running', [], { createdAt: 11 })], assets);
      expect(q('.space-fold')!.getAttribute('aria-expanded')).toBe('true');
      expect([...host.querySelectorAll('.space-done .space-tile')].map((t) => t.getAttribute('aria-label'))).toHaveLength(1);
      expect(q('.space-show-all')!.textContent).toBe('Show all 2');
      act(() => q('.space-show-all')!.click());
      expect(host.querySelectorAll('.space-done .space-tile')).toHaveLength(2);
      expect(q('.space-show-all')).toBeNull();
      // Everything done: after a short quiet spell (a plan's next step may follow) Done is whole again.
      setData([gen('g1', 'done', ['a1']), gen('g2', 'done', ['a2'], { createdAt: 10 }), gen('g3', 'done', ['a3'], { createdAt: 11 })], assets);
      act(() => { vi.advanceTimersByTime(2100); });
      expect(q('.space-board')!.classList.contains('is-running')).toBe(false);
      expect(host.querySelectorAll('.space-done .space-tile')).toHaveLength(3);
    } finally { vi.useRealTimers(); }
  });
  it('Ongoing is placed above Done while running (CSS order)', async () => {
    const css = (await import('node:fs')).readFileSync('src/styles/space.css', 'utf8');
    expect(css).toMatch(/\.space-board\.is-running \.space-done, \.space-board\.is-running \.space-failed \{ order: 1; \}/);
  });
  it('Done folds by hand with its count, in Studio and in the plain board (which keeps Actions)', () => {
    setData([gen('g1', 'done', ['a1', 'a2'])]);
    render(createElement(SpaceBoard, { kind: 'image' }));
    expect(q('.space-fold')!.textContent).toContain('2');
    act(() => q('.space-fold')!.click());
    expect(q('.space-fold')!.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelectorAll('.space-tile')).toHaveLength(0);
    expect(q('[aria-label="Actions suggested"]')).not.toBeNull();
    setData([gen('g1', 'done', ['a1', 'a2']), gen('g2', 'running', [], { createdAt: 5 })]);
    expect(q('.space-fold')!.getAttribute('aria-expanded')).toBe('false');
    act(() => q('.space-fold')!.click());
    expect(host.querySelectorAll('.space-tile')).toHaveLength(2);
  });
});

describe('Studio board: tile size and new-tile sheen (CSS)', () => {
  it('Large tiles are at least 200px; the sheen sweeps 3 times in the first 3 s of every 5 s and is off for reduced motion', async () => {
    const css = (await import('node:fs')).readFileSync('src/styles/studio.css', 'utf8');
    expect(css).toMatch(/\.space-board\.is-studio \.space-grid \{[^}]*minmax\(200px/);
    expect(css).toMatch(/is-pending::after[^}]*animation: tile-sheen 5s [^;]*infinite/);
    expect(css).toMatch(/@keyframes tile-sheen \{[^\n]*59\.99%[^\n]*60%, 100% \{[^}]*opacity: 0/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{ \.space-board\.is-studio \.space-tile\.is-pending::after \{ animation: none/);
  });
});

describe('Studio board: Ongoing tiles and default scope', () => {
  it('a running generation shows arrived outputs as tiles plus shimmer for pending ones; no compact row', () => {
    setData([gen('g1', 'running', ['a1'], { settings: { count: 3 } as never })]);
    render(createElement(SpaceBoard, { studio: true }));
    expect(host.querySelectorAll('.space-ongoing .space-tile')).toHaveLength(3);
    expect(host.querySelectorAll('.space-ongoing .space-tile.is-pending .shimmer')).toHaveLength(2);
    expect(q('.space-ongoing .space-run')).toBeNull();
    const t = host.querySelector('.space-ongoing .space-tile.is-pending .studio-pending-text')!;
    expect(t.textContent).toContain('1/3');
    expect(t.textContent).not.toContain('Ongoing');
    expect(t.querySelector('.studio-spinner')).not.toBeNull();
    render(createElement(SpaceBoard, { kind: 'image' }));
    expect(q('.space-ongoing .space-run')).not.toBeNull();
  });
  it('Studio defaults to This session; the plain board keeps All sessions', () => {
    setData([gen('g1', 'done', ['a1']), gen('g2', 'done', ['a2'], { sessionId: 'other' })]);
    render(createElement(SpaceBoard, { key: 'studio', studio: true }));
    expect(host.querySelectorAll('.space-tile')).toHaveLength(1);
    render(createElement(SpaceBoard, { key: 'plain', kind: 'image' }));
    expect(host.querySelectorAll('.space-tile')).toHaveLength(2);
  });
});

describe('attach checkboxes', () => {
  const fallback = createElement('div');
  it('ticking a chat thumbnail or a board tile (Done and Ongoing) adds it to the composer attachments', () => {
    useStore.setState({ composer: { ...useStore.getState().composer, attachments: [] } });
    setData([gen('g1', 'done', ['a1']), gen('g2', 'running', ['a2'], { settings: { count: 2 } as never, createdAt: 5 })]);
    render(createElement(StudioGeneration, { generationId: 'g1', fallback }));
    act(() => q('.studio-gen .attach-toggle')!.click());
    expect(useStore.getState().composer.attachments).toEqual(['a1']);
    render(createElement(SpaceBoard, { studio: true }));
    act(() => q('.space-fold')!.click());
    expect(q('.space-done .attach-toggle')).not.toBeNull();
    act(() => q('.space-ongoing .attach-toggle')!.click());
    expect(useStore.getState().composer.attachments).toEqual(['a1', 'a2']);
  });
});

describe('a finished Studio result keeps what the app noticed', () => {
  const fallback = createElement('div');
  it('shows the delivery mismatch and the notes, as the full card does (audit E5-02)', () => {
    setData([gen('g1', 'done', ['a1'], { delivery: ['asked 9:16, got 1:1'], notes: ['switched to NanoGPT'] } as never)]);
    render(createElement(StudioGeneration, { generationId: 'g1', fallback }));
    expect(q('.studio-gen .gen-delivery')!.textContent).toContain('asked 9:16, got 1:1');
    expect(q('.studio-gen .gen-delivery.faint')!.textContent).toContain('switched to NanoGPT');
  });
});

describe('pick mode for per-image actions', () => {
  const fallback = createElement('div');
  const btn = (l: string) => host.querySelector<HTMLElement>(`[aria-label="${l}"]`);
  it('multi-output Download asks to select, ticking two then confirming downloads both; x cancels', () => {
    setData([gen('g1', 'done', ['a1', 'a2'])]);
    render(createElement(StudioGeneration, { generationId: 'g1', fallback }));
    act(() => btn('Download')!.click());
    expect(q('.studio-pick-hint')!.textContent).toContain('Select images first');
    act(() => host.querySelectorAll<HTMLElement>('.studio-thumb')[0].click());
    expect(useStore.getState().ui.lightbox).not.toMatchObject({ assetIds: ['a1', 'a2'] });
    act(() => host.querySelectorAll<HTMLElement>('.studio-pick-box')[1].click());
    expect(q('.studio-pick-go')!.textContent).toBe('Download 2');
    act(() => btn('Cancel selection')!.click());
    expect(q('.studio-pick-hint')).toBeNull();
    expect(downloadAsset).not.toHaveBeenCalled();
    act(() => btn('Download')!.click());
    act(() => host.querySelectorAll<HTMLElement>('.studio-thumb')[0].click());
    act(() => host.querySelectorAll<HTMLElement>('.studio-thumb')[1].click());
    act(() => q('.studio-pick-go')!.click());
    expect(downloadAsset).toHaveBeenCalledWith('a1');
    expect(downloadAsset).toHaveBeenCalledWith('a2');
    expect(q('.studio-pick-hint')).toBeNull();
  });
  it('single output downloads directly', () => {
    setData([gen('g1', 'done', ['a1'])]);
    render(createElement(StudioGeneration, { generationId: 'g1', fallback }));
    act(() => btn('Download')!.click());
    expect(q('.studio-pick-hint')).toBeNull();
    expect(downloadAsset).toHaveBeenCalledWith('a1');
  });
});

describe('pick mode: several, and single-select actions', () => {
  const fallback = createElement('div');
  const btn = (l: string) => host.querySelector<HTMLElement>(`[aria-label="${l}"]`);
  const thumbs = () => [...host.querySelectorAll<HTMLElement>('.studio-thumb')];
  const boxes = () => [...host.querySelectorAll<HTMLElement>('.studio-pick-box')];
  const on = () => boxes().map((b) => b.getAttribute('aria-checked'));
  it('Download: tick 1, 2, 3 by thumbnail and box, untick, confirm downloads the rest', () => {
    setData([gen('g1', 'done', ['a1', 'a2', 'a3'])], [asset('a1'), asset('a2'), asset('a3')]);
    render(createElement(StudioGeneration, { generationId: 'g1', fallback }));
    act(() => btn('Download')!.click());
    act(() => thumbs()[0].click()); act(() => boxes()[1].click()); act(() => thumbs()[2].click());
    expect(on()).toEqual(['true', 'true', 'true']);
    act(() => boxes()[1].click());
    expect(on()).toEqual(['true', 'false', 'true']);
    expect(q('.studio-pick-go')!.textContent).toBe('Download 2');
    act(() => q('.studio-pick-go')!.click());
    expect(vi.mocked(downloadAsset).mock.calls.map((c) => c[0])).toEqual(['a1', 'a3']);
  });
  it('Favorite: several ticked end up all favorited', () => {
    setData([gen('g1', 'done', ['a1', 'a2', 'a3'])], [{ ...asset('a1'), favorite: true } as Asset, asset('a2'), asset('a3')]);
    render(createElement(StudioGeneration, { generationId: 'g1', fallback }));
    act(() => btn('Favorite')!.click());
    act(() => thumbs()[0].click()); act(() => thumbs()[1].click()); act(() => thumbs()[2].click());
    act(() => q('.studio-pick-go')!.click());
    expect(['a1', 'a2', 'a3'].map((id) => useStore.getState().assets[id].favorite)).toEqual([true, true, true]);
  });
  it('Copy, Reuse and Details take one selection only', () => {
    setData([gen('g1', 'done', ['a1', 'a2'], { variants: ['v1', 'v2'] } as never)]);
    render(createElement(StudioGeneration, { generationId: 'g1', fallback }));
    const copy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: copy }, configurable: true });
    act(() => btn('Copy prompt')!.click());
    expect(q('.studio-pick-hint')!.textContent).toContain('Select an image');
    act(() => thumbs()[0].click()); act(() => thumbs()[1].click());
    expect(on()).toEqual(['false', 'true']);
    act(() => q('.studio-pick-go')!.click());
    expect(q('.studio-pick-hint')).toBeNull();
    expect(copy).toHaveBeenCalledWith('prompt g1 v2');
    act(() => btn('Reuse: prompt, inputs, model and settings in the composer')!.click());
    act(() => thumbs()[0].click()); act(() => thumbs()[1].click());
    expect(on()).toEqual(['false', 'true']);
  });
});

describe('a result inside a row of results', () => {
  it('has no fold of its own: the row folds as a whole', () => {
    setData([gen('g1', 'done', ['a1'])]);
    render(createElement(StudioGeneration, { generationId: 'g1', fallback: createElement('div'), grouped: true }));
    expect(q('.studio-gen-head')).toBeNull();
    expect(host.querySelectorAll('.studio-thumb')).toHaveLength(1);
  });
});

describe('compact generation in Studio chat', () => {
  const fallback = createElement('div', { className: 'full-card' }, 'card');
  it('shows "Created N files" and small thumbnails that open the viewer; the line folds', () => {
    setData([gen('g1', 'done', ['a1', 'a2'])]);
    render(createElement(StudioGeneration, { generationId: 'g1', fallback }));
    expect(q('.studio-gen-head')!.textContent).toContain('Created 2 files');
    expect(host.querySelectorAll('.studio-thumb')).toHaveLength(2);
    expect(q('.full-card')).toBeNull();
    act(() => host.querySelectorAll<HTMLElement>('.studio-thumb')[1].click());
    expect(useStore.getState().ui.lightbox).toMatchObject({ assetIds: ['a1', 'a2'], index: 1 });
    act(() => q('.studio-gen-head')!.click());
    expect(host.querySelectorAll('.studio-thumb')).toHaveLength(0);
  });
  it('thumbnails carry the tinted kind icon behind the picture, as the board tiles do', () => {
    setData([gen('g1', 'done', ['a1'])]);
    render(createElement(StudioGeneration, { generationId: 'g1', fallback }));
    expect(q('.studio-thumb .kind-backdrop.is-image')).not.toBeNull();
    render(createElement(SpaceBoard, { studio: true }));
    expect(q('.space-tile .kind-backdrop.is-image')).not.toBeNull();
  });
  it('a video shows a play icon; a running generation shows a small placeholder', () => {
    setData([gen('g1', 'done', ['v1'], { kind: 'video' }), gen('g2', 'running')], [asset('v1', 'video')]);
    render(createElement(StudioGeneration, { generationId: 'g1', fallback }));
    expect(q('.studio-thumb-play')).not.toBeNull();
    render(createElement(StudioGeneration, { generationId: 'g2', fallback }));
    expect(q('.studio-thumb:not(.is-pending)')).toBeNull();
    expect(host.querySelectorAll('.studio-thumb.is-pending')).toHaveLength(1);
    expect(q('.studio-pending-text')!.textContent).toContain('Ongoing');
    expect(q('.studio-pending-text')!.textContent).not.toContain('0/1');
    // The chat placeholder is the quietest one (board > plan thumbnails > chat): flat, the kind icon, no spinner or shimmer.
    expect(q('.studio-thumb.is-pending .kind-backdrop.is-image')).not.toBeNull();
    expect(q('.studio-thumb .studio-spinner')).toBeNull();
    expect(q('.studio-thumb .shimmer')).toBeNull();
    expect(q('.studio-gen')!.textContent).not.toContain('prompt g2');
    expect(q('.studio-gen-head')).toBeNull();
  });
  it('a followed remote job can be checked or unfollowed (with confirmation); a plain busy one just stops; the card is findable by id', () => {
    setData([gen('g1', 'running', [], { remoteJob: { provider: 'demo', id: 'j' } as never }), gen('g2', 'running')]);
    render(createElement(StudioGeneration, { generationId: 'g1', fallback }));
    expect(q('#gen-g1.studio-gen')).not.toBeNull();
    const btn = (l: string) => host.querySelector<HTMLElement>(`[aria-label="${l}"]`);
    act(() => btn('Check status')!.click());
    expect(checkStatusNow).toHaveBeenCalledWith('g1');
    expect(btn('Stop')).toBeNull();
    act(() => btn('Dejar de seguir')!.click());
    expect(document.body.textContent).toContain('Keep following');
    render(createElement(StudioGeneration, { generationId: 'g2', fallback }));
    expect(btn('Stop')).not.toBeNull();
    expect(btn('Check status')).toBeNull();
  });
  it('failures and sound keep the full card', () => {
    setData([gen('g1', 'error'), gen('g2', 'done', ['a1'], { kind: 'audio' })]);
    render(createElement(StudioGeneration, { generationId: 'g1', fallback }));
    expect(q('.full-card')).not.toBeNull();
    render(createElement(StudioGeneration, { generationId: 'g2', fallback }));
    expect(q('.full-card')).not.toBeNull();
  });
});

describe('Board View popover', () => {
  const pick = (label: string) => act(() => [...document.body.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent === label)!.click());
  it('Small applies is-compact to Done and Ongoing grids; List renders rows', () => {
    setData([gen('g1', 'done', ['a1']), gen('g2', 'running', ['a2'], { settings: { count: 2 } as never, createdAt: 5 })]);
    render(createElement(SpaceBoard, { studio: true }));
    act(() => q('[aria-label="View"]')!.click());
    act(() => q('.space-fold')!.click());
    pick('Small');
    expect(host.querySelectorAll('.space-grid.is-compact').length).toBeGreaterThan(0);
    expect(host.querySelectorAll('.space-grid.is-comfortable')).toHaveLength(0);
    pick('List');
    expect(host.querySelectorAll('.space-grid')).toHaveLength(0);
    expect(host.querySelectorAll('.space-done .space-list-row')).toHaveLength(1);
    expect(q('.space-done .space-list-row .space-list-body')!.textContent).toContain('prompt g1');
    expect(host.querySelectorAll('.space-ongoing .space-list-row').length).toBe(2);
    expect(q('.space-done .space-tile')).not.toBeNull();
  });
});

describe('Studio board: an arrived output of a running generation opens like a Done tile', () => {
  const pickView = (label: string) => act(() => [...document.body.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent === label)!.click());
  const ongoingTiles = () => [...host.querySelectorAll<HTMLElement>('.space-ongoing button.space-tile')];
  beforeEach(() => { act(() => useStore.setState({ ui: { ...useStore.getState().ui, lightbox: null } })); });
  it('grid: clicking the arrived tile opens the lightbox on the generation outputs; the pending slot is not a button', () => {
    setData([gen('g1', 'running', ['a1'], { settings: { count: 2 } as never })]);
    render(createElement(SpaceBoard, { studio: true }));
    expect(ongoingTiles()).toHaveLength(1);
    expect(host.querySelectorAll('.space-ongoing .space-tile.is-pending')[0].tagName).toBe('DIV');
    act(() => ongoingTiles()[0].click());
    expect(useStore.getState().ui.lightbox).toEqual({ assetIds: ['a1'], index: 0 });
    expect(q('.space-ongoing button.space-tile .attach-toggle')).toBeNull();
    expect(q('.space-ongoing .attach-host .attach-toggle')).not.toBeNull();
  });
  it('grid: with several arrived outputs, the lightbox gets the generation list and the clicked index', () => {
    setData([gen('g1', 'running', ['a1', 'a2'], { settings: { count: 3 } as never })], [asset('a1'), asset('a2')]);
    render(createElement(SpaceBoard, { studio: true }));
    act(() => ongoingTiles()[1].click());
    expect(useStore.getState().ui.lightbox).toEqual({ assetIds: ['a1', 'a2'], index: 1 });
  });
  it('list: the arrived tile is a button and opens the lightbox', () => {
    setData([gen('g1', 'running', ['a1'], { settings: { count: 2 } as never })]);
    render(createElement(SpaceBoard, { studio: true }));
    act(() => q('[aria-label="View"]')!.click());
    pickView('List');
    expect(ongoingTiles()).toHaveLength(1);
    act(() => ongoingTiles()[0].click());
    expect(useStore.getState().ui.lightbox).toEqual({ assetIds: ['a1'], index: 0 });
  });
  it('select mode: the arrived tile toggles selection instead of opening the lightbox', () => {
    setData([gen('g1', 'running', ['a1'], { settings: { count: 2 } as never })]);
    render(createElement(SpaceBoard, { studio: true }));
    act(() => q('[aria-label="Select"]')!.click());
    act(() => ongoingTiles()[0].click());
    expect(ongoingTiles()[0].getAttribute('aria-pressed')).toBe('true');
    expect(useStore.getState().ui.lightbox).toBeNull();
  });
});

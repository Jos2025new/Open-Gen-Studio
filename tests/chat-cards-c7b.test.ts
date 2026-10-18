// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  blobDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  getAssetBlob: async () => undefined,
  peekAssetUrl: () => undefined,
  loadAssetUrl: async () => undefined,
  putAssetBlob: async () => undefined,
}));
const sent = vi.hoisted(() => ({ messages: [] as unknown[][], ensured: [] as string[] }));
vi.mock('../src/engine/agent/runtime', async (orig) => ({ ...(await orig<typeof import('../src/engine/agent/runtime')>()), sendAgentMessage: async (...a: unknown[]) => { sent.messages.push(a); } }));
vi.mock('../src/engine/catalog', async (orig) => ({ ...(await orig<typeof import('../src/engine/catalog')>()), ensureSchema: async (ref: string) => { sent.ensured.push(ref); return null; } }));

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { PlanCard } from '../src/components/chat/PlanCard';
import { SettingsCard } from '../src/components/chat/SettingsCard';
import { MediaControls } from '../src/components/composer/MediaControls';
import { variantPrompt } from '../src/engine/variantPrompt';
import { useStore } from '../src/store/store';
import type { Asset, Generation, ImageStep, ModelSchema, ModelSummary, PlanFeedItem } from '../src/engine/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  sent.messages.length = 0;
  sent.ensured.length = 0;
});
const mount = async (el: ReturnType<typeof createElement>) => { await act(async () => { root.render(el); }); };
const click = async (el: Element | null) => { await act(async () => { (el as HTMLElement).click(); }); };
const type = async (el: HTMLTextAreaElement | HTMLInputElement, value: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); });
};

const REF = 'atlas::c7/image';
const model: ModelSummary = { ref: REF, provider: 'atlas', id: 'c7/image', name: 'Studio Image', kind: 'image', acceptsText: true, acceptsImage: true, tags: [], price: { skus: [{ unit: 'output', usd: 0.04 }] } };
const BASE = 'Photorealistic portrait of a young woman, soft light, shallow depth of field.';
const VARS = ['casual outdoor daylight', 'golden-hour rooftop'];
const asset = (id: string): Asset => ({ id, name: id, kind: 'image', mime: 'image/png', width: 8, height: 8, sessionId: 's', origin: 'generated', stored: true, favorite: false, createdAt: 1 });
const plan = (over: Partial<ImageStep> = {}, status: PlanFeedItem['status'] = 'awaiting', extra: Record<string, unknown> = {}): PlanFeedItem => ({
  id: 'p1', createdAt: 0, workspace: 'chat', type: 'plan', style: 'auto', status, stepStates: {}, stepGenerations: {}, estimate: { usd: 0.082 },
  plan: { id: 'pl', title: 'Retrato', summary: 'Un retrato.', workspace: 'chat', adjustments: [], style: 'Natural light photography, warm palette.', steps: [{ id: 's1', title: 'Retrato', kind: 'image', prompt: BASE, modelRef: REF, refs: [], variations: VARS, settings: { aspect: '3:4', count: 2, advanced: {} }, ...over } as ImageStep] },
  ...extra,
} as unknown as PlanFeedItem);
const sid = () => useStore.getState().activeSessionId;
const setup = () => useStore.setState((s) => ({ catalog: { ...s.catalog, models: { ...s.catalog.models, [REF]: model } }, assets: {}, generations: {} }));

describe('C7b plan card (awaiting)', () => {
  it('is a 620px card, left aligned, with variations collapsed to two lines by default and a chevron toggle', async () => {
    setup();
    await mount(createElement(PlanCard, { item: plan(), sessionId: sid() }));
    expect(host.querySelector('article')?.classList.contains('cc-w')).toBe(true);
    const css = readFileSync('src/styles/chat-cards.css', 'utf8');
    expect(css).toMatch(/\.cc-w \{ width: min\(620px, 100%\); margin-right: auto; \}/);
    const items = [...host.querySelectorAll('.cc-var .cc-coll')];
    expect(items).toHaveLength(2);
    expect(items.every((c) => c.querySelector('.cc-ctext.is-clamped'))).toBe(true);
    const head = items[0].querySelector('.cc-coll-head') as HTMLElement;
    expect(head.getAttribute('aria-expanded')).toBe('false');
    expect(head.textContent).toBe(`Variation 1 · ${VARS[0]}`);
    await click(head);
    expect(items[0].querySelector('.cc-ctext.is-clamped')).toBeNull();
    expect(items[0].querySelector('.cc-coll-head')?.getAttribute('aria-expanded')).toBe('true');
    expect(items[1].querySelector('.cc-ctext.is-clamped')).not.toBeNull();
    await click(items[0].querySelector('.cc-coll-head'));
    expect(items[0].querySelector('.cc-ctext.is-clamped')).not.toBeNull();
  });

  it('shows each variation as the exact prompt the app sends (base + variation), delta highlighted, no separate base block', async () => {
    setup();
    await mount(createElement(PlanCard, { item: plan(), sessionId: sid() }));
    const texts = [...host.querySelectorAll('.cc-var .cc-ctext')].map((e) => e.textContent);
    expect(texts).toEqual(VARS.map((v) => variantPrompt(BASE, v)));
    expect([...host.querySelectorAll('.cc-delta')].map((e) => e.textContent)).toEqual(VARS);
    expect(host.querySelectorAll('.cc-coll-row')).toHaveLength(1); // only the style line; no base-prompt block
    // The request builder uses the same function.
    expect(readFileSync('src/engine/jobs.ts', 'utf8')).toContain('variantPrompt(shown, variants[done])');
  });

  it('a single prompt gets its chevron only when the text is really cut', async () => {
    setup();
    const item = plan({ variations: undefined, settings: { aspect: '3:4', count: 1, advanced: {} } });
    await mount(createElement(PlanCard, { item, sessionId: sid() }));
    expect(host.querySelectorAll('.cc-chev')).toHaveLength(0);
    const sh = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 80 });
    try {
      await act(async () => { root.render(createElement(PlanCard, { item: { ...item }, sessionId: sid() })); });
      const chevs = host.querySelectorAll('.cc-chev');
      expect(chevs.length).toBeGreaterThanOrEqual(1);
      const first = chevs[0] as HTMLElement;
      expect(first.getAttribute('aria-expanded')).toBe('false');
      await click(first);
      expect(host.querySelector('.cc-ctext.is-clamped')).not.toBe(first.parentElement?.querySelector('.cc-ctext'));
      expect(host.querySelector('.cc-chev')?.getAttribute('aria-expanded')).toBe('true');
    } finally {
      if (sh) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', sh); else delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollHeight;
    }
  });

  it('"Suggest changes" opens the textarea and sends the comment through the existing revise path; no lone row pencil', async () => {
    setup();
    await mount(createElement(PlanCard, { item: plan(), sessionId: sid() }));
    expect(host.querySelector('.step-variation-edit')).toBeNull();
    expect(host.querySelector('.cc-sb')).toBeNull();
    await click(host.querySelector('.cc-suggest'));
    expect(host.querySelector('.cc-sb-q')?.textContent).toBe('What should change?');
    expect(host.querySelector('.cc-sb small')?.textContent).toBe('The agent revises the plan; nothing is spent');
    const send = [...host.querySelectorAll('.cc-sb button')].find((b) => b.textContent === 'Send') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    await type(host.querySelector('.cc-sb-ta') as HTMLTextAreaElement, 'Make the second variation a night scene');
    await click(send);
    expect(sent.messages).toEqual([['Make the second variation a night scene', { attachments: [] }]]);
    expect(host.querySelector('.cc-sb')).toBeNull();
  });

  it('each prompt, variation and the style has an Edit that sends the comment prefixed with the line', async () => {
    setup();
    await mount(createElement(PlanCard, { item: plan(), sessionId: sid() }));
    const edits = [...host.querySelectorAll('.cc-edit-btn')];
    expect(edits.map((b) => b.getAttribute('aria-label'))).toEqual(['Edit "Retrato", option 1', 'Edit "Retrato", option 2', 'Edit Style']);
    await click(edits[1]);
    const input = host.querySelector('.cc-edit-input') as HTMLInputElement;
    await type(input, 'night');
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(sent.messages).toEqual([['"Retrato", option 2: night', { attachments: [] }]]);
  });

  it('footer is plain: budget left, Suggest changes, Cancel, Approve · $X', async () => {
    setup();
    await mount(createElement(PlanCard, { item: plan(), sessionId: sid() }));
    const foot = host.querySelector('.plan-foot') as HTMLElement;
    expect([...foot.querySelectorAll('button')].map((b) => b.textContent?.replace(/\s+/g, ' ').trim())).toEqual([expect.stringMatching(/^Suggest changes$/), 'Cancel', expect.stringMatching(/^Approve·\$0\.08/)]);
    expect(foot.querySelector('.plan-budget')?.textContent).toMatch(/Budget left|No spending limit|Nothing to pay/);
  });

  it('shows the reference image with a REF badge and counts it in the meta', async () => {
    setup();
    useStore.setState({ assets: { a1: asset('a1') } });
    await mount(createElement(PlanCard, { item: plan({ refs: ['asset:a1'] }), sessionId: sid() }));
    expect(host.querySelector('.plan-step [data-ref-thumb="a1"]')).not.toBeNull();
    expect(host.querySelector('.cc-ref-badge')?.textContent).toBe('REF');
    expect(host.querySelector('.step-detail')?.textContent).toMatch(/· 1 ref$/);
    expect(host.querySelector('.plan-step [data-pending]')).toBeNull();
  });
});

describe('C7b plan card (running)', () => {
  const gen = (assetIds: string[]): Generation => ({ id: 'g1', sessionId: 's', kind: 'image', status: 'running', assetIds, actualUsd: 0.041, settings: { count: 2, advanced: {} } } as unknown as Generation);
  it('counts results ("1 of 2"), one row per result with the live thumbnail, and a progress footer with Cancel', async () => {
    setup();
    useStore.setState({ assets: { a1: asset('a1'), r1: asset('r1') }, generations: { g1: gen(['a1']) } });
    const item = plan({ refs: ['asset:r1'] }, 'running', { stepStates: { s1: 'running' }, stepGenerations: { s1: 'g1' } });
    await mount(createElement(PlanCard, { item, sessionId: sid() }));
    expect(host.querySelector('.cc-run')?.textContent).toBe('1 of 2');
    expect(host.textContent).not.toMatch(/Step/);
    const rows = [...host.querySelectorAll('.cc-result')];
    expect(rows).toHaveLength(3); // reference + two results
    expect(rows[0].querySelector('[data-ref-thumb="r1"]')).not.toBeNull();
    expect(rows[1].querySelector('[data-thumb="a1"]')).not.toBeNull();
    expect(rows[1].textContent).toContain('Variation 1');
    expect(rows[1].textContent).toContain('done');
    expect(rows[2].querySelector('[data-pending]')).not.toBeNull();
    expect(rows[2].textContent).toContain('generating');
    expect(host.querySelector('.plan-progress')?.textContent).toMatch(/^1 of 2 · spent \$0\.04/);
    expect([...host.querySelectorAll('.plan-foot button')].map((b) => b.textContent)).toEqual(['Cancel']);
    // The second result arrives: its placeholder turns into the image live.
    await act(async () => { useStore.setState({ assets: { a1: asset('a1'), a2: asset('a2'), r1: asset('r1') }, generations: { g1: gen(['a1', 'a2']) } }); });
    expect(host.querySelector('.cc-run')?.textContent).toBe('2 of 2');
    expect(host.querySelectorAll('.cc-result [data-pending]')).toHaveLength(0);
  });
});

describe('C7b settings confirmed', () => {
  it('is one compact row: check, "Settings", chips for model, count, resolution and shape + ratio', async () => {
    const item = { id: 'x', createdAt: 0, workspace: 'chat', type: 'settings', summary: '', status: 'confirmed', sections: [{ kind: 'image', count: 2, recommended: { modelRef: REF, needsImage: false, aspect: '3:4', count: 2, resolution: '1K' }, alternatives: [] }] } as never;
    setup();
    await mount(createElement(SettingsCard, { item, sessionId: sid() }));
    const card = host.querySelector('article') as HTMLElement;
    expect(card.classList.contains('cc-w')).toBe(true);
    expect(card.querySelector('.q-kicker')).toBeNull();
    expect(card.querySelector('.cc-set-name')?.textContent).toBe('Settings');
    expect([...card.querySelectorAll('.cc-mini')].map((c) => c.textContent)).toEqual(['Studio Image', '×2', '1K', '3:4']);
    expect(card.querySelector('.cc-mini .cc-shape')?.getAttribute('data-shape')).toBe('3:4');
  });
});

describe('composer note for a model whose parameters did not load', () => {
  it('says it cannot be sent until they load, and Retry loads them again', async () => {
    const derived: ModelSchema = { ref: REF, params: [], slots: { prompt: 'prompt' }, source: 'derived', loadError: 'boom' } as ModelSchema;
    useStore.setState((s) => ({ catalog: { ...s.catalog, models: { ...s.catalog.models, [REF]: model }, schemas: { ...s.catalog.schemas, [REF]: derived } }, composer: { ...s.composer, image: { ...s.composer.image, modelRef: REF } } }));
    await mount(createElement(MediaControls, { kind: 'image' }));
    const chip = host.querySelector('[data-card="Settings"]') as HTMLElement;
    expect(chip).not.toBeNull();
    await click(chip);
    const note = document.body.querySelector('[data-testid="schema-note"]') as HTMLElement;
    expect(note.textContent).toContain("Parameters for this model couldn't be loaded from Atlas");
    expect(note.textContent).toContain("can't be sent until they load");
    expect(note.textContent).not.toMatch(/provider defaults/);
    sent.ensured.length = 0;
    await click(note.querySelector('button'));
    expect(sent.ensured).toEqual([REF]);
  });
});

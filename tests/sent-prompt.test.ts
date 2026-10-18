// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The plan card shows the text the app sends. The send path adds the step's capture style / realism clauses before the
 * variation, so the card must show that final text, built by the same function. Nothing reaches a provider: the local
 * adapter is replaced and records the request it receives.
 */
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  blobDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  getAssetBlob: async () => undefined,
  peekAssetUrl: () => undefined,
  loadAssetUrl: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { PlanCard } from '../src/components/chat/PlanCard';
import { createGeneration, runGeneration } from '../src/engine/jobs';
import { ADAPTERS } from '../src/engine/providers/registry';
import { LOCAL_IMAGE_REF } from '../src/engine/providers/demo';
import { useStore } from '../src/store/store';
import type { ImageStep, PlanFeedItem } from '../src/engine/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const sid = () => useStore.getState().activeSessionId;
let host: HTMLDivElement;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); });

/** What the app really sends for this step: the real job against a stubbed adapter. */
async function sentBy(step: ImageStep): Promise<string[]> {
  const prompts: string[] = [];
  const real = ADAPTERS.local.generate;
  ADAPTERS.local.generate = async (req) => { prompts.push(req.prompt); return { outputs: [] }; };
  try {
    const g = createGeneration({ sessionId: sid(), kind: 'image', prompt: step.prompt, modelRef: step.modelRef, settings: step.settings, origin: 'agent', inputs: { refs: [] }, variants: step.variations });
    await runGeneration(g.id).catch(() => undefined);
  } finally {
    ADAPTERS.local.generate = real;
  }
  return prompts;
}

async function cardTexts(step: ImageStep): Promise<string[]> {
  const item = { id: 'p1', createdAt: 0, workspace: 'chat', type: 'plan', style: 'auto', status: 'awaiting', stepStates: {}, stepGenerations: {}, estimate: { usd: 0 }, plan: { id: 'pl', title: 'T', workspace: 'chat', adjustments: [], steps: [step] } } as unknown as PlanFeedItem;
  const root = createRoot(host);
  await act(async () => { root.render(createElement(PlanCard, { item, sessionId: sid() })); });
  for (const h of host.querySelectorAll('.cc-coll-head')) await act(async () => { (h as HTMLElement).click(); });
  const out = [...host.querySelectorAll('.cc-ctext')].map((e) => e.textContent ?? '');
  await act(async () => { root.unmount(); });
  return out;
}

const base = (over: Partial<ImageStep>): ImageStep => ({ id: 's1', kind: 'image', title: 'Sheet', prompt: 'gamer girl sheet', modelRef: LOCAL_IMAGE_REF, refs: [], settings: { count: 2, advanced: {}, capture: { style: 'documentary' } }, ...over } as ImageStep);

describe('the card shows the prompt the app sends', () => {
  it('variations with a capture style: the expanded text is the request prompt (style clause included), delta highlighted', async () => {
    const step = base({ variations: ['pink hair', 'black braids'] });
    // One request per candidate; the stub ends each job after its first request, so each variation is sent on its own.
    const sent = [...(await sentBy({ ...step, variations: ['pink hair'] })), ...(await sentBy({ ...step, variations: ['black braids'] }))];
    expect(sent[0]).toContain('35 mm handheld'); // the capture clause really was added by the send path
    expect(await cardTexts(step)).toEqual(sent);
  });

  it('a single prompt with a capture style shows the sent text', async () => {
    const step = base({ settings: { count: 1, advanced: {}, capture: { style: 'documentary' } } });
    const sent = await sentBy(step);
    expect(sent).toHaveLength(1);
    expect(await cardTexts(step)).toEqual(sent);
  });

  it('the variation stays highlighted as the delta, after the styled base', async () => {
    const step = base({ variations: ['pink hair'] });
    const item = { id: 'p1', createdAt: 0, workspace: 'chat', type: 'plan', style: 'auto', status: 'awaiting', stepStates: {}, stepGenerations: {}, estimate: { usd: 0 }, plan: { id: 'pl', title: 'T', workspace: 'chat', adjustments: [], steps: [step] } } as unknown as PlanFeedItem;
    const root = createRoot(host);
    await act(async () => { root.render(createElement(PlanCard, { item, sessionId: sid() })); });
    await act(async () => { (host.querySelector('.cc-coll-head') as HTMLElement).click(); });
    expect(host.querySelector('.cc-ctext .cc-delta')?.textContent).toBe('pink hair');
    expect(host.querySelector('.cc-ctext')?.textContent?.endsWith('\npink hair')).toBe(true);
    await act(async () => { root.unmount(); });
  });
});

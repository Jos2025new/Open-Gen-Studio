// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, blobDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined }));
const execute = vi.hoisted(() => vi.fn(async () => ({ outputs: new Map(), failed: [], skipped: [] })));
vi.mock('../src/engine/executor', async (original) => ({ ...(await original<typeof import('../src/engine/executor')>()), executeSteps: execute }));
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { RunButton } from '../src/components/node/nodes';
import { createSession, useStore } from '../src/store/store';
import { previewRun } from '../src/engine/flow/actions';
import { overLimit } from '../src/engine/budget';
import type { Graph, ModelSummary } from '../src/engine/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

/*
 * 2026-10-29 audit: «Continue once» on the Nodes Run popover must let that run start. The action handed to the pass must
 * hand back its promise, or the pass is retired at once and runNodes asks about the limit again and refuses.
 */
const ref = 'fal::fal-ai/priced';
const graph: Graph = { nodes: [{ id: 'n', position: { x: 0, y: 0 }, data: { kind: 'image', title: 'N', prompt: 'a cat', modelRef: ref, settings: { count: 1, advanced: {} }, outputIndex: 0 } }], edges: [] };

beforeEach(() => {
  const st = useStore.getState();
  const m = { ref, provider: 'fal', id: 'fal-ai/priced', name: 'p', kind: 'image', acceptsText: true, acceptsImage: false, tags: [], price: { skus: [{ usd: 0.5, unit: 'output' }] } } as unknown as ModelSummary;
  useStore.setState({
    spentUsd: 5, activeSessionId: 'A', sessions: { A: { ...createSession(), id: 'A', graph } },
    catalog: { ...st.catalog, models: { [ref]: m }, schemas: { [ref]: { ref, params: [], source: 'openapi', slots: { prompt: 'prompt' } } } },
    settings: { ...st.settings, keys: { ...st.settings.keys, fal: 'k' }, budgetOn: true, budgetUsd: 5, budgetAccepted: null, budgetNoAsk: false },
  } as never);
  execute.mockClear();
});

describe('«Continue once» on a Nodes Run', () => {
  it('lets the approved run start', async () => {
    const preview = previewRun('A', ['n']);
    const host = document.createElement('div');
    document.body.replaceChildren(host);
    act(() => createRoot(host).render(createElement(RunButton, { node: graph.nodes[0] })));
    await act(async () => { (host.querySelector('button[aria-label="Run node"]') as HTMLButtonElement).click(); await new Promise((r) => setTimeout(r, 20)); });
    const btn = [...document.body.querySelectorAll('button')].find((b) => /Continue once/.test(b.textContent ?? '')) as HTMLButtonElement;
    expect(btn).toBeTruthy();
    await act(async () => { btn.click(); await new Promise((r) => setTimeout(r, 20)); });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(overLimit(preview.estimate, 'A')).toBe(true); // and the next one asks again
  });
});

// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { ActivityBlock } from '../src/components/chat/ActivityBlock';
import type { ActivityFeedItem } from '../src/engine/types';
import { useStore } from '../src/store/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('ActivityBlock renders', () => {
  it('mounts with no schema wait set (its selectors must return stable values) and lists a pending one', async () => {
    const sessionId = Object.keys(useStore.getState().sessions)[0];
    const item = { id: 'a1', type: 'activity', startedAt: Date.now() - 5000, entries: [] } as unknown as ActivityFeedItem;
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await act(async () => { root.render(createElement(ActivityBlock, { item, sessionId })); });
    expect(host.querySelector('.activity')).not.toBeNull();
    expect(errors).not.toHaveBeenCalled();
    const s = useStore.getState().sessions[sessionId];
    await act(async () => {
      useStore.setState({ sessions: { ...useStore.getState().sessions, [sessionId]: { ...s, agent: { ...s.agent, busy: true, waiting: [{ key: 'k', name: 'Wan 3.0', since: Date.now() - 4000 }] } } } });
    });
    expect(host.textContent).toContain('Loading schema');
    expect(host.textContent).toContain('Wan 3.0');
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
    await act(async () => { root.unmount(); });
  });

  it('a finished turn folds to one line with what it did; its reasoning shows only when opened (ADR 0024 M)', async () => {
    const sessionId = Object.keys(useStore.getState().sessions)[0];
    const s = useStore.getState().sessions[sessionId];
    useStore.setState({ sessions: { ...useStore.getState().sessions, [sessionId]: { ...s, agent: { ...s.agent, busy: false, waiting: [] } } } });
    const item = { id: 'a2', type: 'activity', startedAt: Date.now() - 7000, endedAt: Date.now(), entries: [
      { kind: 'thinking', text: 'Long private reasoning text', ms: 2000 },
      { kind: 'action', icon: 'questions', label: 'Asked 1 question' },
    ] } as unknown as ActivityFeedItem;
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => { root.render(createElement(ActivityBlock, { item, sessionId })); });
    const head = host.querySelector<HTMLButtonElement>('.act-head')!;
    expect(head.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('.act-sum')?.textContent).toBe('Asked 1 question');
    expect(host.querySelector('.act-list')).toBeNull();
    expect(host.textContent).not.toContain('Long private reasoning');
    await act(async () => { head.click(); });
    expect(head.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector('.act-sum')).toBeNull();
    expect(host.textContent).toContain('Thought for');
    expect(host.textContent).not.toContain('Long private reasoning');
    await act(async () => { host.querySelector<HTMLButtonElement>('.act-thinking .act-line')!.click(); });
    expect(host.textContent).toContain('Long private reasoning');
    await act(async () => { root.unmount(); });
  });
});

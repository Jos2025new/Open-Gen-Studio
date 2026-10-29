// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, blobDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined }));
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QuestionsCard } from '../src/components/chat/QuestionsCard';
import { sendAgentMessage } from '../src/engine/agent/runtime';
import { useStore } from '../src/store/store';
import type { QuestionsFeedItem } from '../src/engine/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

/*
 * 2026-10-29 audit: the user picks another option (or writes «Otra respuesta») in the questions card and then types in the
 * Composer without pressing Continue. What goes out must be what the card showed selected, not the recommendation.
 */
const q = { id: 'who', question: 'Who?', options: ['A gamer', 'A chef'], default: 'A gamer', multi: false, allowCustom: true };
const item = { id: 'q1', createdAt: 0, workspace: 'chat', type: 'questions', status: 'pending', round: 1, maxRounds: 1, questions: [q] } as unknown as QuestionsFeedItem;
const sid = () => useStore.getState().activeSessionId;
const answers = () => (useStore.getState().sessions[sid()].feed.find((f) => f.id === 'q1') as QuestionsFeedItem).answers;
let host: HTMLDivElement;

function setup() {
  const st = useStore.getState();
  useStore.setState({
    composer: { ...st.composer, agentStyle: 'auto', attachments: [] },
    sessions: { ...st.sessions, [sid()]: { ...st.sessions[sid()], feed: [item], editLog: [], agent: { history: [], questionRound: 0, notes: [], busy: false, pending: { kind: 'questions', feedItemId: 'q1', toolCallId: null } } } },
  } as never);
  host = document.createElement('div');
  document.body.replaceChildren(host);
  act(() => createRoot(host).render(createElement(QuestionsCard, { item, sessionId: sid() })));
}
const click = (label: string) => act(() => ([...host.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === label || b.textContent?.trim() === label) as HTMLButtonElement).click());

beforeEach(setup);

describe('typing with a questions card open sends what the card shows', () => {
  it('a chosen option B is sent, not the recommended A', async () => {
    click('A chef');
    await sendAgentMessage('que sea mayor de 40');
    expect(answers()?.who).toBe('A chef');
  });
  it('their own words («Otra respuesta») are sent, not the recommendation', async () => {
    click('Otra respuesta…');
    const input = host.querySelector('input.q-custom') as HTMLInputElement;
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'a pirate'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await sendAgentMessage('hola');
    expect(answers()?.who).toBe('a pirate');
  });
  it('an untouched card still sends the recommendation', async () => {
    await sendAgentMessage('hola');
    expect(answers()?.who).toBe('A gamer');
  });
});

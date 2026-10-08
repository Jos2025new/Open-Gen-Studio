import { describe, expect, it, vi } from 'vitest';

/*
 * The three agent modes. Auto (default) and guided keep their behavior; direct asks nothing, shows no settings card and
 * uses the composer's models. Stubbed fetch, nothing reaches a provider.
 */
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));


import { forcedCheck, forcedFor, forcedNote, strongOps } from '../src/engine/agent/force';
import { sendAgentMessage } from '../src/engine/agent/runtime';
import { useStore } from '../src/store/store';
import type { PlanFeedItem } from '../src/engine/types';

/*
 * Forced operations (agent/force.ts): five strong triggers with their input as precondition set a floor on the plan.
 * The agent is told before it plans, a plan without the operation is sent back with the step to add, and the accepted
 * plan says what the request forced. Stubbed fetch, nothing reaches a provider.
 */
const img = { id: 'img1', kind: 'image' };
const vid = { id: 'vid1', kind: 'video' };
const aud = { id: 'aud1', kind: 'audio' };

describe('strong triggers force only with their input attached', () => {
  it('each of the five forces with its input, and nothing without it', () => {
    expect(strongOps('quítale el fondo', [img])).toEqual([{ op: 'remove_bg', phrase: 'quitale el fondo', input: 'asset:img1' }]);
    expect(strongOps('quítale el fondo', [])).toEqual([]);
    expect(strongOps('quítale el fondo', [vid])).toEqual([]);
    expect(strongOps('dame el último frame', [vid]).map((f) => f.op)).toEqual(['extract_frame']);
    expect(strongOps('una vista lateral de este personaje', [img]).map((f) => f.op)).toEqual(['angle']);
    expect(strongOps('hazme una hoja de personaje de ella', [img]).map((f) => f.op)).toEqual(['reference_sheet']);
    expect(strongOps('crea una voz como la de este audio', [aud]).map((f) => f.op)).toEqual(['create_voice']);
  });

  it('an angle forces only when one is named, and never inside a sheet', () => {
    expect(strongOps('dame un ángulo diferente', [img])).toEqual([]);
    expect(strongOps('hoja de personaje con vista lateral y trasera', [img]).map((f) => f.op)).toEqual(['reference_sheet']);
  });

  it('several in the order the request names them', () => {
    expect(strongOps('quita el fondo y luego dame una vista lateral', [img]).map((f) => f.op)).toEqual(['remove_bg', 'angle']);
  });
});

describe('the floor on a plan', () => {
  it('a plan without the forced op is sent back with the exact step; the accepted one says it, and that one was sent back', () => {
    const state = forcedFor('s-floor', 'quita el fondo', [img]);
    const missing = forcedCheck([{ id: 's1', kind: 'op', op: 'edit' }], state);
    expect(missing.errors[0]).toContain('{ "kind": "op", "op": "remove_bg", "input": "asset:img1" }');
    const present = forcedCheck([{ id: 's1', kind: 'op', op: 'remove_bg' }], forcedFor('s-floor', 'quita el fondo', [img]));
    expect(present.errors).toEqual([]);
    expect(present.adjustments[0]).toContain('required by your request');
    expect(present.adjustments[0]).toContain('sent back');
  });

  it('a new request starts clean', () => {
    forcedCheck([], forcedFor('s-reset', 'quita el fondo', [img]));
    const next = forcedCheck([{ id: 's1', kind: 'op', op: 'remove_bg' }], forcedFor('s-reset', 'quita el fondo de esta otra', [img]));
    expect(next.adjustments[0]).not.toContain('sent back');
  });

  it('the agent reads two lines, only when something is forced', () => {
    expect(forcedNote([])).toBe('');
    const note = forcedNote(strongOps('quita el fondo', [img]));
    expect(note).toContain('The app detected in this request: remove_bg on asset:img1');
    expect(note.trim().split('\n').filter((l) => l && l !== '---')).toHaveLength(2);
  });
});

describe('in a request, end to end', () => {
  it('the note travels with the request; a plan without remove_bg is sent back; the accepted plan says why', async () => {
    const sent: string[] = [];
    const editPlan = { title: 'Fondo', steps: [{ id: 's1', kind: 'op', op: 'edit', input: 'asset:img1', params: { instruction: 'remove the background' } }] };
    const bgPlan = { title: 'Fondo', steps: [{ id: 's1', kind: 'op', op: 'remove_bg', input: 'asset:img1' }] };
    const replies = [editPlan, bgPlan];
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (!body.messages) return new Response(JSON.stringify({ data: [] }));
      sent.push(JSON.stringify(body.messages));
      const plan = replies.shift();
      const delta = plan ? { tool_calls: [{ index: 0, id: `c${sent.length}`, function: { name: 'propose_plan', arguments: JSON.stringify(plan) } }] } : { content: 'Listo.' };
      return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: plan ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
    });
    const st = useStore.getState();
    const sid = st.activeSessionId;
    useStore.setState({
      settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'k' }, agent: { ...st.settings.agent, provider: 'nanogpt', model: 'm' } },
      composer: { ...st.composer, agentStyle: 'auto', attachments: ['img1'] },
      assets: { ...st.assets, img1: { id: 'img1', kind: 'image', name: 'foto.png', width: 1024, height: 1024, createdAt: Date.now() } as never },
      sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], feed: [], subjects: [], agent: { history: [], questionRound: 0, notes: [], busy: false } } },
    });
    await sendAgentMessage('Quítale el fondo a esta foto');
    expect(sent[0]).toContain('The app detected in this request: remove_bg on asset:img1');
    expect(sent[1]).toContain('the plan has no remove_bg step');
    const plans = useStore.getState().sessions[sid].feed.filter((f) => f.type === 'plan') as unknown as PlanFeedItem[];
    expect(plans).toHaveLength(1);
    expect(plans[0].plan.adjustments.join(' ')).toContain('remove_bg, required by your request');
    expect(plans[0].plan.adjustments.join(' ')).toContain('an earlier plan without it was sent back');
    vi.unstubAllGlobals();
  });
});

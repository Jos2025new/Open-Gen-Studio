import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The agent's find_commands / run_commands over every area and workspace (ADR 0030, "Agente"): the index, the area
 * listings, a chain on the graph, the hidden commands, and spend / delete refused with a readable text. Never a provider.
 */
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CommandApprovalCard } from '../src/components/chat/CommandApprovalCard';
import { sendAgentMessage } from '../src/engine/agent/runtime';
import { AGENT_HIDDEN, decideCommandApproval, findCommandsTool, runCommandsTool } from '../src/engine/agent/commandCalls';
import { COMMAND_TOOLS } from '../src/engine/agent/commandTools';
import { z } from 'zod';
import { budgetProblem } from '../src/engine/actions';
import { askAgain, dontAskUntilNextSession, overLimit } from '../src/engine/budget';
import { allCommands, argsSchema, command, setApprover } from '../src/engine/commands';
import { register } from '../src/engine/commands/registry';
import { defineCommand } from '../src/engine/commands/types';
import { graphHistory } from '../src/engine/flow/history';
import type { CommandApprovalFeedItem } from '../src/engine/types';
import { createSession, useStore } from '../src/store/store';

let sid = '';
const graph = () => useStore.getState().sessions[sid].graph;
const fetchSpy = vi.fn(async () => { throw new Error('Unexpected fetch'); });

beforeEach(() => {
  const session = createSession('Agent commands');
  sid = session.id;
  useStore.setState((st) => ({ sessions: { ...st.sessions, [sid]: session }, activeSessionId: sid }));
  fetchSpy.mockClear();
  vi.stubGlobal('fetch', fetchSpy);
});

const chain = [
  { cmd: 'nodes.node.new_data', args: { kind: 'text' } },
  { cmd: 'nodes.node.add', args: { data: '$1', position: { x: 0, y: 0 } } },
  { cmd: 'nodes.node.edit', args: { node: '$2.node', patch: { title: 'Prompt', text: 'Hola' } } },
];

describe('find_commands', () => {
  it('answers an index of the areas, not every command', () => {
    const answer = findCommandsTool(sid, {});
    const lines = answer.text.split('\n');
    expect(answer.done).toBe(true);
    expect(lines).toHaveLength(2 + 7);
    expect(lines[0]).not.toContain('Document on screen');
    expect(lines.find((l) => l.startsWith('nodes '))).toMatch(/^nodes \(21\) — /);
    expect(lines.find((l) => l.startsWith('models '))).toMatch(/^models \(3\) — /);
    expect(lines.find((l) => l.startsWith('sessions '))).toMatch(/^sessions \(4\) — /);
    expect(findCommandsTool(sid, { area: 'nope' })).toEqual(findCommandsTool(sid, {}));
  });

  it('lists an area with signatures, marks spend and delete, and never lists the hidden ones', () => {
    const nodes = findCommandsTool(sid, { area: 'nodes' }).text.split('\n');
    expect(nodes).toHaveLength(1 + 21);
    expect(nodes.find((l) => l.startsWith('nodes.run.start '))).toContain("[needs the user's approval]");
    expect(nodes.find((l) => l.startsWith('nodes.edge.connect '))).not.toContain('needs the user');
    const studio = findCommandsTool(sid, { area: 'studio' }).text;
    expect(studio).toMatch(/studio\.generation\.delete .*\[needs the user's approval/);
    const everything = [...Object.keys(AGENT_HIDDEN)].map((id) => findCommandsTool(sid, { area: id.split('.')[0] }).text + findCommandsTool(sid, { text: id }).text).join('\n');
    for (const id of Object.keys(AGENT_HIDDEN)) { expect(command(id), id).toBeDefined(); expect(everything, id).not.toMatch(new RegExp(`^${id.replace(/\./g, '\\.')} `, 'm')); }
    expect(findCommandsTool(sid, { area: 'models' }).text.split('\n')).toHaveLength(1 + 3);
    expect(findCommandsTool(sid, { text: 'zzz' })).toMatchObject({ done: false });
  });

  it('names the document only when there is one', () => {
    expect(findCommandsTool(sid, { area: 'sessions' }).text.split('\n')[0]).not.toContain('Document');
  });
});

describe('run_commands', () => {
  it('chains three nodes commands with $n: one graph undo step, in any workspace', async () => {
    const answer = await runCommandsTool(sid, { seq: chain });
    expect(answer.text).toMatch(/^Done, 3 steps\./);
    expect(graph().nodes).toHaveLength(1);
    expect(graph().nodes[0].data).toMatchObject({ kind: 'text', text: 'Hola' });
    expect(graphHistory(sid, 'undo')).toHaveLength(1);
  });

  it('reaches the registry end to end from the chat workspace', async () => {
    const sent: string[] = [];
    const replies = [{ name: 'run_commands', args: { seq: chain } }];
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (!body.messages) return new Response(JSON.stringify({ data: [] }));
      sent.push(JSON.stringify(body.messages));
      const call = replies.shift();
      const delta = call ? { tool_calls: [{ index: 0, id: `c${sent.length}`, function: { name: call.name, arguments: JSON.stringify(call.args) } }] } : { content: 'Listo.' };
      return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: call ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
    });
    const st = useStore.getState();
    useStore.setState({ ui: { ...st.ui, workspace: 'chat' }, settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'k' }, agent: { ...st.settings.agent, provider: 'nanogpt', model: 'm' } }, composer: { ...st.composer, agentStyle: 'auto', attachments: [] } });
    await sendAgentMessage('Pon un nodo de texto');
    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain('Done, 3 steps.');
    expect(sent[1]).not.toContain('works only in the Designer');
    expect(graph().nodes).toHaveLength(1);
  });

  it('refuses a hidden command with its reason, and nothing runs', async () => {
    const before = useStore.getState();
    const answer = await runCommandsTool(sid, { seq: [...chain.slice(0, 1), { cmd: 'models.composer.pick', args: {} }] });
    expect(answer).toEqual({ text: 'Step 2: "models.composer.pick" is not available to the agent: the model is the user\'s choice. Nothing ran.', done: false });
    expect((await runCommandsTool(sid, { seq: [{ cmd: 'sessions.new' }] })).text).toMatch(/^Step 1: "sessions\.new" is not available to the agent: it would move the user/);
    expect(useStore.getState()).toBe(before);
  });

  it('asks for approval on spend and delete: canceling rolls back earlier writes and calls no provider', async () => {
    setApprover(null);
    useStore.setState({ generations: { g: { id: 'g', sessionId: sid } as never } });
    const spend = [{ cmd: 'studio.generate.start', args: { kind: 'image' } }, { cmd: 'nodes.run.start', args: { targets: ['nope'] } }];
    for (const step of spend) {
      const pendingRun = runCommandsTool(sid, { seq: [step] });
      const card = useStore.getState().sessions[sid].feed.findLast((f): f is CommandApprovalFeedItem => f.type === 'commands');
      expect(card?.status).toBe('awaiting');
      expect(decideCommandApproval(sid, card!.id, 'cancel')).toBe(true);
      expect((await pendingRun).text, step.cmd).toBe("Step 1 needs the user's approval (it spends or deletes). Nothing ran.");
    }
    const pendingDelete = runCommandsTool(sid, { seq: [...chain.slice(0, 2), { cmd: 'studio.generation.delete', args: { generationId: 'g' } }] });
    const deleteCard = useStore.getState().sessions[sid].feed.findLast((f): f is CommandApprovalFeedItem => f.type === 'commands');
    expect(deleteCard?.status).toBe('awaiting');
    expect(decideCommandApproval(sid, deleteCard!.id, 'cancel')).toBe(true);
    const deleted = await pendingDelete;
    expect(deleted).toEqual({ text: "Step 3 needs the user's approval (it spends or deletes). Nothing ran.", done: false });
    expect(graph().nodes).toEqual([]);
    expect(useStore.getState().generations.g).toBeDefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('produces one approval per sequence with the real total cost across $n spend steps, and approves delete too', async () => {
    setApprover(null);
    const st = useStore.getState();
    useStore.setState({
      spentUsd: 0,
      settings: { ...st.settings, budgetOn: true, budgetUsd: 10, budgetAccepted: null, budgetNoAsk: false },
      catalog: {
        ...st.catalog,
        models: {
          ...st.catalog.models,
          'fal::test-image': {
            ref: 'fal::test-image',
            provider: 'fal',
            id: 'fal-ai/test-image',
            name: 'Test Image',
            kind: 'image',
            price: { skus: [{ unit: 'output', usd: 0.05 }] },
          } as never,
        },
      },
    });
    const seq = [
      { cmd: 'nodes.node.new_data', args: { kind: 'image' } },
      { cmd: 'nodes.node.add', args: { data: '$1', position: { x: 0, y: 0 } } },
      { cmd: 'nodes.node.edit', args: { node: '$2.node', patch: { prompt: 'first cat', modelRef: 'fal::test-image', settings: { count: 2, advanced: {} } } } },
      { cmd: 'nodes.run.start', args: { targets: ['$2.node'] } },
      { cmd: 'nodes.node.new_data', args: { kind: 'image' } },
      { cmd: 'nodes.node.add', args: { data: '$5', position: { x: 300, y: 0 } } },
      { cmd: 'nodes.node.edit', args: { node: '$6.node', patch: { prompt: 'second cat', modelRef: 'fal::test-image', settings: { count: 1, advanced: {} } } } },
      { cmd: 'nodes.run.start', args: { targets: ['$6.node'] } },
    ];
    const pendingRun = runCommandsTool(sid, { seq });
    const cards = useStore.getState().sessions[sid].feed.filter((f): f is CommandApprovalFeedItem => f.type === 'commands');
    expect(cards).toHaveLength(1);
    const card = cards[0];
    expect(card.status).toBe('awaiting');
    expect(card.steps).toHaveLength(2);
    expect(card.steps[0].args).toEqual({ targets: [graph().nodes[0].id] });
    expect(card.steps[0].estimate.usd).toBeCloseTo(0.10);
    expect(card.steps[1].args).toEqual({ targets: [graph().nodes[1].id] });
    expect(card.steps[1].estimate.usd).toBeCloseTo(0.05);
    expect(card.estimate.usd).toBeCloseTo(0.15);

    const html = renderToStaticMarkup(createElement(CommandApprovalCard, { item: card, sessionId: sid }));
    expect(html).toContain('Approve');
    expect(html).toContain('$0.15');
    expect(html).not.toContain('Allow this time');

    expect(decideCommandApproval(sid, card.id, 'cancel')).toBe(true);
    await pendingRun;
    expect(graph().nodes).toEqual([]);

    // Delete sequence: one approval, runs when approved.
    const pendingDel = runCommandsTool(sid, {
      seq: [
        { cmd: 'library.subject.save', args: { subject: { id: 'sub_1', name: 'Hero', refAssetIds: [] } } },
        { cmd: 'library.subject.delete', args: { id: '$1.id' } },
      ],
    });
    const delCard = useStore.getState().sessions[sid].feed.findLast((f): f is CommandApprovalFeedItem => f.type === 'commands')!;
    expect(delCard.steps).toEqual([{ step: 2, cmd: 'library.subject.delete', title: 'Delete subject', effect: 'delete', args: { id: 'sub_1' }, estimate: { usd: 0, approximate: false } }]);
    expect(decideCommandApproval(sid, delCard.id, 'approve')).toBe(true);
    const delDone = await pendingDel;
    expect(delDone.done).toBe(true);
    expect(useStore.getState().library).toEqual([]);
  });

  it('holds requests at the spending limit until the user picks Allow this time, Allow for the whole session, or Don’t ask again until next session', async () => {
    setApprover(null);
    askAgain(sid);
    const other = createSession('Other session');
    const st = useStore.getState();
    useStore.setState({
      spentUsd: 0.95,
      sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], noAskOverLimit: false }, [other.id]: other },
      settings: { ...st.settings, budgetOn: true, budgetUsd: 1.0, budgetAccepted: null, budgetNoAsk: false },
      catalog: {
        ...st.catalog,
        models: {
          ...st.catalog.models,
          'fal::paid-image': {
            ref: 'fal::paid-image',
            provider: 'fal',
            id: 'fal-ai/paid-image',
            name: 'Paid Local',
            kind: 'image',
            price: { skus: [{ unit: 'output', usd: 0.10 }] },
          } as never,
        },
      },
    });
    // A stand-in for a paid run: it prices $0.10 and, like the real ones, refuses itself when the limit would stop it.
    const price = { usd: 0.10, approximate: false };
    if (!command('nodes.test.paid')) register(defineCommand({ id: 'nodes.test.paid', title: 'Paid stand-in', args: z.object({ node: z.string() }).strict(), effect: 'spend', estimate: () => price, run: (_ctx, args) => { const problem = budgetProblem(price, sid); if (problem) throw new Error(problem); return { ran: args.node }; } }));
    const makeNodeAndRun = [
      { cmd: 'nodes.node.new_data', args: { kind: 'image' } },
      { cmd: 'nodes.node.add', args: { data: '$1', position: { x: 0, y: 0 } } },
      { cmd: 'nodes.test.paid', args: { node: '$2.node' } },
    ];

    // 1. At the limit ($0.95 spent + $0.10 > $1.00): plain 'approve' is held; 'once' ("Allow this time") lets only this sequence through.
    const run1 = runCommandsTool(sid, { seq: makeNodeAndRun });
    const card1 = useStore.getState().sessions[sid].feed.findLast((f): f is CommandApprovalFeedItem => f.type === 'commands')!;
    expect(card1.estimate.usd).toBeCloseTo(0.10);
    const overHtml = renderToStaticMarkup(createElement(CommandApprovalCard, { item: card1, sessionId: sid }));
    expect(overHtml).toContain('Allow this time');
    expect(overHtml).toContain('Allow for the whole session');
    expect(overHtml).toContain('Don’t ask again until next session');
    expect(decideCommandApproval(sid, card1.id, 'approve')).toBe(false);
    expect(useStore.getState().sessions[sid].feed.find((f): f is CommandApprovalFeedItem => f.id === card1.id)?.status).toBe('awaiting');
    expect(decideCommandApproval(sid, card1.id, 'once')).toBe(true);
    expect((await run1).done).toBe(true);
    // Next run in the same session is held at the limit again.
    expect(overLimit({ usd: 0.10, approximate: false }, sid)).toBe(true);

    // 2. "Allow for the whole session" ('session') allows this session, while other sessions stay held at the limit.
    const run2 = runCommandsTool(sid, { seq: makeNodeAndRun });
    const card2 = useStore.getState().sessions[sid].feed.findLast((f): f is CommandApprovalFeedItem => f.type === 'commands')!;
    expect(decideCommandApproval(sid, card2.id, 'approve')).toBe(false);
    expect(decideCommandApproval(sid, card2.id, 'session')).toBe(true);
    expect((await run2).done).toBe(true);
    expect(overLimit({ usd: 0.10, approximate: false }, sid)).toBe(false);
    expect(overLimit({ usd: 0.10, approximate: false }, other.id)).toBe(true);

    // Reset session flag and test 3. "Don't ask again until next session" ('until-next-session').
    askAgain(sid);
    expect(overLimit({ usd: 0.10, approximate: false }, sid)).toBe(true);
    const run3 = runCommandsTool(sid, { seq: makeNodeAndRun });
    const card3 = useStore.getState().sessions[sid].feed.findLast((f): f is CommandApprovalFeedItem => f.type === 'commands')!;
    expect(decideCommandApproval(sid, card3.id, 'approve')).toBe(false);
    expect(decideCommandApproval(sid, card3.id, 'until-next-session')).toBe(true);
    expect((await run3).done).toBe(true);
    expect(overLimit({ usd: 0.10, approximate: false }, sid)).toBe(false);
    expect(overLimit({ usd: 0.10, approximate: false }, other.id)).toBe(false);

    // Changing the limit also ends it.
    useStore.setState((cur) => ({ settings: { ...cur.settings, budgetUsd: 1.5 } }));
    expect(overLimit({ usd: 0.60, approximate: false }, sid)).toBe(true);
    useStore.setState((cur) => ({ settings: { ...cur.settings, budgetUsd: 1.0 } }));
    dontAskUntilNextSession(sid);
    expect(overLimit({ usd: 0.10, approximate: false }, sid)).toBe(false);

    // Starting a new session resets "until next session".
    const nextSession = createSession('Next session');
    useStore.setState((cur) => ({ sessions: { ...cur.sessions, [nextSession.id]: nextSession } }));
    expect(overLimit({ usd: 0.10, approximate: false }, nextSession.id)).toBe(true);
    expect(overLimit({ usd: 0.10, approximate: false }, sid)).toBe(true);
  });

  it('still takes only on.doc from a step', async () => {
    expect((await runCommandsTool(sid, { seq: [{ cmd: 'nodes.run.list', on: { session: 'other' } }] })).text).toMatch(/^Invalid run_commands input: seq\.0\.on/);
  });
});

describe('what the model reads', () => {
  it('two tools cost a fraction of one tool per command', () => {
    const twoTools = JSON.stringify(COMMAND_TOOLS).length;
    const oneEach = JSON.stringify(allCommands().map((c) => ({ type: 'function', function: { name: c.id, description: c.description ?? c.title, parameters: argsSchema(c) } }))).length;
    const index = findCommandsTool(sid, {}).text.length;
    const largest = Math.max(...['designer', 'nodes', 'studio', 'library', 'skills', 'models', 'sessions'].map((area) => findCommandsTool(sid, { area }).text.length));
    if (process.env.COMMANDS_BENCH) console.log(`two tools ${twoTools} chars; one per command ${oneEach}; index ${index}; largest area listing ${largest}`);
    expect(twoTools).toBeLessThan(2000);
    expect(twoTools * 4).toBeLessThan(oneEach);
    expect(index).toBeLessThan(1200);
  });
});

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
import { sendAgentMessage } from '../src/engine/agent/runtime';
import { AGENT_HIDDEN, findCommandsTool, runCommandsTool } from '../src/engine/agent/commandCalls';
import { COMMAND_TOOLS } from '../src/engine/agent/commandTools';
import { allCommands, argsSchema, command } from '../src/engine/commands';
import { graphHistory } from '../src/engine/flow/history';
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
    expect(lines.find((l) => l.startsWith('nodes '))).toMatch(/^nodes \(32\) — /);
    expect(lines.find((l) => l.startsWith('models '))).toMatch(/^models \(3\) — /);
    expect(lines.find((l) => l.startsWith('sessions '))).toMatch(/^sessions \(4\) — /);
    expect(findCommandsTool(sid, { area: 'nope' })).toEqual(findCommandsTool(sid, {}));
  });

  it('lists an area with signatures, marks spend and delete, and never lists the hidden ones', () => {
    const nodes = findCommandsTool(sid, { area: 'nodes' }).text.split('\n');
    expect(nodes).toHaveLength(1 + 32);
    expect(nodes.find((l) => l.startsWith('nodes.run.start '))).toContain("[needs the user's approval: not available from here yet]");
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

  it('refuses spend and delete with a readable text: nothing changes and no provider is called', async () => {
    useStore.setState({ generations: { g: { id: 'g', sessionId: sid } as never } });
    const before = useStore.getState();
    const spend = [{ cmd: 'studio.generate.start', args: { kind: 'image' } }, { cmd: 'nodes.run.start', args: { targets: ['nope'] } }];
    for (const step of spend) {
      expect((await runCommandsTool(sid, { seq: [step] })).text, step.cmd).toBe("Step 1 needs the user's approval: not available from here yet (it spends or deletes). Nothing ran.");
    }
    const deleted = await runCommandsTool(sid, { seq: [...chain.slice(0, 1), { cmd: 'studio.generation.delete', args: { generationId: 'g' } }] });
    expect(deleted).toEqual({ text: "Step 2 needs the user's approval: not available from here yet (it spends or deletes). Nothing ran.", done: false });
    expect(useStore.getState()).toEqual(before);
    expect(graph().nodes).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
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

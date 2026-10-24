import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener() {} }, document: { addEventListener() {}, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined }));
import { useStore } from '../src/store/store';
import { sendAgentMessage } from '../src/engine/agent/runtime';
import { agentCanvas, moveToCanvas, studioLine } from '../src/engine/agent/agentCanvas';
import { buildContext } from '../src/engine/agent/context';
import { CAPABILITIES, TOOLS } from '../src/engine/agent/tools';
import { openBoardSchema } from '../src/engine/agent/agentCanvas';
import { getStudioBoard, setStudioBoard, studioCanvases } from '../src/lib/studioBoard';
import type { Graph } from '../src/engine/types';

let sid: string;
const data = (title: string) => ({ kind: 'image' as const, title, prompt: 'old', modelRef: 'local::studio-image', settings: { count: 1, advanced: {} }, outputIndex: 0 });
const session = () => useStore.getState().sessions[sid];
const toolResults = () => session().agent.history.filter((m) => m.role === 'tool').map((m) => String(m.content));

function script(calls: Array<{ name: string; args: object }>) {
  const replies = [...calls];
  vi.stubGlobal('fetch', async (_u: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (!body.messages) return new Response(JSON.stringify({ data: [] }));
    const t = replies.shift();
    const delta = t ? { tool_calls: [{ index: 0, id: `call-${replies.length}`, function: { name: t.name, arguments: JSON.stringify(t.args) } }] } : { content: 'ok' };
    return new Response(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  });
}
const goLive = (workspace: 'chat' | 'node') => {
  const st = useStore.getState();
  useStore.setState({ ui: { ...st.ui, workspace }, settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'test' }, agent: { ...st.settings.agent, provider: 'nanogpt', model: 'test' } }, composer: { ...st.composer, agentStyle: 'auto', attachments: [] } });
};

beforeEach(() => {
  const st = useStore.getState();
  sid = st.activeSessionId;
  const graph: Graph = { nodes: [{ id: 'key2', position: { x: 0, y: 0 }, data: data('Keyframe 2') }], edges: [] };
  useStore.setState({ sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], graph, feed: [], agent: { ...st.sessions[sid].agent, pending: undefined, busy: false, history: [] } } } });
  setStudioBoard({ open: true, view: 'assets' });
});
afterEach(() => vi.unstubAllGlobals());

describe('effective agent canvas', () => {
  it('is the workspace, except in Studio with the board showing Nodes', () => {
    goLive('chat');
    expect(agentCanvas()).toBe('chat');
    setStudioBoard({ view: 'nodes' });
    expect(agentCanvas()).toBe('node');
    setStudioBoard({ open: false });
    expect(agentCanvas()).toBe('chat');
    goLive('node');
    setStudioBoard({ open: true, view: 'assets' });
    expect(agentCanvas()).toBe('node');
    expect(studioLine()).toEqual([]);
  });
  it('the context says where the user is in Studio', () => {
    goLive('chat');
    expect(studioLine()).toEqual(['You are in Studio (chat). The board shows: Generations (the chat canvas).']);
    setStudioBoard({ view: 'nodes' });
    const ctx = buildContext(session(), { workspace: agentCanvas(), style: 'auto', round: 0, maxRounds: 2, attachments: [] });
    expect(ctx).toContain('You are in Studio (chat). The board shows: Nodes');
    expect(ctx).toContain('workspace: node');
    setStudioBoard({ open: false });
    expect(studioLine()[0]).toContain('closed');
  });
  it('Studio shows the whole conversation whatever the board shows; opening the board never changes the workspace', () => {
    setStudioBoard({ view: 'nodes' });
    expect(studioCanvases(getStudioBoard())).toEqual(['chat', 'node', 'designer']);
    setStudioBoard({ view: 'assets' });
    expect(studioCanvases(getStudioBoard())).toEqual(['chat', 'node', 'designer']);
  });
});

describe('continue_in_chat with a Studio board left on Nodes', () => {
  it('the board goes back to Generations so the agent canvas is the chat in the same turn', async () => {
    goLive('node');
    setStudioBoard({ open: true, view: 'nodes' });
    script([{ name: 'continue_in_chat', args: {} }]);
    await sendAgentMessage('back to chat');
    expect(useStore.getState().ui.workspace).toBe('chat');
    expect(getStudioBoard()).toMatchObject({ open: true, view: 'assets' });
    expect(agentCanvas()).toBe('chat');
  });
});

describe('continue_in_canvas / continue_in_designer from Studio', () => {
  it('nodes: the workspace stays chat, the board opens on Nodes and the agent canvas is node', async () => {
    goLive('chat');
    setStudioBoard({ open: false, view: 'assets' });
    script([{ name: 'continue_in_canvas', args: {} }]);
    await sendAgentMessage('continue on nodes');
    expect(useStore.getState().ui.workspace).toBe('chat');
    expect(getStudioBoard()).toMatchObject({ open: true, view: 'nodes' });
    expect(agentCanvas()).toBe('node');
  });
  it('designer: same, on the Designer tab', async () => {
    goLive('chat');
    setStudioBoard({ open: false, view: 'assets' });
    moveToCanvas('designer');
    expect(useStore.getState().ui.workspace).toBe('chat');
    expect(getStudioBoard()).toMatchObject({ open: true, view: 'designer' });
    expect(agentCanvas()).toBe('designer');
  });
  it('from the node workspace nothing changes', async () => {
    goLive('node');
    setStudioBoard({ open: false, view: 'assets' });
    script([{ name: 'continue_in_canvas', args: {} }]);
    await sendAgentMessage('continue on nodes');
    expect(useStore.getState().ui.workspace).toBe('node');
    expect(getStudioBoard()).toMatchObject({ open: false, view: 'assets' });
    expect(agentCanvas()).toBe('node');
  });
});

describe('open_board', () => {
  it('is a real tool, in the capability map', () => {
    expect(TOOLS.some((t) => t.function.name === 'open_board')).toBe(true);
    expect(CAPABILITIES).toContain('- open_board:');
    expect(openBoardSchema.safeParse({ view: 'nodes' }).success).toBe(true);
    expect(openBoardSchema.safeParse({ view: 'x' }).success).toBe(false);
  });
  it('without it, graph tools are refused in Studio; after open_board("nodes") the same turn edits the node', async () => {
    goLive('chat');
    script([{ name: 'edit_node', args: { node_id: 'key2', prompt: 'a' } }]);
    await sendAgentMessage('edit');
    expect(toolResults().join('\n')).toContain('Graph actions work only on the node canvas');
    expect(session().graph.nodes[0].data).toMatchObject({ prompt: 'old' });

    useStore.setState((s) => ({ sessions: { ...s.sessions, [sid]: { ...s.sessions[sid], feed: [], agent: { ...s.sessions[sid].agent, history: [] } } } }));
    script([{ name: 'open_board', args: { view: 'nodes' } }, { name: 'edit_node', args: { node_id: 'key2', prompt: 'walk toward the camera' } }]);
    await sendAgentMessage('edit the keyframe');
    expect(getStudioBoard()).toMatchObject({ open: true, view: 'nodes' });
    expect(useStore.getState().ui.workspace).toBe('chat');
    expect(session().graph.nodes[0].data).toMatchObject({ prompt: 'walk toward the camera' });
    const results = toolResults().join('\n');
    expect(results).toContain('node canvas is your canvas now');
    expect(results).toContain('Updated');
  });
  it('open_board("closed") returns to the chat canvas', async () => {
    goLive('chat');
    setStudioBoard({ view: 'nodes' });
    script([{ name: 'open_board', args: { view: 'closed' } }]);
    await sendAgentMessage('close it');
    expect(getStudioBoard().open).toBe(false);
    expect(toolResults().join('\n')).toContain('chat canvas');
  });
  it('is refused outside Studio, leaving the board as it was', async () => {
    goLive('node');
    script([{ name: 'open_board', args: { view: 'nodes' } }]);
    await sendAgentMessage('x');
    expect(toolResults().join('\n')).toContain('works only in Studio');
    expect(getStudioBoard().view).toBe('assets');
  });
  it('open_board("designer") makes the designer canvas the agent\'s, in the same turn', async () => {
    goLive('chat');
    expect(openBoardSchema.safeParse({ view: 'designer' }).success).toBe(true);
    script([{ name: 'view_canvas', args: {} }]);
    await sendAgentMessage('look');
    expect(toolResults().join('\n')).toContain('view_canvas works only in the Designer');

    useStore.setState((s) => ({ sessions: { ...s.sessions, [sid]: { ...s.sessions[sid], feed: [], agent: { ...s.sessions[sid].agent, history: [] } } } }));
    script([{ name: 'open_board', args: { view: 'designer' } }, { name: 'view_canvas', args: {} }, { name: 'designer_fx', args: {} }]);
    await sendAgentMessage('look at the design');
    expect(getStudioBoard()).toMatchObject({ open: true, view: 'designer' });
    expect(useStore.getState().ui.workspace).toBe('chat');
    expect(agentCanvas()).toBe('designer');
    const results = toolResults().join('\n');
    expect(results).toContain('designer canvas is your canvas now');
    expect(results).not.toContain('view_canvas works only in the Designer');
    expect(results).not.toContain('designer_fx works only in the Designer');
    expect(buildContext(session(), { workspace: 'designer', style: 'auto', round: 1, maxRounds: 5, attachments: [] })).toContain('The board shows: the Designer');
    expect(studioCanvases(getStudioBoard())).toEqual(['chat', 'node', 'designer']);
  });
});

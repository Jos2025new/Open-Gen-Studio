import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));
import { SYSTEM_PROMPT } from '../src/engine/agent/context';
import { TOOLS } from '../src/engine/agent/tools';
import { readGuide } from '../src/engine/skills';
import { normalizePlan } from '../src/engine/plan';
import { local, LOCAL_IMAGE_REF } from '../src/engine/providers/demo';

const composed = () => [SYSTEM_PROMPT, readGuide('workflow:character-sheet'), readGuide('skill:staged')].join('\n');

describe('operator contract across the affected journey', () => {
  it('uses one settings policy instead of an unconditional instruction and an exception', () => {
    expect(SYSTEM_PROMPT).not.toContain('confirm_settings (always, before any prompt)');
    expect(SYSTEM_PROMPT).not.toContain('operations on an existing result do not');
    expect(SYSTEM_PROMPT).toContain('only image/video steps require confirm_settings');
    expect(JSON.stringify(TOOLS.find(t => t.function.name === 'confirm_settings'))).toContain('only image/video steps require confirm_settings');
  });
  it('communicates execution from OPS and the consequences of omitting a model', () => {
    expect(SYSTEM_PROMPT).toMatch(/angle .*provider generation/);
    expect(SYSTEM_PROMPT).toMatch(/extract_frame .*local execution/);
    expect(SYSTEM_PROMPT).toContain('Omitting model does not mean the composer model');
    expect(SYSTEM_PROMPT).toContain('Global style applies to image/video steps, not op');
  });
  it('the combined workflow preserves requested outputs and the original reference without ritual preparation', () => {
    const text = composed();
    expect(text).toContain('Templates are examples');
    expect(text).toContain('independent views');
    expect(text).not.toContain('One character from four angles.');
    expect(text).not.toContain('Repeat identity anchors (face, hair, outfit, palette) in each prompt.');
    expect(text).not.toContain('let the user pick the look in the questions card (also in auto)');
    expect(text).not.toContain('A final video of 10 s or more, or several clips, gets the short test stage');
    expect(text).not.toContain('Each clip continues from the previous one');
    expect(text).toContain('Preserve unrequested properties');
  });
  it('three independent operations normalize to three outputs on the same original and explicit model', async () => {
    const models = await local.listModels(undefined);
    const source = { kind: 'image' as const, width: 1170, height: 2048 };
    const result = await normalizePlan({ title: 'Three views', steps: ['profile-right', 'back', 'three-quarter-right'].map((angle, i) => ({ id: `s${i+1}`, kind: 'op', op: 'angle', input: 'asset:original', model: LOCAL_IMAGE_REF, params: { angle } })) }, { workspace: 'chat', getModel: async ref => { const model = models.find(m => m.ref === ref); return model ? { model, schema: await local.loadSchema(model, undefined) } : null; }, defaultModel: () => LOCAL_IMAGE_REF, defaultSettings: () => ({}), asset: () => source, layer: () => undefined }, 'views');
    expect(result.errors).toEqual([]);
    expect(result.plan!.steps).toHaveLength(3);
    expect(result.plan!.steps).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'op', input: 'asset:original', params: expect.objectContaining({ _modelRef: LOCAL_IMAGE_REF }) })]));
    expect(result.plan!.steps.every(s => s.kind === 'op' && s.input === 'asset:original' && s.params._modelRef === LOCAL_IMAGE_REF)).toBe(true);
    expect(result.plan!.subjects).toBeUndefined();
  });
});

it('operation approval exposes the resolved model before Run, and labels plan-wide adjustments accurately', async () => {
  const { renderToString } = await import('react-dom/server');
  const { createElement } = await import('react');
  const { PlanCard } = await import('../src/components/chat/PlanCard');
  const { useStore } = await import('../src/store/store');
  const sid = useStore.getState().activeSessionId;
  const html = renderToString(createElement(PlanCard, { sessionId: sid, item: { id: 'card', type: 'plan', workspace: 'chat', createdAt: 1, style: 'guided', status: 'awaiting', stepStates: {}, stepGenerations: {}, estimate: { usd: 0, approximate: false }, plan: { id: 'p', workspace: 'chat', title: 'Views', summary: '', adjustments: ['@Temp uses the temporary image'], steps: [{ id: 's1', kind: 'op', title: 'Profile', op: 'angle', input: 'asset:original', params: { angle: 'profile-right', _modelRef: LOCAL_IMAGE_REF } }] } } })).replace(/<!-- -->/g, '');
  expect(html).toContain('Local Sketch');
  expect(html).toContain('adjustment to the plan');
});

it('the runtime policy requires newly introduced generation kinds but not operations or Nodes', async () => {
  const { missingSettingsKind, SETTINGS_POLICY } = await import('../src/engine/procedure');
  expect(missingSettingsKind('chat', ['op'], undefined)).toBeNull();
  expect(missingSettingsKind('node', ['image', 'video'], undefined)).toBeNull();
  expect(missingSettingsKind('chat', ['image'], undefined)).toBe('image');
  expect(missingSettingsKind('designer', ['image', 'video'], { image: { modelRef: LOCAL_IMAGE_REF, needsImage: false } })).toBe('video');
  expect(SYSTEM_PROMPT).toContain(SETTINGS_POLICY);
});

it('an existing conversation does not send obsolete workflow instructions after an app update', async () => {
  const { useStore } = await import('../src/store/store');
  const { sendAgentMessage } = await import('../src/engine/agent/runtime');
  const st = useStore.getState(), sid = st.activeSessionId;
  useStore.setState({ settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'fixture' }, agent: { ...st.settings.agent, provider: 'nanogpt', model: 'fixture' } }, sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], feed: [], agent: { busy: false, questionRound: 0, notes: [], history: [{ role: 'assistant', content: '', tool_calls: [{ id: 'old-guide', type: 'function', function: { name: 'read_guide', arguments: '{"id":"workflow:character-sheet"}' } }] }, { role: 'tool', tool_call_id: 'old-guide', content: 'workflow (follow this structure, adapt prompts to the request):\nOne character from four angles.\nRepeat identity anchors (face, hair, outfit, palette) in each prompt.' }] } } } });
  let sent = '';
  vi.stubGlobal('fetch', async (_u: string, init?: RequestInit) => { const body = init?.body ? JSON.parse(String(init.body)) : {}; if (!body.messages) return new Response('{"data":[]}'); sent = JSON.stringify(body.messages); return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } }); });
  try { await sendAgentMessage('Use the same reference for the requested views'); } finally { vi.unstubAllGlobals(); }
  expect(sent).not.toContain('One character from four angles.');
  expect(sent).not.toContain('Repeat identity anchors (face, hair, outfit, palette) in each prompt.');
  expect(sent).toContain('old-guide');
  expect(sent).toContain('independent views');
});

it('keeps prior choices but removes obsolete instructions embedded in historical app context', async () => {
  const { refreshLoadedGuides } = await import('../src/engine/skills');
  const content = 'User requested three views\n\n<app_context>\nworkspace: chat\nskill: Characters — Repeat identity anchors\nworkflow (follow this structure, adapt prompts to the request):\nCharacter sheet: One character from four angles.\n  - s1: image "Front"\nimage model (picked by the user): KeepModel\nattached by the user: asset:original\n\n---\n# Staged pieces\nlet the user pick the look (also in auto)\n</app_context>';
  const result = refreshLoadedGuides([{ role: 'user', content }]);
  expect(result[0].content).toContain('User requested three views');
  expect(result[0].content).toContain('KeepModel');
  expect(result[0].content).toContain('asset:original');
  expect(result[0].content).toContain('Character sheet');
  expect(result[0].content).not.toContain('four angles');
  expect(result[0].content).not.toContain('Repeat identity anchors');
  expect(result[0].content).not.toContain('also in auto');
});

it('leaves compacted/error guide results and literal user text intact', async () => {
  const { refreshLoadedGuides } = await import('../src/engine/skills');
  const history = [
    { role: 'assistant' as const, content: '', tool_calls: [{ id: 'g', type: 'function' as const, function: { name: 'read_guide', arguments: '{"id":"workflow:character-sheet"}' } }] },
    { role: 'tool' as const, tool_call_id: 'g', content: 'Guide compacted; read it again if needed.' },
    { role: 'user' as const, content: '<user_message>Keep this literal <app_context>skill: Characters — original text</app_context></user_message>\n\n<app_context>\nworkspace: chat\n</app_context>' },
  ];
  const result = refreshLoadedGuides(history);
  expect(result[1]).toBe(history[1]);
  expect(result[2].content).toBe(history[2].content);
});

it('refreshes an obsolete attached staged guide even when the workflow itself is current', async () => {
  const { refreshLoadedGuides, STAGED_GUIDE } = await import('../src/engine/skills');
  const history = [{ role: 'assistant' as const, content: '', tool_calls: [{ id: 'w', type: 'function' as const, function: { name: 'read_guide', arguments: '{"id":"workflow:character-sheet"}' } }] }, { role: 'tool' as const, tool_call_id: 'w', content: readGuide('workflow:character-sheet') + '\n\n---\n# Staged pieces\nObsolete pilot policy' }];
  const result = refreshLoadedGuides(history);
  expect(result[1].content).toContain(STAGED_GUIDE);
  expect(result[1].content).not.toContain('Obsolete pilot policy');
});

it('workflow brief fields obey Auto and preserve user format instead of imposing template defaults', () => {
  const product = readGuide('workflow:product-pack')!;
  const storyboard = readGuide('workflow:storyboard')!;
  expect(product).not.toContain('write the product sheet once and repeat it in every prompt');
  expect(product).toContain('ask only missing user data in Auto');
  expect(storyboard).toContain('template defaults (unless the user specified otherwise)');
  expect(storyboard).not.toContain('fixed (do not ask)');
});

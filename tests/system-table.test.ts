import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined }));
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NodeLibrary } from '../src/components/node/AddNodeItems';
import { BASE_SYSTEM_NODE_TYPES } from '../src/engine/graphTypes';
import { systemRefDefault } from '../src/engine/nodes/systemDefaults';
import { addSystemNode } from '../src/engine/nodes/system';
import { createSession, useStore } from '../src/store/store';

/** Fixes what a system node starts with and what the omnicanvas menu lists, so the one table behind both can be refactored safely. */
let sid = '';
beforeEach(() => { const s = createSession('System table'); sid = s.id; useStore.setState((st) => ({ activeSessionId: sid, sessions: { ...st.sessions, [sid]: s } })); });

const REF_DEFAULT = (model: string): Record<string, string> => ({ chat: sid, agent: sid, session: sid, model, provider: 'openrouter', space: 'create', 'designer.doc': 'active', library: 'library', toolset: 'toolset', prompt: 'composer', mediaSettings: 'image' });
// addSystemNode without a ref: prompt and mediaSettings fall back to their own type name (inherited difference with systemRefDefault).
const ADD_REF = (model: string): Record<string, string> => ({ ...REF_DEFAULT(model), prompt: 'prompt', mediaSettings: 'mediaSettings' });

describe('system node table', () => {
  it('systemRefDefault gives each type its initial ref', () => {
    const want = REF_DEFAULT('img-model');
    for (const t of BASE_SYSTEM_NODE_TYPES) expect(systemRefDefault(t, sid, 'img-model', undefined), t).toBe(want[t] === 'active' ? 'active' : want[t] === sid ? sid : want[t]);
  });
  it('systemRefDefault: designer.doc follows the active doc', () => {
    const s = useStore.getState().sessions[sid];
    expect(systemRefDefault('designer.doc', sid, 'm', { ...s, activeDocId: 'd9' })).toBe('d9');
  });
  it('addSystemNode starts each type with its ref', () => {
    const model = useStore.getState().composer.image.modelRef;
    const want = ADD_REF(model);
    for (const t of BASE_SYSTEM_NODE_TYPES) {
      const id = addSystemNode(sid, { type: t });
      const n = useStore.getState().sessions[sid].graph.nodes.find((x) => x.id === id)!;
      const d = n.data as { ref: string; type: string };
      expect(d.type).toBe(t);
      expect(d.ref, t).toBe(t === 'designer.doc' ? (useStore.getState().sessions[sid].activeDocId ?? useStore.getState().sessions[sid].docs[0]?.id ?? 'active') : want[t]);
    }
  });
  it('the omnicanvas menu lists the system parts in this order, with this text', () => {
    const html = renderToStaticMarkup(createElement(NodeLibrary, { onPick: () => undefined, omni: { has: () => false, onSpace: () => undefined, onSystem: () => undefined } }));
    const sys = html.slice(html.indexOf('aria-label="System"'), html.indexOf('aria-label="Tools"'));
    const text = sys.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');
    expect(text).toContain('Chat|The chat of this session|Agent|The agent that answers in the chat|Model|A model to attach to the agent or chat|Provider|A provider and its catalog|Designer Doc|A Designer document|Library|Characters, objects and styles|Tools|The operations catalog|Session|This session');
  });
});

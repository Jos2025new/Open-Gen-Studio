import { nextAgentTitle } from '../../nodes/agentNames';
import { systemRefDefault } from '../../nodes/systemDefaults';
import { SYSTEM_NODE_TYPES } from '../../nodes/system';
import { defineNode } from '../descriptor';
import { delivered } from '../deliver';

/** System nodes (chat, agent, model, session…): their ports live in nodes/spec.ts; chat and agent can `send`. */
export default defineNode({
  kind: 'ref',
  version: 1,
  params: ['title', 'llm', 'recipient', 'promptText', 'attachMode', 'dockedTo', 'mergedModels', 'mediaKind', 'undocked', 'view'],
  inputs: () => [],
  output: (data) => {
    if (data.kind !== 'ref') return null;
    if (data.type === 'chat' || data.type === 'agent' || data.type === 'prompt') return 'text';
    if (data.type === 'designer.doc' || data.type === 'space' || data.type === 'library') return 'image';
    return null;
  },
  required: [],
  affects: {},
  // The live text of a chat/agent/prompt node: what the resolver delivers (the former `evaluate` said null; nothing read it).
  evaluate: (n, _e, env) => delivered(env.chatText(n)),
  defaults: (opts, st) => {
    const type = opts.type ?? 'chat';
    const session = st.sessions[st.activeSessionId];
    return { kind: 'ref', type, ref: opts.ref ?? systemRefDefault(type, st.activeSessionId, st.composer.image.modelRef, session), title: type === 'agent' ? nextAgentTitle(session?.graph) : SYSTEM_NODE_TYPES[type].title };
  },
  actions: ['send'],
});

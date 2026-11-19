import { inputPorts, outputPort } from '../../flow/graph';
import { defineNode } from '../descriptor';
import { evaluateNode } from '../evaluate';

/** System nodes (chat, agent, model, session…): their ports live in nodes/spec.ts; chat and agent can `send`. */
export default defineNode({
  kind: 'ref',
  version: 1,
  params: ['title', 'llm', 'promptText', 'attachMode', 'dockedTo', 'mergedModels', 'mediaKind', 'undocked', 'view'],
  inputs: inputPorts,
  output: outputPort,
  required: [],
  affects: {},
  evaluate: evaluateNode,
  actions: ['send'],
});

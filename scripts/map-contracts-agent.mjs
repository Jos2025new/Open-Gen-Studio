/** Contracts of the agent's guides, checked by map.mjs. */
export default [
  {
    id: 'workflow-ask-first',
    what: 'Un workflow pregunta antes de cargarse: read_guide devuelve su ficha hasta la primera ronda (o ready: true); el prompt lo dice.',
    sides: [
      ['src/engine/agent/tools.ts', "ready: { type: 'boolean' }"],
      ['src/engine/agent/runtime.ts', 'cardInsteadOfGuide('],
      ['src/engine/skills/workflowCard.ts', 'export function cardInsteadOfGuide'],
      ['src/engine/agent/context.ts', 'read_guide of a workflow returns its card'],
    ],
    tests: ['tests/workflow-ask-first.test.ts'],
  },
];

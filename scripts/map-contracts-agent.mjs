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
  {
    id: 'model-switch',
    what: 'DELICADO: un modelo que el usuario nombra en la petición actual se cambia solo con la tarjeta de una pregunta (plan rechazado, tarjeta compacta, parte añadida).',
    sides: [
      ['src/engine/plan.ts', 'call confirm_settings for ${kind} with model'],
      ['src/engine/agent/runtime.ts', 'switchSection('],
      ['src/engine/agent/switchModel.ts', 'export function confirmedState'],
      ['src/components/chat/SettingsCard.tsx', 'function SwitchModelCard'],
    ],
    tests: ['tests/confirmed-named-model.test.ts', 'tests/switch-model-card.test.ts', 'tests/switch-model-card-ui.test.ts'],
  },
];

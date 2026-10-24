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
    id: 'auto-plan-card',
    what: 'Auto, una tarjeta: confirm_settings se confirma sin tarjeta (ítem inline que el feed no dibuja) y la tarjeta de plan lleva los selectores de la tarjeta de ajustes; un cambio va a los pasos y reescribe sus prompts (docs/features/agente-auto-tarjeta.md).',
    sides: [
      ['src/engine/agent/runtime.ts', 'autoConfirmSettings('],
      ['src/engine/agent/autoSettings.ts', 'inline: true'],
      ['src/components/chat/FeedList.tsx', 'item.inline ? null'],
      ['src/engine/agent/planSettings.ts', 'export function planSections'],
      ['src/components/chat/PlanCard.tsx', 'planSections(feed'],
      ['src/components/chat/PlanSettings.tsx', '<SettingsSectionBlock'],
      ['src/components/chat/SettingsCard.tsx', 'export function SettingsSectionBlock'],
      ['src/engine/agent/runtime.ts', 'durationProblem('],
      ['src/engine/agent/modelIndex.ts', 'limitsLine(m.ref)'],
    ],
    tests: ['tests/auto-plan-card.test.ts', 'tests/model-limits.test.ts'],
  },
  {
    id: 'model-switch',
    what: 'DELICADO: un modelo que el usuario nombra en la petición actual, o solo otro proveedor del mismo modelo (ADR 0025 D), se cambia solo con la tarjeta de una pregunta (plan rechazado, tarjeta compacta, parte añadida) en Guided; en Auto se aplica sin tarjeta (autoConfirmSettings).',
    sides: [
      ['src/engine/plan.ts', 'call confirm_settings for ${kind} with model'],
      ['src/engine/agent/runtime.ts', 'switchSection('],
      ['src/engine/agent/autoSettings.ts', 'switchSection('],
      ['src/engine/agent/switchModel.ts', 'export function confirmedState'],
      ['src/components/chat/SettingsCard.tsx', 'function SwitchModelCard'],
      ['src/components/chat/SettingsCard.tsx', 'function FollowUpCard'],
      ['src/engine/modelNamed.ts', 'export async function followUpProblem'],
      ['src/engine/modelNamed.ts', 'export function resolveNamedModel'],
      ['src/engine/agent/settingsCard.ts', 'resolveNamedModel('],
      ['src/engine/agent/tools.ts', 'provider: z.string()'],
    ],
    tests: ['tests/confirmed-named-model.test.ts', 'tests/switch-model-card.test.ts', 'tests/switch-model-card-ui.test.ts', 'tests/ask-change-model.test.ts'],
  },
];

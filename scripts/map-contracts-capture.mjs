/** Registered by map-contracts.mjs; the capture style catalog, the prompt, the selector and what the agent is told must agree. */
export default [
  {
    id: 'capture-styles',
    what: 'Estilos de captura (CTLT), tono y directivas de video: el catálogo escribe el prompt, el selector y el contexto del agente lo muestran y el plan los lleva al paso.',
    sides: [
      ['src/engine/captureStyles.ts', 'export const CAPTURE_PRESETS'],
      ['src/engine/realism.ts', 'captureClause(ctx.capture'],
      ['src/engine/plan.ts', 'withCaptureSetting('],
      ['src/engine/procedure.ts', 'export const CAPTURE_RULE'],
      ['src/engine/agent/captureContext.ts', 'export function captureLines'],
      ['src/engine/agent/context.ts', 'captureLines(subjects'],
      ['src/engine/types.ts', "import('./captureStyles').CaptureSel"],
      ['src/components/composer/CaptureChip.tsx', 'export function CaptureChip'],
    ],
    tests: ['tests/capture-styles.test.ts', 'tests/realism-clean-baseline.test.ts', 'tests/realism.test.ts'],
  },
  {
    id: 'draft-first',
    what: 'Todo plan con video espera la tarjeta obligatoria de borrador (no se salta, no gasta ronda); un borrador terminado ofrece «Mejorar esta toma» con coste confirmado.',
    sides: [
      ['src/engine/agent/draftFirst.ts', 'export function draftGate'],
      ['src/engine/agent/runtime.ts', 'draftGate(v.data.steps'],
      ['src/engine/agent/runtime.ts', 'draftCanon(v.data.questions)'],
      ['src/engine/agent/context.ts', '${DRAFT_RULE}'],
      ['src/components/chat/QuestionsCard.tsx', 'DRAFT_ID'],
      ['src/engine/improveShot.ts', 'export function improvePlan'],
      ['src/components/chat/ImproveShotButton.tsx', 'export function ImproveShotButton'],
      ['src/components/chat/GenerationCard.tsx', '<ImproveShotButton'],
      ['src/components/chat/StudioGeneration.tsx', '<ImproveShotButton'],
    ],
    tests: ['tests/draft-first.test.ts', 'tests/plan-recovery.test.ts', 'tests/story-flow.test.ts'],
  },
];

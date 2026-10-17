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
];

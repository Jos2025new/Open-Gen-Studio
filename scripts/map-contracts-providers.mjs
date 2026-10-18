/** Provider and plan-card contracts, split from map-contracts.mjs to keep that file under 30 KB (AGENTS.md). Checked by map.mjs. */
export default [
  {
    id: 'partial-generation-retry',
    what: 'Retry conserva assets, pide solo resultados o variantes pendientes con nueva semilla y muestra presupuesto de lo pendiente en recuperación directa y de plan.',
    sides: [
      ['src/engine/retryPartial.ts', 'export function estimateForRetry'],
      ['src/engine/jobs.ts', 'export function retryGeneration'],
      ['src/engine/agent/runtime.ts', 'planRetryEstimate('],
      ['src/components/chat/RecoveryActions.tsx', 'estimateForRetry(g)'],
      ['src/engine/types.ts', 'export interface Generation'],
    ],
    tests: ['tests/retry-partial.test.ts'],
  },
  {
    id: 'failed-step-partial-context',
    what: 'El contexto del fallo conserva N/M salidas, IDs, faltantes y error literal; los bloqueos de contenido aconsejan revisar prompt o referencias antes de otro intento.',
    sides: [
      ['src/engine/agent/failureContext.ts', 'export function failedStepSummary'],
      ['src/engine/agent/runtime.ts', 'failedStepSummary('],
    ],
    tests: ['tests/failure-context.test.ts', 'tests/schema-guard.test.ts'],
  },
  {
    id: 'openrouter-reasoning-details',
    what: 'OpenRouter reasoning_details se guardan tal cual en el mensaje assistant y se reenvían; ningún otro proveedor los recibe. Cambiar el lado de llm.ts exige revisar runtime.ts y el tipo LlmMessage.',
    sides: [
      ['src/engine/providers/llm.ts', 'function withoutDetails'],
      ['src/engine/agent/runtime.ts', 'reasoning_details: result.reasoningDetails'],
      ['src/engine/types.ts', 'reasoning_details?: unknown[]'],
    ],
    tests: ['tests/reasoning-details.test.ts'],
  },
  {
    id: 'variant-prompt',
    what: 'El prompt que muestra la tarjeta del plan (estilo de captura o realismo, y variación) es el que se envía: sentPrompt.ts lo construye para el envío y para la tarjeta.',
    sides: [
      ['src/engine/variantPrompt.ts', 'export function variantPrompt'],
      ['src/engine/sentPrompt.ts', 'export function stepSentPrompt'],
      ['src/engine/jobs.ts', 'withVariation(shown, variants?.[done])'],
      ['src/components/chat/PlanCard.tsx', 'stepSentPrompt('],
    ],
    tests: ['tests/chat-cards-c7b.test.ts', 'tests/sent-prompt.test.ts'],
  },
];

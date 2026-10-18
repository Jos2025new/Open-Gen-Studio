/** Provider and plan-card contracts, split from map-contracts.mjs to keep that file under 30 KB (AGENTS.md). Checked by map.mjs. */
export default [
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
    what: 'El prompt de cada variación que muestra la tarjeta del plan es el que se envía: una sola función los combina.',
    sides: [
      ['src/engine/variantPrompt.ts', 'export function variantPrompt'],
      ['src/engine/jobs.ts', 'variantPrompt(shown, variants[done])'],
      ['src/components/chat/PlanCard.tsx', 'variantPrompt('],
    ],
    tests: ['tests/chat-cards-c7b.test.ts'],
  },
];

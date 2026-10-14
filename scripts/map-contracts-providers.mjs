/** Provider contracts, split from map-contracts.mjs to keep that file under 30 KB (AGENTS.md). Checked by map.mjs. */
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
];

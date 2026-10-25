/** Registered by map-contracts.mjs; source and prompting sides must stay aligned. */
export default [
  {
    id: 'video-frame-rules',
    what: 'Las restricciones de fotogramas se declaran por adaptador y se validan con referencias, vídeo fuente y resolución efectivos; los modelos sin reglas conservan su ruta anterior.',
    sides: [
      ['src/engine/types.ts', 'frameRules?:'],
      ['src/engine/params.ts', 'export function videoInputProblem'],
      ['src/engine/params.ts', 'export function routeVideoInputs'],
      ['src/engine/jobs.ts', "kind === 'video' && schema.slots.frameRules"],
      ['src/engine/actions.ts', 'sourceVideo: false'],
      ['src/engine/plan.ts', 'sourceVideo: false'],
      ['src/engine/planFix.ts', 'export function videoFix'],
      ['src/engine/flow/actions.ts', 'sourceVideo: false'],
      ['src/engine/agent/providerFit.ts', 'sourceVideo: false'],
      ['src/engine/providers/nanogpt.ts', 'const frameRules ='],
      ['src/engine/providers/openrouter.ts', 'export const openrouter'],
    ],
    tests: ['tests/video-frame-rules.test.ts', 'tests/video-frame-executor.test.ts', 'tests/video-frame-callers.test.ts', 'tests/video-frame-fixes.test.ts', 'tests/nanogpt-frames.test.ts', 'tests/openrouter-refs.test.ts'],
  },
  {
    id: 'recurring-visual-continuity',
    what: 'Las propuestas nuevas del agente declaran todos los consumidores de sujetos recurrentes; los planes antiguos conservan compatibilidad y el estilo llega a cada shot.',
    sides: [
      ['src/engine/continuity.ts', 'export function recurringSubjectErrors'],
      ['src/engine/plan.ts', 'ctx.strictContinuity'],
      ['src/engine/plan.ts', 'st.settings.shots'],
      ['src/engine/agent/runtime.ts', 'strictContinuity:'],
      ['src/engine/jobs.ts', 'schema.slots.shots?.exclusivePrompt'],
      ['src/engine/subjectPrompts.ts', 'export function mapSubjectPrompts'],
    ],
    tests: ['tests/plan-visual-continuity.test.ts', 'tests/agent-direct-model.test.ts', 'tests/subjects-shots.test.ts'],
  },
  {
    id: 'shared-video-direction',
    what: 'Todos los modos reciben dirección de video común; la guía amplía cámara, física, multirreferencia y transiciones respetando el estilo y las entradas disponibles.',
    sides: [
      ['src/engine/procedure.ts', 'export const VIDEO_DIRECTION_POLICY'],
      ['src/engine/agent/context.ts', '${VIDEO_DIRECTION_POLICY}'],
      ['src/engine/guides/directing.md', 'Transitions: a beat is an action interval'],
      ['src/engine/skills/catalog.ts', 'Follow the requested aspect, medium and style'],
    ],
    tests: ['tests/video-direction-policy.test.ts'],
  },
];

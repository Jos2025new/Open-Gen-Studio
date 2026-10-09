/**
 * Links the compiler does not see: two places that must say the same thing (a prompt line and the runtime rule it
 * describes, a card and the parameter it shows). Each side names a file and a literal anchor that must exist in it.
 * scripts/map.mjs fails when a file or an anchor is gone, so whoever changes one side is sent to the other.
 * Add a contract when a change shows two places that must agree; keep "what" in one plain sentence.
 */
export default [
  {
    id: 'guided-asks',
    what: 'Guided pregunta antes de cada plan: el prompt lo dice y el runtime rechaza un plan sin preguntas.',
    sides: [
      ['src/engine/agent/context.ts', 'Guided, one questions card before every plan'],
      ['src/engine/agent/runtime.ts', 'Guided mode: ask your questions first'],
      ['src/engine/agent/context.ts', "mode: guided (ask before each plan"],
    ],
    tests: ['tests/agent-mode.test.ts'],
  },
  {
    id: 'direct-guides',
    what: 'Direct no tiene tarjeta de ajustes: las guías de los modelos del compositor llegan con la petición.',
    sides: [
      ['src/engine/agent/context.ts', "in Direct, the composer's model guides come with the request"],
      ['src/engine/agent/requestGuides.ts', 'In Direct there is no card'],
      ['src/engine/agent/requestGuides.ts', 'export function earlyModelGuide'],
    ],
    tests: ['tests/agent-direct-model.test.ts'],
  },
  {
    id: 'settings-policy',
    what: 'Qué pasos necesitan la tarjeta de ajustes: el texto para el agente y la puerta del runtime.',
    sides: [
      ['src/engine/procedure.ts', 'export const SETTINGS_POLICY'],
      ['src/engine/procedure.ts', 'export function planRequiresSettings'],
      ['src/engine/agent/runtime.ts', 'planRequiresSettings(workspace, kinds'],
    ],
    tests: ['tests/general-model-gate.test.ts', 'tests/agent-force.test.ts'],
  },
  {
    id: 'automation-policy',
    what: 'Cuándo se reutilizan ajustes sin preguntar (umbral de coste): el texto debe describir exactamente needsConfirmation.',
    sides: [
      ['src/engine/procedure.ts', 'export const AUTOMATION_POLICY'],
      ['src/engine/procedure.ts', 'export function needsConfirmation'],
      ['src/engine/procedure.ts', 'export const LOW_COST_USD = 0.5'],
    ],
    tests: ['tests/general-model.test.ts', 'tests/general-model-gate.test.ts'],
  },
  {
    id: 'no-forced-tool-choice',
    what: 'Decisión del usuario (2026-10-08): las palabras clave dirigen al agente con una señal en el mensaje; nunca se envía al proveedor un tool_choice con nombre.',
    sides: [
      ['src/engine/providers/llm.ts', "tool_choice: 'auto'"],
      ['src/engine/agent/force.ts', 'export function steerNote'],
    ],
    tests: ['tests/agent-force.test.ts'],
  },
  {
    id: 'ops-confirm-model',
    what: 'Decisión del usuario (ADR 0009, enmienda a 0007-9): una operación con modelo de imagen confirma su modelo (Auto una vez por sesión, Guided en cada petición; Direct usa el compositor).',
    sides: [
      ['src/engine/procedure.ts', 'An op step that runs on an image model (edit engine) needs the image kind confirmed'],
      ['src/engine/agent/runtime.ts', 'An operation that runs on an image model needs the image kind confirmed'],
    ],
    tests: ['tests/agent-force.test.ts', 'tests/agent-fit-plan.test.ts'],
  },
  {
    id: 'cost-recheck',
    what: 'Un plan caro se muestra tras confirmar su tarjeta en la misma petición; el mensaje de coste nombra cada tipo una vez (la tarjeta admite 4 partes).',
    sides: [
      ['src/engine/agent/runtime.ts', 'const confirmedNow'],
      ['src/engine/agent/runtime.ts', 'costAskMessage([...new Set(settingKinds)]'],
      ['src/engine/agent/tools.ts', 'parts: z.array(settingsPartSchema).min(1).max(4)'],
    ],
    tests: ['tests/general-model-gate.test.ts'],
  },
  {
    id: 'spend-approval',
    what: 'Todo plan con coste mayor que cero o desconocido espera aprobación, también en Auto.',
    sides: [
      ['src/engine/pricing.ts', 'export function needsSpendCheck'],
      ['src/engine/agent/runtime.ts', "style === 'auto' && !needsSpendCheck(total)"],
    ],
    tests: ['tests/engine.test.ts'],
  },
  {
    id: 'upscale-note',
    what: 'El aviso de upscale se calcula del factor que se ejecuta; si no llega a lo pedido, la tarjeta lo muestra sin plegar.',
    sides: [
      ['src/engine/agent/fit.ts', 'export function upscaleNote'],
      ['src/engine/agent/fit.ts', "step.op === 'upscale' ? upscaleNote("],
      ['src/components/chat/PlanCard.tsx', 'const shortOfRequest'],
      ['src/components/chat/PlanCard.tsx', "s.op === 'upscale' && s.params.factor"],
    ],
    tests: ['tests/agent-fit-plan.test.ts'],
  },
  {
    id: 'user-model-notes',
    what: 'Los cambios sobre un modelo elegido por el usuario («your … model») se ven siempre en la tarjeta y como aviso.',
    sides: [
      ['src/engine/plan.ts', 'kept your ${kind} model'],
      ['src/components/chat/PlanCard.tsx', 'const aboutUserModel'],
      ['src/engine/agent/runtime.ts', '/\\byour [\\w-]+ model\\b/'],
    ],
    tests: ['tests/routing.test.ts'],
  },
  {
    id: 'reference-sheet-subject',
    what: 'Una hoja de referencia solo se rechaza si el lugar es su sujeto; la descripción de la operación dice lo mismo.',
    sides: [
      ['src/engine/agent/fit.ts', 'const SHEET_OF_PLACE'],
      ['src/engine/ops.ts', 'never a place'],
    ],
    tests: ['tests/agent-fit-plan.test.ts'],
  },
  {
    id: 'keyword-route',
    what: 'Las palabras clave señalan una operación y su encaje; la señal va antes del mensaje del usuario.',
    sides: [
      ['src/engine/agent/triggers.ts', 'export const OP_TRIGGERS'],
      ['src/engine/agent/force.ts', 'export function steerNote'],
      ['src/engine/agent/fit.ts', 'export function fitOp'],
      ['src/engine/agent/runtime.ts', 'const forced = steerNote(gate, confirmFirst)'],
    ],
    tests: ['tests/agent-force.test.ts', 'tests/agent-fit.test.ts'],
  },
  {
    id: 'ops-in-prompt',
    what: 'Las operaciones que conoce el agente salen del registro OPS, no de una segunda lista.',
    sides: [
      ['src/engine/ops.ts', 'export const OPS'],
      ['src/engine/procedure.ts', 'export const OP_LINES'],
      ['src/engine/agent/context.ts', '${OP_LINES}'],
    ],
    tests: ['tests/agent-procedure.test.ts'],
  },
  {
    id: 'audio-defaults',
    what: 'Voz y efectos (2026-10-08): por defecto Gemini 3.8 Flash TTS para voz y ElevenLabs Sound Effects v2 para efectos, salvo que el usuario nombre o elija otro; el agente lo lee en el contrato del paso de audio.',
    sides: [
      ['src/engine/providers/nanogptAudio.ts', "export const SPEECH_MODELS = ['google/gemini-3.8-flash-tts'"],
      ['src/engine/procedure.ts', 'export const AUDIO_STEP'],
      ['src/engine/agent/context.ts', '${AUDIO_STEP}'],
      ['docs/catalogo-voz-y-efectos.md', 'Gemini 3.8 Flash TTS'],
    ],
    tests: ['tests/nanogpt-speech.test.ts'],
  },
  {
    id: 'shortcuts',
    what: 'Los atajos de teclado: el manejador, Ajustes → Shortcuts y el README leen la misma lista.',
    sides: [
      ['src/engine/shortcuts.ts', 'export function shortcutGroups'],
      ['src/components/designer/DesignerWorkspace.tsx', 'DESIGN_TOOL_KEYS[e.key.toLowerCase()]'],
      ['src/components/shell/SettingsPanel.tsx', 'shortcutGroups()'],
      ['README.md', '<!-- shortcuts:start -->'],
    ],
    tests: ['tests/readme-shortcuts.test.ts'],
  },
  {
    id: 'sandbox',
    what: 'El sandbox usa .sandbox/data y el puerto 5183; las salvaguardas comprueban ese aislamiento.',
    sides: [
      ['scripts/dev-sandbox.mjs', 'export const SANDBOX_PORT = 5183'],
      ['scripts/check-safeguards.mjs', 'node scripts\\/dev-sandbox\\.mjs'],
    ],
    tests: ['tests/safeguards.test.ts'],
  },
  {
    id: 'store-local-only',
    what: 'El almacén /x/store solo responde al propio ordenador (también con --host); docs/seguridad.md lo afirma con su prueba.',
    sides: [
      ['server/local-store.js', "if (!isLoopback(req.socket?.remoteAddress)) return send(403, 'only from this computer')"],
      ['docs/seguridad.md', 'only from this computer'],
      ['README.md', 'el almacén solo responde a tu propio ordenador'],
    ],
    tests: ['tests/store-server.test.ts'],
  },
  {
    id: 'automated-writes',
    what: 'El servidor rechaza escrituras automatizadas (cabecera X-OGS-Automated) fuera del sandbox.',
    sides: [['server/local-store.js', "req.headers['x-ogs-automated'] === '1' && !sandbox"]],
    tests: ['tests/automated-write.test.ts', 'tests/store-server.test.ts'],
  },
  {
    id: 'fx-plan',
    what: 'ADR 0011: el lienzo y la exportación SVG aplican las capas FX con el mismo plan (qué filtra cada capa y en qué orden).',
    sides: [
      ['src/engine/fx/plan.ts', 'export function fxPlan'],
      ['src/engine/design/render.ts', 'const steps = fxPlan(doc.layers, opts.hideLayerId)'],
      ['src/engine/design/export.ts', 'for (const step of fxPlan(doc.layers))'],
    ],
    tests: ['tests/fx-render.test.ts', 'tests/fx-svg.test.ts'],
  },
  {
    id: 'fx-svg-match',
    what: 'Los filtros SVG coinciden con ctx.filter: sRGB en cada <filter> y el radio de la sombra dividido entre dos (CSS drop-shadow).',
    sides: [
      ['src/engine/fx/svg.ts', 'color-interpolation-filters="sRGB"'],
      ['src/engine/fx/svg.ts', "numParam(op, 'blur') / 2"],
      ['src/engine/fx/canvas.ts', "case 'shadow': return `drop-shadow("],
    ],
    tests: ['tests/fx-svg.test.ts'],
  },
  {
    id: 'fx-commands',
    what: 'ADR 0011: el panel de capas y el agente cambian las capas FX con los mismos comandos (runFx), en un solo paso de deshacer.',
    sides: [
      ['src/engine/design/fx.ts', 'export function runFx'],
      ['src/components/designer/FxPanel.tsx', 'const r = runFx(sessionId, docId, commands)'],
      ['src/engine/agent/designerFx.ts', 'runFx(sessionId, doc.id, v.data.commands'],
      ['src/engine/agent/designerTools.ts', "name: 'designer_fx'"],
    ],
    tests: ['tests/fx-commands.test.ts', 'tests/fx-agent.test.ts'],
  },
  {
    id: 'fx-designer-route',
    what: 'En el Designer los filtros y efectos son capas FX: la guía lo dice y el runtime no dirige a la operación fx, que crea una imagen nueva.',
    sides: [
      ['src/engine/skills/app/designer.md', 'En el Designer no uses la operación fx'],
      ['src/engine/agent/runtime.ts', "workspace !== 'designer' || g.op !== 'fx'"],
    ],
    tests: ['tests/fx-agent.test.ts'],
  },
];

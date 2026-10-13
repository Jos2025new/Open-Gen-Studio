/**
 * Links the compiler does not see: two places that must say the same thing (a prompt line and the runtime rule it
 * describes, a card and the parameter it shows). Each side names a file and a literal anchor that must exist in it.
 * scripts/map.mjs fails when a file or an anchor is gone, so whoever changes one side is sent to the other.
 * Add a contract when a change shows two places that must agree; keep "what" in one plain sentence.
 */
export default [
  {
    id: 'path-node-topology',
    what: 'Borrar segmentos y soldar nodos conservan curvas exteriores, tipos e índices elegidos; la barra aplica un solo deshacer.',
    sides: [
      ['src/engine/design/pathNodeOps.ts', 'export function deleteSegments'],
      ['src/engine/design/pathNodeOps.ts', 'export function weldNodes'],
      ['src/components/designer/PathNodes.tsx', 'export function setJoinEnds'],
      ['src/components/designer/PathNodes.tsx', 'export function setDeleteSegments'],
      ['src/components/designer/ContextStrip.tsx', '>Delete segment</button>'],
    ],
    tests: ['tests/path-nodes.test.ts', 'tests-e2e/path-nodes.spec.ts'],
  },
  {
    id: 'provider-key-ui',
    what: 'Connected y Settings reutilizan ProviderRow para guardar claves, refrescar catálogos y mostrar errores.',
    sides: [
      ['src/components/shell/SettingsPanel.tsx', 'export function ProviderRow'],
      ['src/components/shell/SettingsPanel.tsx', '<ProviderRow key={p} id={p} />'],
      ['src/components/shell/ConnectedProviders.tsx', '<ProviderRow key={p} id={p} autoFocus />'],
    ],
    tests: ['tests/connected-providers.test.ts'],
  },
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
      ['src/engine/shortcuts.ts', "{ keys: 'Mod + S'"],
      ['src/components/designer/DesignerWorkspace.tsx', 'void saveNow(); return;'],
      ['src/components/shell/SettingsPanel.tsx', 'Save (Mod+S) also works while typing'],
      ['src/engine/shortcuts.ts', 'export function shortcutGroups'],
      ['src/components/designer/DesignerWorkspace.tsx', 'DESIGN_TOOL_KEYS[e.key.toLowerCase()]'],
      ['src/components/designer/PathNodes.tsx', 'marqueeNodeSelection'],
      ['src/components/shell/SettingsPanel.tsx', 'shortcutGroups()'],
      ['README.md', '<!-- shortcuts:start -->'],
    ],
    tests: ['tests/readme-shortcuts.test.ts'],
  },
  {
    id: 'sandbox',
    what: 'El sandbox dev y producción usan .sandbox/data y el puerto 5183; preview conserva strictPort y las protecciones locales.',
    sides: [
      ['scripts/dev-sandbox.mjs', 'export const SANDBOX_PORT = 5183'],
      ['scripts/dev-sandbox.mjs', 'export function sandboxOptions('],
      ['scripts/dev-sandbox.mjs', 'export async function sandboxBuildDirectory('],
      ['scripts/dev-sandbox.d.mts', 'export function sandboxOptions('],
      ['src/main.tsx', "import.meta.env.VITE_OGS_SANDBOX === '1'"],
      ['src/lib/designerBenchFixtures.ts', 'export function sandboxBenchAllowed('],
      ['docs/depuracion.md', '## Banco de fluidez en producción'],
      ['scripts/check-safeguards.mjs', 'node scripts\\/dev-sandbox\\.mjs'],
    ],
    tests: ['tests/safeguards.test.ts', 'tests/designer-bench.test.ts'],
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
    id: 'raster-export-resolution',
    what: 'PNG/JPG y galería entregan el documento completo con el mismo plan FX; el tope de píxeles solo limita FX efectivos; dimensiones inválidas y fallos reales llegan al toast de exportación, sin reducir silenciosamente.',
    sides: [
      ['src/engine/design/render.ts', "resolution: 'document'"],
      ['src/engine/design/exportLimits.ts', 'export function checkExportSize'],
      ['src/engine/design/actions.ts', 'downloadBlob(await exportDoc('],
      ['src/components/designer/DesignerWorkspace.tsx', "toast(err instanceof Error ? err.message : 'Export failed', 'error')"],
      ['docs/features/designer.md', '33.554.432'],
    ],
    tests: ['tests/fx-render.test.ts'],
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
  {
    id: 'trace-store',
    what: 'ADR 0012: el registro de rendimiento escribe en /x/store/trace y el servidor lo añade a logs/trace-<id>.jsonl con las protecciones de escritura de la app.',
    sides: [
      ['src/lib/trace.ts', 'fetch(`/x/store/trace?id='],
      ['server/local-store.js', "if (path === '/trace' && req.method === 'POST')"],
    ],
    tests: ['tests/trace.test.ts'],
  },
  {
    id: 'trace-key',
    what: 'La tecla del registro de rendimiento: el manejador y la lista de atajos (Ajustes y README) dicen lo mismo.',
    sides: [
      ['src/components/shell/TraceControl.tsx', "e.altKey && !e.shiftKey && e.code === 'KeyP'"],
      ['src/engine/shortcuts.ts', "keys: 'Mod + Alt + P'"],
    ],
    tests: ['tests/readme-shortcuts.test.ts'],
  },
  {
    id: 'render-attribution',
    what: 'Cada paso FX lleva el renderId y origen de su compositor; el porcentaje del editor excluye todos los renders fuera de pantalla.',
    sides: [
      ['src/lib/renderTrace.ts', 'export function beginRender'],
      ['src/engine/design/render.ts', 'beginRender(opts.origin'],
      ['src/engine/fx/canvas.ts', '...c.trace'],
      ['src/engine/fx/op.ts', "beginRender('asset-fx'"],
      ['src/engine/design/fill.ts', "origin: 'fill'"],
      ['src/engine/design/swatches.ts', "origin: 'color-sample'"],
      ['src/engine/design/pixelSelection.ts', "origin: 'selection'"],
      ['src/engine/agent/canvasView.ts', "origin: 'agent-view'"],
      ['src/components/designer/DocumentPicker.tsx', "origin: 'thumbnail'"],
      ['scripts/trace-report.mjs', 'function timeInFrame'],
      ['docs/depuracion.md', 'renderId'],
    ],
    tests: ['tests/fx-render.test.ts', 'tests/trace.test.ts'],
  },
  {
    id: 'trace-probes',
    what: 'El protocolo de medida (docs/depuracion.md#protocolo) solo cubre lo que tiene sondas: cada span, note o awaitFrame del código está en la tabla «Qué se mide hoy», y cada evento de la tabla tiene su sonda.',
    sides: [
      ['docs/depuracion.md', '## Qué se mide hoy'],
      ['docs/depuracion.md', '## Protocolo'],
      ['src/lib/trace.ts', 'export function span('],
      ['AGENTS.md', 'docs/depuracion.md#protocolo'],
    ],
    tests: ['tests/trace-domains.test.ts'],
  },
  {
    id: 'single-controls',
    what: 'ADR 0013: los ajustes del Designer usan un solo tipo de campo (InlineControls); ningún otro componente dibuja su propio deslizador o input de color.',
    sides: [
      ['src/components/designer/InlineControls.tsx', 'export function InlineSlider'],
      ['src/components/designer/InlineControls.tsx', 'export function InlineToggle'],
      ['src/styles/designer-connected.css', 'One field per setting (InlineControls.tsx)'],
    ],
    tests: ['tests/ui-single-slider.test.ts'],
  },
  {
    id: 'brush-one-engine',
    what: 'ADR 0013: el trazo en vivo, el trazo reconstruido y la vista previa de la brocha se dibujan con el mismo motor de punta (stampSegment).',
    sides: [
      ['src/engine/design/brushEngine.ts', 'export function stampSegment'],
      ['src/engine/design/rasterStrokeMask.ts', 'stampSegment(img'],
      ['src/engine/design/raster.ts', 'stampSegment(img, x, y, [a.x, a.y, b.x, b.y, width], density, live.tip, hexRgb(live.color), live.last)'],
      ['src/engine/design/raster.ts', 'rasterStrokeMask(stroke, tip)'],
      ['src/components/designer/BrushSettings.tsx', 'stampSegment(img, 0, 0, [ax, ay, bx, by, width], density, tip, rgb, last ??'],
    ],
    tests: ['tests/brush-engine.test.ts', 'tests/raster-stroke-mask.test.ts'],
  },
  {
    id: 'raster-png-worker',
    what: 'Al persistir los píxeles de una capa, el PNG se prepara y codifica en un worker cuando es posible, con fallback al encoder Canvas actual y sin cambiar el acuse de guardado.',
    sides: [
      ['src/engine/design/raster.ts', 'await blobDb.set(keyFor(layerId), await canvasToPngBlob(c))'],
      ['src/lib/canvasPngWorker.ts', 'export async function canvasToPngBlob'],
      ['src/lib/canvasPng.worker.ts', 'canvas.convertToBlob({ type: \'image/png\' })'],
      ['bench/engines/png-parity.ts', 'export async function runPngParity'],
      ['bench/engines/main.ts', "mode === 'png' ? runPngParity"],
    ],
    tests: ['tests/canvas-png-worker.test.ts', 'tests/raster-persist.test.ts'],
  },
  {
    id: 'fx-editor-cache',
    what: '2026-10-09: el editor reutiliza el resultado de una capa con FX mientras no cambie lo que lee (objeto de capa, versión de contenido de sus píxeles, sus FX, escala). Toda escritura de píxeles sube la versión de su lienzo, también el trazo en vivo; las exportaciones siempre calculan.',
    sides: [
      ['src/engine/design/render.ts', 'function contentKey('],
      ['src/engine/design/raster.ts', 'export function bufferVersion('],
      ['src/engine/design/raster.ts', 'export function paintLive(buf: HTMLCanvasElement, live: LiveStroke, a: { x: number; y: number }, b: { x: number; y: number }, width: number, density = 1): void {\n  touchBuffer(buf);'],
    ],
    tests: ['tests/fx-render.test.ts'],
  },
  {
    id: 'persist-json-exact',
    what: '2026-10-09: el guardado del estado reutiliza el texto de las sesiones que no cambiaron (las sesiones se reemplazan, nunca se mutan) y produce el mismo JSON byte a byte; cada 30 s una pasada completa detecta y corrige una sesión mutada en el sitio. 2026-10-12: el disco recibe esos mismos bytes como un Blob de partes por sesión (un texto de 12 MB en fetch bloqueaba ~0,9 s), con su baseAt; IndexedDB guarda Blob bajo una clave nueva sin modificar el texto legado; el indicador confirma la versión y los píxeles solo tras los acuses.',
    sides: [
      ['src/store/store.ts', 'stateDb.set(next.name, persistState(next.value))'],
      ['src/store/persistJson.ts', 'export function persistState('],
      ['src/lib/idb.ts', 'async function readLegacy(key: string)'],
      ['src/store/saveStatus.ts', 'export function confirmStateSave('],
      ['src/components/shell/SaveIndicator.tsx', 'export function SaveIndicator('],
      ['src/lib/disk.ts', 'next.blob(`{"savedAt":${next.savedAt},"baseAt":${baseAt},`)'],
    ],
    tests: ['tests/persist-json.test.ts', 'tests/state-conflict.test.ts', 'tests/state-copies.test.ts', 'tests/save-status.test.ts', 'tests/disk-receipts.test.ts', 'tests/save-now.test.ts', 'tests/raster-persist.test.ts', 'tests/state-format-2.test.ts'],
  },
  {
    id: 'state-format-2',
    what: 'ADR 0014 (aprobado por el usuario, 2026-10-12): el estado se guarda en formato 2, un registro global y uno por sesión; un cambio escribe solo las sesiones cambiadas. El disco publica un manifiesto (HEAD) al final; el formato 1 (state.json, ogs-app) no se escribe ni se borra: se copia íntegro antes de la primera escritura en formato 2.',
    sides: [
      ['server/store-v2.js', 'export function createStoreV2('],
      ['server/store-v2.d.ts', 'export function createStoreV2('],
      ['server/local-store.js', "import { createStoreV2 } from './store-v2.js';"],
      ['src/store/formatV2.ts', 'export function assembleText('],
      ['src/lib/idb.ts', "const v2Store = createStore('ogs-store-v2', 'kv');"],
      ['src/lib/disk.ts', 'setCommit(c: {'],
    ],
    tests: ['tests/store-v2.test.ts', 'tests/state-format-2.test.ts', 'tests/state-copies.test.ts', 'tests/store-server.test.ts'],
  },
  {
    id: 'cache-budget',
    what: 'Paso 4 (2026-10-13): las cachés del editor (FX de capa, FX below y máscaras de trazo) comparten un presupuesto en bytes; descarta primero lo menos usado y nunca el dibujo del usuario, que no es una entrada.',
    sides: [
      ['src/engine/design/cacheBudget.ts', 'export const editorCacheBudget'],
      ['src/engine/design/render.ts', 'editorCacheBudget.put(`fx:${id}`'],
      ['src/engine/design/belowFxCache.ts', 'editorCacheBudget.put(`below:${id}`'],
      ['src/engine/design/rasterStrokeMask.ts', 'editorCacheBudget.put(id, bytes'],
    ],
    tests: ['tests/cache-budget.test.ts', 'tests/raster-stroke-mask.test.ts', 'tests/fx-render.test.ts'],
  },
  {
    id: 'raster-dirty-retained',
    what: 'Una escritura raster localizada invalida en la página retenida su área mapeada y el margen de sus FX; cambios de capa o escrituras sin región conservan el redibujo geométrico seguro.',
    sides: [
      ['src/engine/design/raster.ts', 'export function takeDirty('],
      ['src/engine/design/rasterDirty.ts', 'function rasterDirtyRect('],
      ['src/engine/design/retainedPage.ts', 'function changedArea('],
    ],
    tests: ['tests/retained-page-plan.test.ts', 'tests/raster-strokes.test.ts'],
  },
  {
    id: 'raster-editable-stroke-limit',
    what: 'Una capa raster editable se aplana en el mismo paso de deshacer al llegar al límite provisional de 64 trazos o 8192 segmentos; el buffer exacto que pintó Stage pasa a píxeles persistentes, y una capa antigua que ya alcanzó o superó la cuota pide confirmación antes de pintar.',
    sides: [
      ['src/engine/types.ts', 'paintFlattened?: boolean;'],
      ['src/engine/design/rasterLimit.ts', 'export const DEFAULT_PAINT_STROKE_LIMIT = 64;'],
      ['src/components/designer/Stage.tsx', 'prepareStagePaint(current, erase)'],
      ['src/components/designer/StagePaintCommit.ts', 'shouldFlattenRasterPaint({ ...layer, paintStrokes: nextStrokes }'],
      ['src/components/designer/LayersPanel.tsx', '<RasterLimitControls sessionId={sessionId}'],
      ['docs/raster-limit.md', '64 trazos o 8192 segmentos.'],
    ],
    tests: ['tests/raster-limit.test.ts'],
  },
];

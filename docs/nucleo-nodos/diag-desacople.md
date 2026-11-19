# Puntos de desacople por componente (solo lectura, rama task/sqlite-adopt)

Rutas relativas a `src/`. «Verificado» = leído en el código. `agentNodeOf` está ahora en `runtimeShared.ts:108-111` y acepta `nodeId`.

**Hechos transversales que cambian el diseño**
- Los 11 nodos de sistema (`graphTypes.ts:9`) son espejos: `resolveSystemNodeLive` (`spec.ts:287`) y `omniSpaceLive` (`omniLive.ts:17`) solo leen el store. Único efecto real hoy:
  - Escrituras reales: `setSpaceParam` (`omni.ts:192`, solo studio `mode`/`style` y designer `doc`), `attachModelToNode` y `applyModelLinkToAgent` (`system.ts:358`, `:328`) y `setAgentLlm` (`system.ts:345`).
  - Lectura de texto por enlace: solo `refNodeText` (`flow/refText.ts:8-14`), solo si el nodo es chat o agent (consumido en `flow/graph.ts:436-437`).
- Un nodo `prompt` conectado a un nodo de generación da «has no text yet» porque `refNodeText` no lo contempla. Solo funciona `prompt→agent`, vía `promptsWiredToAgent` (`spec.ts:276`, usado en `conversation.ts:44-45`).
- **La UI no usa la capa de comandos.** Solo `CommandPalette.tsx` llama a `invoke(`. Los paneles llaman directamente al motor (p. ej. `LayersPanel.tsx:10` importa `engine/design/actions`). Los comandos (`engine/commands/*`, ADR 0030, ~110 ids) son una puerta paralela para agente, CLI y paleta.
- Dos significados de «space»: Omni = Studio, Nodes y Designer (`omniSpaces.ts:9`); `ui.space` = `'create'|'tools'` (`store.ts:55`), Panel + Board.
- Escrituras de sesión: `patchSession` (`store.ts:448`), `setGraph` (`:524`), `setDoc`. Globales: `setComposer` (`:538`), `setComposerMedia` (`:542`), `setUi` (`:546`), `setSettings` (`:554`).

## Tabla

| Space | Componente | Entradas (archivo:línea) | Salidas (archivo:línea) | Nodo hoy | Bloqueo para envolver |
|---|---|---|---|---|---|
| Studio | Chat / feed | `chat/ChatWorkspace.tsx:18-29` (`sessions[activeSessionId].feed`); `chat/FeedList.tsx:226` | `appendFeed`, `updateFeedItem` (`store.ts:456`, `:460`); `setComposer({text,mode})` en `ChatWorkspace.tsx:82` | `chat`, espejo (`spec.ts:296`; `ref` = sessionId, `system.ts:75-80`) | `feedOfChat` (`runtimeShared.ts:127`) sin uso: el nodo chat no es dueño del feed; la UI lee `activeSessionId`. |
| Studio | Agente (envío) | `conversation.ts:31-40` (`activeSessionId`, `composer.attachments`); `:44-45` (`agentNodeOf(sessionId)` sin id) | `appendFeed` con `messageMeta` (`conversation.ts:49`); `setComposer` (`:50`); `patchAgent` (`:80`); `llmTurn` | `agent`, espejo (`spec.ts:327`; `ref` = sessionId, `system.ts:82-87`) | `sendAgentMessage` sin `agentNodeId`; `agentEngine()` sin argumento en `conversation.ts:68,82,108` y `llmTurn.ts:53`; responde el primero (`runtimeShared.ts:110`). |
| Studio | LLM del agente | `runtimeShared.ts:133-143` (`node.llm` o `settings.agent`); `AgentModelControls.tsx:43-44` | UI: `setSettings({agent})` (`AgentModelControls.tsx:58`, `settings/AgentTab.tsx:156,171`). Nodo: `setAgentLlm` (`system.ts:345`), solo tests | `model`/`agent`, espejo | La UI escribe el global; `spec.ts:331,360` muestra `settings.agent`. Proveedor: `llmTurn.ts:157`. |
| Studio | Composer | `store.ts:137,199`; `composer/Composer.tsx:48-54,183`; `AgentControls.tsx:16,105-114,132`; `ModeMenu.tsx:16` | `setComposer` (`Composer.tsx:28,151,165`; `ModeMenu.tsx:41`; `AgentControls.tsx:33,72`); `sendAgentMessage(text)` `Composer.tsx:390`; `generateDirect(mode)` | `prompt` ref `'composer'` (`spec.ts:462`; `flow/actions.ts:72`): espejo | Composer único y global. `prompt`/`mediaSettings` no están en `SYSTEM_ENTRIES` (`AddNodeItems.tsx:24-33`). |
| Studio | Aspecto / estilo / cantidad / mediaSettings | `AspectChoices.tsx:12-41` (props); `MediaControls.tsx:22,72-74,275-277`; `StyleFields.tsx:12,22,123-126` | `setComposerMedia` (`MediaControls.tsx:85,170,192,285`; `StyleFields.tsx:17`) | `mediaSettings`, espejo solo lectura (`spec.ts:466-470`) | Cada control lee y escribe `composer[kind]` directo. |
| Studio | Generación directa | `actions.ts:212` (`checkDirect`), `:280-300` | `createGeneration` (`jobs.ts:99`); `runGeneration` (`jobs.ts:311`); `ADAPTERS[provider].generate` (`jobs.ts:586`) | ninguno (comando `studio.generate.start`) | `generateDirect(kind)` lee todo del composer global. |
| Studio | Space board | `space/SpaceBoard.tsx:28-34` | `setUi({lightbox,tileSize})` (`:60,121,134,209`) | `space` Studio, espejo (`omniLive.ts:25-42`) | Depende de `activeSessionId`. |
| Studio | Registro de generaciones | `shell/GenerationsPanel.tsx:26-36`; `generationsView.ts` | `setUi({lightbox})` (`:142`); `cancelGeneration` (`jobs.ts:812`, no verificado) | ninguno | `generations` global por id (`store.ts:133`). |
| Studio | Historial de prompts | `lib/promptHistory.ts:10` (IndexedDB `ogs-prompts`); `space/PromptHistory.tsx:17` | `recordPrompt` (`promptHistory.ts:18`); `setComposer({text})` (`PromptHistory.tsx:22,35`) | ninguno | Fuera del store; clave única. |
| Studio | Designer embebido y tablero | `studio/StudioBoard.tsx`; `EmbeddedDesigner.tsx:25-26` | `ui.tool` (no verificado) | ninguno | No verificado. |
| Nodes | Lienzo | `node/NodeWorkspace.tsx:54-62` | `setGraph` (`store.ts:524`); `runNodes` (`flow/actions.ts:362`), `previewRun` (`:276`) | `space` Nodes, espejo (`omniLive.ts:45-70`); nodos de datos = fuente | `graphToSteps` (`flow/graph.ts:371`) = enganche de ejecución. |
| Nodes | Toolset / Operations | `ToolsPanel.tsx:21,58-64`; `ops.ts` | `setUi({toolOp,toolSeed})`; `runAssetOp` (`actions.ts:676`); `useOpRun` | `toolset`, espejo (`spec.ts:471`) | La tool se ejecuta por fuera del nodo. |
| Designer | Documento | `DesignerWorkspace.tsx:30-31` | `mutateDoc` (`design/actions.ts:46`); `selectDoc` (`:68`); `setDoc` | `designer.doc`, espejo (`spec.ts:403`) | Sin `out`. Escritura única: `mutateDoc`. |
| Designer | Capas | `LayersPanel.tsx:89` (props), `:93` (`ui.tool`) | `patchLayer` (`design/actions.ts:282`) y afines; `designer.layer.*` | ninguno | Buena frontera por props. |
| Designer | FX | `FxPanel.tsx:30,76,105` | `runFx` (`design/fx.ts`), `designer.fx.*` | ninguno | Falta decidir frontera. |
| Designer | Export | `ExportPanel.tsx:39`; `settings.designExportPresets` (`:50`) | `exportDoc` (`design/exportRaster.ts:89`); `exportDocFile` (`design/actions.ts:462`); `setSettings` (`:153,233`) | ninguno | Mezcla preset global y doc. |
| Designer | Brush / toolbox | `BrushSettings.tsx:99`; `ToolSettings.tsx:59-168`; `Stage.tsx:207-235` | `setUi({brush,tool,selectMode,wand})` | ninguno | Estado global en `ui.*`. |
| Home | Home | `shell/HomeView.tsx:88-96` | `setUi({homeTab})` (`:96`) | `toolset`, espejo de `OPS` | Sin salida de datos. |
| Home | Create / Tools (`ui.space`) | `space/SpacePanel.tsx:28-38` | `setComposer` (`:42,59`); `generateDirect`; `recordCreatePrompt` | `space` create/tools (`spec.ts:421-436`), espejo | Composer global compartido. |
| Shell | Barra lateral | `Sidebar.tsx:41-46` | `setUi({panel})` (`:101,121`); `newSession()` (`:143`); `navModel.ts:49,60` | `session`, espejo | Navegación por `ui.*`. |
| Shell | Sesiones | `SessionsPanel.tsx:41-44` | `newSession` (`store.ts:585`), `selectSession` (`:591`), `renameSession` (`:595`), `togglePinSession` (`:601`) | `session`, espejo (`spec.ts:437`) | `activeSessionId` global. |
| Shell | TopBar | `TopBar.tsx:51-61` | `setUi({home,settingsOpen})` (`:45,84,137`) | ninguno | Solo UI. |
| Ajustes | Ajustes | `SettingsPanel.tsx:27-57`; `settings/*Tab.tsx` | `setSettings` (`AgentTab.tsx:156,171`; `BudgetTab.tsx:21-72`; `OpsTab.tsx:32,69`; `ProvidersTab.tsx:81-88`); `saveKey` (`ProvidersTab.tsx:27`) | `provider`, espejo (`spec.ts:389`) | Claves no salen por puertos; agente global mezclado con proveedor (`storeTypes.ts:12`). |
| Galería | Galería | `gallery/GalleryPanel.tsx:36,47-48`; `GeneratedAssets.tsx:28-47` | `setUi`; `saveSubject` (`actions.ts:77`); `library.*` | `library`, espejo (`spec.ts:450`) | `library.in/out` sin efecto; `store.library` global. |
| Otros | Lightbox | `store.ts:71` | `setUi({lightbox})` | ninguno | UI pura. |
| Otros | Gasto | `SpendingPanel.tsx`; `store.ts:126-129` | `settings.budget*` | ninguno | Global. |
| Otros | Skills / workflows | `AgentControls.tsx:16,52`; `engine/skills/commands.ts` | `setComposer({skillId,workflowId})` | ninguno | Cuelgan del composer. |
| Otros | Paleta de comandos | `shell/CommandPalette.tsx` | `invoke(` | ninguno | Único consumidor de comandos en la UI. |
| Otros | Modelos / catálogo | `catalog.*` (`store.ts`) | `models.*` (`catalog.commands.ts`) | `model`, espejo | Ref de catálogo, no id estable. |
| Otros | Alertas, toasts, guardado | `alerts.ts`, `store/toasts.ts`, `SaveIndicator.tsx` | no verificado | ninguno | Persistencia protegida. |

## (a) Envoltorio genérico: dónde engancharlo

- Registro: `SYSTEM_NODE_TYPES` (`spec.ts:21-148`), `resolvers` (`spec.ts:295`), `SystemNodeType` (`graphTypes.ts:9`); además `newNodeData` (`flow/actions.ts:62`) y `AddNodeItems.tsx:24`.
- Lectura: `resolveSystemNodeLive` (`spec.ts:287`) → tabla puerto→selector.
- Escritura: `linkSystemNodes` (`system.ts:504`) → `onLink` genérico puerto→acción.
- Datos a nodos de generación: `textFrom` (`flow/graph.ts:426-440`) y `refNodeText` (`flow/refText.ts:8`) → `portValue(node, port)` genérico.
- Frescura: `flow/freshness.ts:32,44`.
- Acciones: capa de comandos (`engine/commands/registry.ts`, `run.ts:62`, `commands/types.ts`): salida → id de comando, entrada → selector.
- Limitación: UI y comandos son dos caminos al mismo estado.

## (b) Inicio y fin de space

- Existe: nodos de space con puertos (`omniSpaces.ts:23-27`); `SPACE_SYSTEM_PARTS` y `showSpaceSystemNodes` (`omni.ts:151-167`, sueltos con enlace `ref`); `setSpaceView` (`omni.ts:170`); `GraphGroup` (`graphTypes.ts:115`, solo `nodeIds`; `flow/arrange.ts:79-97`); `ordinaryGraph` (`omniSpaces.ts:40`).
- Falta: puertos de space sin efecto; grupo sin Group Input/Output; `graph.ts` ignora `groups` (no revisado `executionOrder`); sin ruteo de aristas que crucen el marco ni anidado; Create/Tools sin inicio/fin; nodos de sistema sin marco al abrir.

## (c) Acoplamientos verificados

- Envío sin `agentNodeId` (`conversation.ts:31,44,68,82,108`; `llmTurn.ts:53`; `runtimeShared.ts:110`).
- Un solo `AgentState` por sesión (`types.ts:847`; `patchAgent` `conversation.ts:80`).
- `feedOfChat` sin uso; la UI lee el feed por `activeSessionId`.
- `agent` y `chat` con `ref = sessionId` (`system.ts:75-87`).
- `node.llm` solo lo lee `agentEngine`; ningún control lo escribe.
- Composer global único (`store.ts:137,199`); `ChatNode.tsx:44` incrusta el mismo `<Composer />`.
- `activeSessionId` y `ui.workspace` como contexto implícito.
- Estado de herramienta de Designer en `ui.*`.
- UI y comandos, dos caminos.
- `prompt` → generación no entrega texto (`refText.ts:10`).
- Registro cerrado: cada tipo toca 5 sitios.
- Historial de prompts fuera del store.

**No verificado:** `executionOrder` (`flow/graph.ts:345`) con grupos; `useOpRun`; paneles internos de Designer; `settings/*` completo; comportamiento en ejecución.

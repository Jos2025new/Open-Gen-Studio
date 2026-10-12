# Mapa del código

Generado por `node scripts/map.mjs --write` a partir de [map-contracts.mjs](../scripts/map-contracts.mjs) y de los imports. `npm test` falla si está desactualizado o si falta un ancla de un contrato. No editar a mano.

## Antes de cambiar código

1. Busca aquí el archivo que vas a tocar: los **contratos** dicen qué otro lugar debe seguir diciendo lo mismo; los **módulos centrales**, si el cambio se propaga lejos.
2. Al terminar cada cambio, `npm run test:related`: ejecuta solo los tests que alcanzan los archivos modificados.
3. Si cambias un lado de un contrato, cambia los otros en el mismo commit; si descubres uno nuevo, añádelo a `scripts/map-contracts.mjs`.
4. Antes de dar el trabajo por hecho, `npm test` completo.
5. Para medir rendimiento, el [protocolo](depuracion.md#protocolo), solo en lo que tiene sondas (tabla «Qué se mide hoy»). Una sonda nueva va a esa tabla en el mismo commit: lo comprueba `tests/trace-domains.test.ts`.

## Contratos que el compilador no ve

| Contrato | Lugares | Tests |
| --- | --- | --- |
| **path-node-topology** — Borrar segmentos y soldar nodos conservan curvas exteriores, tipos e índices elegidos; la barra aplica un solo deshacer. | [pathNodeOps.ts](../src/engine/design/pathNodeOps.ts), [PathNodes.tsx](../src/components/designer/PathNodes.tsx), [ContextStrip.tsx](../src/components/designer/ContextStrip.tsx) | [path-nodes.test.ts](../tests/path-nodes.test.ts), [path-nodes.spec.ts](../tests-e2e/path-nodes.spec.ts) |
| **provider-key-ui** — Connected y Settings reutilizan ProviderRow para guardar claves, refrescar catálogos y mostrar errores. | [SettingsPanel.tsx](../src/components/shell/SettingsPanel.tsx), [ConnectedProviders.tsx](../src/components/shell/ConnectedProviders.tsx) | [connected-providers.test.ts](../tests/connected-providers.test.ts) |
| **guided-asks** — Guided pregunta antes de cada plan: el prompt lo dice y el runtime rechaza un plan sin preguntas. | [context.ts](../src/engine/agent/context.ts), [runtime.ts](../src/engine/agent/runtime.ts) | [agent-mode.test.ts](../tests/agent-mode.test.ts) |
| **direct-guides** — Direct no tiene tarjeta de ajustes: las guías de los modelos del compositor llegan con la petición. | [context.ts](../src/engine/agent/context.ts), [requestGuides.ts](../src/engine/agent/requestGuides.ts) | [agent-direct-model.test.ts](../tests/agent-direct-model.test.ts) |
| **settings-policy** — Qué pasos necesitan la tarjeta de ajustes: el texto para el agente y la puerta del runtime. | [procedure.ts](../src/engine/procedure.ts), [runtime.ts](../src/engine/agent/runtime.ts) | [general-model-gate.test.ts](../tests/general-model-gate.test.ts), [agent-force.test.ts](../tests/agent-force.test.ts) |
| **automation-policy** — Cuándo se reutilizan ajustes sin preguntar (umbral de coste): el texto debe describir exactamente needsConfirmation. | [procedure.ts](../src/engine/procedure.ts) | [general-model.test.ts](../tests/general-model.test.ts), [general-model-gate.test.ts](../tests/general-model-gate.test.ts) |
| **no-forced-tool-choice** — Decisión del usuario (2026-10-08): las palabras clave dirigen al agente con una señal en el mensaje; nunca se envía al proveedor un tool_choice con nombre. | [llm.ts](../src/engine/providers/llm.ts), [force.ts](../src/engine/agent/force.ts) | [agent-force.test.ts](../tests/agent-force.test.ts) |
| **ops-confirm-model** — Decisión del usuario (ADR 0009, enmienda a 0007-9): una operación con modelo de imagen confirma su modelo (Auto una vez por sesión, Guided en cada petición; Direct usa el compositor). | [procedure.ts](../src/engine/procedure.ts), [runtime.ts](../src/engine/agent/runtime.ts) | [agent-force.test.ts](../tests/agent-force.test.ts), [agent-fit-plan.test.ts](../tests/agent-fit-plan.test.ts) |
| **cost-recheck** — Un plan caro se muestra tras confirmar su tarjeta en la misma petición; el mensaje de coste nombra cada tipo una vez (la tarjeta admite 4 partes). | [runtime.ts](../src/engine/agent/runtime.ts), [tools.ts](../src/engine/agent/tools.ts) | [general-model-gate.test.ts](../tests/general-model-gate.test.ts) |
| **spend-approval** — Todo plan con coste mayor que cero o desconocido espera aprobación, también en Auto. | [pricing.ts](../src/engine/pricing.ts), [runtime.ts](../src/engine/agent/runtime.ts) | [engine.test.ts](../tests/engine.test.ts) |
| **upscale-note** — El aviso de upscale se calcula del factor que se ejecuta; si no llega a lo pedido, la tarjeta lo muestra sin plegar. | [fit.ts](../src/engine/agent/fit.ts), [PlanCard.tsx](../src/components/chat/PlanCard.tsx) | [agent-fit-plan.test.ts](../tests/agent-fit-plan.test.ts) |
| **user-model-notes** — Los cambios sobre un modelo elegido por el usuario («your … model») se ven siempre en la tarjeta y como aviso. | [plan.ts](../src/engine/plan.ts), [PlanCard.tsx](../src/components/chat/PlanCard.tsx), [runtime.ts](../src/engine/agent/runtime.ts) | [routing.test.ts](../tests/routing.test.ts) |
| **reference-sheet-subject** — Una hoja de referencia solo se rechaza si el lugar es su sujeto; la descripción de la operación dice lo mismo. | [fit.ts](../src/engine/agent/fit.ts), [ops.ts](../src/engine/ops.ts) | [agent-fit-plan.test.ts](../tests/agent-fit-plan.test.ts) |
| **keyword-route** — Las palabras clave señalan una operación y su encaje; la señal va antes del mensaje del usuario. | [triggers.ts](../src/engine/agent/triggers.ts), [force.ts](../src/engine/agent/force.ts), [fit.ts](../src/engine/agent/fit.ts), [runtime.ts](../src/engine/agent/runtime.ts) | [agent-force.test.ts](../tests/agent-force.test.ts), [agent-fit.test.ts](../tests/agent-fit.test.ts) |
| **ops-in-prompt** — Las operaciones que conoce el agente salen del registro OPS, no de una segunda lista. | [ops.ts](../src/engine/ops.ts), [procedure.ts](../src/engine/procedure.ts), [context.ts](../src/engine/agent/context.ts) | [agent-procedure.test.ts](../tests/agent-procedure.test.ts) |
| **audio-defaults** — Voz y efectos (2026-10-08): por defecto Gemini 3.8 Flash TTS para voz y ElevenLabs Sound Effects v2 para efectos, salvo que el usuario nombre o elija otro; el agente lo lee en el contrato del paso de audio. | [nanogptAudio.ts](../src/engine/providers/nanogptAudio.ts), [procedure.ts](../src/engine/procedure.ts), [context.ts](../src/engine/agent/context.ts), [catalogo-voz-y-efectos.md](../docs/catalogo-voz-y-efectos.md) | [nanogpt-speech.test.ts](../tests/nanogpt-speech.test.ts) |
| **shortcuts** — Los atajos de teclado: el manejador, Ajustes → Shortcuts y el README leen la misma lista. | [shortcuts.ts](../src/engine/shortcuts.ts), [DesignerWorkspace.tsx](../src/components/designer/DesignerWorkspace.tsx), [PathNodes.tsx](../src/components/designer/PathNodes.tsx), [SettingsPanel.tsx](../src/components/shell/SettingsPanel.tsx), [README.md](../README.md) | [readme-shortcuts.test.ts](../tests/readme-shortcuts.test.ts) |
| **sandbox** — El sandbox usa .sandbox/data y el puerto 5183; las salvaguardas comprueban ese aislamiento. | [dev-sandbox.mjs](../scripts/dev-sandbox.mjs), [check-safeguards.mjs](../scripts/check-safeguards.mjs) | [safeguards.test.ts](../tests/safeguards.test.ts) |
| **store-local-only** — El almacén /x/store solo responde al propio ordenador (también con --host); docs/seguridad.md lo afirma con su prueba. | [local-store.js](../server/local-store.js), [seguridad.md](../docs/seguridad.md), [README.md](../README.md) | [store-server.test.ts](../tests/store-server.test.ts) |
| **automated-writes** — El servidor rechaza escrituras automatizadas (cabecera X-OGS-Automated) fuera del sandbox. | [local-store.js](../server/local-store.js) | [automated-write.test.ts](../tests/automated-write.test.ts), [store-server.test.ts](../tests/store-server.test.ts) |
| **fx-plan** — ADR 0011: el lienzo y la exportación SVG aplican las capas FX con el mismo plan (qué filtra cada capa y en qué orden). | [plan.ts](../src/engine/fx/plan.ts), [render.ts](../src/engine/design/render.ts), [export.ts](../src/engine/design/export.ts) | [fx-render.test.ts](../tests/fx-render.test.ts), [fx-svg.test.ts](../tests/fx-svg.test.ts) |
| **raster-export-resolution** — PNG/JPG y galería entregan el documento completo con el mismo plan FX; el tope de píxeles solo limita FX efectivos; dimensiones inválidas y fallos reales llegan al toast de exportación, sin reducir silenciosamente. | [render.ts](../src/engine/design/render.ts), [exportLimits.ts](../src/engine/design/exportLimits.ts), [actions.ts](../src/engine/design/actions.ts), [DesignerWorkspace.tsx](../src/components/designer/DesignerWorkspace.tsx), [designer.md](../docs/features/designer.md) | [fx-render.test.ts](../tests/fx-render.test.ts) |
| **fx-svg-match** — Los filtros SVG coinciden con ctx.filter: sRGB en cada <filter> y el radio de la sombra dividido entre dos (CSS drop-shadow). | [svg.ts](../src/engine/fx/svg.ts), [canvas.ts](../src/engine/fx/canvas.ts) | [fx-svg.test.ts](../tests/fx-svg.test.ts) |
| **fx-commands** — ADR 0011: el panel de capas y el agente cambian las capas FX con los mismos comandos (runFx), en un solo paso de deshacer. | [fx.ts](../src/engine/design/fx.ts), [FxPanel.tsx](../src/components/designer/FxPanel.tsx), [designerFx.ts](../src/engine/agent/designerFx.ts), [designerTools.ts](../src/engine/agent/designerTools.ts) | [fx-commands.test.ts](../tests/fx-commands.test.ts), [fx-agent.test.ts](../tests/fx-agent.test.ts) |
| **fx-designer-route** — En el Designer los filtros y efectos son capas FX: la guía lo dice y el runtime no dirige a la operación fx, que crea una imagen nueva. | [designer.md](../src/engine/skills/app/designer.md), [runtime.ts](../src/engine/agent/runtime.ts) | [fx-agent.test.ts](../tests/fx-agent.test.ts) |
| **trace-store** — ADR 0012: el registro de rendimiento escribe en /x/store/trace y el servidor lo añade a logs/trace-<id>.jsonl con las protecciones de escritura de la app. | [trace.ts](../src/lib/trace.ts), [local-store.js](../server/local-store.js) | [trace.test.ts](../tests/trace.test.ts) |
| **trace-key** — La tecla del registro de rendimiento: el manejador y la lista de atajos (Ajustes y README) dicen lo mismo. | [TraceControl.tsx](../src/components/shell/TraceControl.tsx), [shortcuts.ts](../src/engine/shortcuts.ts) | [readme-shortcuts.test.ts](../tests/readme-shortcuts.test.ts) |
| **render-attribution** — Cada paso FX lleva el renderId y origen de su compositor; el porcentaje del editor excluye todos los renders fuera de pantalla. | [renderTrace.ts](../src/lib/renderTrace.ts), [render.ts](../src/engine/design/render.ts), [canvas.ts](../src/engine/fx/canvas.ts), [op.ts](../src/engine/fx/op.ts), [fill.ts](../src/engine/design/fill.ts), [swatches.ts](../src/engine/design/swatches.ts), [pixelSelection.ts](../src/engine/design/pixelSelection.ts), [canvasView.ts](../src/engine/agent/canvasView.ts), [DocumentPicker.tsx](../src/components/designer/DocumentPicker.tsx), [trace-report.mjs](../scripts/trace-report.mjs), [depuracion.md](../docs/depuracion.md) | [fx-render.test.ts](../tests/fx-render.test.ts), [trace.test.ts](../tests/trace.test.ts) |
| **trace-probes** — El protocolo de medida (docs/depuracion.md#protocolo) solo cubre lo que tiene sondas: cada span, note o awaitFrame del código está en la tabla «Qué se mide hoy», y cada evento de la tabla tiene su sonda. | [depuracion.md](../docs/depuracion.md), [trace.ts](../src/lib/trace.ts), [AGENTS.md](../AGENTS.md) | [trace-domains.test.ts](../tests/trace-domains.test.ts) |
| **single-controls** — ADR 0013: los ajustes del Designer usan un solo tipo de campo (InlineControls); ningún otro componente dibuja su propio deslizador o input de color. | [InlineControls.tsx](../src/components/designer/InlineControls.tsx), [designer-connected.css](../src/styles/designer-connected.css) | [ui-single-slider.test.ts](../tests/ui-single-slider.test.ts) |
| **brush-one-engine** — ADR 0013: el trazo en vivo, el trazo reconstruido y la vista previa de la brocha se dibujan con el mismo motor de punta (stampSegment). | [brushEngine.ts](../src/engine/design/brushEngine.ts), [rasterStrokeMask.ts](../src/engine/design/rasterStrokeMask.ts), [raster.ts](../src/engine/design/raster.ts), [BrushSettings.tsx](../src/components/designer/BrushSettings.tsx) | [brush-engine.test.ts](../tests/brush-engine.test.ts), [raster-stroke-mask.test.ts](../tests/raster-stroke-mask.test.ts) |
| **fx-editor-cache** — 2026-10-09: el editor reutiliza el resultado de una capa con FX mientras no cambie lo que lee (objeto de capa, versión de contenido de sus píxeles, sus FX, escala). Toda escritura de píxeles sube la versión de su lienzo, también el trazo en vivo; las exportaciones siempre calculan. | [render.ts](../src/engine/design/render.ts), [raster.ts](../src/engine/design/raster.ts) | [fx-render.test.ts](../tests/fx-render.test.ts) |
| **persist-json-exact** — 2026-10-09: el guardado del estado reutiliza el texto de las sesiones que no cambiaron (las sesiones se reemplazan, nunca se mutan) y produce el mismo JSON byte a byte; cada 30 s una pasada completa detecta y corrige una sesión mutada en el sitio. 2026-10-12: el disco recibe esos mismos bytes como un Blob de partes por sesión (un texto de 12 MB en fetch bloqueaba ~0,9 s), con su baseAt; IndexedDB sigue guardando el texto. | [store.ts](../src/store/store.ts), [persistJson.ts](../src/store/persistJson.ts), [idb.ts](../src/lib/idb.ts), [disk.ts](../src/lib/disk.ts) | [persist-json.test.ts](../tests/persist-json.test.ts), [state-conflict.test.ts](../tests/state-conflict.test.ts) |

## Módulos centrales

Los más importados por el resto del código: un cambio aquí se propaga lejos. Casi todo pasa por el store, así que «tests que lo alcanzan» por imports no discrimina (la mayoría del motor alcanza casi todos los tests); la columna útil es **tests directos**, los que lo importan y lo prueban por su nombre.

| Módulo | Importado por (src) | Tests directos |
| --- | --- | --- |
| [types.ts](../src/engine/types.ts) | 149 | 93 |
| [store.ts](../src/store/store.ts) | 98 | 88 |
| [primitives.tsx](../src/components/ui/primitives.tsx) | 44 | 0 |
| [media.ts](../src/lib/media.ts) | 35 | 25 |
| [Popover.tsx](../src/components/ui/Popover.tsx) | 32 | 1 |
| [params.ts](../src/engine/params.ts) | 30 | 17 |
| [actions.ts](../src/engine/design/actions.ts) | 28 | 11 |
| [ops.ts](../src/engine/ops.ts) | 27 | 10 |
| [doc.ts](../src/engine/design/doc.ts) | 25 | 20 |
| [format.ts](../src/lib/format.ts) | 23 | 1 |
| [catalog.ts](../src/engine/catalog.ts) | 22 | 10 |
| [raster.ts](../src/engine/design/raster.ts) | 22 | 5 |
| [types.ts](../src/engine/providers/types.ts) | 21 | 6 |
| [id.ts](../src/lib/id.ts) | 21 | 0 |
| [actions.ts](../src/engine/actions.ts) | 18 | 9 |
| [idb.ts](../src/lib/idb.ts) | 17 | 106 |
| [render.ts](../src/engine/design/render.ts) | 16 | 3 |
| [http.ts](../src/lib/http.ts) | 15 | 4 |
| [AssetMedia.tsx](../src/components/ui/AssetMedia.tsx) | 12 | 0 |
| [history.ts](../src/engine/design/history.ts) | 12 | 5 |

## Por área

| Área | Archivos | Tests que la importan directamente |
| --- | --- | --- |
| `src` | 2 | 0 |
| `src/components/assets` | 10 | 2 |
| `src/components/chat` | 9 | 3 |
| `src/components/composer` | 10 | 4 |
| `src/components/designer` | 23 | 3 |
| `src/components/gallery` | 1 | 0 |
| `src/components/node` | 4 | 0 |
| `src/components/shell` | 12 | 1 |
| `src/components/ui` | 12 | 1 |
| `src/engine` | 30 | 119 |
| `src/engine/agent` | 19 | 54 |
| `src/engine/design` | 48 | 41 |
| `src/engine/flow` | 10 | 11 |
| `src/engine/fx` | 7 | 4 |
| `src/engine/guides` | 1 | 1 |
| `src/engine/providers` | 13 | 37 |
| `src/engine/skills` | 6 | 13 |
| `src/lib` | 17 | 115 |
| `src/store` | 2 | 89 |

97 de 236 módulos no tienen ningún test que los importe directamente.

## Sin ningún test que los alcance

- [App.tsx](../src/App.tsx)
- [Lightbox.tsx](../src/components/assets/Lightbox.tsx)
- [Model3DViewer.tsx](../src/components/assets/Model3DViewer.tsx)
- [SketchEditor.tsx](../src/components/assets/SketchEditor.tsx)
- [Viewer3DControls.tsx](../src/components/assets/Viewer3DControls.tsx)
- [viewer3d.ts](../src/components/assets/viewer3d.ts)
- [ChatWorkspace.tsx](../src/components/chat/ChatWorkspace.tsx)
- [CanvasSize.tsx](../src/components/designer/CanvasSize.tsx)
- [DesignerWorkspace.tsx](../src/components/designer/DesignerWorkspace.tsx)
- [DocumentPicker.tsx](../src/components/designer/DocumentPicker.tsx)
- [FxPanel.tsx](../src/components/designer/FxPanel.tsx)
- [LayerGeometry.tsx](../src/components/designer/LayerGeometry.tsx)
- [LayersPanel.tsx](../src/components/designer/LayersPanel.tsx)
- [ShapeKnots.tsx](../src/components/designer/ShapeKnots.tsx)
- [Stage.tsx](../src/components/designer/Stage.tsx)
- [TextEditor.tsx](../src/components/designer/TextEditor.tsx)
- [ToolPalette.tsx](../src/components/designer/ToolPalette.tsx)
- [GalleryPanel.tsx](../src/components/gallery/GalleryPanel.tsx)
- [CanvasNavigation.tsx](../src/components/node/CanvasNavigation.tsx)
- [NodeWorkspace.tsx](../src/components/node/NodeWorkspace.tsx)
- [Operations.tsx](../src/components/node/Operations.tsx)
- [nodes.tsx](../src/components/node/nodes.tsx)
- [GenerationsPanel.tsx](../src/components/shell/GenerationsPanel.tsx)
- [ProviderPool.tsx](../src/components/shell/ProviderPool.tsx)
- [SessionsPanel.tsx](../src/components/shell/SessionsPanel.tsx)
- [SidePanel.tsx](../src/components/shell/SidePanel.tsx)
- [Sidebar.tsx](../src/components/shell/Sidebar.tsx)
- [SpendingPanel.tsx](../src/components/shell/SpendingPanel.tsx)
- [TopBar.tsx](../src/components/shell/TopBar.tsx)
- [TraceControl.tsx](../src/components/shell/TraceControl.tsx)
- [WorkspaceMenu.tsx](../src/components/shell/WorkspaceMenu.tsx)
- [CanvasFilter.tsx](../src/components/ui/CanvasFilter.tsx)
- [ImportFromChat.tsx](../src/components/ui/ImportFromChat.tsx)
- [Toasts.tsx](../src/components/ui/Toasts.tsx)
- [TooltipLayer.tsx](../src/components/ui/TooltipLayer.tsx)
- [gradient.ts](../src/engine/design/gradient.ts)
- [useCursorPreview.ts](../src/engine/design/useCursorPreview.ts)
- [main.tsx](../src/main.tsx)

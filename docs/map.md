# Mapa del código

Generado por `node scripts/map.mjs --write` a partir de [map-contracts.mjs](../scripts/map-contracts.mjs) y de los imports. `npm test` falla si está desactualizado o si falta un ancla de un contrato. No editar a mano.

## Antes de cambiar código

1. Busca aquí el archivo que vas a tocar: los **contratos** dicen qué otro lugar debe seguir diciendo lo mismo; los **módulos centrales**, si el cambio se propaga lejos.
2. Al terminar cada cambio, `npm run test:related`: ejecuta solo los tests que alcanzan los archivos modificados.
3. Si cambias un lado de un contrato, cambia los otros en el mismo commit; si descubres uno nuevo, añádelo a `scripts/map-contracts.mjs`.
4. Antes de dar el trabajo por hecho, `npm test` completo.

## Contratos que el compilador no ve

| Contrato | Lugares | Tests |
| --- | --- | --- |
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
| **shortcuts** — Los atajos de teclado: el manejador, Ajustes → Shortcuts y el README leen la misma lista. | [shortcuts.ts](../src/engine/shortcuts.ts), [DesignerWorkspace.tsx](../src/components/designer/DesignerWorkspace.tsx), [SettingsPanel.tsx](../src/components/shell/SettingsPanel.tsx), [README.md](../README.md) | [readme-shortcuts.test.ts](../tests/readme-shortcuts.test.ts) |
| **sandbox** — El sandbox usa .sandbox/data y el puerto 5183; las salvaguardas comprueban ese aislamiento. | [dev-sandbox.mjs](../scripts/dev-sandbox.mjs), [check-safeguards.mjs](../scripts/check-safeguards.mjs) | [safeguards.test.ts](../tests/safeguards.test.ts) |
| **store-local-only** — El almacén /x/store solo responde al propio ordenador (también con --host); docs/seguridad.md lo afirma con su prueba. | [local-store.js](../server/local-store.js), [seguridad.md](../docs/seguridad.md), [README.md](../README.md) | [store-server.test.ts](../tests/store-server.test.ts) |
| **automated-writes** — El servidor rechaza escrituras automatizadas (cabecera X-OGS-Automated) fuera del sandbox. | [local-store.js](../server/local-store.js) | [automated-write.test.ts](../tests/automated-write.test.ts), [store-server.test.ts](../tests/store-server.test.ts) |

## Módulos centrales

Los más importados por el resto del código: un cambio aquí se propaga lejos. Casi todo pasa por el store, así que «tests que lo alcanzan» por imports no discrimina (la mayoría del motor alcanza casi todos los tests); la columna útil es **tests directos**, los que lo importan y lo prueban por su nombre.

| Módulo | Importado por (src) | Tests directos |
| --- | --- | --- |
| [types.ts](../src/engine/types.ts) | 130 | 85 |
| [store.ts](../src/store/store.ts) | 89 | 82 |
| [primitives.tsx](../src/components/ui/primitives.tsx) | 41 | 0 |
| [media.ts](../src/lib/media.ts) | 31 | 22 |
| [Popover.tsx](../src/components/ui/Popover.tsx) | 30 | 1 |
| [params.ts](../src/engine/params.ts) | 30 | 17 |
| [ops.ts](../src/engine/ops.ts) | 27 | 10 |
| [format.ts](../src/lib/format.ts) | 23 | 1 |
| [catalog.ts](../src/engine/catalog.ts) | 22 | 9 |
| [actions.ts](../src/engine/design/actions.ts) | 22 | 9 |
| [doc.ts](../src/engine/design/doc.ts) | 22 | 15 |
| [raster.ts](../src/engine/design/raster.ts) | 21 | 4 |
| [types.ts](../src/engine/providers/types.ts) | 20 | 4 |
| [id.ts](../src/lib/id.ts) | 19 | 0 |
| [actions.ts](../src/engine/actions.ts) | 18 | 9 |
| [idb.ts](../src/lib/idb.ts) | 15 | 97 |
| [http.ts](../src/lib/http.ts) | 14 | 4 |
| [render.ts](../src/engine/design/render.ts) | 13 | 2 |
| [AssetMedia.tsx](../src/components/ui/AssetMedia.tsx) | 12 | 0 |
| [history.ts](../src/engine/design/history.ts) | 12 | 3 |

## Por área

| Área | Archivos | Tests que la importan directamente |
| --- | --- | --- |
| `src` | 2 | 0 |
| `src/components/assets` | 10 | 2 |
| `src/components/chat` | 9 | 3 |
| `src/components/composer` | 10 | 4 |
| `src/components/designer` | 14 | 1 |
| `src/components/gallery` | 1 | 0 |
| `src/components/node` | 4 | 0 |
| `src/components/shell` | 10 | 0 |
| `src/components/ui` | 12 | 1 |
| `src/engine` | 27 | 108 |
| `src/engine/agent` | 17 | 52 |
| `src/engine/design` | 38 | 30 |
| `src/engine/flow` | 10 | 11 |
| `src/engine/guides` | 1 | 1 |
| `src/engine/providers` | 12 | 35 |
| `src/engine/skills` | 6 | 13 |
| `src/lib` | 15 | 103 |
| `src/store` | 1 | 82 |

83 de 199 módulos no tienen ningún test que los importe directamente.

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
- [LayerGeometry.tsx](../src/components/designer/LayerGeometry.tsx)
- [LayersPanel.tsx](../src/components/designer/LayersPanel.tsx)
- [Stage.tsx](../src/components/designer/Stage.tsx)
- [ToolPalette.tsx](../src/components/designer/ToolPalette.tsx)
- [GalleryPanel.tsx](../src/components/gallery/GalleryPanel.tsx)
- [CanvasNavigation.tsx](../src/components/node/CanvasNavigation.tsx)
- [NodeWorkspace.tsx](../src/components/node/NodeWorkspace.tsx)
- [Operations.tsx](../src/components/node/Operations.tsx)
- [nodes.tsx](../src/components/node/nodes.tsx)
- [DataSummary.tsx](../src/components/shell/DataSummary.tsx)
- [GenerationsPanel.tsx](../src/components/shell/GenerationsPanel.tsx)
- [ProviderPool.tsx](../src/components/shell/ProviderPool.tsx)
- [SessionsPanel.tsx](../src/components/shell/SessionsPanel.tsx)
- [SettingsPanel.tsx](../src/components/shell/SettingsPanel.tsx)
- [SidePanel.tsx](../src/components/shell/SidePanel.tsx)
- [Sidebar.tsx](../src/components/shell/Sidebar.tsx)
- [SpendingPanel.tsx](../src/components/shell/SpendingPanel.tsx)
- [TopBar.tsx](../src/components/shell/TopBar.tsx)
- [WorkspaceMenu.tsx](../src/components/shell/WorkspaceMenu.tsx)
- [CanvasFilter.tsx](../src/components/ui/CanvasFilter.tsx)
- [ImportFromChat.tsx](../src/components/ui/ImportFromChat.tsx)
- [Toasts.tsx](../src/components/ui/Toasts.tsx)
- [TooltipLayer.tsx](../src/components/ui/TooltipLayer.tsx)
- [gradient.ts](../src/engine/design/gradient.ts)
- [useCursorPreview.ts](../src/engine/design/useCursorPreview.ts)
- [main.tsx](../src/main.tsx)

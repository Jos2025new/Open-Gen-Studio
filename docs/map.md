# Mapa del código

Generado por `node scripts/map.mjs --write` desde [map-contracts.mjs](../scripts/map-contracts.mjs) e imports. `npm test` comprueba vigencia y anclas; no editar a mano.

## Antes de cambiar código

1. Busca archivo, **contratos** y **módulos centrales**.
2. Cada cambio: `npm run test:related`.
3. Actualiza juntos los lados del contrato; registra nuevos en `scripts/map-contracts.mjs`.
4. Al cerrar: `npm test`.
5. Para rendimiento, sigue el [protocolo](depuracion.md#protocolo); registra sondas en «Qué se mide hoy». `tests/trace-domains.test.ts` lo comprueba.

## Contratos que el compilador no ve

Las tablas de contratos [1](map-contracts.md) y [2](map-contracts-2.md) incluyen todos sus archivos, anclas y tests. Se generan y comprueban junto a este índice.

## Módulos centrales

Los más importados por el resto del código: un cambio aquí se propaga lejos. Casi todo pasa por el store, así que «tests que lo alcanzan» por imports no discrimina (la mayoría del motor alcanza casi todos los tests); la columna útil es **tests directos**, los que lo importan y lo prueban por su nombre.

| Módulo | Importado por (src) | Tests directos |
| --- | --- | --- |
| [types.ts](../src/engine/types.ts) | 204 | 133 |
| [store.ts](../src/store/store.ts) | 131 | 111 |
| [primitives.tsx](../src/components/ui/primitives.tsx) | 58 | 0 |
| [actions.ts](../src/engine/design/actions.ts) | 46 | 17 |
| [media.ts](../src/lib/media.ts) | 45 | 34 |
| [Popover.tsx](../src/components/ui/Popover.tsx) | 43 | 1 |
| [doc.ts](../src/engine/design/doc.ts) | 37 | 34 |
| [ops.ts](../src/engine/ops.ts) | 36 | 16 |
| [params.ts](../src/engine/params.ts) | 32 | 17 |
| [raster.ts](../src/engine/design/raster.ts) | 30 | 15 |
| [format.ts](../src/lib/format.ts) | 25 | 1 |
| [catalog.ts](../src/engine/catalog.ts) | 24 | 13 |
| [actions.ts](../src/engine/actions.ts) | 23 | 14 |
| [types.ts](../src/engine/providers/types.ts) | 22 | 6 |
| [id.ts](../src/lib/id.ts) | 22 | 0 |
| [objectSelection.ts](../src/engine/design/objectSelection.ts) | 19 | 5 |
| [render.ts](../src/engine/design/render.ts) | 19 | 6 |
| [matrix.ts](../src/engine/design/matrix.ts) | 17 | 3 |
| [idb.ts](../src/lib/idb.ts) | 17 | 138 |
| [AssetMedia.tsx](../src/components/ui/AssetMedia.tsx) | 16 | 0 |

## Por área

| Área | Archivos | Tests que la importan directamente |
| --- | --- | --- |
| `src` | 2 | 0 |
| `src/components/assets` | 11 | 3 |
| `src/components/chat` | 11 | 4 |
| `src/components/composer` | 10 | 5 |
| `src/components/designer` | 44 | 13 |
| `src/components/gallery` | 1 | 0 |
| `src/components/node` | 4 | 0 |
| `src/components/shell` | 20 | 7 |
| `src/components/space` | 9 | 4 |
| `src/components/studio` | 7 | 2 |
| `src/components/ui` | 13 | 1 |
| `src/engine` | 38 | 169 |
| `src/engine/agent` | 23 | 59 |
| `src/engine/design` | 89 | 91 |
| `src/engine/flow` | 10 | 11 |
| `src/engine/fx` | 8 | 8 |
| `src/engine/guides` | 1 | 1 |
| `src/engine/providers` | 13 | 43 |
| `src/engine/skills` | 6 | 13 |
| `src/lib` | 25 | 161 |
| `src/store` | 4 | 113 |

137 de 349 módulos no tienen ningún test que los importe directamente.

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
- [DrawingChoice.tsx](../src/components/designer/DrawingChoice.tsx)
- [FxPanel.tsx](../src/components/designer/FxPanel.tsx)
- [LayerGeometry.tsx](../src/components/designer/LayerGeometry.tsx)
- [LayersPanel.tsx](../src/components/designer/LayersPanel.tsx)
- [RasterLimitControls.tsx](../src/components/designer/RasterLimitControls.tsx)
- [ToolPalette.tsx](../src/components/designer/ToolPalette.tsx)
- [ProviderPool.tsx](../src/components/shell/ProviderPool.tsx)
- [SidePanel.tsx](../src/components/shell/SidePanel.tsx)
- [Sidebar.tsx](../src/components/shell/Sidebar.tsx)
- [SpendingPanel.tsx](../src/components/shell/SpendingPanel.tsx)
- [CreateSpace.tsx](../src/components/space/CreateSpace.tsx)
- [ToolsSpace.tsx](../src/components/space/ToolsSpace.tsx)
- [Toasts.tsx](../src/components/ui/Toasts.tsx)
- [TooltipLayer.tsx](../src/components/ui/TooltipLayer.tsx)
- [canvasPng.worker.ts](../src/lib/canvasPng.worker.ts)
- [designerBench.ts](../src/lib/designerBench.ts)
- [designerBenchProfessionalRun.ts](../src/lib/designerBenchProfessionalRun.ts)
- [main.tsx](../src/main.tsx)

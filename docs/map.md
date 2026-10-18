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
| [types.ts](../src/engine/types.ts) | 221 | 146 |
| [store.ts](../src/store/store.ts) | 144 | 128 |
| [primitives.tsx](../src/components/ui/primitives.tsx) | 64 | 0 |
| [actions.ts](../src/engine/design/actions.ts) | 47 | 18 |
| [Popover.tsx](../src/components/ui/Popover.tsx) | 46 | 1 |
| [media.ts](../src/lib/media.ts) | 45 | 35 |
| [doc.ts](../src/engine/design/doc.ts) | 38 | 34 |
| [ops.ts](../src/engine/ops.ts) | 36 | 16 |
| [params.ts](../src/engine/params.ts) | 34 | 17 |
| [raster.ts](../src/engine/design/raster.ts) | 30 | 15 |
| [actions.ts](../src/engine/actions.ts) | 27 | 16 |
| [catalog.ts](../src/engine/catalog.ts) | 27 | 15 |
| [format.ts](../src/lib/format.ts) | 26 | 1 |
| [types.ts](../src/engine/providers/types.ts) | 24 | 6 |
| [id.ts](../src/lib/id.ts) | 24 | 0 |
| [objectSelection.ts](../src/engine/design/objectSelection.ts) | 19 | 5 |
| [render.ts](../src/engine/design/render.ts) | 19 | 6 |
| [AssetMedia.tsx](../src/components/ui/AssetMedia.tsx) | 17 | 0 |
| [matrix.ts](../src/engine/design/matrix.ts) | 17 | 3 |
| [http.ts](../src/lib/http.ts) | 17 | 6 |

## Por área

| Área | Archivos | Tests que la importan directamente |
| --- | --- | --- |
| `src` | 2 | 0 |
| `src/components/assets` | 12 | 3 |
| `src/components/chat` | 19 | 9 |
| `src/components/composer` | 11 | 6 |
| `src/components/designer` | 44 | 13 |
| `src/components/gallery` | 1 | 0 |
| `src/components/node` | 5 | 0 |
| `src/components/shell` | 22 | 11 |
| `src/components/space` | 9 | 4 |
| `src/components/studio` | 8 | 2 |
| `src/components/ui` | 15 | 1 |
| `src/engine` | 47 | 188 |
| `src/engine/agent` | 29 | 70 |
| `src/engine/design` | 89 | 92 |
| `src/engine/flow` | 10 | 12 |
| `src/engine/fx` | 8 | 8 |
| `src/engine/guides` | 1 | 1 |
| `src/engine/providers` | 13 | 49 |
| `src/engine/skills` | 6 | 15 |
| `src/lib` | 26 | 183 |
| `src/store` | 5 | 130 |

144 de 382 módulos no tienen ningún test que los importe directamente.

## Sin ningún test que los alcance

- [App.tsx](../src/App.tsx)
- [Lightbox.tsx](../src/components/assets/Lightbox.tsx)
- [Model3DViewer.tsx](../src/components/assets/Model3DViewer.tsx)
- [SketchEditor.tsx](../src/components/assets/SketchEditor.tsx)
- [Viewer3DControls.tsx](../src/components/assets/Viewer3DControls.tsx)
- [viewer3d.ts](../src/components/assets/viewer3d.ts)
- [CanvasSize.tsx](../src/components/designer/CanvasSize.tsx)
- [DesignerWorkspace.tsx](../src/components/designer/DesignerWorkspace.tsx)
- [DrawingChoice.tsx](../src/components/designer/DrawingChoice.tsx)
- [FxPanel.tsx](../src/components/designer/FxPanel.tsx)
- [LayerGeometry.tsx](../src/components/designer/LayerGeometry.tsx)
- [LayersPanel.tsx](../src/components/designer/LayersPanel.tsx)
- [RasterLimitControls.tsx](../src/components/designer/RasterLimitControls.tsx)
- [ToolPalette.tsx](../src/components/designer/ToolPalette.tsx)
- [SidePanel.tsx](../src/components/shell/SidePanel.tsx)
- [SpendingPanel.tsx](../src/components/shell/SpendingPanel.tsx)
- [CreateSpace.tsx](../src/components/space/CreateSpace.tsx)
- [ToolsSpace.tsx](../src/components/space/ToolsSpace.tsx)
- [Toasts.tsx](../src/components/ui/Toasts.tsx)
- [TooltipLayer.tsx](../src/components/ui/TooltipLayer.tsx)
- [canvasPng.worker.ts](../src/lib/canvasPng.worker.ts)
- [designerBench.ts](../src/lib/designerBench.ts)
- [designerBenchProfessionalRun.ts](../src/lib/designerBenchProfessionalRun.ts)
- [main.tsx](../src/main.tsx)

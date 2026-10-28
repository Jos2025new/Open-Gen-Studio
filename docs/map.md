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
| [types.ts](../src/engine/types.ts) | 274 | 206 |
| [store.ts](../src/store/store.ts) | 183 | 185 |
| [primitives.tsx](../src/components/ui/primitives.tsx) | 77 | 0 |
| [actions.ts](../src/engine/design/actions.ts) | 50 | 25 |
| [Popover.tsx](../src/components/ui/Popover.tsx) | 48 | 3 |
| [media.ts](../src/lib/media.ts) | 48 | 40 |
| [catalog.ts](../src/engine/catalog.ts) | 44 | 22 |
| [ops.ts](../src/engine/ops.ts) | 41 | 16 |
| [index.ts](../src/engine/params/index.ts) | 41 | 21 |
| [doc.ts](../src/engine/design/doc.ts) | 38 | 45 |
| [raster.ts](../src/engine/design/raster.ts) | 33 | 23 |
| [format.ts](../src/lib/format.ts) | 31 | 1 |
| [id.ts](../src/lib/id.ts) | 29 | 0 |
| [actions.ts](../src/engine/actions.ts) | 28 | 20 |
| [types.ts](../src/engine/providers/types.ts) | 27 | 9 |
| [render.ts](../src/engine/design/render.ts) | 22 | 8 |
| [InlineControls.tsx](../src/components/designer/InlineControls.tsx) | 20 | 0 |
| [objectSelection.ts](../src/engine/design/objectSelection.ts) | 20 | 6 |
| [AssetMedia.tsx](../src/components/ui/AssetMedia.tsx) | 18 | 1 |
| [matrix.ts](../src/engine/design/matrix.ts) | 18 | 4 |

## Por área

| Área | Archivos | Tests que la importan directamente |
| --- | --- | --- |
| `src` | 2 | 0 |
| `src/components/assets` | 16 | 5 |
| `src/components/chat` | 22 | 16 |
| `src/components/composer` | 11 | 10 |
| `src/components/designer` | 52 | 23 |
| `src/components/gallery` | 1 | 2 |
| `src/components/node` | 8 | 4 |
| `src/components/shell` | 26 | 16 |
| `src/components/space` | 10 | 8 |
| `src/components/studio` | 8 | 3 |
| `src/components/ui` | 17 | 6 |
| `src/engine` | 59 | 257 |
| `src/engine/agent` | 53 | 104 |
| `src/engine/design` | 99 | 119 |
| `src/engine/flow` | 11 | 15 |
| `src/engine/fx` | 8 | 8 |
| `src/engine/guides` | 1 | 1 |
| `src/engine/params` | 9 | 21 |
| `src/engine/providers` | 15 | 59 |
| `src/engine/skills` | 7 | 16 |
| `src/lib` | 32 | 260 |
| `src/store` | 13 | 187 |

171 de 480 módulos no tienen ningún test que los importe directamente.

## Sin ningún test que los alcance

- [App.tsx](../src/App.tsx)
- [Lightbox.tsx](../src/components/assets/Lightbox.tsx)
- [Model3DViewer.tsx](../src/components/assets/Model3DViewer.tsx)
- [SketchEditor.tsx](../src/components/assets/SketchEditor.tsx)
- [Viewer3DControls.tsx](../src/components/assets/Viewer3DControls.tsx)
- [viewer3d.ts](../src/components/assets/viewer3d.ts)
- [DesignerWorkspace.tsx](../src/components/designer/DesignerWorkspace.tsx)
- [DrawingChoice.tsx](../src/components/designer/DrawingChoice.tsx)
- [FxPanel.tsx](../src/components/designer/FxPanel.tsx)
- [LayerGeometry.tsx](../src/components/designer/LayerGeometry.tsx)
- [LayerUnreadable.tsx](../src/components/designer/LayerUnreadable.tsx)
- [LayersPanel.tsx](../src/components/designer/LayersPanel.tsx)
- [RasterLimitControls.tsx](../src/components/designer/RasterLimitControls.tsx)
- [ToolPalette.tsx](../src/components/designer/ToolPalette.tsx)
- [SidePanel.tsx](../src/components/shell/SidePanel.tsx)
- [SpendingPanel.tsx](../src/components/shell/SpendingPanel.tsx)
- [CreateSpace.tsx](../src/components/space/CreateSpace.tsx)
- [ToolsSpace.tsx](../src/components/space/ToolsSpace.tsx)
- [Toasts.tsx](../src/components/ui/Toasts.tsx)
- [canvasPng.worker.ts](../src/lib/canvasPng.worker.ts)
- [designerBench.ts](../src/lib/designerBench.ts)
- [designerBenchProfessionalRun.ts](../src/lib/designerBenchProfessionalRun.ts)
- [main.tsx](../src/main.tsx)

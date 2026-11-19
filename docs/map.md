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
| [types.ts](../src/engine/types.ts) | 389 | 307 |
| [store.ts](../src/store/store.ts) | 265 | 301 |
| [icons.tsx](../src/components/ui/icons.tsx) | 147 | 1 |
| [primitives.tsx](../src/components/ui/primitives.tsx) | 105 | 0 |
| [actions.ts](../src/engine/design/actions.ts) | 75 | 46 |
| [Popover.tsx](../src/components/ui/Popover.tsx) | 65 | 5 |
| [media.ts](../src/lib/media.ts) | 58 | 50 |
| [objectSelection.ts](../src/engine/design/objectSelection.ts) | 50 | 23 |
| [id.ts](../src/lib/id.ts) | 50 | 0 |
| [catalog.ts](../src/engine/catalog.ts) | 48 | 25 |
| [doc.ts](../src/engine/design/doc.ts) | 47 | 72 |
| [ops.ts](../src/engine/ops.ts) | 47 | 19 |
| [index.ts](../src/engine/params/index.ts) | 43 | 21 |
| [raster.ts](../src/engine/design/raster.ts) | 40 | 29 |
| [format.ts](../src/lib/format.ts) | 38 | 1 |
| [actions.ts](../src/engine/actions.ts) | 37 | 29 |
| [InlineControls.tsx](../src/components/designer/InlineControls.tsx) | 36 | 0 |
| [render.ts](../src/engine/design/render.ts) | 31 | 10 |
| [graph.ts](../src/engine/flow/graph.ts) | 30 | 16 |
| [types.ts](../src/engine/providers/types.ts) | 30 | 9 |

## Por área

| Área | Archivos | Tests que la importan directamente |
| --- | --- | --- |
| `src` | 2 | 0 |
| `src/components/assets` | 17 | 9 |
| `src/components/chat` | 23 | 22 |
| `src/components/composer` | 15 | 15 |
| `src/components/designer` | 101 | 56 |
| `src/components/gallery` | 4 | 4 |
| `src/components/node` | 21 | 17 |
| `src/components/omni` | 7 | 4 |
| `src/components/shell` | 38 | 29 |
| `src/components/space` | 10 | 8 |
| `src/components/studio` | 8 | 4 |
| `src/components/ui` | 24 | 17 |
| `src/engine` | 69 | 371 |
| `src/engine/agent` | 62 | 135 |
| `src/engine/commands` | 7 | 20 |
| `src/engine/design` | 163 | 205 |
| `src/engine/flow` | 17 | 53 |
| `src/engine/fx` | 8 | 10 |
| `src/engine/guides` | 1 | 1 |
| `src/engine/nodecore` | 22 | 21 |
| `src/engine/nodes` | 6 | 24 |
| `src/engine/params` | 9 | 21 |
| `src/engine/providers` | 15 | 65 |
| `src/engine/skills` | 8 | 17 |
| `src/lib` | 35 | 398 |
| `src/store` | 18 | 303 |

233 de 710 módulos no tienen ningún test que los importe directamente.

## Sin ningún test que los alcance

- [App.tsx](../src/App.tsx)
- [DesignerWorkspace.tsx](../src/components/designer/DesignerWorkspace.tsx)
- [DrawingChoice.tsx](../src/components/designer/DrawingChoice.tsx)
- [FxPanel.tsx](../src/components/designer/FxPanel.tsx)
- [LayerGeometry.tsx](../src/components/designer/LayerGeometry.tsx)
- [LayerObjects.tsx](../src/components/designer/LayerObjects.tsx)
- [LayerUnreadable.tsx](../src/components/designer/LayerUnreadable.tsx)
- [LayersPanel.tsx](../src/components/designer/LayersPanel.tsx)
- [RasterLimitControls.tsx](../src/components/designer/RasterLimitControls.tsx)
- [OmniWorkspace.tsx](../src/components/omni/OmniWorkspace.tsx)
- [CreateSpace.tsx](../src/components/space/CreateSpace.tsx)
- [ToolsSpace.tsx](../src/components/space/ToolsSpace.tsx)
- [layer.commands.ts](../src/engine/design/layer.commands.ts)
- [generation.ts](../src/engine/nodecore/generation.ts)
- [asset.node.ts](../src/engine/nodecore/types/asset.node.ts)
- [audio.node.ts](../src/engine/nodecore/types/audio.node.ts)
- [image.node.ts](../src/engine/nodecore/types/image.node.ts)
- [model3d.node.ts](../src/engine/nodecore/types/model3d.node.ts)
- [ref.node.ts](../src/engine/nodecore/types/ref.node.ts)
- [text.node.ts](../src/engine/nodecore/types/text.node.ts)
- [tool.node.ts](../src/engine/nodecore/types/tool.node.ts)
- [video.node.ts](../src/engine/nodecore/types/video.node.ts)
- [commands.ts](../src/engine/nodes/commands.ts)
- [canvasPng.worker.ts](../src/lib/canvasPng.worker.ts)
- [designerBench.ts](../src/lib/designerBench.ts)
- [designerBenchProfessionalRun.ts](../src/lib/designerBenchProfessionalRun.ts)
- [main.tsx](../src/main.tsx)

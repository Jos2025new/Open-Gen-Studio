# Mapa del código

Generado por `node scripts/map.mjs --write` desde [map-contracts.mjs](../scripts/map-contracts.mjs) e imports. `npm test` comprueba vigencia y anclas; no editar a mano.

## Antes de cambiar código

1. Busca archivo, **contratos** y **módulos centrales**.
2. Cada cambio: `npm run test:related`.
3. Actualiza juntos los lados del contrato; registra nuevos en `scripts/map-contracts.mjs`.
4. Al cerrar: `npm test`.
5. Para rendimiento, sigue el [protocolo](depuracion.md#protocolo); registra sondas en «Qué se mide hoy». `tests/trace-domains.test.ts` lo comprueba.

## Contratos que el compilador no ve

Las tablas de contratos [1](map-contracts.md), [2](map-contracts-2.md) y [3](map-contracts-3.md) incluyen todos sus archivos, anclas y tests. Se generan y comprueban junto a este índice.

## Módulos centrales

Los más importados por el resto del código: un cambio aquí se propaga lejos. Casi todo pasa por el store, así que «tests que lo alcanzan» por imports no discrimina (la mayoría del motor alcanza casi todos los tests); la columna útil es **tests directos**, los que lo importan y lo prueban por su nombre.

| Módulo | Importado por (src) | Tests directos |
| --- | --- | --- |
| [types.ts](../src/engine/types.ts) | 489 | 429 |
| [store.ts](../src/store/store.ts) | 330 | 429 |
| [icons.tsx](../src/components/ui/icons.tsx) | 159 | 1 |
| [primitives.tsx](../src/components/ui/primitives.tsx) | 115 | 0 |
| [actions.ts](../src/engine/design/actions.ts) | 89 | 68 |
| [Popover.tsx](../src/components/ui/Popover.tsx) | 71 | 5 |
| [id.ts](../src/lib/id.ts) | 67 | 0 |
| [media.ts](../src/lib/media.ts) | 61 | 87 |
| [catalog.ts](../src/engine/catalog.ts) | 57 | 34 |
| [ops.ts](../src/engine/ops.ts) | 57 | 22 |
| [doc.ts](../src/engine/design/doc.ts) | 56 | 93 |
| [objectSelection.ts](../src/engine/design/objectSelection.ts) | 54 | 25 |
| [index.ts](../src/engine/params/index.ts) | 50 | 21 |
| [raster.ts](../src/engine/design/raster.ts) | 48 | 42 |
| [libraryTypes.ts](../src/engine/libraryTypes.ts) | 42 | 10 |
| [InlineControls.tsx](../src/components/designer/InlineControls.tsx) | 41 | 1 |
| [types.ts](../src/engine/providers/types.ts) | 39 | 10 |
| [format.ts](../src/lib/format.ts) | 39 | 1 |
| [actions.ts](../src/engine/actions.ts) | 38 | 42 |
| [render.ts](../src/engine/design/render.ts) | 36 | 13 |

## Por área

| Área | Archivos | Tests que la importan directamente |
| --- | --- | --- |
| `src` | 2 | 0 |
| `src/components/assets` | 17 | 11 |
| `src/components/chat` | 23 | 28 |
| `src/components/composer` | 16 | 19 |
| `src/components/designer` | 122 | 62 |
| `src/components/gallery` | 11 | 12 |
| `src/components/node` | 32 | 44 |
| `src/components/omni` | 7 | 5 |
| `src/components/shell` | 38 | 36 |
| `src/components/space` | 10 | 9 |
| `src/components/studio` | 8 | 7 |
| `src/components/ui` | 26 | 29 |
| `src/engine` | 105 | 509 |
| `src/engine/agent` | 71 | 187 |
| `src/engine/commands` | 7 | 53 |
| `src/engine/design` | 167 | 247 |
| `src/engine/flow` | 24 | 123 |
| `src/engine/fx` | 8 | 11 |
| `src/engine/guides` | 1 | 1 |
| `src/engine/money` | 4 | 12 |
| `src/engine/nodecore` | 23 | 59 |
| `src/engine/nodes` | 8 | 37 |
| `src/engine/params` | 9 | 21 |
| `src/engine/planSteps` | 19 | 3 |
| `src/engine/providers` | 15 | 99 |
| `src/engine/skills` | 8 | 17 |
| `src/lib` | 38 | 519 |
| `src/store` | 19 | 431 |

282 de 838 módulos no tienen ningún test que los importe directamente.

## Sin ningún test que los alcance

- [App.tsx](../src/App.tsx)
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
- [storeWiring.ts](../src/engine/storeWiring.ts)
- [canvasPng.worker.ts](../src/lib/canvasPng.worker.ts)
- [designerBench.ts](../src/lib/designerBench.ts)
- [designerBenchProfessionalRun.ts](../src/lib/designerBenchProfessionalRun.ts)
- [main.tsx](../src/main.tsx)

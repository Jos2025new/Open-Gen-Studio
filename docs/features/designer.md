# Designer

| Comportamiento documentado | Código | Test |
| --- | --- | --- |
| El raster guarda los últimos píxeles tras 700 ms; los fallos quedan pendientes y borrar espera la escritura. | [src/engine/design/raster.ts](../../src/engine/design/raster.ts) | [tests/raster-persist.test.ts](../../tests/raster-persist.test.ts) |
| La exportación SVG mantiene orden, opacidad y mezcla, omite capas ocultas y conserva texto editable escapado. | [src/engine/design/export.ts](../../src/engine/design/export.ts) | [tests/design-export.test.ts](../../tests/design-export.test.ts) |
| Save to gallery pide confirmación mediante un Popover de la app con Cancel y Save. | [src/components/designer/DesignerWorkspace.tsx](../../src/components/designer/DesignerWorkspace.tsx) | sin test |

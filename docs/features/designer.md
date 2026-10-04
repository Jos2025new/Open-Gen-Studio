# Designer

| Comportamiento documentado | Código | Test |
| --- | --- | --- |
| El raster guarda los últimos píxeles tras 700 ms; los fallos quedan pendientes y borrar espera la escritura. | [src/engine/design/raster.ts](../../src/engine/design/raster.ts) | [tests/raster-persist.test.ts](../../tests/raster-persist.test.ts) |
| La exportación SVG mantiene orden, opacidad y mezcla, omite capas ocultas y conserva texto editable escapado. | [src/engine/design/export.ts](../../src/engine/design/export.ts) | [tests/design-export.test.ts](../../tests/design-export.test.ts) |
| Save to gallery pide confirmación mediante un Popover de la app con Cancel y Save. | [src/components/designer/DesignerWorkspace.tsx](../../src/components/designer/DesignerWorkspace.tsx) | sin test |

## Monkey test manual
Arranca `npm run dev:sandbox` y ejecuta `npm run stress`; termina deteniendo el sandbox ([test](../../tests-e2e/designer-monkey.spec.ts)).
Usa `SEED=101 STEPS=300 npm run stress` para repetir acciones y coordenadas; el valor por defecto es 300 ([test](../../tests-e2e/designer-monkey.spec.ts)).
Solo acepta `http://localhost:5183`; el hook devuelve datos planos y solo existe en ese puerto ([store](../../src/store/store.ts), [test unitario](../../tests/raster-persist.test.ts)).
Comprueba ids, archivos raster mediante GET, selección, grupos y errores nuevos de consola ([test](../../tests-e2e/designer-monkey.spec.ts)).
Compara deshacer/rehacer y, cada 25 acciones, guardar/recargar tras las señales reales de guardado ([test](../../tests-e2e/designer-monkey.spec.ts)).
Ante un fallo se detiene y guarda los últimos 50 pasos, estado, captura y problemas en `tests-e2e/failures/<seed>-<paso>/` ([test](../../tests-e2e/designer-monkey.spec.ts)).
La comparación incluye selección e historial, aunque estos se mantienen en memoria y se reinician al recargar ([selección](../../src/engine/design/selection.ts), [historial](../../src/engine/design/history.ts), [test](../../tests-e2e/designer-monkey.spec.ts)).

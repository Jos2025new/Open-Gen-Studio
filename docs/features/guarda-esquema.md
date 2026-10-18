# Guarda de esquema derivado: nada pagado se envía sin esquema real

Cuando el proveedor no da el esquema de parámetros de un modelo, la app muestra un esquema «derivado» solo para mostrar. Con él no se envía ninguna petición de pago (2026-10-18, `task/gui-cohesion`; decisión [0021](../decisions/0021-esquema-derivado-sin-envio.md), historial [042](../history/042-2026-10-W42.md), sección 6).

| Comportamiento documentado | Código | Test |
| --- | --- | --- |
| Todo envío de pago pasa por `resolveSendable`: un esquema derivado recibe una segunda carga; si sigue derivado, se lanza `SchemaUnavailableError` y no sale nada ni se cobra. Cubre generación directa, reintento, paso de plan, operación (relight, editar), generación de nodos y vídeo. | [schemaGuard.ts](../../src/engine/schemaGuard.ts), [jobs.ts](../../src/engine/jobs.ts) | [schema-guard.test.ts](../../tests/schema-guard.test.ts) |
| Plan: un paso con esquema derivado se marca antes de mostrar precio, con «Not priced». | [schemaGuard.ts](../../src/engine/schemaGuard.ts), [plan.ts](../../src/engine/plan.ts) | [schema-guard.test.ts](../../tests/schema-guard.test.ts) |
| Nodos: la vista previa marca el mismo caso desde el catálogo ya cargado. | [schemaGuard.ts](../../src/engine/schemaGuard.ts), [flow/actions.ts](../../src/engine/flow/actions.ts) | [schema-guard.test.ts](../../tests/schema-guard.test.ts) |
| El esquema derivado no se guarda para siempre: cada `ensureSchema` vuelve a cargar el real, y las cargas simultáneas comparten una sola petición. Se guarda el error de carga. | [catalog.ts](../../src/engine/catalog.ts) | [schema-guard.test.ts](../../tests/schema-guard.test.ts) |
| Fallo de un paso: el agente recibe el modelo usado (nombre y ref), el proveedor, el origen del esquema y el error literal del proveedor. Sin generación, la frase corta de antes. | [failureContext.ts](../../src/engine/agent/failureContext.ts), [runtime.ts](../../src/engine/agent/runtime.ts) | [schema-guard.test.ts](../../tests/schema-guard.test.ts) |
| Errores de validación: `extractErrorMessage` conserva cada campo con su mensaje (hasta 5), y un objeto de error sin `message` se muestra como texto. | [http.ts](../../src/lib/http.ts) | [schema-guard.test.ts](../../tests/schema-guard.test.ts) |

## Límites

- Búsqueda de modelos y `confirm_settings` no marcan los modelos derivados; sin test. Pendiente en [pendientes-gui.md](../pendientes-gui.md).
- Un modelo cuyo esquema nunca carga no se puede enviar, y su plan no se puede aprobar. A cambio, no se paga una petición incompleta. La nota del compositor ofrece Reintentar.
- La guarda no verifica el contrato real de cada proveedor; solo impide enviar con el esquema derivado.
- Sin prueba con un proveedor real: la evidencia son pruebas con proveedor simulado.

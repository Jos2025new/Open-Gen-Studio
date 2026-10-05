# Decisión de revisión de precio y contexto del agente

| Comportamiento documentado | Código | Test |
| --- | --- | --- |
| Continuar o Cancelar conserva decisión, instante, generación, modelo y estimación anteriores/nuevos, y motivo en decisions de la revisión existente del paso. Otra revisión conserva las decisiones anteriores. | [priceNotes.ts](../../src/engine/agent/priceNotes.ts), [runtime.ts](../../src/engine/agent/runtime.ts), [priceAuthorization.ts](../../src/engine/priceAuthorization.ts) | [price-agent-notes.test.ts](../../tests/price-agent-notes.test.ts), [price-approval.test.ts](../../tests/journeys/price-approval.test.ts) |
| Las notas se vacían antes de cada chat, incluidas continuaciones: se añaden mensajes user con prefijo app al final del historial y se vacía la cola en una actualización persistida. No se insertan entre llamadas de herramientas y sus respuestas. | [priceNotes.ts](../../src/engine/agent/priceNotes.ts), [runtime.ts](../../src/engine/agent/runtime.ts), [context.ts](../../src/engine/agent/context.ts) | [price-agent-notes.test.ts](../../tests/price-agent-notes.test.ts) |
| La cancelación conserva canceledSteps y no transmite la generación; el bloqueo funciona después de consumir el aviso. | [runtime.ts](../../src/engine/agent/runtime.ts), [executor.ts](../../src/engine/executor.ts) | [price-agent-notes.test.ts](../../tests/price-agent-notes.test.ts), [price-approval.test.ts](../../tests/journeys/price-approval.test.ts) |
| Un resultado terminal añade otro aviso, una vez. Solo providerReportedUsd alimenta el coste informado: nunca la autorización, el catálogo ni la cotización. Un nuevo intento limpia el coste informado del intento anterior. | [jobs.ts](../../src/engine/jobs.ts), [priceNotes.ts](../../src/engine/agent/priceNotes.ts) | [price-agent-notes.test.ts](../../tests/price-agent-notes.test.ts) |
| Decisión pendiente y aviso ya entregado sobreviven a la rehidratación; el marcador de resultado impide repetirlo al reconciliar. | [priceNotes.ts](../../src/engine/agent/priceNotes.ts), [runtime.ts](../../src/engine/agent/runtime.ts) | [price-agent-notes.test.ts](../../tests/price-agent-notes.test.ts) |
| El prefijo serializado se conserva en continuaciones, también con el aviso de prisa de 50 s. Ese aviso se conserva una vez por turno y expresa su vigencia hasta la próxima petición del usuario. El system permanece igual. | [runtime.ts](../../src/engine/agent/runtime.ts) | [price-agent-notes.test.ts](../../tests/price-agent-notes.test.ts) |
| El cambio no añade llamadas LLM, cotizaciones, esperas ni cache_control. Se conserva el resumen final ya existente. | [runtime.ts](../../src/engine/agent/runtime.ts), [priceNotes.ts](../../src/engine/agent/priceNotes.ts) | [price-agent-notes.test.ts](../../tests/price-agent-notes.test.ts), [plan-wrapup.test.ts](../../tests/plan-wrapup.test.ts), [price-approval.test.ts](../../tests/journeys/price-approval.test.ts) |

Ejemplo de decisión:

```text
[app] Plan P, paso s1: antes $0.20 → ahora $1.20 (motivo: cambió el modelo).
Decisión: Continuar. Autorizado: $1.20 estimados. Estado: pendiente.
```

Al cancelar, la segunda línea es `Decisión: Cancelar. No enviado. No reintentar.`
Al terminar se añade otro mensaje: `Estado: terminado` o `Estado: fallido`, más
`coste informado por el proveedor: $X` o `coste real desconocido`.
Las cifras de proveedor conservan su precisión numérica, incluso por debajo de un centavo.
El motivo del aviso es breve; el registro conserva el motivo completo y los parámetros.

**Autorizado ≠ cobrado.** La autorización expresa una estimación aceptada, no una
factura ni un máximo contractual del proveedor. actualUsd conserva la contabilidad
existente, que puede usar una cotización de Atlas. providerReportedUsd se registra
solo desde el resultado del adaptador. Si una llamada de un lote no informa coste,
el coste total informado es desconocido. No se reconstruye para generaciones antiguas.
Un importe informado por el proveedor tampoco sustituye una conciliación de factura.

La caché depende del proveedor y de su ruta. Conservar el prefijo facilita la caché
implícita; no demuestra un hit ni garantiza latencia o cuota. No se añaden controles
explícitos. Las políticas existentes de imágenes/guías en nuevas peticiones, y la
edición o borrado deliberados del historial, siguen vigentes: la prueba de prefijo
cubre continuaciones del turno, no promete invariancia de cualquier edición histórica.

Los avisos esperan la siguiente llamada existente cuando el agente está ocupado,
offline o no corresponde el resumen final. No despiertan al LLM ni reejecutan pasos.
La conciliación tras recarga no envía generaciones nuevas. Las pruebas simulan
proveedores y persistencia; no prueban facturación, interfaz visual ni rendimiento real.

# Plan de remediación auditado — Open Gen Studio

**Auditor: GPT 6 ASTRA · Fecha: 2026-09-24**

**Estado:** propuesta basada en inspección estática del código; no implementada.

**Origen:** `REMEDIATION_PLAN.md`, conservado sin cambios. No se ejecutaron pruebas ni navegador durante la auditoría; pérdida al cerrar y consumo de memoria requieren reproducción.

## Orden de ejecución

1. **Persistencia raster — prioridad alta.** `src/engine/design/raster.ts` retrasa el guardado 700 ms y silencia errores. Definir seguimiento de cambios pendientes, confirmación de persistencia y aviso de fallos; revisar orden de escrituras y recuperación de buffers ausentes. Comparar memoria con IndexedDB después de recargar no recupera datos nunca guardados. **Aceptación:** probar recarga tras guardado confirmado, cierre con cambios pendientes, fallo de almacenamiento y ediciones rápidas; documentar el límite ante cierre abrupto. Riesgo medio, esfuerzo por precisar.

2. **Límite de pasos — cambio pequeño.** Compartir el límite predeterminado de 16 entre `src/engine/plan.ts` y los esquemas JSON/Zod de `src/engine/agent/tools.ts` (actualmente 16/16/24). Conservar `ctx.maxSteps`. `executor.ts` no contiene ese límite. **Aceptación:** comprobar los bordes 16/17 y la configuración explícita del validador.
   **Hecho (486d890 + test de bordes):** `MAX_PLAN_STEPS` en `plan.ts`; `ctx.maxSteps` conservado; test 16/17 y `maxSteps` explícito.

3. **Operaciones del agente — reutilización.** Consumir `OP_IDS`, ya exportado por `src/engine/ops.ts`, en lugar de duplicar identificadores. Derivar la descripción de parámetros de `OPS` solo preservando opciones y reglas útiles del contexto. **Aceptación:** mismas operaciones disponibles y parámetros descritos coherentes con sus definiciones. Cambiar instrucciones del agente requiere revisar su comportamiento; no es enteramente mecánico.
   **Hecho (486d890):** `tools.ts` usa `OP_IDS`; las líneas de ops del system prompt se generan desde `OPS` (campos, opciones, entrada → salida y descripción). Pendiente: observar el agente con un LLM real.

4. **Memoria del historial — medir antes de implementar.** `src/engine/design/history.ts` limita el historial previo a 40 entradas; borrar un documento llama a `dropHistory`. Los snapshots retienen canvases por referencia y las ediciones raster crean copias: un buffer RGBA de 2048×2048 representa aproximadamente 16 MiB de píxeles. Medir buffers únicos retenidos en undo/redo y varios documentos; decidir después presupuesto y descarte. **Aceptación:** evidencia de memoria y funcionamiento de undo/redo tras aplicar cualquier límite. No están demostrados los 50 KB por snapshot ni una fuga tras 1–2 horas.

5. **Proveedores — opcional.** Consolidar metadatos duplicados aprovechando `ADAPTERS` y el registro existente. Separar metadatos estáticos de claves y estado de conexión; revisar dependencias antes de derivar tipos desde el registro. **Aceptación:** conservar selección, catálogos y configuración persistida de cada proveedor. Prioridad posterior a integridad y medición.

## Correcciones al plan original

- **Assets huérfanos:** retirar el bloqueo de render/export por ausencia de `sourceAssetId`. `placeAsset` copia los píxeles al buffer de la capa y `drawLayer` usa ese buffer; borrar el original no implica perder la capa. Investigar buffers ausentes dentro del punto 1.
- **Generaciones:** no añadir un reset genérico de cinco minutos. Los estados son `running/queued`, no `executing`; `resumeInterrupted()` ya reanuda trabajos remotos o marca interrupciones, y la ejecución captura errores. Ampliar recuperación solo tras reproducir un caso no cubierto, conservando la identidad del trabajo remoto y evitando reenvíos automáticos.
- **Inicialización:** documentar la doble llamada si hace falta. `loadCatalogs()` puede cambiar el modelo seleccionado; `ensureSchema()` reutiliza caché y solicitudes en curso. No se justifica fusionarlas por duplicación aparente.

## Verificación al implementar

- Una tarea y un commit por cambio; actualizar `PROGRESS.md` con resultados reales.
- Ejecutar `npx tsc --noEmit -p .`, `npm test` y verificar el flujo afectado en navegador (`npm run dev`, puerto 5173).
- Añadir pruebas de comportamiento donde corresponda. Separar comprobaciones estáticas de reproducciones en navegador; no declarar riesgo nulo ni ausencia de cambios de comportamiento de antemano.
- Estimar tiempos después de reproducir los problemas pendientes; no adoptar el calendario de tres semanas ni los totales originales como estimaciones auditadas.

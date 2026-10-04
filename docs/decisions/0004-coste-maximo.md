# 0004 — Aprobar un coste máximo antes de usar proveedores de pago

## Estado

Aceptado

## Fecha

2026-10-04

## Contexto

La app calcula estimaciones y cotizaciones mediante [costs.ts](../../src/engine/costs.ts) y [quotes.ts](../../src/engine/quotes.ts). El panel [SpendConfirm.tsx](../../src/components/ui/SpendConfirm.tsx) también contempla costes aproximados, mínimos y desconocidos: una estimación no demuestra por sí sola un máximo.

## Decisión

Antes de una operación de pago, presentar un coste máximo, proveedor, modelo y alcance, y obtener aprobación explícita. Si no se puede acotar el máximo, detener el envío hasta resolverlo. Cambiar materialmente el coste o la selección requiere nueva aprobación. Esta es una regla operativa; no se afirma que todos los flujos actuales la impongan automáticamente.

## Alternativas

Usar una estimación como máximo oculta la incertidumbre. Aprobar solo después del envío no limita el gasto ya realizado. Ejecutar primero para medir el precio crea un gasto sin aprobación.

## Consecuencias

La aprobación queda ligada a una petición concreta. Las cotizaciones fallidas deben mantenerse como estimaciones, según [quotes.test.ts](../../tests/quotes.test.ts). El cálculo del gasto tiene cobertura en [spending.test.ts](../../tests/spending.test.ts); la aplicación universal de esta regla operativa está sin test.

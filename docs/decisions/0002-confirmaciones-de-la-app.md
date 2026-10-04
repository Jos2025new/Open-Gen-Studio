# 0002 — No usar confirm() nativo

## Estado

Aceptado

## Fecha

2026-10-04

## Contexto

La confirmación de Save to gallery se sustituyó por un panel contextual de la app el 2026-10-02. La implementación está en [DesignerWorkspace.tsx](../../src/components/designer/DesignerWorkspace.tsx).

## Decisión

Usar confirmaciones de la app, con acción concreta y opciones de cancelar y continuar. Para Save to gallery, conservar el [Popover](../../src/components/designer/DesignerWorkspace.tsx) con Cancel y Save. No usar window.confirm() ni confirm() nativo para acciones del producto.

## Alternativas

El diálogo nativo bloquea la interacción y queda fuera de la presentación de la app. Ejecutar sin confirmación elimina la elección del usuario. Se conserva la confirmación contextual.

## Consecuencias

La confirmación puede expresar qué se guardará y debe conservar una salida de cancelación. Este flujo visual está sin test directo. La protección beforeunload ante píxeles pendientes es un mecanismo distinto y no se elimina; cobertura en [raster-persist.test.ts](../../tests/raster-persist.test.ts).

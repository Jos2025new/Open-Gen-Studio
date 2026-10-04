# 0001 — Proteger los datos tras el incidente del 2026-10-03

## Estado

Aceptado

## Fecha

2026-10-04

## Contexto

El 2026-10-03 se reportó que abrir la app real desde un perfil automatizado sobrescribió 23 sesiones. El caso de una pestaña con estado antiguo está reproducido en [state-conflict.test.ts](../../tests/state-conflict.test.ts). No se inspeccionaron datos reales para redactar este registro.

## Decisión

No escribir ni experimentar sobre data/ real. Conservar la serialización, la comprobación baseAt, las copias y el rechazo de pérdidas masivas de [local-store.js](../../server/local-store.js). Marcar las escrituras automatizadas y rechazarlas antes de leer el cuerpo; cobertura en [store-server.test.ts](../../tests/store-server.test.ts) y [automated-write.test.ts](../../tests/automated-write.test.ts).

## Alternativas

Confiar solo en la fecha del guardado permitiría que una pestaña antigua con reloj reciente reemplazase datos. Confiar solo en una advertencia al agente dejaría la protección fuera del código. Ninguna alternativa protege el caso reportado.

## Consecuencias

Las pestañas obsoletas reciben conflicto y las escrituras automatizadas reciben 403. Las copias y los intentos rechazados pueden contener información privada. Los umbrales de pérdida y las copias periódicas tienen código, pero sin test directo dedicado en la suite actual.

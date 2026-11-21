# 071 · Revisión SOLID, KISS y YAGNI (sesión maestra, 2026-11-20)

Rama `task/solid-int`, fusionada en `main` con el sí del usuario. Evidencia, no estado actual.

## Qué se hizo
- **Revisión de Opus 5.5:** 14 hallazgos. Informe en `bus/20261120-opus-solid.md`, fuera del repo.
- **Tandas de trabajo:** A, B, C, D, E, F, G, H e I. Cada hallazgo se confirmó, se reprodujo con un test o check que falla con el código anterior y se reparó.
  1. Tope de referencias: `refsLimit`.
  2. Precio y modelo de las operaciones: `opChoice` y `opSpecForModel`.
  3. Variante con imagen: `sentModelRef`.
  4. `jobs.ts` dividido en `opSpec`, `jobRecovery`, `jobState`, `assetIO`, `localOps`, `specialSends` y `sendInputs`.
  5. Tablas por tipo de paso en `src/engine/planSteps/`, vigiladas por `tests/step-kind-tables.test.ts`.
  6. Red de gasto al enviar (`assertWithinLimit`).
  7. «No preguntar»: hoja pura `noAsk.ts`.
  8. Ganchos del proveedor en `ProviderAdapter` (`quote`, `serialKey`, `retry`) y `quotes.ts` neutro.
  9. `isVideoOpEngine` y `OpVideoControls`.
  10. `cachedJson` y `peekCached`.
  11. El store ya no importa el dominio: ganchos en `storeBindings.ts` registrados desde `storeWiring.ts`.
  12. `idb.ts` separa `cacheDb.ts` y `assetUrls.ts`.
  13. Registro de herramientas de Designer: `Stage.tsx` pasa de 75 a 10 KB.
  14. Código muerto, vigilado por `check-dead-exports`.
- **#6, decisión del usuario del 2026-10-29:** con un límite activo, un precio desconocido pregunta. Al aplicarla aparecieron entradas que enviaban sin pase y se arreglaron:
  - crear desde Spaces;
  - Nodes con varios pasos (pase por lote);
  - `SketchEditor` y «Mejorar plano» en un Space (`opSessionId`).
- **Checks nuevos:** `check-engine-structure`, con estas reglas:
  - límites del store, de reuse y del almacenamiento de proveedores;
  - motor neutral respecto a los proveedores;
  - ciclos de import (SCC) con un baseline por arista;
  - un único punto de elección de modelo.

  Además, `check-dead-exports` cubre ahora `export { … } from`.
- **Interfaz:** «Polygon» y «Star» ya no se solapan en `InlineChoice`. El color principal por defecto sigue siendo blanco, por decisión del usuario.
- **Persistencia protegida:** con autorización explícita para #11, #12, reuse y los fixtures de writer-lock. Las filas están en `docs/persistencia-protegida.md`.

## Revisiones
- **Neon:** calificó cada tanda, revisó los restos y dio la nota final de 13/14. Lo que quedaba se cerró en la tanda I.
- **Hydrogen:** revisó la tanda I, fusionable y sin hallazgos.
- **Haiku:** prueba visual en el sandbox. Designer está bien. Las confirmaciones de gasto no se pudieron ver en pantalla por falta de claves y de assets; solo las cubren los tests.

## Tests
`npm test`: 4633 en verde. Falla solo `pdf-look` («300 groups»), una prueba de tiempo con la RAM al límite: 3,3 s frente a un tope de 3 s. Sola pasa 29/29.

## Pendiente, en orden (próxima sesión maestra; sustituye a la lista de 070)

1. **Arrastre a menos de 3 fps con 200 nodos.** Es crítico y ya existía. Hay que medirlo con la sonda y arreglarlo. Neon señaló cálculos O(n) en `CanvasNavigation` y `NodeSide`.
2. **Check permanente** que impida cálculos pesados del lienzo en cada arrastre.
3. **Las revisiones de Neon corren la suite de su área**, no solo los tests tocados. Se escribe en sus encargos.
4. **Descriptor:** completar frescura, selección e interfaz, y ajustar su contrato antes del subnet (`env`, `sourceHandle`, `PlanStep[]`, `DefaultsEnv`).
5. **Envolver los componentes y el subnet.**
6. **Prueba del usuario con una clave real**, y paso de la app real a `main`.
7. **Registro durable de envíos** en `jobs.ts`.
8. **Agentes de suscripción** (baja prioridad).

Sin comprobar de esta sesión:
- Ver en pantalla, con claves, las confirmaciones de gasto: Nodes con 2 pasos, `SketchEditor` y «Mejorar plano» en un Space.
- Que el clic en «Star» cambie de modo (Haiku no lo consiguió).
- El indicador «!1» del omnicanvas.
- La prueba de tiempo de `pdf-look`, que depende de la carga de la máquina.

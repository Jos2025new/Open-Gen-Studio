# Persistencia protegida

Vigente desde 2026-10-18 ([propuesta](propuesta-zonas-protegidas.md)). Regla 5 de AGENTS.md: antes de modificar estos archivos o sus tests, obtener autorización explícita para ese cambio; conservar sus contratos y aportar pruebas y revisión independiente.

El guardado protegido ([ADR 0022](decisions/0022-guardado-local-first-sin-bloqueo.md), [arquitectura](arquitectura-guardado.md)) pasó cuatro revisiones externas. No se toca salvo por un bug evidente o por la fase 2 o 3.

## Archivos

- Servidor: `server/save-guard.js`, `server/store-v2.js` y el cuerpo del 409 en `server/local-store.js`.
- Cliente: `src/lib/idb.ts`, `disk.ts`, `saveGuard.ts` y `writerLock.ts`; en `src/store/`, `writerHandoff.ts`, `saveRecovery.ts`, `saveReport.ts` y `saveStatus.ts`.
- Solo estas funciones de dos archivos más grandes: `flushWrite` y `saveNow` de `src/store/store.ts`; `writeLayer`, `flushRaster` y `deleteBuffers` de `src/engine/design/raster.ts`.

## Tests

`scripts/check-protected.mjs`, que corre dentro de `npm test`, falla si falta uno de estos archivos, si este documento deja de enlazarlo o si alguno de sus tests se marca con `skip`, `only` o `todo`. No detecta casos borrados dentro de un archivo ni aserciones debilitadas: eso lo frena la revisión.

| Test | Qué demuestra |
|---|---|
| [save-guard-review](../tests/save-guard-review.test.ts) | Los hallazgos de la revisión 1 y la reversión con envíos en cola |
| [save-guard-server](../tests/save-guard-server.test.ts) | Regla de pérdida, `baseAt`, rechazo completo, «Mantener», borrado masivo |
| [save-guard-client](../tests/save-guard-client.test.ts) | Revisiones pendientes, rebase, arranque con `pending` |
| [save-guard-banner](../tests/save-guard-banner.test.ts) | El aviso y sus tres salidas |
| [save-now](../tests/save-now.test.ts) | Un `ok` tardío no oculta un fallo local |
| [raster-persist](../tests/raster-persist.test.ts) | Píxeles: fallo local, capa borrada, carrera del borrado |
| [writer-lock](../tests/writer-lock.test.ts), [writer-lock-handoff](../tests/writer-lock-handoff.test.ts), [writer-lock-panel](../tests/writer-lock-panel.test.ts), [writer-lock-raster](../tests/writer-lock-raster.test.ts) | Una pestaña activa, traspaso seguro, sin `steal` |
| [prompt-history-wipe](../tests/prompt-history-wipe.test.ts) | Borrar todos los datos incluye `ogs-prompts`, también con una conexión abierta hasta recargar |
| [state-conflict](../tests/state-conflict.test.ts), [state-copies](../tests/state-copies.test.ts) | Conflictos y copias al arrancar |

## Revisiones

| Revisión | Sobre | Hallazgos | Corrección |
|---|---|---|---|
| Astra | `90eebc8` | 6 | `7d153fd` |
| GPT | `7d153fd` | 3 | `bb58598` |
| GPT | `bb58598` | 1 | `9f11649` |
| GPT | `9f11649` | 0; sugiere un test de la carrera del borrado | `71b9636` |
| Spaces, 2026-10-19 (revisión independiente local) | Solo añadir `ogs-prompts` a `ALL_DB_NAMES` en `idb.ts`, autorización explícita del usuario | Ampliar el test al borrado bloqueado por una conexión abierta | Test ampliado: cierra la conexión, espera el borrado y reabre sin la clave; test de borrado bloqueado y revisión independiente |

El detalle está en [043](history/043-2026-10-W42.md). Cada cambio futuro añade una fila.

## Evidencia según el tipo de cambio

- **Bug:** una reproducción que falle antes del arreglo y pase después.
- **Fase 2 o 3:** tests de los contratos nuevos, los anteriores conservados y una revisión independiente.
- **Cambio en estos tests:** se revisa junto con el código.

## Fase 2: dirección propuesta

SQLite sustituiría los JSON del servidor, con sesiones, orden, globales y revisión en una sola transacción. Se conservan `baseAt`, las comprobaciones de pérdida y las copias. Los archivos multimedia siguen fuera. Antes de sustituir nada hay que verificar la migración y la recuperación. Ver [la propuesta](propuesta-zonas-protegidas.md#dirección-propuesta-para-la-fase-2-sqlite).

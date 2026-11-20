# Persistencia protegida

Vigente desde 2026-10-18 ([propuesta](propuesta-zonas-protegidas.md)). Regla 5 de AGENTS.md: antes de modificar estos archivos o sus tests, obtener autorización explícita para ese cambio; conservar sus contratos y aportar pruebas y revisión independiente.

El guardado protegido ([ADR 0022](decisions/0022-guardado-local-first-sin-bloqueo.md), [arquitectura](arquitectura-guardado.md)) pasó cuatro revisiones externas. No se toca salvo por un bug evidente o por la fase 2 o 3.

## Archivos

- Servidor: `server/save-guard.js`, `server/store-v2.js` y el cuerpo del 409 en `server/local-store.js`.
- SQLite de la fase 1 y 2 (autorizado el 2026-11-15): [store-sqlite.js](../server/store-sqlite.js), [store-b.js](../server/sqlite/store-b.js), [store-b-helpers.js](../server/sqlite/store-b-helpers.js), [store-ba.js](../server/sqlite/store-ba.js), [delta-client.mjs](../server/sqlite/delta-client.mjs), [fractional-index.mjs](../server/sqlite/fractional-index.mjs) y [migrate.js](../server/sqlite/migrate.js). El spike solo reexporta estos archivos.
- Cliente: `src/lib/idb.ts`, `disk.ts`, `saveGuard.ts` y `writerLock.ts`; en `src/store/`, `writerHandoff.ts`, `saveRecovery.ts`, `saveReport.ts` y `saveStatus.ts`.
- Solo estas funciones de dos archivos más grandes: `flushWrite` y `saveNow` de `src/store/store.ts`; `writeLayer`, `flushRaster`, `deleteBuffers`, `schedulePersist`, `storeCanvas`, `beginEdit`, `restoreBuffers` y `ensureBuffers` de `src/engine/design/raster.ts` (las cinco últimas deciden si se guardan o se descartan píxeles: D30).

## Tests

`scripts/check-protected.mjs`, que corre dentro de `npm test`, falla si falta uno de estos archivos, si este documento deja de enlazarlo o si alguno de sus tests se marca con `skip`, `only` o `todo`. No detecta casos borrados dentro de un archivo ni aserciones debilitadas: eso lo frena la revisión.

| Test | Qué demuestra |
|---|---|
| [save-guard-review](../tests/save-guard-review.test.ts) | Los hallazgos de la revisión 1 y la reversión con envíos en cola |
| [save-guard-server](../tests/save-guard-server.test.ts) | Regla de pérdida, `baseAt`, rechazo completo, «Mantener», borrado masivo |
| [save-guard-client](../tests/save-guard-client.test.ts) | Revisiones pendientes, rebase, arranque con `pending` |
| [save-guard-banner](../tests/save-guard-banner.test.ts) | El aviso y sus tres salidas |
| [raster-unreadable](../tests/raster-unreadable.test.ts) | Píxeles ilegibles (D30): nunca se escriben encima, ninguna edición se guarda sobre ellos y la recuperación no descarta nada |
| [save-now](../tests/save-now.test.ts) | Un `ok` tardío no oculta un fallo local |
| [raster-persist](../tests/raster-persist.test.ts) | Píxeles: fallo local, capa borrada, carrera del borrado |
| [writer-lock](../tests/writer-lock.test.ts), [writer-lock-handoff](../tests/writer-lock-handoff.test.ts), [writer-lock-panel](../tests/writer-lock-panel.test.ts), [writer-lock-raster](../tests/writer-lock-raster.test.ts) | Una pestaña activa, traspaso seguro, sin `steal` |
| [prompt-history-wipe](../tests/prompt-history-wipe.test.ts) | Borrar todos los datos incluye `ogs-prompts`, también con una conexión abierta hasta recargar |
| [state-conflict](../tests/state-conflict.test.ts), [state-copies](../tests/state-copies.test.ts) | Conflictos y copias al arrancar |
| [store-sqlite](../tests/store-sqlite.test.ts), [store-sqlite-phases](../tests/store-sqlite-phases.test.ts), [store-sqlite-session-order](../tests/store-sqlite-session-order.test.ts) | Fases 1–4: el almacén SQLite, la migración verificada, el envío de cambios y orden de sesiones con índice fraccionario, las revisiones de assets y el diario de eventos |

## Revisiones

| Revisión | Sobre | Hallazgos | Corrección |
|---|---|---|---|
| Astra | `90eebc8` | 6 | `7d153fd` |
| GPT | `7d153fd` | 3 | `bb58598` |
| GPT | `bb58598` | 1 | `9f11649` |
| GPT | `9f11649` | 0; sugiere un test de la carrera del borrado | `71b9636` |
| Spaces, 2026-10-19 (revisión independiente: GPT, aprobado 2026-10-19, con IndexedDB simulada, sin navegador) | Solo añadir `ogs-prompts` a `ALL_DB_NAMES` en `idb.ts`, autorización explícita del usuario | Ampliar el test al borrado bloqueado por una conexión abierta | Test ampliado: cierra la conexión, espera el borrado y reabre sin la clave; test de borrado bloqueado y revisión independiente |
| D30, 2026-10-23 (`b72412e`, `b19b84a`, `b35dfd1`; autorización explícita del usuario el 2026-10-23, que llegó después de `b72412e` y `b19b84a`) | `schedulePersist` no escribe capas ilegibles; `ensureBuffers` las marca y las recupera; `storeCanvas`, `beginEdit` y `restoreBuffers` no guardan ediciones sobre ellas | Revisión independiente (Thermos, 2026-10-23, solo lectura, con IndexedDB simulada, sin navegador): aprobado, 0 hallazgos medios o mayores; nota menor: un aviso por trazo en una capa ilegible | Sin cambios |
| Claves, 2026-11-13 (autorización explícita del usuario solo para el manejo de claves: «Si, lo aprobaria. La copia y la migracion se puede hacer de una vez.») | `server/local-store.js` (rutas `/keys` y `/proxy`, migración al arrancar) y `server/keys.js` reescriben `state.json` y `store-v2/globals.json` solo para quitar `settings.keys`, tras una copia fechada (600); la página guarda un marcador en vez de la clave. No cambian `save-guard.js`, `store-v2.js`, `baseAt`, el 409 ni el rechazo de pérdidas. | Pendiente de la revisión independiente (Opus) | [historial 063](history/063-2026-11-W46-claves.md) |
| SOLID D, 2026-11-20 (autorización explícita para Opus #11, #12 y Neon A6) | `store.ts` extrae el merge y el gasto. `saveNow` conserva el `await` de la importación de raster a través del puente. `idb.ts` delega la caché de catálogo y las URLs de objeto, y mantiene las operaciones de estado y blobs. | Comparación contra `c86a05ab`, checks estructurales y tests protegidos existentes | Revisión independiente (Neon, 2026-11-20, `40de4841`, solo lectura): fusionable, 0 bloqueantes; contratos, orden asíncrono, borrado de `ogs-cache` y 17 tests protegidos intactos (22 suites, 170 tests). Dos menores corregidos: mock de `cacheDb` en `import-safety` y esta tabla |

El detalle está en [043](history/043-2026-10-W42.md). Cada cambio futuro añade una fila.

## Evidencia según el tipo de cambio

- **Bug:** una reproducción que falle antes del arreglo y pase después.
- **Fase 2 o 3:** tests de los contratos nuevos, los anteriores conservados y una revisión independiente.
- **Cambio en estos tests:** se revisa junto con el código.

## Fase 2: dirección propuesta

SQLite sustituiría los JSON del servidor, con sesiones, orden, globales y revisión en una sola transacción. Se conservan `baseAt`, las comprobaciones de pérdida y las copias. Los archivos multimedia siguen fuera. Antes de sustituir nada hay que verificar la migración y la recuperación. Ver [la propuesta](propuesta-zonas-protegidas.md#dirección-propuesta-para-la-fase-2-sqlite).
| SQLite, 2026-11-15/16 (autorización explícita del usuario: «TODAS LAS FASES») | `server/sqlite/`, `server/store-sqlite.js`, rutas de `local-store.js`, `disk.ts` (envío de cambios), biblioteca con revisiones; `save-guard.js` y el cuerpo del 409 sin cambios | Terra (fase 1, dos vueltas), Sonnet (fase 1), Terra (fases 1d-4) y Grok (arreglos, aprobada) | [historial 065](history/065-2026-11-W46-persistencia-sqlite.md) |
| C0 pagehide, 2026-11-17/18 (el usuario autorizó el arreglo y la fusión) | `src/lib/disk.ts`: tras `pagehide` solo se calla el aborto de red (`TypeError`); toda respuesta HTTP de error avisa; el 409 sigue en su flujo de conflicto | GPT 6 Luna (dos revisiones adversariales), Sonnet (arreglos) | `tests/adversarial-c0-pagehide.test.ts`, `tests/adversarial-disk-pagehide.test.ts`, `tests/disk-receipts.test.ts` |
| Agentes en paralelo, 2026-11-19 (autorización del usuario en la sesión, literal: «Autorizo tocar writerHandoff.ts») | Solo `src/store/writerHandoff.ts`: `busySessions` cuenta a la sesión como ocupada si cualquiera de sus hilos lo está (`allThreads`), y `abortAll` para a todos sus agentes con `stopSession` en vez de `stopAgent` de uno solo; `writerLock.ts`, el cuerpo del 409 y las demás zonas sin cambios | Contratos intactos; test [writer-handoff-agents](../tests/writer-handoff-agents.test.ts) | Revisiones adversariales de Neon: [hilos](nucleo-nodos/informe-neon-hilos.md) y [cierre](nucleo-nodos/informe-neon-cierre.md) (su punto 4, borrar con el traspaso pedido, se arregló en `agentAccepts`, fuera de esta zona); falta la revisión independiente final de `writerHandoff.ts` |
| writer-lock-panel, 2026-11-19 (autorización del usuario en la sesión maestra, literal: «Sí, autorizo») | Solo `tests/writer-lock-panel.test.ts`: el primer import en frío del grafo de módulos (~17 s con la máquina cargada) agotaba los 20 s del primer test; ahora se calienta en un `beforeAll` con plazo propio, `jobs` y `agent/runtime` se cargan solo en el test que los usa y el cambio de panel va dentro de `act()`; ninguna aserción cambia | Sin cambios de contrato (una pestaña activa, traspaso seguro, sin `steal`); 3 pasadas seguidas en verde | Pendiente de revisión independiente |
| SOLID G/H, 2026-11-20 (autorización del usuario en la sesión maestra, literal: «Sí, autorizo») | `tests/writer-lock-handoff.test.ts` y `tests/writer-lock-panel.test.ts`: el helper que crea la generación fija `budgetOn: false`, porque con el límite por defecto (25 USD) y un modelo sin precio la red de gasto de Opus #6 preguntaba antes de llegar al cerrojo. Las aserciones del traspaso no cambian. H cambia solo un import de `writerHandoff.ts` (`controllers` desde `jobState`) | 9/9 tests de las dos suites en verde | Pendiente: calificación final de Neon sobre `main...task/solid-int` |
| SOLID I, 2026-11-20 (autorización explícita del usuario para Opus #11 en esta tanda) | `src/store/store.ts` y `src/engine/storeBindings.ts`: inversión real de dependencias con `storeHooks` y `src/engine/storeWiring.ts` (cargado en `main.tsx`), sin re-exports estáticos de `design/` ni `flow/` y retiradas las 4 aristas de `engine-import-cycles-baseline.json`. `flushWrite` sin cambios; `saveNow` mantiene su lógica y el `await` de `storeHooks.loadRaster()` (con importación diferida de `design/raster` intacta). | 17/17 suites protegidas de la tabla en verde (134 tests), `check-engine-structure` y `check-protected` en verde | Pendiente de revisión independiente |

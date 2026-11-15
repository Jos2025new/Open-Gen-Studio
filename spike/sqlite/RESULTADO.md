# Spike SQLite para la persistencia (resultado)

Rama `task/sqlite-spike`. Solo archivos nuevos bajo `spike/sqlite/`. Ningún archivo existente se modificó. Sin data/, .sandbox/, navegador, app ni red. Datos en `/tmp/ogs-sqlite-spike-data`, borrados al final.

## Números (fixture: 50 sesiones, 40k generaciones, 40k gastos, 20k assets; globals 25,7 MB)

| Medida | store-v2 (actual) | store-sqlite (spike) |
|---|---|---|
| Importación inicial | 235 ms | 2.575 ms |
| Edición pequeña (1 sesión + UI), p50 / p95 | 69 / 177 ms | 1.390 / 2.663 ms |
| Guardado al final de gesto (sesión de 620 KB), p50 / p95 | 123 / 343 ms | 1.422 / 2.229 ms |
| Arranque: read() tras reabrir, p50 / p95 | 130 / 135 ms | 383 / 653 ms |
| Disco solo datos (tras ediciones) | 29,7 MB | 92,5 MB (db 49,4 + WAL 43,0) |
| Disco con copias de respaldo | 57,5 MB | 134,8 MB |
| WAL | n/a | 43 MB en la commit 100 y en la 200 (no crece más) |

Notas: 100 ediciones y 40 gestos; el WAL se midió solo hasta 200 commits (1000 serían ~25 min, fuera de un comando en primer plano). Tiempos in-process, `commit(body)` sin HTTP, caché de disco caliente.

## Crash test (kill -9 aleatorio, 100 ejecuciones por tienda)

| Tienda | OK | Vacío (muerto antes del 1.er commit) | Torn (HEAD y archivos de pasos distintos) | Commit reconocido perdido | Fallo de guardas |
|---|---|---|---|---|---|
| store-v2 (1.ª pasada) | 74 | 23 | 3 | 0 | 0 |
| store-v2 (2.ª pasada) | 78 | 16 | 6 | 0 | 0 |
| store-sqlite | 75 | 25 | 0 | 0 | 0 |

Cada ejecución compara `read()` con el estado exacto del paso indicado por HEAD (sesiones, globales y orden). Las guardas se prueban después: baseAt viejo -> 409, pérdida total -> 409, y ninguna negativa cambia el estado. Los 'torn' de store-v2 aparecen porque los archivos de sesión y globales se escriben antes que HEAD sin transacción.

## Tests

`npx vitest run spike/sqlite --maxWorkers=1` no encuentra nada: `vite.config.ts` solo incluye `tests/**`. Se usó `--config spike/sqlite/vitest.config.mts` (archivo nuevo). 11 pruebas OK: 409 por baseAt, rechazo por sesión y total con aprobación exacta, sesiones fuera del orden a `removed_sessions`, historial append-only (tombstone, filas viejas intactas, ventana de gastos), 400 por sesión ausente, y rollback ante fallo a mitad de commit.

## Qué queda demostrado

- Mismo contrato de `read()` / `commit(body)`: 409 por baseAt, guardas de pérdida (reutilizadas de `save-guard.js`) y rechazo sin escribir estado.
- Una transacción por commit: un fallo a mitad no deja estado a medias (test de rollback y 0 torn en 100 kills).
- Ninguna confirmación reconocida se pierde en 200 kills (100 por tienda, 0 casos).
- store-v2 no hace fsync y escribe en tres pasos; sus 'torn' son reales, no teóricos.

## Qué NO queda demostrado

- Que sea "no más lenta": **no se cumple**. Edición pequeña ~20 veces más lenta; arranque ~3 veces más lento.
- El WAL a 1000 commits (solo 200).
- Migración real desde format 2 (no hay importador, solo commit completo).
- Copias de respaldo equivalentes: VACUUM INTO cada 10 min, no probado en uso.
- Rendimiento con datos reales (fixture sintético).

## Causa probable de la lentitud (no optimizada)

Cada commit hace JSON.parse de los 25 MB de globals, hashea 40k generaciones, lee gen_head completo y reescribe el blob de globals en una fila. Además SQLite con synchronous=FULL hace fsync por commit, y el commit es síncrono: bloquea el event loop unos 1,4 s. Una versión útil no reescribiría globals completos.

## Riesgos para adoptarlo

- Guardas: `looksLost` y `keep` se reimplementaron dentro de la transacción; cualquier cambio de reglas debe aplicarse en dos sitios hasta unificarlas.
- Protegida: `store-v2.js`, `save-guard.js`, 409 y rutas `/v2/commit` y `/state` están en `docs/persistencia-protegida.md`; cambiarlos exige autorización explícita y revisión independiente (AGENTS.md regla 5).
- Migración: sin importador, con copia previa de format 2 y reversión a JSON pendientes.
- Orden de claves de globals distinto al original (semánticamente igual).
- Commit síncrono bloquea el servidor mientras dura.

Veredicto: SQLite con este diseño es más seguro frente a cortes (0 torn) pero es mucho más lento y ocupa más disco. Para adoptarlo hay que sacar globals del camino caliente antes de medir de nuevo.

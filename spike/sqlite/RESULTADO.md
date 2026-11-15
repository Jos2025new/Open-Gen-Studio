# Spike SQLite para la persistencia (resultado, ronda 2)

Rama `task/sqlite-spike`. Solo archivos nuevos o propios bajo `spike/sqlite/`. Ningún archivo existente se modificó. Sin data/, .sandbox/, navegador, app ni red. Datos en `/tmp/ogs-sqlite-spike-data`, borrados al final.

## Veredicto

- **Edición pequeña: SQLite gana** (mediana 36 ms frente a 60 ms de store-v2; rangos sin solapar).
- **Guardado al final de gesto: SQLite gana** (44 ms frente a 129 ms).
- **Arranque (read): SQLite NO iguala** (231 ms frente a 90 ms). Causa: materializar 60k filas y armar el texto; diseño, no carga.
- Seguridad: 0 torn y 0 commits reconocidos perdidos en 100 kills con SQLite; store-v2 tuvo 3, 6 y 5 torn en tres pasadas.

## Ronda 2: cambios

- Globals se trocean con un escáner estructural del texto (sin `JSON.parse` del blob). Escalares en una fila; generaciones, assets y library en una fila por registro; spend como tabla append-only con ventana en head.
- Cada commit compara el texto del cuerpo con el último confirmado: prefijo y sufijo común por bloques; solo se reescriben los miembros de nivel superior que toca el cambio. Si el texto es idéntico no se escanea nada.
- Copias y rechazos pasan a ficheros en `backups/` (como store-v2). Snapshots: VACUUM INTO cada 10 min.
- Historial append-only solo para generaciones (`gen_history`, una fila por cambio).
- `checkpoint()` = `PRAGMA wal_checkpoint(TRUNCATE)`, llamado al final de cada tramo de WAL (en producción sería al quedar inactivo).

## Números: 5 rondas intercaladas v2 / sqlite (mediana [mín–máx])

| Medida | store-v2 | store-sqlite |
|---|---|---|
| Edición pequeña p50 | 59,5 [51,8–145,4] ms | 36,0 [28,5–50,9] ms |
| Edición pequeña p95 | 215 [173–329] ms | 49 [46–66] ms |
| Gesto (sesión 620 KB) p50 | 129 [78–146] ms | 44 [29–54] ms |
| Arranque read() p50 | 90 [81–143] ms | 231 [181–405] ms |
| Importación inicial | 190 [164–433] ms | 2383 [2237–3661] ms |
| Disco solo datos tras ediciones | 29,7 MB | 54,1 MB |
| WAL | n/a | pico 52 MB en la importación; en edición 4,2–4,5 MB; 0 tras checkpoint |

Ronda 1 (anterior, sin intercalar): ver historial de commits; sus cifras quedan superadas.

## WAL a 1000 commits (un tramo de 200 por comando)

| Commits | Pico WAL en el tramo | WAL tras checkpoint | Commit p50 / p95 |
|---|---|---|---|
| 1–200 (incluye importación) | 51,8 MB | 0 | 36 / 54 ms |
| 201–400 | 4,2 MB | 0 | 47 / 75 ms |
| 401–600 | 4,3 MB | 0 | 66 / 115 ms |
| 601–800 | 4,4 MB | 0 | 66 / 150 ms |
| 801–1000 | 4,5 MB | 0 | 71 / 165 ms |

El commit sube con el tamaño de la sesión tocada: el fixture crece una línea por commit (sesiones de hasta ~280 KB al final), así que la subida es del fixture, no de SQLite.

## Crash test kill -9, 100 ejecuciones por tienda (ronda 2)

| Tienda | OK | Vacío | Torn | Commit reconocido perdido | Fallo de guardas |
|---|---|---|---|---|---|
| store-v2 | 77 | 18 | 5 | 0 | 0 |
| store-sqlite | 77 | 23 | 0 | 0 | 0 |

## Carga, interferencia o diseño

Instantáneas antes y después de cada ejecución: `/tmp/ogs-sqlite-spike-data/round/*.snap` (no se incluyen en el repositorio). Carga media 3,4–5,3 en 8 núcleos. Lo que más consume CPU es el navegador Brave del usuario (~50 % de un núcleo); no había vitest, agy ni codex. No cerré Brave; las rondas intercaladas reparten esa carga entre las dos tiendas por igual. Las medianas de las dos tiendas no se solapan en edición, gesto ni arranque: la diferencia es de diseño.

- Edición y gesto: el orden de ejecución no influye (sqlite siempre por debajo de v2). La carga explica la dispersión (v2 de 52 a 145 ms), no la diferencia.
- Arranque: sqlite es más lento en todas las rondas. Es coste de diseño: materializar filas y componer texto.

Perfil con `node --cpu-prof` (solo la parte medida, con el inspector):
- Edición pequeña (30 commits, ~13 ms de CPU JS por commit): `commonPrefix` 45 % del tiempo propio; `commitTx` 33 % (comparación de textos de 26 MB y transacción); `get` de sentencias 7 %; `measure` de save-guard 5 %; GC 3 %. El tiempo nativo de SQLite no aparece en el perfil JS.
- Arranque read (5 lecturas): nativo (materializar filas) 46 %; `read` 24 %; GC 16 %; `assembleText` 11 %.

Fsync (`synchronous=FULL`, transacción WAL con una escritura, 300 repeticiones): FULL p50 7,65 ms; NORMAL 0,024 ms; fsync crudo de 4 KB p50 6,9 ms. El fsync es ~20 % de la edición pequeña. Se mantiene FULL.

## Qué queda demostrado

- Mismo contrato `read()` / `commit(body)`: 409 por baseAt, guardas reutilizadas de `save-guard.js`, rechazo sin tocar el estado.
- Una transacción por commit; 0 torn y 0 pérdidas en 100 kills de sqlite; 11 pruebas de contrato OK tras cada cambio.
- Edición pequeña y gesto más rápidos que v2 en medianas y en rangos.

## Qué no queda demostrado

- Arranque igual o mejor que v2: no se cumple.
- Migración real desde format 2 (sin importador).
- Coste de la primera confirmación tras reabrir (escaneo completo, ~0,5 s, no medido en tabla).
- Snapshots (VACUUM INTO) con datos reales.
- Tamaño de disco: sqlite ocupa ~1,8× v2 (historial de generaciones y tabla de registros duplican datos).
- Commits en el hilo principal: sqlite es síncrono y bloquea el proceso durante ~36 ms por edición; v2 es asíncrono.

## Riesgos para adoptarlo

- Guardas: `looksLost` y `keep` están reimplementados dentro de la transacción; deben mantenerse en dos sitios.
- Zona protegida: `store-v2.js`, `save-guard.js`, el 409 y las rutas `/v2/commit` y `/state` exigen autorización explícita y revisión independiente (AGENTS.md regla 5).
- Memoria: el espejo en memoria guarda el texto de cada registro y el último blob (~2× los globals).
- El escáner asume JSON compacto (`JSON.stringify`); un cuerpo con espacios no da error: el escáner lo trocea mal en silencio y debe validarse antes.
- Lectura de arranque: hay que optimizar la materialización (una sola consulta por colección ya aplicada; resto pendiente).

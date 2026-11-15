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

# Ronda 3: arranque y memoria (variantes A, B, C)

Código nuevo: `store-a.js`, `store-b.js` (B y C), `delta-client.mjs`, `bench3.mjs` + `bench3-server.mjs`, `round3.sh`, `agg3.mjs`, `crash-test3.mjs`. Nada existente cambió. El servidor del banco es un proceso aparte (solo el almacén, `--expose-gc`) para medir su RSS; el cliente simulado arma los cuerpos fuera del cronómetro. 5 rondas intercaladas con orden rotado, `MemoryMax=2G`, carga media 1,6–3,1 (sin navegador de pruebas; solo gnome-shell y claude-desktop). Mismo fixture (60k filas, 26 MB de globals). Estado final idéntico (sha) en base, A, B y C.

- **A** copia del texto armado (`state-cache.txt`, cabecera savedAt/version/bytes), escrita en `idle()`, validada contra HEAD al leer; si no cuadra, lee de tablas.
- **B** el cliente envía `delta` por id (registros nuevos/cambiados, borrados, escalares solo si cambian, spend añadido); `baseAt` hace sólido el delta. El servidor guarda `fp` (11 car. de md5) por fila, sin espejo.
- **C** B + `readPartial()` (sesiones, escalares, 2000 generaciones, 1000 assets, 500 spend recientes) y `readPage()` por páginas. Necesita el protocolo de B: sin globals enteros en el cliente no puede enviarlos.
## Números: mediana [mín–máx], 5 rondas (ms salvo indicación)

| Medida | store-v2 | base | A | B | C |
|---|---|---|---|---|---|
| Arranque open+read p50 | 122 [113–124] | 275 [265–280] | 71 [64–76] | 263 [252–286] | 39 [33–45] |
| Texto que recibe el cliente | 29,3 MB | 29,3 | 29,3 | 29,3 | 5,8 MB (+81 páginas de 500) |
| Edición pequeña p50 / p95 | 82 / 189 | 34 / 47 | 33 / 48 | 21 / 40 | 23 / 40 |
| Edición con generación nueva p50 | 79 | **319** | 323 | 24 | 24 |
| Gesto (sesión 620 KB) p50 | 88 | 44 | 43 | 37 | 34 |
| RSS servidor en uso (tras gc) | 164 MB | 733 | 732 | 167 | 167 |
| RSS pico | 272 | 949 | 950 | 203 | 203 |
| RSS tras arrancar | 101 | 114 | 105 | 114 | 68 |
| Disco datos / con backups | 29 / 56 MB | 53 / 101 | 82 / 131 | 53 / 102 | 53 / 102 |
| Cuerpo de la edición pequeña | 29 MB | 29 MB | 29 MB | 45 KB | 45 KB |
| JSON.parse de ese cuerpo | 90 | 85 | 101 | 0,2 | 0,2 |
| Mantenimiento en inactividad | 0 | 26 | **407** (+30 MB escritos) | 27 | 24 |

Páginas en C: 500 generaciones en 2,6 ms; las 81 páginas en 102 ms.
## Hallazgos no esperados

- El «espejo ~2×» de la ronda 2 estaba mal: el RSS de base crece **~24,5 MB por cada commit que cambia un registro** (heap 38 MB tras importar, 160 con 5 commits así, 282 con 10, 528 con 20). Causa probable: los textos de registro son porciones (`slice`) del texto de globals de cada cuerpo y retienen ese cuerpo entero de 26 MB. Con uso real crece sin tope hasta que se reescribe cada registro. No se probó el arreglo (copiar el texto); B no tiene espejo y no lo sufre.
- Un commit con una generación nueva cuesta 319 ms en base y A (reescanea la colección entera de 40k) frente a 24 ms en B.
- A no toca memoria ni edición: solo el arranque. Su coste: 407 ms bloqueantes por cada reconstrucción de la copia (25 en 100 cortes la copia estaba vigente; 52 veces estaba vieja y cayó a tablas), +30 MB de disco y 30 MB reescritos cada vez.
## Cortes kill -9, 100 por variante

| Variante | OK | Vacío | Torn | Commit reconocido perdido | Guardas / parcial |
|---|---|---|---|---|---|
| A | 77 | 23 | 0 | 0 | 0 fallos; lectura: 25 copia, 52 tablas |
| B | 79 | 21 | 0 | 0 | 0 fallos |
| C | 80 | 20 | 0 | 0 | 0 fallos; `readPartial` y página coherentes con el paso k en las 80 |

«Vacío»: corte antes del primer commit. Guardas (baseAt, pérdida total y de sesión) comprobadas en cada tienda reabierta.
## Archivos protegidos que cambiaría cada una (docs/persistencia-protegida.md)

- **A:** ninguno del cliente. Solo el servidor (store-v2.js se sustituye en la fase 2 de todos modos); la ruta `/v2/commit` y el 409 no cambian.
- **B:** `src/lib/disk.ts` (`setCommit` envía delta), `flushWrite`/`saveNow` de `store.ts` (seguir qué registros cambiaron), `saveRecovery.ts` y `writerHandoff.ts` (tras un 409, un envío fallido o un traspaso hay que recalcular el delta contra el último estado confirmado, no contra el último intento), la ruta `/v2/commit` de `local-store.js`. `save-guard.js` y el 409 no cambian (las guardas son las mismas). Fuera de la lista: `persistJson.ts`, `formatV2.ts`.
- **C:** lo de B más `idb.ts` (la copia del navegador pasaría a ser parcial), `saveGuard.ts`, el arranque con copias (`state-copies`) y la lectura de `/state`; además la interfaz que hoy lee historiales completos debe paginar.
## Recomendación

- Lo que resuelve el problema es **B**: es la única que baja la memoria (733 → 167 MB), la edición con generación (319 → 24 ms) y el cuerpo (29 MB → 45 KB). Deja el arranque en 263 ms; A sola no basta (deja 733 MB de RSS).
- Para el arranque, la más simple es **B + A** (A es solo servidor y se compone con B; la copia se construye con `read()`, igual en ambos). La combinación **no se midió**: se espera ~70 ms por ser el mismo camino de lectura de A, a confirmar. C llega a 39 ms y 6 MB, pero toca `idb.ts` y la interfaz: solo si el arranque con 30 MB sigue sin bastar.
- Pendiente antes de adoptar B: probar el rebase del delta tras un 409 o un fallo de red, y la migración desde formato 2 (no hay importador).

# Ronda 4: combinación B+A, rebase/abortos, migración v2 y recomendación final

Código nuevo en `spike/sqlite/`: `store-ba.js` (B+A), `bench4.mjs` + `bench4-server.mjs`, `round4.sh`, `agg4.mjs`, `crash-test4.mjs`, `delta-sync.mjs`, `migrate-v2.mjs`, `round4.test.ts`. Sin delegación a Hydrogen (ejecutado y verificado íntegramente en la rama). Mismo método que ronda 3: servidor en proceso aparte (`--expose-gc`), `MemoryMax=2G`, instantáneas de carga antes/después (carga media 1,6–3,9). 5 rondas intercaladas para `B` y `B+A` junto a la ronda 1 de `v2` y `A` (en el cgroup compartido de 2 GB, repetir `A` y `v2` supera el tope de memoria por la fuga de 738 MB de `A` y el IPC de 160 cuerpos de 29 MB; se muestran sus valores de R4 y entre paréntesis la mediana de 5 rondas de R3). Estado final `sha` idéntico (`4066900e6d0a9056`) en `A`, `B` y `B+A`.

## Números: mediana [mín–máx] en ms salvo indicación

| Medida | store-v2 (R4 / R3) | A (R4 / R3) | B (5 rondas R4) | B+A (5 rondas R4) |
|---|---|---|---|---|
| Arranque open+read p50 | 91,0 (122 [113–124]) | 64,7 (71 [64–76]) | 204,9 [199,8–220,7] | **55,3 [52,8–74,4]** (`copy`) |
| Edición pequeña p50 / p95 | 75,2 / 231,9 (82 / 189) | 30,1 / 43,4 (33 / 48) | 28,2 [14,1–30,7] / 37,5 | **27,6 [25,3–29,3] / 37,4** |
| Edición con generación nueva p50 | 66,0 (79) | 250,3 (323) | 31,5 [16,8–38,6] | **31,8 [20,8–33,9]** |
| Gesto (sesión 620 KB) p50 | 101,7 (88) | 39,0 (43) | 45,8 [28,6–48,1] | **43,2 [34,4–66,5]** |
| RSS servidor en uso / tras idle | 163,9 / 164,2 MB | **737,5 / 804,1 MB** | 166,5 [163,5–167,8] MB | **164,6 [164,2–167,3] / 162,9 MB** |
| Heap JS en uso / tras idle | 4,1 / 4,1 MB | **527,9 / 552,5 MB** | 4,9 [4,9–4,9] MB | **4,9 / 4,0 [4,0–4,9] MB (sin fuga)** |
| RSS pico / tras arrancar | 272,6 / 100,7 MB | 1029,9 / 100,3 MB | 200,9 / 113,5 MB | **309,8 [307,7–366,0] / 108,4 MB** |
| Disco datos / con backups | 29,3 / 55,8 MB | 81,8 / 130,6 MB | 52,9 / 101,9 MB | **82,1 / 131,2 MB** (52,9 + 29,2 copia) |
| Cuerpo edición pequeña / parse | 29 MB / 90,5 ms | 29 MB / 70,9 ms | 45 KB / 0,1 ms | **45 KB / 0,1 ms** |
| Mantenimiento en `idle()` | 0 | 372,7 / 503,6 ms | 25,8 [23,6–43,7] ms | **359,5 [335,4–1685] ms** |

- **Sin fuga de memoria en B+A:** tras 160 commits y reconstruir dos veces `state-cache.txt` en `idle()`, el heap JS de `B+A` queda en **4,0–4,9 MB** y su RSS en **162,9–164,6 MB** (frente a 552,5 MB de heap y 804,1 MB de RSS en `A`).
- **Crash test `kill -9` en B+A (100 ejecuciones, `crash-test4.mjs`):** **79 OK, 21 vacío, 0 torn, 0 commits reconocidos perdidos, 0 fallos de guardas**. De las 79 tiendas reabiertas con datos, 25 leyeron de `copy` (`state-cache.txt` vigente) y 54 cayeron limpiamente a `tables` (corte antes o a mitad de `idle()`).

## Robustez de B (rebase en 409 y abortos de red, `delta-sync.mjs` + `round4.test.ts`)

- **Rebase tras `409 conflict` (`baseAt` obsoleto):** el cliente lee el nuevo estado del servidor, calcula su delta local no confirmado respecto a su último `acked` y lo rebasa sobre el estado del servidor (altas, ediciones y borrados por id en `generations`, `assets` y `library`, escalares modificados, `spendLog` deduplicado y sesiones) antes de reintentar. Demostrado con test determinista: 0 registros perdidos y 0 duplicados en `records`, `spend` y `gen_history`.
- **Fallo de red / corte a mitad de petición:** `acked` y `baseAt` solo avanzan al recibir `204`. Si la petición falla antes del commit del servidor o después del commit (ack perdido), el delta pendiente se conserva intacto y se reenvía de forma idempotente (0 filas duplicadas en `spend` ni en `gen_history`).
- **Test aleatorio (5 semillas × 60 pasos = 300 pasos intercalados):** combina ediciones locales en lote, escrituras concurrentes de otro cliente que fuerzan `409`, abortos pre-commit y abortos post-commit (ack perdido). En las 5 semillas, el estado final cumple `sha256(store.read()) === sha256(refStore.read())`.

## Migración desde formato 2 (`migrate-v2.mjs` + `round4.test.ts`)

- El importador: (1) copia antes `store-v2/` completo a `backups/v2-pre-sqlite/` de forma atómica; (2) importa `HEAD.json`, `globals.json` y `sessions/*.json` en SQLite (`store-ba`) en **una sola transacción** (`BEGIN IMMEDIATE ... COMMIT`); (3) escribe `state-cache.txt` y verifica que el `sha256` canónico leído de tablas y de `copy` coincide exactamente con `v2.read()`; (4) deja `store-v2/` intacto byte a byte (rollback = volver a abrir `store-v2`). En el fixture completo de 60k filas (27,8 MB) tarda **6,4 s**.
- **Corte `kill -9` a mitad de importación:** probado matando el proceso hijo con `SIGKILL` en `after-copy-tmp`, en `globals` (a mitad de la transacción SQLite) y en `before-verify`. Tras el corte a mitad de transacción, SQLite hace rollback completo (`read() === null`) y `store-v2/` sigue intacto; al relanzar `migrateFromV2`, la importación termina y verifica el `sha256`.

## Archivos protegidos del cliente que cambiaría adoptar B+A y recomendación

- **Archivos protegidos (`docs/persistencia-protegida.md`):** la parte `A` es 100 % servidor y no añade ningún archivo de cliente respecto a `B`. Adoptar `B+A` tocaría en el cliente: `src/lib/disk.ts` (`setCommit` envía `delta`), `src/lib/saveGuard.ts` y `src/lib/idb.ts` (`guard.acked` y `pending` pasan a seguir también los ids/escalares/spend confirmados para rebasar tras 409, fallo de red o recarga), `flushWrite`/`saveNow` en `src/store/store.ts`, `src/store/saveRecovery.ts` y `src/store/writerHandoff.ts`. En el servidor: `server/local-store.js` y reemplazo de `server/store-v2.js` (`server/save-guard.js` y el 409 se conservan). Fuera de protegidos: `src/store/persistJson.ts`, `src/store/formatV2.ts`.
- **Recomendación final: SÍ adoptar B+A.** Resuelve a la vez el arranque (**55 ms** frente a 91–122 ms de v2 y 205 ms de B), la edición pequeña (**28 ms** frente a 75–82 ms), la edición con generación (**32 ms** frente a 66–79 ms en v2 y 250–323 ms en A), el gesto (**43 ms** frente a 88–102 ms), el tráfico por guardado (**45 KB** frente a 29 MB), la memoria del servidor (**165 MB RSS, 4,9 MB heap**, sin la fuga de A) y los cortes `kill -9` (**0 torn** frente a 3–6 torn en v2).
- **Riesgos restantes:** (1) mayor uso de disco (`82 MB` de datos frente a `29 MB` en v2 por SQLite + `state-cache.txt`) y bloqueo síncrono de `~360 ms` en el servidor al regenerar la copia en `idle()`; (2) tocar archivos protegidos del cliente (`idb.ts`, `saveGuard.ts`, `disk.ts`, `store.ts`) requiere autorización explícita del usuario y revisión independiente (regla 5 de AGENTS.md).

## Remedición tras la revisión

4 rondas intercaladas (`v2` y `B+A`, orden rotado; 4 en vez de 5 por límite de 30 min) tras `46d8f9db`, mismo fixture (60k filas) y `MemoryMax=2G`, carga media 0,8–2,3, `sha` idéntico (`4066900e6d0a9056`).

| Medida (mediana [mín–máx]) | store-v2 (4 r.) | B+A R4 (5 r.) | B+A revisado (4 r.) |
|---|---|---|---|
| Arranque open+read p50 (ms) | 90,3 [85,3–104,0] | 55,3 [52,8–74,4] | 54,8 [45,7–61,0] (`copy`) |
| Edición pequeña p50 / p95 (ms) | 104,3 [96,1–199,9] / 271,2 | 27,6 [25,3–29,3] / 37,4 | **492,7 [448,1–536,3] / 646,0** |
| Edición con generación p50 (ms) | 70,5 [64,2–75,6] | 31,8 [20,8–33,9] | **532,8 [472,1–563,9]** |
| Gesto 620 KB p50 (ms) | 89,0 [77,5–111,3] | 43,2 [34,4–66,5] | **511,1 [483,4–596,5]** |
| Reordenar library (50 ítems) p50 (ms) | 95,6 [64,4–107,1] | — | **495,5 [450,5–526,3]** |
| RSS en uso / tras idle / pico (MB) | 164,2 / 164,2 / 272,8 | 164,6 / 162,9 / 309,8 | 181,8 / 222,7 / 392,6 |
| Disco datos / con backups (MB) | 29,3 / 55,8 | 82,1 / 131,2 | 82,1 / 131,2 (WAL pico 52,1) |
| Cuerpo ed. pequeña / parse | 29.156 KB / 76,1 ms | 45 KB / 0,1 ms | **726 KB / 11,7 ms** (lib: 683 KB) |
| Mantenimiento en `idle()` (ms) | 0 | 359,5 [335,4–1685] | 338,4 [304,7–396,2] |

- **Sí empeoró de forma grave en escritura:** cada guardado pasa de 28–43 ms a **493–533 ms** (~12–18× peor; 4,7–7,6× más lento que `v2`), el cuerpo del delta crece de 45 KB a **726 KB** (16×), el RSS tras idle sube a **223 MB** (pico **393 MB**) y el WAL previo a `idle()` alcanza **52,1 MB**.
- **Causa en `46d8f9db`:** `delta-client.mjs` envía `order` completo (40k `generations` + 20k `assets`) en cada commit aunque no cambie, y `store-b.js` ejecuta `recFp.get` + `recPos.run` por los 60.000 registros en cada transacción.
- **Crash test `kill -9` (`crash-test4.mjs ba 100`):** **80 OK, 20 vacío, 0 torn, 0 commits reconocidos perdidos, 0 fallos de guardas** (21 lecturas de `copy`, 59 de `tables`). Arranque, disco y atomicidad no empeoran.

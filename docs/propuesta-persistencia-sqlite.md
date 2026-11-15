# Propuesta: persistencia en SQLite con envío de cambios (2026-11-15)

Estado: **propuesta, sin autorizar.** Toca la [persistencia protegida](persistencia-protegida.md): ningún archivo
protegido cambia sin la autorización explícita del usuario para cada fase, pruebas y revisión independiente (regla 5 de
AGENTS.md). Evidencia: [spike/sqlite/RESULTADO.md](../spike/sqlite/RESULTADO.md), rondas 1 a 4, rama `task/sqlite-spike`.

## Por qué

1. **Un corte deja el guardado a medias.** `server/store-v2.js` escribe cada sesión y después `HEAD.json`, sin
   transacción. Con 100 cortes `kill -9`, el formato 2 quedó a medias 3 y 6 veces en las dos pasadas de la ronda 1 y 5 en la ronda 2; SQLite, 0 en las rondas 1 a 4.
2. **Cada guardado envía y reescribe el estado entero.** Una edición pequeña manda 29 MB con el fixture de 100k
   registros. Los historiales de generaciones y gastos viven dentro de `globals`, que crece con el uso.
3. **Multiplataforma.** SQLite es nativo en el escritorio (Electron, Tauri) y en iOS y Android; el contrato de leer y
   guardar se conserva y solo cambia lo de debajo en cada plataforma.

## Diseño elegido: B+A

- **Servidor:** SQLite (`node:sqlite`, sin dependencia nueva), WAL, `synchronous=FULL`, `user_version` para migraciones.
  Tablas fijas indexadas (sesiones, generaciones, gastos, assets, biblioteca) con un JSON flexible por fila; ajustes e
  interfaz en una fila pequeña. Un guardado es una transacción.
- **B, envío de cambios:** el cliente manda solo los registros cambiados, por id. El servidor guarda una huella pequeña
  por registro y no mantiene ninguna copia del estado. Un corte de red reenvía el cambio pendiente sin duplicar. **Un 409
  se comporta como hoy:** se guarda la copia de la pestaña y no se envía hasta que el usuario decide (`idb.ts`); el
  spike lo rebasaba solo y eso es un hallazgo de la revisión, no el diseño.
- **A, copia para arrancar:** cuando la app está inactiva, el servidor arma el estado como texto y lo valida contra
  HEAD; al arrancar se lee esa copia y, si es vieja, las tablas.
- **Sin cambios:** la interfaz sigue trabajando en memoria y nunca espera al servidor; IndexedDB sigue como hoy;
  `baseAt`, el 409, la regla de pérdidas, «Mantener», las copias fechadas y el rechazo de peticiones de fuera del
  ordenador se conservan.

## Medido (ronda 4, medianas de 5 rondas intercaladas, fixture de 50 sesiones y 100k registros)

| Medida | Formato 2 | B+A |
|---|---|---|
| Arranque | 91–122 ms (una pasada en la ronda 4 y la mediana de la ronda 3) | 55 ms |
| Edición pequeña | 59–82 ms | 28 ms |
| Edición con generación nueva | 66–79 ms | 32 ms |
| Guardado de gesto | 88–129 ms | 43 ms |
| Memoria del servidor | 164 MB | 165 MB, estable |
| Cuerpo de una edición | 29 MB | 45 KB |
| Disco | 29 MB | 82 MB (53 SQLite + 29 copia) |
| Cortes `kill -9` a medias | 3–6 de 100 | 0 de 100 |

Reenvío tras corte de red: 300 pasos aleatorios con 5 semillas, 0 pérdidas, 0 duplicados, huella final idéntica. El
test excluía las ediciones concurrentes del mismo registro, así que no cubre ese choque. Migración: 60k filas en 6,4 s, una vez.

## Coste y riesgos

- +53 MB de disco y una mediana de 359 ms de trabajo en inactividad, con un máximo medido de 1685 ms, para armar la copia.
- Archivos protegidos que cambian: `server/store-v2.js` (sustituido por el almacén SQLite) y la ruta `/v2/commit`;
  `src/lib/disk.ts` (`setCommit`), `src/lib/idb.ts`, `src/lib/saveGuard.ts`, `flushWrite` y `saveNow` de
  `src/store/store.ts`, `src/store/saveRecovery.ts` y `src/store/writerHandoff.ts`. `save-guard.js` y el cuerpo del 409
  no cambian.
- `looksLost` debe medir filas igual que hoy mide sesiones, o la guarda cambia sin aviso.
- No medido: datos reales del usuario (solo fixture), la primera confirmación tras reabrir (unos 0,5 s), el navegador.

## Revisión independiente (Grok en Cursor, 2026-11-15, solo lectura, 17/17 tests del spike)

Hallazgos que hay que corregir en el spike antes de autorizar nada:

1. El 409 dejaba de frenar: `delta-sync.mjs:368` rebasa y reintenta, mientras hoy `idb.ts:143` e `idb.ts:171` esperan
   al usuario.
2. Ese rebase sustituye entero un registro editado a la vez en el servidor (`delta-sync.mjs:264`), y pierde un reorden de
   sesiones (`:312`). `round4.test.ts:372` excluía ese choque.
3. Reordenar la biblioteca no se guarda: el envío compara solo el texto por id (`delta-sync.mjs:134`) y
   `store-b.js:166` no mueve la posición.
4. Relanzar la migración borra el SQLite si ya no coincide con el formato 2 (`migrate-v2.mjs:91-92`), y con él lo
   guardado después de migrar.
5. Cifras: corregidas arriba (el rango del formato 2, la inactividad y el origen de los cortes a medias).

## Fases (cada una con su autorización)

1. **Servidor con el mismo contrato:** el almacén SQLite detrás de `/x/store/state` y `/x/store/v2/commit`, con el cuerpo
   actual. Arregla el guardado a medias sin tocar el cliente. Prueba de cortes dentro de `npm test`.
2. **Migración:** copia previa de la carpeta a `backups/v2-pre-sqlite/`, importación en una transacción, verificación por
   huella; el formato 2 queda intacto y volver atrás es apuntar a él. Prueba con corte a mitad de la importación.
3. **Envío de cambios (B):** cliente y servidor pasan a registros por id; reenvío idempotente; el 409 sigue frenando como hoy.
4. **Biblioteca que no pierde nada:** revisiones de assets y diario de eventos en las mismas tablas (original intocable,
   «Guardar como copia» por defecto, «Aplicar al original» con «Revertir»), según la
   investigación de registros (Apple Fotos, Google Fotos, darktable, Lightroom) y el acuerdo del 2026-11-15.

Cada fase termina con `npm test`, una prueba en el sandbox y una revisión independiente registrada en
[persistencia-protegida.md](persistencia-protegida.md#revisiones).

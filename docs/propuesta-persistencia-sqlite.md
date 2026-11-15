# Propuesta: persistencia en SQLite con envío de cambios (2026-11-15)

Estado: **propuesta, sin autorizar.** Toca la [persistencia protegida](persistencia-protegida.md): ningún archivo
protegido cambia sin la autorización explícita del usuario para cada fase, pruebas y revisión independiente (regla 5 de
AGENTS.md). Evidencia: [spike/sqlite/RESULTADO.md](../spike/sqlite/RESULTADO.md), rondas 1 a 4, rama `task/sqlite-spike`.

## Por qué

1. **Un corte deja el guardado a medias.** `server/store-v2.js` escribe cada sesión y después `HEAD.json`, sin
   transacción. Con 100 cortes `kill -9`, el formato 2 quedó a medias 3, 6 y 5 veces (rondas 1, 2 y 3); SQLite, 0.
2. **Cada guardado envía y reescribe el estado entero.** Una edición pequeña manda 29 MB con el fixture de 100k
   registros. Los historiales de generaciones y gastos viven dentro de `globals`, que crece con el uso.
3. **Multiplataforma.** SQLite es nativo en el escritorio (Electron, Tauri) y en iOS y Android; el contrato de leer y
   guardar se conserva y solo cambia lo de debajo en cada plataforma.

## Diseño elegido: B+A

- **Servidor:** SQLite (`node:sqlite`, sin dependencia nueva), WAL, `synchronous=FULL`, `user_version` para migraciones.
  Tablas fijas indexadas (sesiones, generaciones, gastos, assets, biblioteca) con un JSON flexible por fila; ajustes e
  interfaz en una fila pequeña. Un guardado es una transacción.
- **B, envío de cambios:** el cliente manda solo los registros cambiados, por id. El servidor guarda una huella pequeña
  por registro y no mantiene ninguna copia del estado. Un 409 hace que el cliente rehaga su cambio pendiente sobre el
  estado nuevo; un corte de red lo reenvía sin duplicar.
- **A, copia para arrancar:** cuando la app está inactiva, el servidor arma el estado como texto y lo valida contra
  HEAD; al arrancar se lee esa copia y, si es vieja, las tablas.
- **Sin cambios:** la interfaz sigue trabajando en memoria y nunca espera al servidor; IndexedDB sigue como hoy;
  `baseAt`, el 409, la regla de pérdidas, «Mantener», las copias fechadas y el rechazo de peticiones de fuera del
  ordenador se conservan.

## Medido (ronda 4, medianas de 5 rondas intercaladas, fixture de 50 sesiones y 100k registros)

| Medida | Formato 2 | B+A |
|---|---|---|
| Arranque | 91–122 ms | 55 ms |
| Edición pequeña | 59–82 ms | 28 ms |
| Edición con generación nueva | 66–79 ms | 32 ms |
| Guardado de gesto | 88–129 ms | 43 ms |
| Memoria del servidor | 164 MB | 165 MB, estable |
| Cuerpo de una edición | 29 MB | 45 KB |
| Disco | 29 MB | 82 MB (53 SQLite + 29 copia) |
| Cortes `kill -9` a medias | 3–6 de 100 | 0 de 100 |

Rebase tras 409 y reenvío tras corte de red: 300 pasos aleatorios con 5 semillas, 0 pérdidas, 0 duplicados, huella
final idéntica. Migración: 60k filas en 6,4 s, una vez.

## Coste y riesgos

- +53 MB de disco y unos 360 ms de trabajo en inactividad para armar la copia.
- Archivos protegidos que cambian: `server/store-v2.js` (sustituido por el almacén SQLite) y la ruta `/v2/commit`;
  `src/lib/disk.ts` (`setCommit`), `src/lib/idb.ts`, `src/lib/saveGuard.ts`, `flushWrite` y `saveNow` de
  `src/store/store.ts`, `src/store/saveRecovery.ts` y `src/store/writerHandoff.ts`. `save-guard.js` y el cuerpo del 409
  no cambian.
- `looksLost` debe medir filas igual que hoy mide sesiones, o la guarda cambia sin aviso.
- No medido: datos reales del usuario (solo fixture), la primera confirmación tras reabrir (unos 0,5 s), el navegador.

## Fases (cada una con su autorización)

1. **Servidor con el mismo contrato:** el almacén SQLite detrás de `/x/store/state` y `/x/store/v2/commit`, con el cuerpo
   actual. Arregla el guardado a medias sin tocar el cliente. Prueba de cortes dentro de `npm test`.
2. **Migración:** copia previa de la carpeta a `backups/v2-pre-sqlite/`, importación en una transacción, verificación por
   huella; el formato 2 queda intacto y volver atrás es apuntar a él. Prueba con corte a mitad de la importación.
3. **Envío de cambios (B):** cliente y servidor pasan a registros por id; rebase tras 409 y reenvío idempotente.
4. **Biblioteca que no pierde nada:** revisiones de assets y diario de eventos en las mismas tablas (original intocable,
   «Guardar como copia» por defecto, «Aplicar al original» con «Revertir»), según la
   investigación de registros (Apple Fotos, Google Fotos, darktable, Lightroom) y el acuerdo del 2026-11-15.

Cada fase termina con `npm test`, una prueba en el sandbox y una revisión independiente registrada en
[persistencia-protegida.md](persistencia-protegida.md#revisiones).

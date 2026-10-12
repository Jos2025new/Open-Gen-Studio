# 0014 — Guardar cada sesión por separado

## Estado

Aceptado

Aprobado por el usuario el 2026-10-12 («apruebo adr0014, la idea es que esto funcione de verdad»). Implementación parcial el 2026-10-13: ver la sección «Implementación (2026-10-13)». Revisado contra el código por GPT 6 Astra el 2026-10-10. No autoriza migrar ni borrar datos. Complementaría [0001](0001-proteger-datos.md); no lo sustituye ni reduce sus protecciones.

## Fecha

2026-10-10

## Contexto

[La medida de Claude](../depuracion.md#decisiones-de-rendimiento-del-designer-2026-10-09) atribuye ~20–29 ms a unir 95 sesiones en 8 MB, frente a 3,5 ms para convertir la activa. Es una medida en Node, no una medición nueva del navegador. Separar sesiones elimina esa concatenación completa en cada gesto; no garantiza coste constante: los metadatos globales, descubrir cambios y construir índices aún pueden crecer.

Código contrastado en `1ba22f1`:

- [store.ts](../../src/store/store.ts) entrega un `Persisted` completo a `persistJson`, aplazado 350 ms y en tiempo libre; `pagehide`/ocultación fuerzan el envío. [persistJson.ts](../../src/store/persistJson.ts) reutiliza texto por identidad y revisa mutaciones cada 30 s, pero une todo.
- [idb.ts](../../src/lib/idb.ts) guarda un JSON en `ogs-state/kv` (`ogs-app`) y blobs en **otra base**, `ogs-blobs/kv`. Elige por `savedAt`, conserva una copia local rechazada en `ogs-app:conflict-*` y refleja datos a disco. No hay transacción JSON+blobs entre esas bases.
- [disk.ts](../../src/lib/disk.ts) serializa envíos de estado y mantiene `baseAt`; el servidor compara y escribe dentro de una cola. Los blobs viajan aparte: `blobDb.set` no espera disco; `disk.setBlob` resuelve aun sin servidor y no comprueba `res.ok`. Esperar esa promesa actual **no demuestra guardado durable**.
- [local-store.js](../../server/local-store.js) usa `state.json`, blobs por clave, rechaza menos de la mitad de sesiones cuando había al menos dos, conserva el intento rechazado y hace copia antes de reducir sesiones o cada diez minutos (20 copias periódicas). Cuenta identificadores con una expresión regular. Hoy mueve el original a copias antes de instalar el nuevo; no constituye una transacción completa ni una garantía frente a corte eléctrico.

## Decisión

### Unidad de guardado y formato 2

Mantener el modelo de sesiones en memoria y las funciones públicas de la app. Cambiar el adaptador de persistencia, sin crear un segundo sistema paralelo. Separar la versión del formato de almacenamiento (`format: 2`) de la versión de Zustand (`version: 1`); no cambiar contenido ni redondear trazos.

Una revisión confirmada identifica:

- un registro global con los campos de `Persisted` excepto `sessions` (settings, gasto, generaciones, assets, biblioteca, compositor, UI y sesión activa);
- un registro inmutable por sesión cambiada, identificado por `sessionId` y revisión;
- un índice de sesiones que refiere exactamente la versión de cada registro, y un inventario de blobs por clave lógica y versión inmutable;
- `revision`, `parentRevision`, `savedAt`, conteo de sesiones y versión de esquema. `baseAt` sigue siendo obligatorio y compara la revisión exacta de partida, no la hora del cliente. `savedAt` queda como información temporal, no árbitro de conflictos.

**Disco:** `store-v2/HEAD.json` apunta a un manifiesto inmutable; `commits/<revision>.json` contiene las referencias globales, índice y blobs; `sessions/<id>/<revision>.json`, `globals/<revision>.json` y `blobs/<digest>` son inmutables. Los identificadores se validan; ninguna ruta procede de texto libre. Las claves raster/asset del modelo siguen siendo lógicas: el inventario resuelve la versión física, sin reescribir todas las referencias del documento.

**Navegador:** una nueva base `ogs-store-v2`, con almacenes `meta`, `globals`, `sessions`, `blobs` y `commits`. Un solo `readwrite` confirma los registros cambiados, el manifiesto y HEAD; abortar deja visible la revisión anterior. Los bytes se preparan antes de abrir la transacción (sin esperar red ni codificación dentro). No se modifica en sitio un blob confirmado: una nueva versión solo se vuelve visible con el commit que la referencia.

Primera implementación: manifiesto completo de referencias, no de los JSON de sesiones. El trabajo de serializar sesiones escala con las modificadas; enumerar identidades y serializar el manifiesto sigue siendo O(n). El estado global también puede crecer. Medir esos costes por separado antes de introducir índices incrementales o carga diferida (fuera de esta decisión).

### Confirmación y recuperación

1. Tomar una instantánea coherente del estado y de los buffers que referencia, con revisión de origen. Serializar cambios y materializar **todos** los blobs nuevos requeridos por esa revisión. Un registro que depende de un blob sin confirmar no puede publicarse.
2. En disco, preparar ficheros inmutables temporales, comprobar longitud/hash y sincronizar contenido; dentro de la cola global, verificar otra vez `baseAt`, esquema, referencias y pérdida de sesiones. Preparar la copia del manifiesto anterior sin retirar el HEAD vigente.
3. Publicar el manifiesto y reemplazar HEAD mediante rename atómico en el mismo sistema de archivos, sincronizando ficheros/directorios antes de responder éxito. HEAD es el único punto de publicación. Si el entorno no soporta la garantía, fallar explícitamente; no anunciar durabilidad. La implementación deberá demostrar orden de fsync/rename con inyección de fallos.
4. Antes del cambio de HEAD, una caída deja el commit anterior visible; después, la nueva revisión debe ser completa. Temporales/huérfanos se ignoran, no se borran automáticamente. Si HEAD o sus referencias están dañados, detener escrituras y ofrecer recuperar una copia completa: nunca arrancar vacío y reemplazar datos.
5. IndexedDB y disco no pueden participar en una transacción común. Confirmar primero la revisión local completa y registrarla como pendiente de réplica; disco confirma mediante identificador idempotente y respuesta explícita. La interfaz distingue «guardado local» de «copia en disco pendiente/error». Al perder la respuesta, consultar la revisión antes de reenviar: el mismo ID debe dar el mismo resultado y otro contenido con ese ID se rechaza.

El nuevo adaptador de blobs debe devolver fallo ante HTTP no exitoso, desconexión o ausencia del destino cuando se exige réplica. No reutilizar la promesa actual como acuse. Con servidor ausente se puede trabajar solo en IndexedDB, con estado de réplica visible; al volver no sobreescribir una rama divergente.

### Protecciones y dos pestañas

Una cola de commit por destino serializa validación, `baseAt`, conteo, copia y publicación. En IndexedDB la transacción compara HEAD; en disco lo hace el servidor. Una revisión obsoleta devuelve conflicto aunque su reloj sea más reciente. Conservar localmente el intento y sus blobs, bloquear nuevas escrituras de esa pestaña y ofrecer recargar/recuperar; no descartar el trabajo ni fusionarlo en silencio.

Comparar el número de IDs **válidos y únicos** del índice comprometido, no cadenas que parezcan IDs. Conservar exactamente el umbral actual: si había `had >= 2` y `has < had / 2`, rechazar y guardar el intento completo aparte. Antes de cualquier reducción admitida y cada diez minutos, retener una instantánea recuperable. Mantener 20 copias periódicas; intentos rechazados y conflictos no cuentan para esa rotación. Una copia incluye por referencia inmutable sesiones, globales y blobs; no basta un índice que apunte a ficheros sobrescribibles. No se elimina contenido necesario para HEAD, copias o conflictos. La recolección de huérfanos queda fuera y requerirá aprobación para borrar datos.

Conservar controles loopback, origen, `X-OGS`, `X-OGS-Automated` y sandbox en **todos** los nuevos endpoints, incluidas preparación, commit, recuperación y exportación. Mantener permisos privados de estados/copias. Exportar datos debe incluir una revisión completa y seguir retirando claves; wipe conserva su confirmación y aislamiento. No dejar rutas antiguas capaces de esquivar estas protecciones.

### Lectura antigua, migración y reversión

Mientras no se apruebe ejecutar la migración, la versión nueva puede leer el legado sin modificarlo; no arranca autosave v2 ni convierte al abrir. La implementación y la ejecución sobre datos reales son aprobaciones distintas.

Al migrar, cerrar otras pestañas y adquirir exclusión de escritura. Antes de cualquier cambio, inspeccionar por lectura tanto legado de disco como IndexedDB; no elegir solo el mayor `savedAt`. Si son iguales, usar esa instantánea. Si una revisión acredita continuidad con la otra mediante la base registrada, presentar esa procedencia. Si discrepan o no se puede demostrar continuidad, conservar ambas y exigir elección explícita del usuario; no mezclar campos ni blobs en silencio. Los blobs se resuelven y verifican en su origen; faltantes/corruptos bloquean la migración, sin sustituciones vacías.

Mostrar conteos de sesiones/blobs, tamaño, divergencias y destino. Tras la aprobación explícita de esa migración: crear copia íntegra del legado (JSON y blobs), construir v2 en ubicación nueva, comprobar IDs/contenido/referencias y recarga, y publicar el marcador de formato únicamente al final. Mantener legado y copias intactos. Si falla cualquier paso, seguir leyendo legado y conservar evidencia; un reintento es idempotente. Nunca migrar desde una sesión vacía creada por defecto.

Desde que v2 se activa, `/x/store/state` no acepta PUT legado (conflicto que obliga a recargar) y su GET no devuelve una falsa colección vacía. El cliente v2 detecta el marcador antes de hidratar/autoguardar. Una pestaña vieja puede seguir escribiendo su antigua base IndexedDB, pero esas escrituras quedan aisladas y no se importan automáticamente. El caso sin servidor requiere también un marcador en la nueva base que las versiones nuevas respeten: **una versión antigua sin este protocolo no puede impedirse escribir su propia base**. Exigir cierre/recarga de pestañas y conservar ambas bases es parte de la migración; no prometer compatibilidad de escritura bidireccional.

Reversión antes de nuevos commits v2: desactivar con aprobación y restaurar la copia verificada. Después de editar en v2, el legado ya está desactualizado: volver al código antiguo requiere una exportación inversa verificada y aprobada; no arrancarlo directamente sobre datos antiguos presentándolos como actuales.

## Comprobación requerida antes de darlo por implementado

Ampliar tests existentes, con datos sintéticos y fallos inyectados; no usar data/ real:

| Riesgo | Evidencia que debe cerrar la implementación |
|---|---|
| Pérdida de contenido | `persist-json.test.ts`, `raster-persist.test.ts`: equivalencia del estado reconstruido, IDs, orden, valores y bytes raster; cambiar una sesión no reescribe las otras; revisión periódica detecta mutación en sitio. |
| Dos pestañas / réplica | `state-conflict.test.ts`: mismo baseAt concurrente, reloj adelantado, offline que vuelve con disco avanzado, respuesta perdida, commit idempotente y conflicto conservado con blobs. Probar IDB real multi-tab además del doble. |
| JSON y blobs | Abortar IDB, cuota llena, blob faltante, HTTP 500 y caída en cada etapa de disco: al recargar solo revisión vieja completa o nueva completa; nunca referencias rotas. No basta mockear setBlob como resuelto. |
| Salvaguardas | `store-server.test.ts`, `automated-write.test.ts`: rutas nuevas/antiguas, loopback/origen/automatización; umbrales 2→0 rechazo, 2→1 admisión con copia, 5→2 rechazo, 5→3 admisión; copia periódica, rotación y restauración con blobs. |
| Legado / compatibilidad | Ambos destinos iguales/distintos, legado solo en uno, truncado, copias y blobs faltantes; ninguna escritura antes de aprobar; fallo/reintento migración, pestaña antigua, reversión antes/después de edición. |
| Guardado y cierre | `idle-save.test.ts`: debounce, idle, máximo de espera, hide/pagehide, cambios mientras un commit está en vuelo. No prometer que cerrar inmediatamente confirma una escritura asíncrona; recuperar la última revisión confirmada y señalar pendientes. |
| Rendimiento | Misma sesión activa y tamaño, 1/95/500 sesiones sintéticas: bytes/tiempo de serialización, manifiesto, transacción IDB, réplica, memoria y latencia del gesto en sandbox. Separar resultados Node y navegador; comparar con el mecanismo actual. |

Actualizar el contrato `persist-json-exact` del mapa cuando cambie el adaptador, manteniendo equivalencia de datos aunque el contenedor deje de ser un JSON único; añadir contratos de revisión, blobs y legado en `scripts/map-contracts.mjs`. Ejecutar `test:related`, `npm test`, build y recorrido sandbox guardar/recargar/exportar antes de solicitar aprobación para migración real. El ADR no constituye evidencia de esos tests futuros.

## Alternativas

Mantener un JSON único conserva el coste observado. Dividir solo el archivo en disco deja intacta la concatenación del navegador. Sobrescribir archivos de sesión sin manifiesto deja revisiones mezcladas tras una caída. Worker, reducción de precisión y Rust/WASM no resuelven la unidad de persistencia medida. Base SQL o diario incremental podrían reducir manifiestos, pero añaden complejidad no justificada por una medición actual.

## Consecuencias

Se evita serializar y enviar el contenido de sesiones intactas en cada guardado, a cambio de versiones inmutables, más almacenamiento temporal y un protocolo de commit/reconciliación explícito. La primera fase no reduce la memoria de todas las sesiones cargadas ni garantiza latencia constante. No se implementa caché FX, carga diferida ni limpieza de datos en este encargo. Revisión Astra: los cuatro riesgos están cubiertos como requisitos verificables; el diseño queda propuesto, no aprobado ni implementado.

## Implementación (2026-10-13)

Qué se implementó, y dónde:

- **Disco, formato 2:** `server/store-v2.js`. Carpeta `store-v2/` con `HEAD.json` (manifiesto, se publica al final), `globals.json` y `sessions/<id>.json`. Una escritura escribe solo las sesiones cambiadas. `state.json` no se escribe otra vez tras la migración.
- **Navegador, formato 2:** `src/lib/idb.ts` (base `ogs-store-v2`, un registro por sesión; el manifiesto se escribe el último) y `src/store/formatV2.ts`. Un guardado escribe las sesiones cambiadas en local y envía un solo commit al disco con esas sesiones (`src/lib/disk.ts`, `setCommit`).
- **Migración:** la primera carga sin formato 2 copia el texto de formato 1 completo a `ogs-app:format1-backup-<savedAt>` (en IndexedDB) y en el servidor a `backups/format1-<ts>.json`, antes de escribir nada nuevo. Las claves de formato 1 (`ogs-app`, `ogs-app:b`) no se borran ni se sobrescriben.
- **Lectura:** el servidor devuelve el texto de formato 1 reensamblado (`GET /x/store/state`), así que la carga de la app no cambia. El PUT legado (`PUT /x/store/state`) se conserva y se convierte en commit cuando existe formato 2.

Decisiones conservadoras (el ADR deja alternativas abiertas):

1. **Sin base nueva por bloques de blobs.** El ADR describe un inventario de blobs y un HEAD por revisión. Aquí los blobs de medios siguen igual que antes (`blobDb`); solo cambia el estado de la aplicación.
2. **Retirada del PUT legado: no se retira.** Lo usa el cliente al cargar (`disk.putState`) y tests existentes; se convierte en commit. Anotado como pendiente.
3. **Papelera de sesiones:** las sesiones eliminadas no se borran del disco; pasan a `backups/removed-sessions/`.
4. **Copias periódicas:** cada 10 minutos (máximo 20) se copia el formato 2 completo a `backups/v2-<ts>/`.
5. **Pérdida masiva, por total y por sesión:** se rechaza y el intento queda en `backups/rejected-*.json`. Por sesión: una sesión de más de 4 KB que se reduce a menos de la mitad.
6. **Revisión de tiempo de la pasada de seguridad (`FULL_EVERY_MS`):** se conserva, como exige el ADR.

## Vuelta atrás

Procedimiento para volver al formato 1 (no destructivo):

1. Cerrar el servidor de datos y todas las pestañas de la app.
2. Exportar el estado de formato 2 a `state.json`: `node -e "import('./server/store-v2.js').then(m => m.exportToFormat1('<carpeta de datos>'))"`. Antes de escribir, el `state.json` actual se copia a `backups/before-export-<ts>.json`.
3. Mover `store-v2/` a `backups/reverted-store-v2-<ts>/` (no se borra).
4. Arrancar la app. Sin `store-v2/`, el servidor lee `state.json` como antes. En el navegador, la base `ogs-store-v2` no se usa cuando falta su manifiesto; si se quiere forzar, borrar esa base desde las herramientas del navegador (los datos de formato 1 siguen en `ogs-app`).

Los datos de formato 1 nunca se borran por este procedimiento: `state.json` original se conserva en `backups/format1-<ts>.json` y `ogs-app:format1-backup-<savedAt>`.

Pruebas que cubren la vuelta atrás: `tests/store-v2.test.ts` (exportar restaura el último estado y deja copia previa).

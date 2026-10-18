# 0022 — Guardado local-first sin bloqueo

## Estado

Aceptado

La fase 1 está implementada en `task/save-guard`. Las fases 2 y 3 están pendientes.

## Fecha

2026-10-18

## Contexto

El 2026-10-18, a las 09:19:30, el sandbox dejó de guardar. La limpieza normal del historial del agente (`agent.history`) redujo una sesión de 424.188 a 143.575 bytes. La guarda por sesión del servidor la tomó por una pérdida y rechazó el commit. Tres fallos la agravaron:

- El servidor medía en bytes la copia anterior y comparaba con `text.length` (caracteres) la nueva.
- El cliente marcó la pestaña como `stale` para siempre y dejó de escribir en IndexedDB.
- Al chocar con el disco, el cliente sustituyó la copia local por la del disco.

Lo no confirmado además se calculaba contra `committed`, no contra lo que el disco había confirmado. El intento rechazado quedó en `.sandbox/data/backups/rejected-session-ses_mvdbr5tb4kdvfmkn1y-1792329570911.json`. Diagnóstico, revisiones del plan y commits: [043](../history/043-2026-10-W42.md).

## Decisión

El plan tiene tres fases. Esta decisión fija la fase 1, que es «que nunca se pierda nada en silencio» y no cambia el formato del disco.

1. **La guarda mide solo el contenido del usuario.** Excluye `agent`, que es caché del contexto del modelo. Mide bytes UTF-8 reales y elementos a la vez (`feed`, `graph.nodes`, `docs`, y las capas de los documentos que siguen existiendo). Salta solo si los bytes bajan a menos de la mitad (con una sesión previa de más de 4 KB) **y** los elementos bajan a menos de la mitad.
2. **El 409 dice por qué.** `conflict` (con `savedAt`) o `possible-loss` (con `sessionId` y `rejectedFile`). El intento rechazado se guarda en `backups/`, como mucho una copia por minuto y tipo.
3. **Posible pérdida ya no deja la pestaña «stale».** Lo local sigue escribiéndose; lo no confirmado queda pendiente y el aviso ofrece las salidas.
4. **IndexedDB se escribe siempre** en la pestaña activa. Solo el envío al disco espera.
5. **Pendientes por revisión.** Cada commit local tiene un `rev`. `acked` guarda lo que el disco confirmó y solo un 204 lo avanza. `pending` guarda `{ rev, baseAt }` en la misma transacción que el commit local. Un 204 de la revisión *n* borra `pending` solo si `pending.rev ≤ n`, y la base avanza con el ack (rebase).
6. **El arranque nunca adopta el disco sobre trabajo sin enviar.** Con `pending`, se reenvía con el `baseAt` conservado. Si el disco no coincide, es `conflict` y se conservan las dos copias.
7. **Una sola pestaña activa.** Web Locks (`ogs-writer`). Una guarda `holdsWriterLock()` en todas las rutas de escritura (estado, IndexedDB, disco, raster). La hidratación y el trabajo que arranca al cargar solo ocurren tras tomar el candado. La pestaña sin candado muestra un panel que cubre la app y bloquea teclado y ratón. La entrega usa `BroadcastChannel` con el motivo `WRITER_HANDOFF`: las generaciones con `remoteJob` siguen `running`, sin cobro parcial, y la nueva pestaña las reanuda. Una pestaña que no responde en 5 s puede tomarse con «Tomar de todos modos». Sin Web Locks, la pestaña queda en solo lectura con aviso.
8. **«Mantener esta versión» vincula las dos versiones.** La petición lleva `diskHash` y `candidateHash`. El servidor la acepta solo si ambos coinciden, guarda la versión del disco antes de escribir y es de un solo uso.
9. **Aviso persistente** con el motivo y tres salidas: Descargar copia, Mantener esta versión y Volver a la del disco. Esta última pide confirmación contextual, nunca `confirm()`, y antes guarda la copia local en `:conflict-`. `beforeunload` avisa si hay un rechazo o trabajo pendiente.

Se conservan `baseAt`, la serialización de escrituras, las copias (snapshots), el rechazo de pérdida masiva de sesiones y el rechazo de escrituras automatizadas o de peticiones de fuera del ordenador.

## Alternativas

- **Quitar la guarda por sesión.** Descartada: el incidente demuestra que hace falta una red contra los vaciados reales.
- **Varias pestañas con una rama de recuperación por pestaña.** Más compleja; la propuesta de una sola pestaña activa es la que se aprobó.
- **Adoptar el disco al arrancar cuando hay conflicto.** Descartada: borra trabajo sin enviar sin que el usuario lo decida.
- **Dejar que la pestaña sin candado escriba y confiar en `baseAt`.** Descartada: zustand llama a `setItem` en cada cambio, hidratado o no, y una pestaña con estado inicial pisaría IndexedDB.

## Consecuencias

- Con dos pestañas abiertas, la segunda queda tapada hasta que el usuario elige «Usar aquí». Lo que no se puede traspasar (una generación sin `remoteJob` o una respuesta del agente en curso) avisa con «Esperar» o «Tomar ahora».
- Un guardado rechazado no bloquea la edición, pero queda pendiente hasta que el usuario decide.
- En navegadores sin Web Locks, la pestaña es de solo lectura.
- La guarda lee y parsea la sesión en el servidor. Su coste no está medido todavía con la sonda ([protocolo](../depuracion.md#protocolo)).
- Comportamiento, código y tests en [persistencia](../features/persistencia.md). Implementación, flujos y mantenimiento en [arquitectura del guardado](../arquitectura-guardado.md).

## Límites aceptados en la fase 1

- Una carga que conserva los elementos pero vacía su contenido no se detecta. La regla exige que bajen también los elementos, para no bloquear el borrado de un documento grande. Lo cubrirá el historial (fase 2).
- Borrar a propósito más de la mitad de los elementos de una sesión que además pesan más de la mitad da `possible-loss`. Lo local sigue guardándose y el aviso ofrece «Mantener». La fase 2 lo resuelve con marcas de borrado.
- Si se pierde la respuesta 204 y la pestaña se recarga antes de reconocerla, el arranque puede mostrar un conflicto falso. No pierde datos, pero pide una decisión.
- Un error de lógica que borra poco en memoria no se puede impedir, solo recuperar. Ninguna de las apps de referencia lo impide. En la fase 1 la red son los snapshots `v2-*` (como mucho uno cada 10 minutos, los 20 últimos).

## Pendiente

**Fase 2: atomicidad, borrados explícitos e historial.**

- Commit atómico: archivos nuevos e inmutables por commit (`sessions/<id>.<commitId>.json`), y `HEAD.json` como único punto de publicación. La limpieza solo mueve a `backups/` los archivos retirados hace más de 10 minutos.
- Marcas de borrado emitidas por cada acción de borrar, con el inventario de sus rutas como primer entregable. La guarda gruesa por ids solo acepta una pérdida si todos los ids que faltan están marcados.
- Historial de versiones en `backups/session-history/`. Retención propuesta: al menos las últimas 10 versiones y todas las de los últimos 7 días. El usuario aún no lo ha confirmado.
- Evaluar SQLite en el servidor como alternativa al formato de archivos para la fase 2. No está decidido.

**Fase 3: recuperación al abrir.** Aviso «Trabajo sin guardar de las HH:MM» con Restaurar, Descargar o Descartar, y retención de `backups/rejected-*`.

El rescate de la pestaña abierta del sandbox (`rescate-pestana.js`, de solo lectura) vive en la carpeta de notas de la sesión, fuera del repositorio.

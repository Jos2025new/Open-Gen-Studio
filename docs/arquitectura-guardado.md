# Arquitectura del guardado protegido (fase 1, 2026-10-18)

Cómo está implementada la fase 1 de [ADR 0022](decisions/0022-guardado-local-first-sin-bloqueo.md) y qué hay que tocar cuando la app crece. Leído en el código de `task/save-guard` (`7621c03`), con las correcciones de la revisión externa del 2026-10-18.

- **Qué hace cada comportamiento y qué test lo comprueba:** [persistencia](features/persistencia.md).
- **El incidente que lo motivó:** [043](history/043-2026-10-W42.md).

## 1. Piezas

| Pieza | Responsabilidad |
|---|---|
| [server/save-guard.js](../server/save-guard.js) | `looksLost(prev, next)`: la regla de pérdida por sesión. `sha256`. |
| [server/store-v2.js](../server/store-v2.js) `commit()` | Orden de comprobaciones: `baseAt` → pérdida total → pérdida por sesión (con `keep`). También las copias en `backups/` y la escritura. |
| [server/local-store.js](../server/local-store.js) | HTTP. Envía el cuerpo del 409, también para el `PUT` antiguo (`commitLegacy`). |
| [src/lib/disk.ts](../src/lib/disk.ts) | Peticiones al servidor. Traduce el 409: `conflict` marca `stale`; `possible-loss` devuelve `'rejected'` y lo guarda en `disk.rejection()`. |
| [src/lib/saveGuard.ts](../src/lib/saveGuard.ts) | Lo que la pestaña sabe del disco: `acked`, `rev`, `pending`, `diskAt`, `held`, `problem`. No importa nada del store. |
| [src/lib/idb.ts](../src/lib/idb.ts) `stateDb` | Commit local (siempre) y envío al disco de lo que difiere de `acked`. `settle` (ack y rebase), `resend` y `hold` (arranque). |
| [src/lib/writerLock.ts](../src/lib/writerLock.ts) | El candado `ogs-writer`, `holdsWriterLock()`, `mayStartWork()` y el canal `BroadcastChannel` de entrega. No importa nada del store. |
| [src/store/writerHandoff.ts](../src/store/writerHandoff.ts) | Conecta el candado con la app. Hace el informe de trabajo en curso y corta las consultas con `WRITER_HANDOFF`. Vacía lo pendiente con `saveNow()` y, al perder el candado, pone `hydrated` en falso. |
| [src/store/saveReport.ts](../src/store/saveReport.ts), [saveStatus.ts](../src/store/saveStatus.ts) | El resultado de cada guardado se convierte en estado visible (`reason`, `rejected`). `hasPendingSave()` alimenta `beforeunload`. |
| [src/store/saveRecovery.ts](../src/store/saveRecovery.ts) | Las tres salidas del aviso: `downloadCopy`, `keepThisVersion` y `revertToDisk`. |
| [SaveGuardBanner.tsx](../src/components/shell/SaveGuardBanner.tsx), [WriterLockPanel.tsx](../src/components/shell/WriterLockPanel.tsx) | El aviso persistente bajo la barra superior y el panel que tapa la app sin candado. |

**Contratos** en `scripts/map-contracts-saveguard.mjs`: la forma del 409 y de `keep`, las revisiones pendientes, el candado y `WRITER_HANDOFF`. Si se cambia un lado, se cambian los demás en el mismo commit.

## 2. Flujos

### Guardado normal
1. `idbStorage.setItem` (debounce) → `flushWrite` → `stateDb.set`.
2. `rev + 1`. `pending = { rev, baseAt }` se escribe en la misma transacción que el commit local (`commitV2`).
3. El envío espera su turno en la cola `sendChain`. Al llegarle, vuelve a preguntar por el candado y calcula entonces qué sesiones difieren de `acked`, más el orden y los globales. Así, volver al texto del disco durante un envío también se envía.
4. Con el 204, `settle` avanza `acked` y `diskAt` antes de que empiece el siguiente envío. Si llegó una revisión más nueva mientras tanto, `pending` sigue con la base nueva (rebase); si no, se borra. Sin candado al llegar el turno, no se envía nada y `pending` queda para la pestaña siguiente.

### El servidor rechaza
| Respuesta | Cliente | Usuario |
|---|---|---|
| 409 `conflict` (otra pestaña o copia guardó) | `stale = true`. Lo local se sigue guardando y no se envía nada más. Una copia `:conflict-<at>` por episodio. | Aviso «Another tab saved more recent changes»: descargar o volver a la del disco. |
| 409 `possible-loss` | No marca `stale`. `problem` guarda `losses` (todas las sesiones que encogen, con su `diskHash`), `total` si se borran la mayoría de sesiones, y `rejectedFile`. Cada guardado siguiente reenvía todo lo que difiere de `acked`. | Aviso con el título de la sesión: descargar, mantener esta versión o volver. |
| Fallo de red | Ni `acked` ni `pending` cambian; el siguiente guardado lo reenvía. | El indicador de guardado. |

Mientras dura el rechazo, el servidor guarda como mucho una copia por minuto del intento (`rejected-session-<id>-<ts>.json`, la más reciente).

### Arranque (`stateDb.get`, solo con el candado)
| Situación | Qué hace |
|---|---|
| Sin `pending` y el disco es más nuevo | Adopta el disco (comportamiento de siempre). |
| `pending` y el disco ya tiene ese contenido (se perdió el ack) | Borra `pending`; no envía nada. |
| `pending` y el disco sigue en `pending.baseAt` | Reenvía la copia local con esa base. |
| `pending` y el disco cambió desde la base | `hold`: no envía ni reemplaza nada, guarda una copia `:conflict-` y avisa. |
| Copia local más nueva y sin `pending` | La reenvía con la base del disco. |

### «Mantener esta versión»
`keepThisVersion` guarda con `keep: true`. Al enviar, `approvalFor` construye la aprobación de **todas** las pérdidas que listó el 409:
- por sesión: `{ sessionId, diskHash, candidateHash }`. `diskHash` sale del 409 (si no, del texto en `acked`); `candidateHash` es el del texto exacto enviado;
- si hay borrado masivo: `total: { diskOrderHash, candidateOrderHash }`, los hashes de los dos órdenes de sesiones.

El servidor exige que se aprueben todas las pérdidas. Si falta una, rechaza el commit entero. Guarda `backups/kept-before-<id>-<ts>.json` (y `kept-before-order-*`) antes de escribir y nunca salta un `baseAt`.

### «Volver a la del disco»
Pide confirmación en el propio aviso. Guarda en `:conflict-<at>` el estado en memoria (incluido lo que aún no se había escrito); si esa copia falla, no adopta nada y el guardado sigue. Después pone `guard.discarding`: ningún envío nuevo sale (los de la cola responden `fail`). Espera al que está en vuelo, lee el disco ya con él y lo adopta; luego recarga la página. Si la adopción falla, `discarding` vuelve a falso.

### Pestañas
1. **Al cargar el módulo,** `writerLock.ts` pide el candado. La persistencia usa `skipHydration`, y `onWriterLockGranted` llama a `persist.rehydrate()`. Todo lo que `App.tsx` lanza con `hydrated` corre después.
2. **Sin el candado:** el panel tapa la app. `holdsWriterLock()` es falso en todas las escrituras y `mayStartWork()` es falso en `runGeneration`, `recheckGeneration`, `agentAccepts` y `llmTurn`.
3. **«Use here»** envía `ask` por el canal. La pestaña que tiene el candado deja de empezar trabajo y responde con `{ transferable, generations, agent }`.
   - Si nada se perdería, entrega en el acto.
   - Si algo se perdería, la nueva ofrece «Wait for them to finish» (sondeo cada 500 ms) o «Take over now».
4. **La entrega,** en este orden: corta las consultas con `remoteJob` con `WRITER_HANDOFF` (siguen `running`, sin cobro parcial); `saveNow()` (estado y raster diferido); suelta el candado. La anterior queda tapada y vuelve a la cola.
   - Si `saveNow()` lanza porque IndexedDB falló, no se suelta nada: la pestaña conserva el candado y responde `kept`. Lanza cuando falla el estado de la versión más reciente (un `ok` tardío de una anterior no lo borra) o cuando una capa de píxeles no llegó al navegador (`flushRaster`). Un disco caído no lanza.
   - Fuera de la garantía quedan los medios que no pasan por `saveNow()` (p. ej. `putAssetBlob` de un resultado descargado).
5. **Sin respuesta en 5 s:** el panel pide cerrar o recargar la otra pestaña y ofrece «Ask again». No hay `steal`: no cortaría las peticiones que la otra ya envió.
6. **La nueva hidrata sin recargar,** y `resumeInterrupted()` reanuda las generaciones con `remoteJob`.
7. **Al recuperar el candado,** `stateDb.get` empieza de cero: `disk.reset()` (sin `stale` ni el último rechazo), `acked`, `held`, `problem` y el estado del aviso. Después lo reconstruye desde las copias actuales y solo mantiene un conflicto si sigue siéndolo.

## 3. Qué queda guardado y dónde

- **IndexedDB `ogs-store-v2`:** `manifest`, `globals`, `session:<id>` y `pending`.
- **IndexedDB `ogs-state`:** las copias `ogs-app:conflict-<at>`. Se escriben, pero todavía no hay interfaz que las lea: es la fase 3.
- **Disco `backups/`:**
  - `rejected-session-<id>-<ts>.json`: intentos rechazados de una sesión;
  - `rejected-<ts>.json`: pérdida total;
  - `kept-before-<id>-<ts>.json`: la versión del disco antes de «Mantener»;
  - `v2-*`: los snapshots de siempre.

Ninguno tiene retención todavía; es la fase 3.

## 4. Mantenimiento: qué hay que tocar cuando la app crece

| Cambio en la app | Qué tocar | Si se olvida |
|---|---|---|
| Un tipo de contenido nuevo en la sesión (p. ej. `scenes`) | Contarlo en `measure()` de `server/save-guard.js` y añadir un caso a `tests/save-guard-server.test.ts`. | Ese contenido no cuenta para la guarda; solo lo cubren los snapshots. |
| Un campo nuevo que sea caché y encoja solo (como `agent`) | Excluirlo en `measure()`, con test. | Una limpieza legítima puede dar un `possible-loss` falso, aunque ya sin bloqueo permanente. |
| Una ruta nueva que escriba en IndexedDB o en el disco | Pasar por `stateDb`, `blobDb` o `disk`, que ya comprueban `holdsWriterLock()`. Si no puede, comprobarlo explícitamente. | Una pestaña tapada podría pisar a la activa. |
| Una acción nueva que gaste dinero o llame al proveedor | Empezar por `runGeneration` o por el agente, o comprobar `mayStartWork()`. | Se podría gastar desde una pestaña tapada o durante una entrega. |
| Un proveedor nuevo con trabajos asíncronos | Guardar `remoteJob` (`onRemoteJob`) y soportar `resume` en su adaptador. | Sus generaciones no se pueden traspasar: la entrega pide esperar o perderlas. |
| Un nuevo motivo de aborto que no deba cancelar | Tratarlo como `isRestart()` en `src/engine/checkStatus.ts`. | La generación quedaría `canceled` con cobro parcial. |
| Una acción de borrado masivo nueva | Hoy nada. En la fase 2 tendrá que emitir su marca de borrado. | En la fase 1 puede dar el aviso con «Mantener» si supera la regla. |

## 5. Diagnóstico

- **No se guarda:** mirar la hora de `HEAD.json` en `.sandbox/data/store-v2/`, buscar `save-conflict` en `logs/app.log`, y listar `backups/rejected-*` (`ls -t .sandbox/data/backups | head`).
- **Aviso de pérdida tras un borrado legítimo:** comparar en `backups/` el `rejected-session-*` con la sesión en disco y contar elementos con `looksLost`. Es el límite de la fase 1 si se borró más de la mitad de los elementos y de los bytes.
- **Panel de otra pestaña sin tener otra abierta:** buscar otra pestaña o ventana del mismo origen; un navegador automatizado sobre el sandbox también toma el candado. En desarrollo, editar `writerLock.ts` con la app abierta puede dejar la pestaña esperando su propio candado: recargar.
- **Conflicto al arrancar sin otra pestaña:** probablemente se perdió el ack justo antes de recargar (límite aceptado). Descargar la copia y volver a la del disco, o comparar con `:conflict-<at>`.

## 6. Límites conocidos

- Revisión externa del 2026-10-18: seis fallos corregidos, cada uno con su test (`tests/save-guard-review.test.ts`, el traspaso en `writer-lock-handoff.test.ts` y el servidor en `save-guard-server.test.ts`). Se comprobó que los tests fallan con el código anterior. Una segunda revisión, sobre `7d153fd`, encontró tres huecos más, también corregidos con sus tests (ADR 0022).
- Para un conflicto real solo hay descargar o volver a la del disco. «Mantener mi versión» frente a un conflicto, y la lectura de las copias `:conflict-`, son de la fase 3.
- Los tests del candado se escribieron después del código: no consta que fallaran antes.
- Sin prueba visual en el navegador todavía.
- El resto está en [ADR 0022](decisions/0022-guardado-local-first-sin-bloqueo.md#límites-aceptados-en-la-fase-1).

# Propuesta: zonas protegidas (empezando por la persistencia)

Fecha: 2026-10-18. Estado: **propuesta, sin implementar**.

La pidió el usuario después de cuatro revisiones externas del guardado protegido. Sus palabras: que quede «claro y permanente como algo que ha pasado por varias iteraciones, referenciando todas las pruebas que lo avalan», que «no se toque en un futuro a menos que se encuentren bugs evidentes» y que sea «una regla».

La primera versión de Claude (huellas de archivos, cuenta de `expect` y extracción de módulos) se corrigió con la revisión de GPT del mismo día. Esta es la versión corregida.

## Lo que esta propuesta puede y no puede garantizar

- **Puede:** que cualquier cambio en la zona o en sus pruebas sea **visible, pedido y revisable**, y que los tests que la avalan no desaparezcan ni se salten sin que `npm test` falle.
- **No puede:** impedirlo. Un agente que puede cambiar el código también puede cambiar la regla, la comprobación y el manifiesto.
- **La única barrera independiente** está fuera del repositorio: la protección de rama en GitHub, que exige revisión antes de fusionar en `main`. Solo la puede activar el usuario.
- **La seguridad real** viene de comprobar los escenarios de fallo, no de inmovilizar archivos.

## Zona 1: persistencia protegida

**Por qué:** el incidente de las 09:19:30 ([043](history/043-2026-10-W42.md)), la [ADR 0022](decisions/0022-guardado-local-first-sin-bloqueo.md) y cuatro revisiones independientes:

| Revisión | Sobre | Hallazgos | Corrección |
|---|---|---|---|
| 1 (Astra) | `90eebc8` | 6: diff al encolar, envío tras perder el candado, reversión fallida, traspaso con IndexedDB caído, «Mantener» de una pérdida cada vez, `stale` arrastrado | `7d153fd` |
| 2 (GPT) | `7d153fd` | 3: `ok` tardío que oculta un fallo local, píxeles con IndexedDB caído, envíos en cola durante la reversión | `bb58598` |
| 3 (GPT) | `bb58598` | 1: marca de fallo de una capa borrada | `9f11649` |
| 4 (GPT) | `9f11649` | 0. Sugiere fijar en un test la carrera del borrado | `71b9636` |

**Archivos de la zona:**
- Servidor: `server/save-guard.js` y `server/store-v2.js` (comprobaciones, copias y rechazos), además de `server/local-store.js` (el cuerpo del 409).
- Cliente: `src/lib/idb.ts`, `disk.ts`, `saveGuard.ts` y `writerLock.ts`; en `src/store/`, `writerHandoff.ts`, `saveRecovery.ts`, `saveReport.ts` y `saveStatus.ts`.
- Las funciones de guardado de `src/store/store.ts` (`flushWrite`, `saveNow`) y de `src/engine/design/raster.ts` (`writeLayer`, `flushRaster`, `deleteBuffers`). El resto de esos dos archivos **no** es zona protegida.

**Pruebas que la avalan.** Las marcadas **(R)** reproducen un hallazgo de revisión y se comprobó que fallan con el código anterior al arreglo:

| Test | Qué demuestra |
|---|---|
| [save-guard-review.test.ts](../tests/save-guard-review.test.ts) **(R)** | Los hallazgos 1, 2, 3, 5 y 6 de la revisión 1, y la reversión con envíos en cola de la revisión 2 |
| [save-guard-server.test.ts](../tests/save-guard-server.test.ts) | Regla de pérdida, UTF-8, `baseAt`, rechazo completo, hashes de «Mantener», varias sesiones y borrado masivo **(R)** |
| [save-guard-client.test.ts](../tests/save-guard-client.test.ts) | Revisiones pendientes, rebase tras el ack, arranque con `pending`, payload de «Mantener» |
| [save-guard-banner.test.ts](../tests/save-guard-banner.test.ts) | El aviso y sus tres salidas |
| [save-now.test.ts](../tests/save-now.test.ts) | Un `ok` tardío no oculta un fallo local **(R)**; recibos y reintentos |
| [raster-persist.test.ts](../tests/raster-persist.test.ts) | Píxeles: fallo local que detiene el traspaso **(R)**, capa borrada tras fallar **(R)**, carrera del borrado **(R)** |
| [writer-lock.test.ts](../tests/writer-lock.test.ts), [writer-lock-handoff.test.ts](../tests/writer-lock-handoff.test.ts) | Una pestaña activa, traspaso, IndexedDB caído conserva el candado **(R)**, sin `steal` |
| [writer-lock-panel.test.ts](../tests/writer-lock-panel.test.ts), [writer-lock-raster.test.ts](../tests/writer-lock-raster.test.ts) | Panel de la pestaña tapada; píxeles en el traspaso |
| [state-conflict.test.ts](../tests/state-conflict.test.ts), [state-copies.test.ts](../tests/state-copies.test.ts) | Conflictos y elección de copias al arrancar |

**Evidencia, separada por quién la obtuvo:**
- *Ejecutada por Claude:* `npm test` completo en `9f11649` (2042 tests); los tests (R) fallan con el commit anterior a su arreglo; prueba visual en el sandbox con dos pestañas («Use here», traspaso y guardado en disco sin rechazos).
- *Comunicada por los revisores:* reproducciones aisladas con módulos reales (55, 89, 26 y 16 tests en sus pasadas). No repitieron la suite completa.
- *Sin verificar:* los casos de fallo en el navegador (cuota, pestaña congelada) y cualquier proveedor real.

**Garantías y límites:** los de [arquitectura-guardado.md](arquitectura-guardado.md#6-límites-conocidos) y la ADR 0022. En resumen, el traspaso cubre el estado y los píxeles que pasan por `saveNow()`, pero no los medios guardados por otro camino. Las fases 2 y 3 están pendientes.

## Qué se implementaría

1. **`docs/zonas-protegidas.md`** con la zona 1 tal como está arriba (tabla de revisiones, archivos, pruebas y evidencia), y un índice para futuras zonas. Se enlaza desde el README.
2. **`scripts/check-protected.mjs`, dentro de `npm test`:** los tests listados deben existir y no contener `.skip`, `.only`, `it.todo` ni `describe.skip`. Nada más. No cuenta `expect` ni exige nombres de casos, porque un test puede conservar ambos y dejar de comprobar lo importante.
3. **La regla en AGENTS.md** (una línea, dentro de los 3 KB):
   > **Persistencia protegida:** antes de modificar las zonas o pruebas de [docs/zonas-protegidas.md](docs/zonas-protegidas.md), obtener autorización explícita para ese cambio; conservar sus contratos y aportar pruebas y revisión independiente.
4. **Evidencia según el tipo de cambio**, escrita en el documento:
   - *bug:* una reproducción que falle antes y pase después;
   - *fase 2 o 3 de la ADR 0022:* tests de los contratos nuevos, conservación de los anteriores y revisión independiente;
   - *cualquier cambio en sus tests:* se revisa junto con el código.

   Cada cambio en la zona añade una fila a la tabla de revisiones.

## Qué no se haría ahora

- **Extraer el guardado de `raster.ts` y `store.ts` a módulos propios.** Acabamos de corregir carreras entre esos módulos: separarlos es un cambio con su propio riesgo. Se hará cuando un cambio concreto lo pida.
- **Huellas sha256 como barrera.** Si se añaden más adelante, solo como alarma de cambio y sobre un conjunto pequeño.
- **Contar `expect` o fijar nombres de casos.** Da sensación de control sin protegerlo.

## Decisiones del usuario

- Si se aprueba la propuesta y su nombre («zonas protegidas»).
- Si se activa la protección de rama en GitHub para `main`. Lo hace el usuario en la configuración del repositorio.

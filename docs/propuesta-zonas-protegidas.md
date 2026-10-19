# Propuesta: persistencia protegida

Fecha: 2026-10-18. Estado: **propuesta recortada, lista para implementar**. No toca el guardado.

El usuario la pidió para que el guardado protegido, corregido después de cuatro revisiones externas, quede «claro y permanente» y «no se toque en un futuro a menos que se encuentren bugs evidentes». La versión anterior traía huellas, conteos, futuras zonas y extracciones. Se recortó con la revisión de GPT y el acuerdo del usuario: un documento corto, una regla y una comprobación obligatoria.

## Qué se implementa

1. **`docs/persistencia-protegida.md`**, enlazado desde el README. Contiene:
   - los archivos protegidos;
   - los tests que los avalan, cada uno con lo que demuestra;
   - las revisiones y los commits que las corrigieron;
   - la evidencia necesaria según el tipo de cambio.
2. **La regla en AGENTS.md**, en una línea:
   > **Persistencia protegida:** antes de modificar las zonas o pruebas de [docs/persistencia-protegida.md](docs/persistencia-protegida.md), obtener autorización explícita para ese cambio; conservar sus contratos y aportar pruebas y revisión independiente.
3. **`scripts/check-protected.mjs`, dentro de `npm test`:** falla si falta alguno de los tests listados o si alguno usa `.skip`, `.only` o `.todo`.

## Alcance de la comprobación

- **Detecta:** archivos de test ausentes y tests marcados para saltarse.
- **No detecta:** casos borrados dentro de un archivo ni aserciones debilitadas. Eso solo lo frena la revisión, que la regla exige.
- **No impide nada:** lo hace visible. La única barrera independiente es la protección de rama de `main` en GitHub, que solo puede activar el usuario.

## Archivos protegidos

- Servidor: `server/save-guard.js`, `server/store-v2.js` y el cuerpo del 409 en `server/local-store.js`.
- Cliente: `src/lib/idb.ts`, `disk.ts`, `saveGuard.ts` y `writerLock.ts`; en `src/store/`, `writerHandoff.ts`, `saveRecovery.ts`, `saveReport.ts` y `saveStatus.ts`.
- Solo estas funciones de dos archivos más grandes: `flushWrite` y `saveNow` de `src/store/store.ts`; `writeLayer`, `flushRaster` y `deleteBuffers` de `src/engine/design/raster.ts`.

## Tests que lo avalan

| Test | Qué demuestra |
|---|---|
| `save-guard-review` | Los hallazgos de la revisión 1 y la reversión con envíos en cola |
| `save-guard-server` | Regla de pérdida, `baseAt`, rechazo completo, «Mantener», borrado masivo |
| `save-guard-client` | Revisiones pendientes, rebase, arranque con `pending` |
| `save-guard-banner` | El aviso y sus tres salidas |
| `save-now` | Un `ok` tardío no oculta un fallo local |
| `raster-persist` | Píxeles: fallo local, capa borrada, carrera del borrado |
| `writer-lock`, `writer-lock-handoff`, `writer-lock-panel`, `writer-lock-raster` | Una pestaña activa, traspaso seguro, sin `steal` |
| `state-conflict`, `state-copies` | Conflictos y copias al arrancar |

**Revisiones:**
- Astra, sobre `90eebc8`: 6 hallazgos, corregidos en `7d153fd`.
- GPT, sobre `7d153fd`: 3 hallazgos, corregidos en `bb58598`.
- GPT, sobre `bb58598`: 1 hallazgo, corregido en `9f11649`.
- GPT, sobre `9f11649`: ningún hallazgo; el test de la carrera que sugirió está en `71b9636`.

El detalle está en [043](history/043-2026-10-W42.md) y en la [ADR 0022](decisions/0022-guardado-local-first-sin-bloqueo.md).

## Evidencia según el tipo de cambio

- **Bug:** una reproducción que falle antes del arreglo y pase después.
- **Fase 2 o 3:** tests de los contratos nuevos, los anteriores conservados y una revisión independiente.
- **Cambio en estos tests:** se revisa junto con el código.

## Dirección propuesta para la fase 2: SQLite

No se implementa ahora.
- Sustituiría los JSON del servidor, no se añadiría a ellos.
- Sesiones, orden, globales y revisión se guardarían en una sola transacción.
- Se mantienen `baseAt`, las comprobaciones de pérdida y las copias recuperables.
- Los archivos multimedia siguen fuera, con su propio contrato.

Antes de sustituir los JSON hay que verificar la migración y la recuperación: interrumpir una escritura, reabrir y comprobar que aparece una versión completa, y restaurar una copia.

SQLite no sustituye la coordinación entre pestañas ni sus tests.

## Fuera de alcance

Huellas, conteo de `expect`, futuras zonas y extraer módulos de `store.ts` o `raster.ts`.

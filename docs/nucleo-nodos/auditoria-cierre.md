# Auditoría de cierre de la sesión (2026-11-19)

Dos auditorías independientes, en paralelo y en solo lectura, sobre el transcript de la sesión maestra y el código en `8ff06470`. La sesión maestra cruzó ambas; los frenos se corrigieron antes de fusionar (ver [069](../history/069-2026-11-W47-master-cierre-fusion.md)).

## GPT 6.2 Sol

**No fusionaría `task/nucleo-nodos` en `8ff06470` todavía.** El plan de lienzo puede enviar pasos fuera del presupuesto aprobado, Deshacer puede cambiar la imagen que entrega un cable y quedan casos de pérdida o cruce de historial.
La rama puede servir de base única tras corregir esos casos, cerrar la autorización y revisión de persistencia, y pasar Haiku y `npm test` sobre el candidato final.
Leí las 2.101 líneas del transcript y comprobé que ambas referencias locales apuntan al mismo commit. La evidencia de esta auditoría es estática. No ejecuté tests ni abrí la app.

## A. Bloquea la fusión

- **Un plan de lienzo puede cobrar un paso que la tarjeta no presupuestó.** Aprobar calcula coste y autorizaciones con los pasos de la tarjeta. Después, el ejecutor recompila el grafo vivo y puede añadir un nodo aguas arriba sin resultado vigente. Ese paso llega al proveedor sin autorización de precio propia porque la guarda retorna cuando falta su entrada. `4380b4c1` sí impide un segundo envío simultáneo, pero deja abierta esta ruta, que ya existía en `09ac4b55`. `planRun.ts:65` · `planRun.ts:151` · `graph.ts:393` · `priceAuthorization.ts:34`
- **Deshacer puede volver a conectar el resultado vecino.** Borrar la primera de dos imágenes sí marca el cable vivo `NO_RESULT`. Si después deshaces una edición anterior del lienzo, el historial repone la arista previa al borrado. Su índice vuelve a apuntar al primer resultado, que ahora es la otra imagen. `dropResults.ts:40` · `history.ts:89` · `CanvasNavigation.tsx:65` · `resolver.ts:86`
- **Una fila antigua puede cambiar de agente al borrar el primero.** La migración asigna el hilo antiguo, pero deja las filas sin dueño explícito. Su dueño se recalcula con el primer agente que quede en el grafo. Si borras A y queda B, editar una fila antigua puede reenviar el mensaje a B. Por separado, borrar nueve agentes con historial y deshacer devuelve los nodos, pero el archivo de hilos conserva solo ocho. La prueba nueva cubre un agente. `threads.ts:55` · `lanes.ts:17` · `lanes.ts:40` · `messageEdit.ts:62`
- **Persistencia protegida y primer arranque.** El usuario autorizó `writerHandoff` y Neon sí comprobó que un agente ocupado de fondo impide el traspaso. El candidato también cambió `abortAll` y dos tests protegidos, mientras la fila de revisión aún describe solo `busySessions`. Hace falta cerrar la autorización y revisión del diff efectivo. Además, la primera carga con el bloqueo de escritor convierte `agent` a `agents` y pone el estado migrado en la ruta de guardado. La autorización que consta en el transcript cubre `writerHandoff`. Hace falta autorización explícita para aplicar la migración a datos reales. `writerHandoff.ts:31` · `persistencia-protegida.md:57` · `store.ts:380` · `store.ts:424` · `AGENTS.md:22`

## B. Qué cerrar ahora, en orden

1. **Tras corregir A, pruebas dirigidas y revisión independiente de persistencia, 15–25 min de verificación.** El código actual ya corrige el doble clic de `nodeRun`, la reutilización de su aprobación, Stop durante comandos y revisión, edición durante traspaso, destinatario desconectado, atribución del modelo y de resultados, reemplazo de cables por puerto y los escapes AST concretos de Neon. La prueba de recarga pasa por JSON y `merge`, borra el registro en memoria y simula el ejecutor. Cubre dos casos concretos. `reload-no-resend.test.ts:15`
2. **Actualizar 068, ADR y registro protegido, 10–15 min.** Marcar qué quedó corregido y con qué evidencia. Quitar del ADR la proyección `session.agent` y la autorización pendiente que aún describe. Registrar el candado del plan, el alcance de la recarga y el resultado de la revisión protegida. `068:105` · `ADR 0031:88`
3. **Haiku sin contexto en sandbox, 15–25 min, y `npm test`, unos 22 min.** Pedirle que cree y conecte dos agentes, compruebe destinatario y Stop, y abra la confirmación de ejecución para ver entradas y coste sin enviar a un proveedor de pago. El primer Haiku no creó el segundo agente ni abrió la confirmación. Los 4.244 tests de la última suite completa citada son anteriores al candidato. Si todo pasa, el cierre acordado era local y sin push.

## C. Puede quedar pendiente

- Descriptores que aún delegan en varios sitios, direcciones entre grafos, subnet evaluable con Entrada/Salida, inspector visual, medición con grafos grandes y el resto de componentes como nodos reales. Son trabajo de la siguiente sesión.
- Rehacer y aprobar el boceto de avisos. El criterio corregido ya está en 068 y en el ADR. También pueden esperar la rama menor de Grok, la prueba de proveedor real y otra crítica general, distinta de la revisión protegida de A.

## Promesas perdidas y errores de proceso

- **Falta registrar el cierre acordado.** En el transcript 1729–1745 el usuario encargó evaluación, Haiku nuevo y fusión local condicional. 068 y el ADR todavía dicen que el usuario prueba antes de fusionar. La crítica de Grok sobre descriptores y subnet se prometió anotar en 068 y quedó fuera. El último ataque corto de Neon quedó propuesto y su omisión no se llegó a acordar en el transcript.
- **La extensión tuvo motivos reales y aprobación.** El usuario eligió arreglar de raíz, autorizó el paralelismo y pidió incorporar la tanda de cinco, DRY/KISS y la crítica de Grok. El fallo de proceso fue volver a decir «cerrado» tras pruebas parciales y convertir cada revisión en una puerta nueva, sin fijar qué hallazgo concreto podía frenar la fusión. Los cortes de sesión, red y autenticación añadieron tiempo aparte.
- **Para la próxima sesión:** comprobar el resultado y el SHA antes de decir «hecho», revisar los contratos antes de adaptar tests que los fijan, y corroborar referencias externas antes de usarlas. El episodio de Blender y el `pkill -f` ya están recogidos en 068.
## Gemini 4 Neon



### Veredicto
**No fusionar tal cual `8ff06470`, pero SÍ es fusionable hoy tras ~1 h 15 min de cierre (pasos B1–B5).**
Los 45 fallos previos de Neon, los 10 refactors de Sol, los 14 de `informe-neon-cierre` (`598ee860..57c6022f`) y casi todos los frenos de Grok (`837f2010`, `696f86f7`, `7ae75add`, `301d160b`) ya están corregidos en el código actual.
Condiciones para fusionar a `main`: cerrar el bypass de aprobación en `presentPlan`, completar `persistencia-protegida.md` y docs, confirmar 2 decisiones rápidas del usuario, pasar Haiku en sandbox y correr `npm test` completo.

### A. Bloquea la fusión de verdad (evidencia en `8ff06470`)
1. **Regla dura `AGENTS.md` — sin `npm test` completo desde `09ac4b55`:** hubo 56 commits (hilos, Sol, Neon-cierre, Grok) solo con `test:related`; `AGENTS.md` exige `npm test` al entregar.
2. **Persistencia protegida sin cierre (`AGENTS.md` regla 5):** `docs/persistencia-protegida.md:57` aún marca «Pendiente la revisión independiente» y solo cita `busySessions`, omitiendo el cambio en `abortAll` (`src/store/writerHandoff.ts:34`, `stopSession`); el contrato sigue intacto y Neon ya revisó `writerHandoff.ts` (`informe-neon-owner.md:29`), pero falta registrarlo.
3. **Dinero / bypass del registro en planes de Nodes (`src/engine/agent/runtimeShared.ts:383-391`, `src/engine/agent/planRun.ts:56,151-161`):** `presentPlan` publica la tarjeta `status: 'awaiting'` con `nodeRun: undefined` antes de `await prepareNodeRun` (red). Aprobar en esa ventana (o un plan `node` antiguo sin `nodeRun`) entra por `executePlanItem`, que ejecuta `graphToSteps` con `force` por defecto (`src/engine/flow/graph.ts:387`), fuera de `nodecore/action.ts`, sin `runProblems` y sin revalidar firma/coste; además `resolveStepCostReview` (`planRun.ts:300-314`) indexa `prior`/`blocked` por `st.id` frente a `${plan.id}_${st.id}` en `executePlanItem:155`, pudiendo re-cobrar pasos ya hechos. *(En planes normales tras el `await`, sí entra por `approveNodeRun` + `runAction`, y `4380b4c1` ya añadió `lockNodes`.)*
4. **Contradicción con decisión del usuario (`docs/decisions/0031-nucleo-de-nodos.md:73`):** `src/engine/nodecore/edit.ts:156-160` (`planDelete`) sigue creando `graph.broken` al borrar un nodo manualmente, y `guard.ts:20` lo reporta como «cable inválido» en `tool` (`types/tool.node.ts:11`). Hoy no se dibuja ni bloquea nodos de generación (`generation.ts:13`), pero contradice `0031:73` («`graph.broken` no es para un borrado hecho por el usuario»).
5. **Identidad visual sin aprobación explícita (`AGENTS.md` regla 6):** `src/components/node/AgentNodeControls.tsx:11-43` (renderizado en `SystemNode.tsx:89`, `ChatNode.tsx:40`) añade controles «Model» y «To» con «aspecto provisional» (`0031:94`) no aprobado por el usuario.

### B. Puede hacerse ya para cerrar la rama (orden y tiempo)
1. **Arreglo chico de `presentPlan`/`executePlanItem` (~15 min):** mover `prepareNodeRun` antes de `appendFeed` en `runtimeShared.ts:383-391` y normalizar/bloquear `workspace === 'node'` sin `nodeRun` en `planRun.ts:151` + test de regresión.
2. **Decisión del usuario en 2 min:** (a) aprobar o aceptar como provisional `AgentNodeControls.tsx`; (b) decidir si quitar `graph.broken` en `planDelete` ya (~15 min) o al implementar el boceto de avisos.
3. **Cerrar docs y persistencia protegida (~15 min):** actualizar `persistencia-protegida.md:57` (`abortAll` y revisiones de Neon); limpiar contradicciones en `0031-nucleo-de-nodos.md` (`0031:68,83,91`) y `nodecore/commands.ts:19` (aún cita `replaces:"any"`); poner al día `068` (`b892a9cd..8ff06470` y Grok); al fusionar, actualizar `pendientes.md` (con `067:66-69`) y `docs/map.md`.
4. **Prueba de Haiku sin contexto en sandbox (`npm run dev:sandbox`, ~20 min):** pedida en el `/goal` (transcript:1730-1732); validar flujo actual y capturar los controles provisionales con 2 agentes.
5. **Suite completa `npm test` una vez (~22 min) y fusión local `task/nucleo-nodos` → `main` sin push** (incluye `task/sqlite-adopt`).

### C. Puede quedar pendiente para la próxima sesión (sin riesgo)
- **Diseño de Grok (`20261119-grok-critica-nucleo.md:21-27`):** mover valor/puertos al descriptor (quitar los 3 `switch` de `evaluate.ts:16`, `resolver.ts:78`, `graph.ts:458`) y diseñar `space` como subnet con Entrada/Salida y plan plano (decisión pendiente, `0031:40,69`).
- **Avisos a escala:** rehacer el boceto con la corrección del usuario (`068:46-52`), aprobarlo e implementarlo.
- **Resto de «todo es un nodo»:** envolver Designer, board, log, ajustes, biblioteca y composer (`0031:47`); panel UI del inspector; prueba con 1000 nodos (la lentitud por token en UI ya se cerró en `5dbcf725`).
- **Prueba del usuario con clave real** (generación real + 2 agentes LLM) y **rama menor de Grok** (A5, A2, tests intermitentes `writer-lock-panel`/`path-boolean`) sobre la base fusionada.
- **Menores sin riesgo:** `HomeBar.tsx:26` calla en vez de avisar si el chat no tiene agente; `AgentLlmSelect` (`AgentNodeControls.tsx:13`) solo lista el proveedor global; `action.ts` en RAM (recarga probada en `a6164a7f`, no reenvía); deuda previa de `067:66-69` (doc/library, exportación, idioma, A3–A6, B1–B2).

### Promesas o decisiones perdidas
- **Neon sobre las propuestas (`transcript:730-737`):** pedido para auditar ADR 0031, propuesta y diagnóstico; anotado al principio y borrado al reordenar `068:105-117` (solo hubo ataques al código; la arquitectura la revisó Grok al final).
- **Aprobación visual de `AgentNodeControls.tsx`:** admitida como provisional en `0031:94` y `068:82`, nunca puesta en pendientes ni enseñada al usuario.
- **Quitar `graph.broken` en borrado manual (`transcript:1059-1068`, `0031:73`):** anotado como decisión, sin tarea en `068:105-117`; el master además dijo que servía para deshacer cuando Undo usa `undoNodes` (`flow/actions.ts:398`).
- **Cierre de `068` y deuda de `067:66-69`:** `068` quedó congelado en `09ac4b55` (faltan hilos, 3 rondas Neon, Sol, Grok y `/goal`); «inicio y fin de space» pasó de «la manda» (`067:52`) a decisión aplazada sin detallar las piezas sin nodo.

### Errores de proceso del master (no repetir)
- **Dar por «hecho» antes de evidencia adversarial:** tras GPT y `npm test` (`456`) y tras el arreglo de raíz (`749`, `1043`); cada vez aparecieron decenas de fallos reales.
- **No frenar decisiones autónomas de subagentes al instante:** `ddf27bcb`/`b07c5090` (paralelo no aprobado, contradiciendo `0031:88`) y excepciones para tests viejos dispararon 4 rondas y medio día extra.
- **Parchear sobre una arquitectura rota:** parchear `owner` sobre `session.agent` generó 20 fallos; migrar a hilos dejando `owner` opcional generó 25 más.
- **Validar por muestreo o de memoria:** describió Blender mal de memoria (`789` vs `931`); aceptó `a6164a7f` sin notar que `reload-no-resend.test.ts:49` probó `workspace: 'chat'` y no `workspace: 'node'`.
- **Acumular 56 commits sin `npm test` ni actualizar `068`/`0031`/`persistencia-protegida.md`**, y usar `pkill -f` amplio matando su propio shell.

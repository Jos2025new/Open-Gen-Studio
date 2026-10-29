---
type: rastreo
title: Rastreo de Nodes
description: Pendientes, decisiones revertidas, regresiones y contradicciones del área Nodes, rastreados en el historial git y los docs y contrastados con el código de la rama task/designer-measure.
tags: [nodes, rastreo, regresiones, pendientes]
updated: 2026-10-28
---
# Rastreo de Nodes

Lectura de historial (`git log`), docs y código de `task/designer-measure` (cabeza `1f0a2b0`, 2026-10-28). **Nada se ejecutó** (ni app, ni navegador, ni tests): todo estado «hoy» sale de leer el código. «Probado» = trazado por lectura entre archivos citados, no reproducido en pantalla. Los docs y mensajes de commit son pistas; el código manda. Registro previo del área: [nodes-controles](../nodes-controles/README.md), [hallazgos](../nodes-controles/hallazgos.md), [huecos](../nodes-controles/huecos.md), [dependencias](../nodes-controles/dependencias.md).

Lista de secciones: 1 Pendientes y frágiles (20 filas) · 2 Decisiones revertidas (7) · 3 Regresiones (10) · 4 Respuestas a H1–H17 y huecos (27) · 5 Contradicciones (9).

Promesas del producto usadas para la gravedad: **P1** el modelo o proveedor no cambia sin que el usuario pulse Cambiar; **P2** no se gasta por encima de lo mostrado; **P3** una alerta nunca afirma algo falso.

## 1. Pendientes, frágiles y «sin cerrar»

Estado: **cerrado** (commit o código), **abierto** (evidencia en código) o **sin verificar**.

| # | Dónde se escribió | Qué decía | Estado hoy |
| --- | --- | --- | --- |
| 1.1 | `docs/history/050-2026-10-W43.md:11` (item 5, A24), 2026-10-23 | «Abierto: la conexión con índice propio no se ve en el tablero, y elegir otro resultado en el nodo no la cambia» | **Primera mitad cerrada** por `55f31d4` (mismo día): `NodeWorkspace.tsx:230` dibuja la conexión desde `resultHandle(e.outputIndex)` y `ConnectedNodeMenu.tsx:42-60` pinta un puerto numerado por resultado. **Segunda mitad, por diseño**: la conexión con índice propio ignora la elección del nodo (`graph.ts:387`, `freshness.ts:31`). |
| 1.2 | `050:12` (item 6) y `docs/pendientes.md:13` | «el dibujo no tiene prueba de render: falta mirarlo en el sandbox»; probar puertos por resultado, margen de precio y Nodes frenado por límite | **Sin verificar.** `tests/node-link-result.test.ts` cubre solo el modelo de datos (`connect`, `graphToSteps`); ninguna prueba toca `ResultPorts`. |
| 1.3 | commit `3753f82` (2026-10-22) y `163db69` | «audit E5-01»: el plan de Nodes no puede enviar dos candidatos del mismo paso; se avisa al agente | **Cerrado y retirado** por `33447d2` (A24). `nodeCandidateErrors` ya no existe en `src` ni `tests` (grep vacío). «E5-01» no aparece en ningún doc: solo en el mensaje de `3753f82`. |
| 1.4 | `07f535c` (2026-10-23), `050:7` | «Nodes con su motivo»: un Run aprobado desde el chat y frenado por el límite deja el motivo en la tarjeta, no «The execution changed» | **Cerrado y conservado** tras partir `runtime.ts`: `planRun.ts:127` y `:134`, `budget.ts:43` (`rerunNote`), prueba en `tests/node-agent.test.ts`. Residuo: ver 3.9. |
| 1.5 | `docs/history/002-2026-10-W40.md:39` (punto 4) | `RunButton` se suscribe a todo el estado y recalcula `previewRun`; «suscribirlo a dependencias concretas arriesga un precio desfasado» | **Abierto, decisión deliberada** (precio fresco frente a coste). Sigue en `nodes.tsx:55`. Coste no medido (H14, [huecos](../nodes-controles/huecos.md)). |
| 1.6 | `docs/history/002-2026-10-W40.md:40` | Guardado serializa todo el estado: «marcado como frágil (`feffc15`)» | Fuera del área; las zonas están en `docs/persistencia-protegida.md`. Sin verificar aquí. |
| 1.7 | `docs/pendientes-sistema.md:30` (F2, 2026-10-08) | `join_clips` no se ejecuta en Nodes | **Abierto**: `fromChat.ts:26` lo sigue diciendo y `nodes.tsx:654` filtra `multiInput` del menú de operaciones. |
| 1.8 | `docs/history/053-2026-10-W43.md:95` (C5) | «mensajes zod crudos en las herramientas de nodos» | **Abierto**: `nodeTools.ts:12`, `:34`, `:38`, `:45` devuelven `Invalid …: ${error.message}` de zod al modelo. Solo afecta al agente. |
| 1.9 | `docs/pendientes-gui.md:27` | Sin pruebas de interacción real sobre canvases incrustados; «la captura de Nodes tenía el grafo vacío» | **Abierto** (la propia fila está abierta; sin pruebas nuevas de ReactFlow con nodos reales: sin verificar). |
| 1.10 | `docs/pendientes-sistema.md:17` (C8, 2026-10-08) | Tests que fallan con carga: `chat-to-nodes`, `join-clips` | **Sin verificar** (no se ejecutó nada). |
| 1.11 | `docs/history/009-2026-09-W40.md:41-48` (Límites) | Run de Nodes sin LLM real ni E2E de proveedores de audio y operaciones; «no se añadieron controles de cascada» | **Abierto**: el recorrido de operaciones de Nodes con proveedor real sigue sin evidencia en docs; sin verificar. |
| 1.12 | `docs/history/009:44` | `run_nodes` «siempre espera clic, incluso Auto y coste cero» | **Cerrado/vigente**: `tools.ts:28`, `canvasCalls.ts`/`planRun.ts:91`. El aviso de [agente-nodes](../nodes-controles/agente-nodes.md) (fila 20: Auto aprueba coste 0) se refiere a planes de Nodes, no a `run_nodes`. |
| 1.13 | `docs/history/050:20` (B12 E1-01, `1b78aa1`) | Una variante de solo Chat se rechaza en Nodes al leerla | **Sin verificar** en código (no se rastreó la lectura). |
| 1.14 | `docs/pendientes-designer.md:11` (D11) | Nodos coincidentes del Designer: «Revisión de GPT pendiente» | Fuera del área (nodos de trazado, no del grafo de Nodes). |
| 1.15 | `docs/history/050:13` y `docs/pendientes.md:13` | Probar en sandbox: Price margin, tarjeta frenada por límite, puertos | **Sin verificar** (nada se ejecutó). |
| 1.16 | `locks.ts:12` frente a `:4-7` | Comentario de `lockedNodes`: «cannot be edited until it ends» | **Abierto**: obsoleto desde `b35a933`; ver 2.1 y 5.2. |
| 1.17 | Hallazgo H2, [hallazgos](../nodes-controles/hallazgos.md) | Modelos de operaciones ocultos en Nodes: «decisión» | **Abierto**: ninguna decisión escrita; ver 3.1 y 4. |
| 1.18 | `docs/pendientes.md:122` (G1) | ADR 0005, 0006, 0008, 0009 siguen «Propuesto» | **Abierto**: `docs/decisions/0009-disparo-forzado.md` conserva «Propuesto». Mientras, el contrato `ops-confirm-model` (`scripts/map-contracts.mjs:180`) lo trata como decisión del usuario. |
| 1.19 | `docs/history/050:8` | Auto reutiliza «Borrador (como antes)» (E2-01) y `confirmRepeat` (A1) | **Sustituido 2026-10-24** por `8fc96c0`/`cd15ef0`; `docs/pendientes-agente.md:9` lo dice. `confirmRepeat` ya no está en `src`; ver 2.6. |
| 1.20 | `docs/features/nodes.md` | Tabla de comportamiento con filas separadas por líneas en blanco (se rompe en varios renderizadores) | **Abierto**, cosmético. |

## 2. Decisiones tomadas y luego revertidas o sustituidas

| # | Decisión original | Reversión | Huellas hoy |
| --- | --- | --- | --- |
| 2.1 | **Bloqueo de edición durante un Run.** `353628e` (2026-09-29): los nodos de un Run quedan bloqueados para editar. | `f8afbb3` (2026-10-02): escribir exclusivo, leer compartido (un duplicado corre mientras su original). `b35a933` (2026-10-02, tocó `AGENTS.md`): el Run usa una copia del grafo y **editar es libre**; solo borrar un nodo que se genera espera. | `locks.ts:27` y `:4-7` lo dicen; pero `locks.ts:12` («cannot be edited») y `CanvasNavigation.tsx:71` (Undo/Redo bloqueados con cualquier nodo bloqueado o en cola) siguen la regla vieja. Ver 3.7. |
| 2.2 | **Parche E5-01.** `3753f82` (2026-10-22): el plan de Nodes rechaza dos candidatos del mismo paso y le dice al agente que parta en pasos. `163db69`: solo cuentan los resultados que el paso usa. | `33447d2` (2026-10-23): `GraphEdge.outputIndex`; cada conexión guarda su resultado; se retira el error al agente (`planSent.ts` pierde 7 líneas, `plan.ts` 3). | Test `tests/node-link-result.test.ts`; `tests/agent-route.test.ts` cambiado en el mismo commit; no queda código del parche. |
| 2.3 | **Un solo puerto «+» por nodo.** `1b050a7` (2026-09-30): sin etiqueta de salida; nombres de puerto solo mientras se conecta. | `55f31d4` (2026-10-23, decisión del usuario, convención Houdini/Nuke, `050:12`): un puerto numerado por resultado, visible al pasar el ratón, al seleccionar o con cable. | `ConnectedNodeMenu.tsx:42` (`ResultPorts`), `graph.ts:129-136`, `node.css`. El «+» sigue la elección del nodo. |
| 2.4 | **Las operaciones heredan el modelo de su origen, sin tarjeta** (ADR 0007-9; `b2470ef`, 2026-09-27: «via Model ▾» elige otro por ejecución). | ADR 0009 enmienda (2026-10-07/08, `454d721`, `2dde4db`): las operaciones con modelo de imagen **confirman** su modelo en la tarjeta (Auto una vez por sesión, Guided siempre, Direct usa el compositor); «rige lo más nuevo» (`docs/fusion-agent-forcing.md:31`). | Solo se reescribió la ruta de planes de chat: `plan.ts:859-860` estampa `params._modelRef`, `procedure.ts`, contrato `ops-confirm-model`. **La ruta de Nodes no se tocó**: `flow/actions.ts:228` y `catalog.ts:437` siguen resolviendo «el modelo del origen». Ver 3.1. |
| 2.5 | **Selector de modelo por ejecución en operaciones** (`b2470ef`, asset/Tools). | En Nodes solo llegó a las de vídeo: `3f3e974` y `0270631` (2026-09-29, `PICKABLE_VIDEO_OPS`, `catalog.ts:448`). Las de imagen en Nodes nunca lo tuvieron (`nodes.tsx:669`). | La ficha de assets sí lo tiene (`opRun.tsx:42`, `:115-135`, `pickable = target.kind==='asset' && opFollowsSource`). Asimetría, ver 3.2. |
| 2.6 | **A1 `confirm_settings` repetida:** `e5b2c17` (2026-10-23) la responde la app sin tarjeta en Auto. | `8fc96c0` (2026-10-24): «drop the repeated-confirmation shortcut»; `cd15ef0`: Auto con una sola tarjeta. | `confirmRepeat` ya no está en `src`; quedan menciones históricas en `050:29`, `051`, `docs/features/agente-auto-tarjeta.md`. Afecta a los planes que acaban en Nodes, no al grafo. |
| 2.7 | **Mensaje de Nodes frenado por límite** («The execution changed», `07f535c` el día antes: toast y mensaje falso). | Reemplazado por el motivo real. | `budget.ts:43`. Sin reversión posterior. |

## 3. Regresiones y contradicciones con promesas

Gravedad por impacto real en el usuario; «probado» = por lectura de código, no reproducido.

| # | Hallazgo | Evidencia | Promesa | Gravedad | Certeza |
| --- | --- | --- | --- | --- | --- |
| 3.1 | **El modelo confirmado de una operación de imagen se ignora al correrla en Nodes.** Un plan de chat estampa `params._modelRef` (modelo confirmado, ADR 0009) en los pasos `edit`; `planToGraph` lo copia al nodo (`graph.ts:166`). La **estimación** usa `_modelRef` (`executor.ts:87`). La **ejecución** pasa `nodeChoice` para toda operación que no sea local ni de voz (`flow/actions.ts:228`, `executor.ts:283`) y `opSpec` da prioridad a `nodeChoice` (`jobs.ts:1074`); para `edit` `chosen` solo existe en operaciones de vídeo (`PICKABLE_VIDEO_OPS`), así que corre el modelo del origen. Cronología: `nodeChoice` es de `353628e` (2026-09-29); el estampado `_modelRef`, de `454d721` (2026-10-08): la decisión nueva no llegó a Nodes. | `plan.ts:859-860`, `graph.ts:166`, `flow/actions.ts:224-229`, `executor.ts:87`, `executor.ts:283`, `jobs.ts:1074` | P1 (modelo distinto del confirmado) y P2 (precio de un modelo, envío con otro; el freno al enviar `checkStepAuthorization` compara contra la autorización del modelo estimado) | Alta | **Probado** por lectura de la cadena y reproducido; **corregido en ea47987** (con `_modelRef` manda ese modelo; `tests/repro-nodes-model.test.ts`; visto en sandbox con gasto real: estimado y facturado 0,027 con el modelo del plan). |
| 3.2 | **Modelo oculto en las operaciones de imagen de Nodes, sin selector**, mientras la ficha de assets sí lo tiene (`opRun.tsx:115`). El nodo muestra solo el precio (`SpendConfirm` no nombra modelo). Sin decisión escrita (ver 4, H2). | `nodes.tsx:669`, `catalog.ts:437-445`, `opRun.tsx:42` | P1 de forma indirecta: el usuario no ve qué modelo cobra | Media-alta | Probado |
| 3.3 | **`edit_node` cambia el modelo sin tarjeta, y también con `params._modelRef`.** `model_ref` entra por `setNodeModel` (`nodeTools.ts:27`); además el esquema acepta cualquier clave en `params` (`tools.ts:17`) y `nodeTools.ts` la mezcla sin filtrar, así que el agente puede fijar `_modelRef` de una operación de vídeo. La única barrera es texto de prompt (`changeRules.ts:2` habla de `confirm_settings`, no de `edit_node`; `context.ts:350` manda usar `edit_node` sin esa cautela). `tests/node-agent.test.ts:54` solo prueba el rechazo por tipo. | `nodeTools.ts:23-31`, `tools.ts:15-17`, `context.ts:350` | P1 | Media-alta (capacidad; no hay caso reportado) | Probado como capacidad; uso real sin reproducir (H1 abierto). |
| 3.4 | **Campos obligatorios no se validan en el nodo.** La ficha bloquea el botón si falta un `required` (`opRun.tsx:70`: «Fill in…»); `previewRun`/`runNodes` no tienen equivalente (grep de `required` en `flow/` vacío) y el nodo nace con `defaultOpParams` (cadena vacía). Run sobre `edit`, `replace_background`, `video_edit`, `video_extend` de un nodo recién creado envía una instrucción vacía. | `ops.ts:249`, `:260`, `:360`, `:371`, `:384`; `flow/actions.ts:243-290` | P2 de forma indirecta (gasto sin entregable útil) | Media-alta | Probado por contraste; la respuesta del proveedor no se comprobó. |
| 3.5 | **A24 deja caer el resultado propio en operaciones de grafo.** `duplicateNode` reconecta las entradas con `{source, target, targetHandle}` sin `sourceHandle` (`actions.ts:151`, `:157`), así que `connect` (`graph.ts:143`) pierde `outputIndex`: la copia usa el resultado elegido en el nodo origen, no el del cable. Mismo hueco al soltar un cable desde «2» en el fondo: `connectionDrop.ts` devuelve solo `from` (nodo), `addConnected` conecta sin `sourceHandle` (`addConnected.ts:38-40`), contra la promesa del propio puerto («links from here always use it», `ConnectedNodeMenu.tsx:55`). | `actions.ts:134-162`, `connectionDrop.ts:5-14`, `addConnected.ts:37-43` | Entregable equivocado (entra otra imagen sin aviso) | Media | Probado; **corregido en 91ea576**: reproducido en `tests/repro-nodes-image.test.ts` y `tests/repro-nodes-drop.test.ts`; duplicar y soltar el cable vistos en sandbox con gasto real (`out-2`, `outputIndex 1`). |
| 3.6 | **Borrar un asset desplaza los índices de resultado.** `deleteAssets` filtra `g.assetIds` (`engine/actions.ts:556`); `data.outputIndex` y `edge.outputIndex` son posiciones en ese arreglo y no se reubican; `deleteGeneration` sí limpia `generationId` del nodo (`engine/actions.ts:520-535`). Entrada: «Delete asset» en el detalle de un resultado sin confirmación (`nodes.tsx:149`, H3). Tras borrar el resultado 1 de 3, el cable «2» y la elección del nodo apuntan a otra imagen. | `nodes.tsx:149`, `engine/actions.ts:547-560`, `fromNodes.ts:30`, `freshness.ts:31`, `graph.ts:387` | Entregable equivocado en silencio | Media-alta | Probado por lectura; **corregido en 91ea576** (`flow/dropResults.ts`) y completado por ba66e08/5c65acc (un cable cuya imagen se borró queda `NO_RESULT`, no vuelve a entregar otra imagen ni en Run all): pruebas automáticas; el caso 1 de 3 se vio en sandbox con gasto real, `NO_RESULT` no. Extiende H3 con un efecto que el hallazgo no recoge. |
| 3.7 | **Undo y Redo bloqueados durante un Run, sin motivo, pese a que editar sí es libre.** `CanvasNavigation.tsx:71` mantiene la regla de `353628e` tras `b35a933`; el botón no dice por qué ni el atajo avisa (H10). Comentario de `lockedNodes` obsoleto. | `CanvasNavigation.tsx:71-74`, `locks.ts:12` | Fricción (críticos según [pendientes](../pendientes.md)) | Baja-media | Probado |
| 3.8 | **Pulsar Run: la confirmación puede no hacer nada sin decirlo.** `onConfirm` sale si `previewRun(...).signature !== preview.signature` sin toast ni cambio en la ventana (`nodes.tsx:71`); además solo se muestra `preview.errors[0]` (`:61`, `actions.ts:329`). Como `preview` se recalcula en cada cambio del almacén (`nodes.tsx:55`), el desacuerdo es poco probable. | `nodes.tsx:55-72`, `actions.ts:329-330` | P3 (sin mensaje) | Baja | Probado; frecuencia sin medir |
| 3.9 | **Run frenado en `runNodes` con causa distinta del límite se rotula «The execution changed».** `approveNodeRun` rama `!result`: `next.errors` vacío ⇒ `rerunNote` (`planRun.ts:134`). `runNodes` también devuelve `null` si `budgetProblem` (`actions.ts:330`) pero ese caso ya es `overLimit`; el hueco real es la firma que cambia por otra causa y no el gasto: el texto es veraz («changed»). Sin falsedad demostrada. | `planRun.ts:119-135`, `budget.ts:43` | P3 | Sin gravedad | Sospecha descartada por lectura |
| 3.10 | **Run lanza `Error` de bloqueo no capturado.** `lockNodes` lanza «These nodes or their inputs are already running.» (`locks.ts:22`) y `runNodes` lo llama sin `try` entre `lockNodes` y `finally` (`actions.ts:332`, antes del `try`); la revisión previa lo evita en la ruta normal (`actions.ts:261`) pero una carrera entre dos clics lo deja como promesa rechazada. | `locks.ts:20-26`, `actions.ts:327-345` | Fricción | Baja | Sospecha, no demostrada |

## 4. Respuestas a hallazgos H1–H17 y huecos

Lo que historial y docs **ya responden**, con cita. Lo no respondido va marcado «sin respuesta en docs».

| Pregunta | Qué dicen historial y docs | Veredicto sobre intención |
| --- | --- | --- |
| H1 `edit_node.model_ref` sin tarjeta | `docs/history/009-2026-09-W40.md:44` y `1cda323`/`353628e` (2026-09-29): «las herramientas reutilizan las acciones de la UI». La regla «nunca cambiar por su cuenta» llegó después (`035bef7`, 2026-10-20, y ADR 0025 D, `0009-disparo-forzado.md` actualización) y se escribió para `confirm_settings`. | **No hay decisión escrita de permitirlo**: es herencia de reutilizar la acción de UI, anterior a la regla. Ver 3.3. |
| H2 ocultar modelos de operaciones | Ningún doc de historial, ADR ni feature trata el modelo de las operaciones **en Nodes**. `b2470ef` dio el selector a la ficha de assets; `3f3e974`/`0270631` lo dieron a las de vídeo en Nodes; ADR 0009 solo cubre planes de chat. | **Omisión, no decisión.** Pendiente de decisión del usuario. |
| H3 Delete asset sin confirmar | `b9bd710` (2026-09-29, «details deletion and parameter reuse»). Sin discusión en docs de confirmar o no. | Sin respuesta en docs. Efecto añadido: 3.6. |
| H4 «Continue anyway» global | Sustituido por `withOncePass`, `dontAskAgain` y el interruptor `budgetNoAsk`. | Corregido parcialmente: solapamiento de acciones pendiente de prueba. |
| H5 / H6 `setNodeOp` y cambio de modelo borran enlaces | `flow/actions.ts:94-99` (docstring: «connections the new output … no longer fit are dropped»). Sin aviso al usuario discutido. | Deliberado en el código; el aviso, sin respuesta. |
| H7 conexión a puerto sencillo sustituye | `graph.ts:137` («replacing the existing edge on single-input ports»); herramienta `connect_nodes` lo dice en `tools.ts:24`. | Deliberado. |
| H8 ajustes ocultos del Composer copiados | `newNodeData` (`actions.ts:48`); sin discusión. | Sin respuesta en docs. |
| H9 `coerceSettings` silencioso | Sin respuesta en docs. | — |
| H10 Undo desactivado sin motivo | Cronología en 2.1: regla heredada de `353628e`. | **Resto de una decisión revertida**, no elección. |
| H11 sin Stop por nodo | `docs/history/009` no menciona Stop de Nodes; las tarjetas de plan tienen Cancel (`3dc6465`, `58bab6e`, 2026-10-18). | Sin respuesta en docs. |
| H12 `edit_region`/`remove_object`/`create_voice` en Nodes | Sin respuesta en docs; `fromChat.ts:26` dice que «mask edits» no se ejecutan en Nodes y entran como resultado. | Contradice el selector (sección 5). |
| H13 `required` sin validar | Sin respuesta en docs. Ver 3.4. | — |
| H14 `previewRun` en cada cambio | `002:39` (punto 4): decisión consciente. | Deliberado, no medido. |
| H15 sin marca de desactualizado | `grep stale src/styles src/components` sin resultados; `nodeIsCurrent` solo se usa en `graph.ts:365`. | **Hueco cerrado por lectura**: no existe marca. Decisión de producto sin escribir. |
| H16 Auto layout sin confirmar | Sin respuesta en docs; se deshace con Ctrl+Z. | — |
| H17 precios desconocidos no cuentan | Resuelto 2026-10-29 (e978427): `overLimit` pide confirmar con precio desconocido y límite activo; `noteExcess` avisa si el coste real pasa el límite. | Resuelto (prueba automatizada). |
| Hueco: marca visual de desactualizado | Ver H15. | Cerrado. |
| Hueco: `edit_node.model_ref` con agente real | Sin sesión de sandbox en docs. `tests/node-agent.test.ts:54` solo prueba el rechazo. | Abierto. |
| Hueco: ejecución de `edit_region`, etc. | `fromChat.ts:26` (importación); ejecución en Nodes: ver `ops.ts:375-400`, sin lectura de ejecutor. | Abierto. |
| Hueco: validación `required` | Respondido por lectura: no existe en `flow/` (3.4). | Cerrado por lectura; falta ver la respuesta del proveedor. |
| Hueco: recarga durante ejecución | `locks.ts` es un `Map` en memoria (`:9`): se pierde al recargar; las generaciones sí persisten. Resto sin leer. | Abierto. |
| Hueco: coste de `previewRun` | `002:39`. | Abierto. |
| Hueco: borrar asset de un nodo de generación | **Respondido por lectura**: ver 3.6. | Cerrado por lectura; falta confirmar en sandbox. |
| Hueco: formato de guardado de `graph` | `GraphEdge.outputIndex` opcional, grafos antiguos se leen igual (`050:11`, `types.ts:659`). | Parcialmente respondido. |
| Hueco: accesibilidad por teclado | Sin respuesta en docs. | Abierto. |
| Hueco: ajustes ocultos hasta el proveedor | Sin respuesta en docs. | Abierto. |

## 5. Contradicciones entre docs y con el código

| # | Contradicción | Dónde |
| --- | --- | --- |
| 5.1 | ADR 0009 dice que una operación de imagen corre con el modelo confirmado «no con el de su origen» (Enmienda a 0007-9), y `docs/fusion-agent-forcing.md:31` y el contrato `ops-confirm-model` lo fijan. El código de Nodes y de la ficha de assets sigue usando el modelo del origen (`catalog.ts:437`, `flow/actions.ts:228`, `executor.ts:87`) y `b2470ef` lo presenta como diseño. El ADR no dice que se limita a planes de chat. Precisión: `executor.ts:87` y `jobs.ts:1074` sí respetan `params._modelRef` cuando no hay `nodeChoice`; lo que lo ignoraba era el camino `nodeChoice` (`flow/actions.ts` `requestContext`) en operaciones de imagen, corregido 2026-10-29 (con `_modelRef` manda ese modelo); no se cita como prueba de lo contrario. | `docs/decisions/0009-disparo-forzado.md` (Decisión 5), `src/engine/catalog.ts:437` |
| 5.2 | `locks.ts:27` y `:4-7`: «editing is always allowed»; `locks.ts:12`: los nodos de un Run «cannot be edited until it ends». | `src/engine/flow/locks.ts` |
| 5.3 | [hallazgos](../nodes-controles/hallazgos.md) H10 cita `locks.ts:20` para el bloqueo de Undo; ese número es `lockNodes`. El Undo se bloquea en `CanvasNavigation.tsx:71` (lo dice bien [deshacer-bloqueos](../nodes-controles/deshacer-bloqueos.md)). | `hallazgos.md` H10 |
| 5.4 | H2 repite la evidencia `engine/catalog.ts:437` dos veces y no menciona que los pasos de plan llevan `_modelRef` estampado (3.1), por lo que «modelo del nodo de origen» no es la única fuente. | `hallazgos.md` H2 |
| 5.5 | H1 asegura que «la regla del agente solo le indica no cambiar por su cuenta» con cita a `changeRules.ts:2`; esa regla habla de `confirm_settings`, y `context.ts:350` instruye usar `edit_node` sin ese freno. | `hallazgos.md` H1 |
| 5.6 | `nodes.tsx:254`: el tooltip «Use output N downstream» sugiere que la elección del nodo alimenta a los siguientes, pero una conexión con índice propio (A24) la ignora. | `src/components/node/nodes.tsx:254`, `graph.ts:387` |
| 5.7 | `docs/history/050:11` (item 5) deja «Abierto … no se ve en el tablero» y el item 6 del mismo documento lo resuelve; `050:Pendiente` solo pide pruebas de sandbox. Ambas lecturas coexisten. | `050-2026-10-W43.md` |
| 5.8 | `fromChat.ts:26` dice que las máscaras no se ejecutan en Nodes y [hallazgos](../nodes-controles/hallazgos.md) H12 dice que `edit_region`/`remove_object` aparecen en los selectores de nodo (comentario de `ops.ts`). Sin docs que los reconcilien. | `fromChat.ts:26`, `hallazgos.md` H12 |
| 5.9 | `docs/pendientes.md:34` («agente A1 a A24») frente a `docs/history/054-2026-10-W44.md` (A25–A28 en curso): índice desactualizado. | `docs/pendientes.md:34` |

## Resumen

Recuentos: sección 1 = 20, 2 = 7, 3 = 10 (8 probadas por lectura, 2 sospechas), 4 = 27, 5 = 9.

Top 10 por impacto en el usuario:

1. 3.1 Modelo confirmado de una operación de imagen ignorado al correr en Nodes (P1/P2, probado por lectura).
2. 3.3 `edit_node` cambia modelo (también `_modelRef`) sin tarjeta (P1).
3. 3.4 Operaciones con campo obligatorio vacío se envían (gasto sin entregable).
4. 3.6 Borrar un asset desplaza `outputIndex` y los cables de A24 (entregable equivocado). Corregido 2026-10-29 (91ea576, ba66e08).
5. 3.2 Modelo oculto en las operaciones de imagen de Nodes (H2).
6. 3.5 Duplicar y soltar desde «2» pierden el resultado del cable.
7. 3.7 Undo bloqueado sin motivo mientras editar es libre.
8. 3.8 Confirmar Run sin respuesta si la firma cambia.
9. H3 / H11: Delete asset sin confirmar y sin Stop por nodo.
10. H15 sin marca de nodo desactualizado.

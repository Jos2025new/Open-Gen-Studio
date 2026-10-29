---
type: inventario
title: El agente y el Composer en Nodes
description: Entradas del agente al grafo (herramientas, nodos borrador de un plan, tarjeta de Run propuesta), el Composer y el hilo en el espacio Nodes, e importaciones entre el chat y los nodos.
tags: [nodes, agente, composer, plan]
updated: 2026-10-28
related: [ejecucion, deshacer-bloqueos, dependencias, hallazgos]
---
# El agente y el Composer en Nodes

El selector de espacio y los controles del modo están debajo del prompt compacto. La zona del dock tiene un fondo del color del lienzo para mantenerlos legibles sobre el grafo.

En el espacio Nodes se monta el mismo `Composer` que en el resto (`App.tsx:76`). Lo que cambia en Nodes está aquí; el resto (modelos, ajustes, adjuntos, tarjetas de plan y de preguntas) está descrito en [composer](../studio-controles/composer.md), [tarjeta-plan](../studio-controles/tarjeta-plan.md) y [tarjeta-preguntas](../studio-controles/tarjeta-preguntas.md). No existe ningún objeto llamado «parche candidato» en el código de Nodes: lo más parecido son los nodos borrador de un plan y las ediciones de `edit_node`; «candidato» solo aparece como campo de operaciones (`count: Candidates`, `engine/ops.ts:222`) y en la documentación como el resultado elegido (`outputIndex`).

| Control | Dónde aparece | Cuándo aparece | De qué depende | Qué modifica | Influye en | Notas |
| --- | --- | --- | --- | --- | --- | --- |
| Composer en Nodes (modo directo: imagen, vídeo, audio) | `Composer.tsx:190` | Espacio Nodes | `composer[kind]`, texto y adjuntos | `generateDirect` → `runInNodes`: crea un nodo Prompt, nodos Reference (uno por adjunto) y el nodo de generación, y lo ejecuta (`engine/actions.ts:327`) | Grafo y **gasto** | Se gasta con el propio botón de envío cuando el precio es conocido y cabe en el límite; si el precio es desconocido o pasa el límite, el Composer abre la revisión (`Composer.tsx:204`). Detalle en [composer](../studio-controles/composer.md). No hay botón Stop del nodo |
| Composer en Nodes (modo agente) | `Composer.tsx:493` | Modo Agent | `agent`, estilo (Guided, Auto, Direct) | El agente trabaja en el lienzo de nodos (`workspace === 'node'`) | Grafo | Ver [composer](../studio-controles/composer.md) |
| Conversation (hilo plegable) | `ThreadPeek.tsx` | En Nodes aparece tras un mensaje del usuario al agente en esa sesión; Designer conserva su comportamiento | `ui.threadOpen` y mensajes del espacio | Abre o pliega el hilo; se abre cuando el agente trabaja | Tarjetas de plan, avisos de borrado | Sin conversación en Nodes, los avisos de borrado recuperables aparecen aparte con Undo |
| Tarjetas del hilo en Nodes | `ThreadPeek.tsx:50` | Hilo abierto | `feed` | Las tarjetas de plan, avisos y mensajes | | Los elementos de otro espacio llevan una etiqueta (`FeedList.tsx:147`) |
| Plan del agente en Nodes: nodos borrador | `runtimeShared.ts:298` | El agente propone un plan en `workspace === 'node'` | `planToGraph`, posición a la derecha de lo existente | Crea nodos con `planId` (borradores sin generación) y enlaces, y los encuadra (`runtimeShared.ts:257`) | Grafo | Si el plan se revisa, se cancela o se borra el mensaje, los borradores sin resultado se quitan (`planRun.ts:33`) |
| Aprobación del plan de Nodes | `runtimeShared.ts:267` | Estilo Auto | `needsSpendCheck` (`pricing.ts:120`) | Solo los planes con coste exactamente 0 se aprueban sin clic; el resto espera el botón de la tarjeta | Gasto | La tarjeta lleva `nodeRun` y vuelve a calcular su precio cuando cambia el grafo (`PlanCard.tsx:152`) |
| Run existente propuesto por el agente (`run_nodes`) | `canvasCalls.ts:79` | El agente llama a la herramienta en Nodes | `presentNodeRun` (`planRun.ts:91`) | Crea una tarjeta «Run existing nodes» en espera con el precio; «waits for the user approval click, even in Auto» (`tools.ts:28`) | Gasto | Si hay errores no crea tarjeta y el agente recibe «Run blocked before spending» |
| Aprobar la tarjeta de Run | `planRun.ts:117` | Botón de la tarjeta | Firma de la ejecución | Si cambió el grafo o el precio: no ejecuta y marca «The execution changed. Review this version and approve again.»; si pasa el límite: muestra el texto del límite (`planRun.ts:127`) | Gasto | Misma revisión de firma que el Run manual |
| Cancelar una ejecución del agente | `PlanCard.tsx:189` | Tarjeta en ejecución | `stepGenerations` | `stopPlanRun` y `cancelGeneration` de cada generación viva | Gasto | Es el único Cancel que alcanza a una generación de nodos |
| Fallo y recuperación | `planRun.ts:368` | Plan de Nodes con pasos fallidos | — | No hay «Retry» ni «Check status» de la tarjeta (`planRecovery` devuelve `null` para Nodes) | — | El agente recibe «Plans on the Node canvas are rerun from their nodes.» |
| `read_graph` | `canvasCalls.ts:185` | Solo en Nodes | Grafo, selección | Nada: solo lectura (`graphView.ts:55`) | Contexto del agente | Muestra un índice de 40 nodos por página y hasta 10 con detalle |
| `edit_node` | `tools.ts:23` | En Nodes | `node_id` | Cambia título, prompt, **modelo** (`model_ref`), ajustes y parámetros de herramienta; usa `setNodeModel` y `patchNodeData` (`nodeTools.ts:27`) | Grafo, modelo del nodo | Sin tarjeta de confirmación; ver [dependencias](dependencias.md) (promesa P1) |
| `connect_nodes` / `disconnect_nodes` | `tools.ts:24` | En Nodes | | `connectNodes` (misma validación que la interfaz; «replaces an occupied single-input port») / `disconnectEdges` | Grafo | Sin confirmación |
| `delete_nodes` | `tools.ts:26` | En Nodes | `node_ids` (1 a 40) | `deleteNodesWithUndo`: borra «No extra confirmation» y deja el aviso con Undo (`nodeTools.ts:55`) | Grafo | |
| `restore_nodes` | `tools.ts:27` | Solo si el usuario pide recuperar | `deletion_id` del contexto | `restoreNodeDeletion` | Grafo | |
| Selección compartida | `canvasCalls.ts:192` | Siempre | Selección del lienzo | Se usa para resolver «esto» | Contexto del agente | |
| Import from Chat | `NodeWorkspace.tsx:537` | Lienzo completo | Ver [lienzo](lienzo.md) | | | |
| Import from Nodes (en el chat) | `fromNodes.ts:39` | Chat de Studio | `nodeWorkNotInChat` | Añade referencias del chat a generaciones de nodos existentes, sin generar ni cobrar (`fromNodes.ts:38`) | Chat | Pertenece a Studio; se cita aquí por ser la otra mitad |
| Enviar desde el chat al lienzo (agente) | `canvasCalls.ts:7` | Herramienta `continue_in_canvas` | | | | Ver [tablero](../studio-controles/tablero.md) |

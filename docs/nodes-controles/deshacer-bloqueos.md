---
type: inventario
title: Deshacer, rehacer y bloqueos de Nodes
description: Cómo se registra el historial del grafo, qué restaura y qué no, cuándo se bloquea, los bloqueos de ejecución (escritura, lectura, assets) y los dos caminos para recuperar un borrado.
tags: [nodes, historial, bloqueos, deshacer]
updated: 2026-10-28
related: [navegacion, ejecucion, agente-nodes, dependencias]
---
# Deshacer, rehacer y bloqueos de Nodes

Los botones y atajos están en [navegacion](navegacion.md); aquí está lo que hacen por dentro. Todo cambio del grafo pasa por `setGraph` (`store.ts:556`), que lo registra con `recordGraph` y lo rechaza si `graphEditProblem` lo prohíbe (`store.ts:559`).

| Control | Dónde aparece | Cuándo aparece | De qué depende | Qué modifica | Influye en | Notas |
| --- | --- | --- | --- | --- | --- | --- |
| Pila de historial por sesión | `flow/history.ts:5` | Siempre | `sessionId` | Guarda hasta 40 entradas «antes/después» (`flow/history.ts:44`) | Undo, Redo | Vive solo en memoria: se pierde al recargar la página. No persiste |
| Qué se registra | `flow/history.ts:20` | Cada cambio de nodos, enlaces y grupos | `logical(before)` frente a `logical(after)` | Ignora cambios que solo mueven `generationId` (un resultado nuevo no entra en el historial) | Undo | Etiqueta: «Add …», «Delete …», «Change connections», «Move …» o «Edit …» (`flow/history.ts:36`) |
| Fusión de ediciones seguidas | `flow/history.ts:40` | Misma clave de edición o de movimiento en menos de 700 ms y sin entradas de rehacer | `key` | Reemplaza la última entrada | Historial | Escribir un prompt o arrastrar un nodo cuenta como una acción |
| Rehacer se vacía | `flow/history.ts:46` | Cualquier cambio nuevo | — | Borra la pila de rehacer | Redo | Normal |
| Undo / Redo restauran | `flow/history.ts:49` | Al pulsar | Grafo guardado | Aplica el grafo anterior o posterior, **conservando el viewport actual y, para cada nodo, el resultado (`generationId`, y `outputIndex`/`sketch` si el resultado es más nuevo)** (`flow/history.ts:59`) | Grafo | Deshacer nunca borra ni quita un resultado ya generado; deshacer «Delete» devuelve el nodo con el resultado vivo. Pendiente de comprobar: si deshacer un borrado de resultado restaura también `outputIndex`/`NO_RESULT` (no se probó; el borrado de assets no pasa por este historial) |
| Undo y Redo desactivados | `CanvasNavigation.tsx:86` | Hay nodos bloqueados por una ejecución o algún nodo en cola o ejecutando | `lockedNodes`, `generations` | `travel` no hace nada si `blocked` | Botones y atajo | La etiqueta del botón no dice el motivo («Undo · right-click for history»); con el atajo no hay aviso. Regla heredada de `353628e`; editar es libre desde `b35a933`, así que el bloqueo sigue sin que conste si es intencional (requiere decisión; [rastreo 3.7](../rastreo/nodes.md#3-regresiones-y-contradicciones-con-promesas)) |
| Rechazo por nodo en generación | `locks.ts:28` | Cualquier edición que **quite** un nodo que se está escribiendo | `writingNodes` | Toast «This node is generating. Wait for it to finish before deleting it.» (`locks.ts:30`) | Borrar, cortar, deshacer un alta | El resto de ediciones sigue permitida durante la ejecución (usa una copia del grafo al arrancar, `flow/actions.ts:333`) |
| Bloqueo de escritura | `locks.ts:20` | Al arrancar `runNodes` | Nodos que ejecuta | Exclusivo: nadie más puede escribir ni leer esos nodos | Run, Run all | Lanza «These nodes or their inputs are already running.» si se solapa (`locks.ts:22`); antes, la revisión muestra «“título” is already running.» |
| Bloqueo de lectura | `locks.ts:23` | Al arrancar | Entradas aguas arriba | Compartido: dos ejecuciones pueden leer la misma entrada | Run | Mientras dura no se puede escribir ese nodo |
| Bloqueo de assets | `locks.ts:36` | Durante `runNodes` (entradas, sujetos y máscara) | `assetIds` | `assetsInUse` impide borrarlos: toast «An asset is in use by a running flow. Wait for it to finish.» | «Delete asset» del historial, borrado de generaciones | |
| Undo del aviso «Deleted nodes…» | `FeedList.tsx:127` | Aviso en el hilo (Conversation) tras borrar nodos por cualquier vía; el botón desaparece al usarlo | `undoNodes` | `restoreNodes`: devuelve los nodos y solo los enlaces cuyo puerto sigue libre y válido (`flow/actions.ts:380`) | Grafo | Segundo camino, distinto de Ctrl+Z; no restaura el grupo del nodo. El texto del aviso se actualiza con los enlaces no restaurados |
| Restaurar con el agente | `nodeTools.ts:44` | Solo si el usuario pide recuperar | `deletion_id` | Mismo `restoreNodeDeletion` | Grafo | Ver [agente-nodes](agente-nodes.md) |

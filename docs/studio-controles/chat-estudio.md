---
type: inventario
title: Chat de Studio
description: Lista de mensajes del chat de Studio, estado vacío, mensajes del usuario, avisos, actividad del agente y filas de resultados.
tags: [studio, chat, feed]
updated: 2026-10-28
related: [tablero, composer, tarjeta-plan, tarjeta-ajustes, tarjeta-preguntas, resultados]
---
# Chat de Studio

`ChatWorkspace` (`ChatWorkspace.tsx:16`) dibuja el chat y `FeedList studio` (`ChatWorkspace.tsx:65`) la conversación completa de la sesión: en Studio se ven los mensajes de los tres lienzos, sea cual sea la vista del tablero (`studioBoard.ts:42-46`, `FeedList.tsx:190-191`). Las tarjetas se despachan en `FeedItemView` (`FeedList.tsx:144-181`): `user`, `assistant`, `activity`, `questions`, `settings` (no se dibuja si `item.inline`, `FeedList.tsx:172`), `plan`, `generation`, `notice`.

Columnas: Control | Dónde (archivo:línea) | Cuándo | De qué depende | Qué modifica | Influye en | Notas.

## Estado vacío y desplazamiento

| Control | Dónde | Cuándo | Depende de | Modifica | Influye en | Notas |
| --- | --- | --- | --- | --- | --- | --- |
| Tres sugerencias (Agent, Agent, Image) | `ChatWorkspace.tsx:10-14,75-89` | Sin mensajes en ningún lienzo (`count === 0`, `ChatWorkspace.tsx:63`) | `SUGGESTIONS` fijas | `setComposer({ text, mode })` y `setUi(focusComposer +1)` | [Compositor](composer.md): texto y modo | No envía nada ni gasta: solo rellena el compositor. La etiqueta «Image» fija el modo imagen aunque el estilo del agente sea otro |
| Texto «What are we making?» / «…the agent plans it and asks before spending.» | `ChatWorkspace.tsx:72-73` | Estado vacío | — | — | — | Texto fijo. Es una promesa del producto; la comprobación de que el agente siempre pide antes de gastar está en [dependencias](dependencias.md) |
| Jump to latest (↓) | `ChatWorkspace.tsx:92-104` | Desplazado a más de 80 px del final (`ChatWorkspace.tsx:54`) | `scrollRef` | Desplazamiento suave al final | — | Mientras se está en el final el chat lo sigue (`stick`, `ChatWorkspace.tsx:40-43`); al cambiar de sesión salta al final (`ChatWorkspace.tsx:45-49`) |
| Seguimiento del final | `ChatWorkspace.tsx:27-43` | Cambia el último elemento, el texto que se escribe o los pensamientos | `lastKey` (id y longitud de texto o de entradas de actividad) | Mueve `scrollTop` | — | Automático |
| Import from Nodes (botón + diálogo) | `ChatWorkspace.tsx:61`, `ImportFromChat.tsx:30-103` | Fuera de Home (`!home`) | `nodeWorkNotInChat(sessionId)` (`fromNodes.ts:14`): resultados del grafo cuya generación no está ya en el chat | `nodesToChat(sessionId, ids)` | Añade resultados al chat | Botón en la barra superior (`TopbarActions side="left"`, `ImportFromChat.tsx:63`); sin aviso (`notice=false`, `ImportFromChat.tsx:127`). Diálogo: casillas, All/None, `Import N`. No gasta: `nodesToChat` añade filas `generation` con `mirroredFrom: 'node'` sobre generaciones existentes (`fromNodes.ts:39-51`) |

## Lista y avisos de la lista

| Control | Dónde | Cuándo | Depende de | Modifica | Influye en | Notas |
| --- | --- | --- | --- | --- | --- | --- |
| Show the other canvases too (N) / Show only this canvas | `FeedList.tsx:202-206` | Hay elementos de otros lienzos | `others` | `setEverywhere` | Lista | En Studio `shown` ya incluye los tres lienzos (`FeedList.tsx:191`), y `Workspace` solo tiene esos tres valores (`types.ts:8`), por lo que `others` es siempre 0 y el botón no aparece; queda como código no alcanzable en Studio (ver [hallazgos](hallazgos.md)) |
| Estado «Working on it… / Drafting the plan… / Checking the plan…» | `FeedList.tsx:195-219,265` | `agent.busy`, sin actividad abierta ni texto escribiéndose | `agent.phase` | — | — | Informativo (`role=status`) |
| Etiqueta de lienzo (Chat/Node/Designer) | `FeedList.tsx:147` | Solo fuera de Studio (`!studio`) | `item.workspace` | — | — | En Studio no se dibuja |

## Mensaje del usuario

| Control | Dónde | Cuándo | Depende de | Modifica | Influye en | Notas |
| --- | --- | --- | --- | --- | --- | --- |
| Copy | `FeedList.tsx:108` | Solo al pasar el puntero o enfocar el mensaje (`chat.css:113-114`); con pantalla táctil siempre visibles (`chat.css:115`) | `item.text` | `copyText` | Portapapeles | — |
| Edit | `FeedList.tsx:109-111` | `editable`: `item.workspace === current` o `current === 'chat'` (`FeedList.tsx:60`) → siempre en Studio | `agent.busy` | Abre editor en línea | — | Deshabilitado con el agente ocupado |
| Editor › Cancel / Send / Intro / Esc | `FeedList.tsx:87-99` | Editando | `draft`, `busy` | `editUserMessage(sessionId, id, draft)` (`messageEdit.ts:46`) | Descarta ese mensaje y todo lo posterior de todos los lienzos (y planes a la espera, con sus nodos borrador), y vuelve a enviar | Aviso previo en pantalla si hay mensajes posteriores (`FeedList.tsx:95`); «results stay in Assets». **Puede volver a lanzar al agente (coste de LLM) y, si el nuevo turno llega a un plan, a mostrar nuevos precios**: no aprueba nada por sí mismo. Intro envía, Mayús+Intro salto de línea, Esc cancela |
| Delete | `FeedList.tsx:112` | Puntero/foco (`chat.css:113-114`) | `agent.busy` | `deleteUserMessage` (`messageEdit.ts:32-40`) | Quita el mensaje del chat y lo neutraliza en el historial del agente | Sin confirmación, sin deshacer. Es borrado de un mensaje, no de datos de generación |
| Adjuntos del mensaje (miniaturas) | `FeedList.tsx:71-79` | El mensaje tiene adjuntos | `item.attachments` | — | — | Solo vista |

## Mensaje del agente, actividad y avisos

| Control | Dónde | Cuándo | Depende de | Modifica | Influye en | Notas |
| --- | --- | --- | --- | --- | --- | --- |
| Texto del agente (RichText) | `FeedList.tsx:154-165` | Hay texto (se omite si el turno solo llamó herramientas) | `item.text`, `item.streaming`, `item.engine` | — | — | Formato mínimo: negrita, código y listas. Muestra el motor (`agent-meta`) |
| Bloque de actividad: cabecera | `ActivityBlock.tsx:49-53` | Cada turno | `agent.busy`, `agent.phase`, `item.endedAt` | Plega/despliega | — | Abierto mientras corre, plegado al terminar; resumen de hasta 3 etiquetas (`ActivityBlock.tsx:32-35`). «Working/Drafting/Checking… N s» |
| Entrada «Thinking… / Thought for N s» | `ActivityBlock.tsx:13-29` | Hay razonamiento transmitido | `entry.text`, `entry.ms` | Despliega el texto | — | Mientras piensa muestra los últimos 240 caracteres |
| Entradas de acción (guide, search, questions, plan, fix, schema) | `ActivityBlock.tsx:8,60-69` | Turno abierto o desplegado | `item.entries` | — | — | Solo texto |
| «Loading schema» | `ActivityBlock.tsx:72-80` | Mientras corre el turno y hay esperas | `agent.waiting` | — | — | Informa de que se carga el esquema de un modelo |
| Aviso (notice) | `FeedList.tsx:119-141` | Siempre que exista un `notice` | `item.level` (`error` con icono de alerta; resto info) | — | — | — |
| Notice › Undo | `FeedList.tsx:127` | `item.undoNodes && !item.undone` | — | `undoNodeDeletion(sessionId, id)` (`planRun.ts:111`) | Restaura nodos borrados por el agente | — |
| Notice › Delete | `FeedList.tsx:128-132` | `garbledItemId` definido y es el último elemento | `agent.busy` | `deleteGarbled` (`messageEdit.ts:131`) | Quita el mensaje ilegible y el aviso | Deshabilitado con el agente ocupado |
| Notice › Retry | `FeedList.tsx:133-138` | `item.retry` y es el último elemento | `agent.busy`, motor `llm` (`conversation.ts:251`) | `retryAgentTurn` (`conversation.ts:247`) | Repite la llamada fallida con el mismo historial | Repite una llamada de LLM (posible coste de agente, no de generación). Solo si es el último: tras un mensaje nuevo desaparece, para no responder fuera de orden (`FeedList.tsx:120`) |

## Filas de resultados en el chat

Los resultados del chat se agrupan: tres por fila, cada fila se pliega entera (`FeedList.tsx:225-242,245-262`). El detalle de cada miniatura y de sus acciones está en [resultados](resultados.md).

| Control | Dónde | Cuándo | Depende de | Modifica | Influye en | Notas |
| --- | --- | --- | --- | --- | --- | --- |
| Created N file(s) (cabecera de fila) | `FeedList.tsx:234-237` | Hay dos o más generaciones consecutivas en el feed | Suma de `assetIds` de la fila | Pliega/despliega la fila | — | Solo agrupa generaciones consecutivas sin otro elemento entre medias (`FeedList.tsx:253-258`) |
| Tarjetas del feed | `FeedList.tsx:170-177` | Según tipo | — | — | — | [Preguntas](tarjeta-preguntas.md), [Ajustes](tarjeta-ajustes.md), [Plan](tarjeta-plan.md), [Resultado](resultados.md) |

## Enlaces

- [[tablero]] · [tablero.md](tablero.md)
- [[composer]] · [composer.md](composer.md)
- [[resultados]] · [resultados.md](resultados.md)
- [[dependencias]] · [dependencias.md](dependencias.md)
- [[README]] · [Índice](README.md)

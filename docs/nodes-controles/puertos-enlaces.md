---
type: inventario
title: Puertos, enlaces y conexión de nodos
description: Puertos de entrada y salida de cada tipo de nodo (tipo, una o varias entradas), puerto «+», puertos numerados de resultado, reglas de conexión, mensajes de error y formas de desconectar.
tags: [nodes, puertos, enlaces, conexion]
updated: 2026-10-28
related: [lienzo, biblioteca-nodos, tarjeta-nodo, ejecucion]
---
# Puertos, enlaces y conexión de nodos

Tipos de puerto: `text`, `image`, `video`, `audio`, `model3d` (`engine/types.ts:701`). Una salida encaja en una entrada si el tipo es igual, o si es un modelo 3D hacia una entrada de imagen (recibe su imagen de vista, `flow/graph.ts:37`). Un puerto de entrada «sencillo» solo admite un enlace: conectar otro **sustituye al anterior sin avisar** (`flow/graph.ts:142`); uno «múltiple» admite varios.

## Puertos por tipo de nodo (fuente: `inputPorts` y `outputPort`)

| Control | Dónde aparece | Cuándo aparece | De qué depende | Qué modifica | Influye en | Notas |
| --- | --- | --- | --- | --- | --- | --- |
| Nodo de texto: salida `text` | `flow/graph.ts:43` | Siempre | — | — | Entradas de texto (prompt, lyrics) | Sin entradas |
| Nodo de imagen: entradas `prompt` (texto, una), `ref` (imagen, varias, «References»), `clip` (vídeo, varias, «Video clip»); salida `image` | `flow/graph.ts:65` | `clip` solo se dibuja si ya tiene un enlace o el modelo admite clips (`nodes.tsx:788`) | `catalog.schemas[modelRef].slots.clips` | — | Ejecución de la imagen | |
| Nodo 3D: entradas `prompt`, `ref` (imagen, varias, «Reference images»); salida `model3d` | `flow/graph.ts:72` | Siempre | — | — | Ejecución del 3D | |
| Nodo de vídeo: entradas `prompt`, `first` (imagen, «First frame»), `last` (imagen, «Last frame»), `ref` (imagen, varias, «References / keyframes»), `refVideo` (vídeo, varias), `audio` (audio, varias); salida `video` | `flow/graph.ts:77` | Siempre | — | — | Qué cuenta como primer fotograma y referencias (`params/inputs.ts:17`) | El modelo decide cómo usa cada entrada; los errores salen al revisar el gasto |
| Nodo de audio: entradas `prompt` y `lyrics` (texto, una); salida `audio`, o `text` con `textOutput` | `flow/graph.ts:89` | Siempre | `data.textOutput` (modelo que responde con letras) | — | Letras: un nodo de texto, un nodo de letras o una transcripción | `lyrics` queda oculto en el cuerpo si ya hay un enlace (`nodes.tsx:601`) |
| Nodo de herramienta: entrada `input` (tipo = entrada de la operación, una); salida = salida de la operación | `flow/graph.ts:92` | Siempre | `OPS[op]` | — | Cambiar la operación descarta los enlaces que ya no encajan (`flow/actions.ts:193`) | La salida puede ser `text` (transcripción) |
| Nodo Asset: salida = tipo del asset | `flow/graph.ts:55` | Con asset asignado | `assets[assetId].kind` | — | — | Un asset vacío no tiene salida: «The source has no output yet.» |

## Controles de puertos y enlaces

| Control | Dónde aparece | Cuándo aparece | De qué depende | Qué modifica | Influye en | Notas |
| --- | --- | --- | --- | --- | --- | --- |
| Puerto de entrada (punto a la izquierda) | `nodes.tsx:34` | Todos los puertos de `inputPorts`, repartidos en vertical (`nodes.tsx:790`) | `inputPorts`, `wired` | Destino de un arrastre | Conexión | El nombre del puerto solo se escribe mientras se arrastra un enlace (`nodes.tsx:790`) |
| Puerto `prompt` «silencioso» | `nodes.tsx:790` | El puerto prompt existe pero es invisible y no recibe puntero salvo que esté conectado o se arrastre un enlace (`node.css:98`) | `wired`, `connecting` | — | — | El texto del prompt ya está en el cuadro del panel; el campo cambia a «Extra prompt (added after the connected text)» si hay un enlace (`nodes.tsx:597`) |
| «+» (Add connected node) | `ConnectedNodeMenu.tsx:22` | A la derecha de todo nodo con salida; visible al pasar el puntero, con el nodo seleccionado o con el foco (`node.css:18`) | `outputPort` | Clic o Intro/Espacio: abre el selector; arrastrar: conecta (es el puerto de salida real `out`) | [biblioteca-nodos](biblioteca-nodos.md) | Consejo «Drag to connect, or click to add a connected node». Un arrastre de más de 5 px no abre el menú (`ConnectedNodeMenu.tsx:26`) |
| Selector del «+» | `ConnectedNodeMenu.tsx:22` (popover) | Tras pulsar «+» | `accepts` = tipo de salida | `addConnected(sessionId, node.id, data)`: crea el nodo a la derecha, bajo sus hijos, y lo conecta al primer puerto que acepta (`addConnected.ts:12`) | Grafo | Si la conexión falla no deja nodo huérfano; crear nodo y enlace se deshace juntos (`addConnected.ts:40`). Un nodo del mismo tipo hereda el modelo y los ajustes del origen, sin la semilla (`addConnected.ts:21`) |
| Curva de previsualización | `ConnectedNodeMenu.tsx:61` | Mientras el selector del «+» o del enlace soltado está abierto | Posición del menú | Nada | — | Solo visual |
| Puertos numerados de resultado (1, 2, 3…) | `ConnectedNodeMenu.tsx:44` | Nodo con 2+ resultados: `count = máx(settings.count, resultados hechos, enlaces+1)`; visibles al pasar el puntero, con el nodo seleccionado o ya enlazados (`node.css:170`) | `generations[...].assetIds.length`, `edges` con `outputIndex` | Un enlace desde «2» usa siempre el segundo resultado (`outputIndex`); uno desde «+» sigue el resultado elegido en la tarjeta | Qué asset reciben los nodos conectados | Las herramientas no tienen `settings.count`, así que solo muestran puertos si su generación devolvió 2+ (`ConnectedNodeMenu.tsx:49`). Consejo «Result n: links from here always use it» |
| Conectar arrastrando de una salida a un puerto | `NodeWorkspace.tsx:445`) | Lienzo completo y embebido | `connectionError` | `tryConnect` → `connectNodes` → `connect` (`flow/actions.ts:175`) | Grafo | Un destino no válido `isValidConnection` (`NodeWorkspace.tsx:304`) decide si el destino admite el enlace; qué se muestra al soltar sobre uno no válido: sin confirmar |
| Soltar el enlace en el fondo | `connectionDrop.ts:4` | Solo lienzo completo; no al soltar sobre nodo, enlace o panel | Dónde acaba el gesto | Abre el menú «Add connected node» en ese punto | Grafo | Con el menú abierto, la curva queda visible; se cierra con `onClose` (`NodeWorkspace.tsx:484`); que Esc lo cierre lo dice docs/features/nodes.md y no se verificó en el componente Popover: sin confirmar) |
| Mensajes de conexión rechazada | `flow/graph.ts:111` | Al conectar por UI, agente o pegado | Grafo, tipos | Toast de error (`flow/actions.ts:180`) | — | «A node cannot connect to itself.», «Unknown node.», «This node has no such input.», «The source has no output yet.», «<puerto> expects <tipo>, got <tipo>.», «That connection would create a loop.» |
| Color y animación del enlace | `NodeWorkspace.tsx:232` | Cada enlace | Tipo de salida de su origen; `running` | Clase CSS; animación si el destino genera (`NodeWorkspace.tsx:233`) | — | Solo visual |
| Desconectar: seleccionar el enlace y Supr | `NodeWorkspace.tsx:292` | Enlace seleccionado | `selectedEdges` | `disconnectEdges` | Entrada del destino | El nodo destino queda desactualizado en la siguiente revisión |
| Desconectar una referencia (X en la miniatura) | `nodes.tsx:416` | Panel de un nodo con entradas de imagen y enlaces | `linked` | `disconnectEdges(sessionId, [edge.id])` | Referencias | Detalle en [nodos-generacion](nodos-generacion.md) |
| Cambio de modelo u operación que invalida enlaces | `flow/actions.ts:113` | Al cambiar el modelo (si cambia el puerto de salida) o la operación | Puertos nuevos | Quita los enlaces que ya no encajan | Grafo | **Sin aviso**: los enlaces desaparecen sin mensaje (solo queda el deshacer) |

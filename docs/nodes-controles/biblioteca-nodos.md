---
type: inventario
title: Biblioteca de nodos y alta de nodos
description: Las tres formas de añadir un nodo (menú Add node, menú contextual y puerto +), el contenido de AddNodeItems, los valores con que nace cada tipo de nodo y las vías para crear nodos sin el menú.
tags: [nodes, biblioteca, alta]
updated: 2026-10-28
related: [lienzo, puertos-enlaces, nodos-generacion, nodos-herramienta]
---
# Biblioteca de nodos y alta de nodos

`AddNodeItems` (`AddNodeItems.tsx:13`) es la única lista de tipos de nodo. Se monta en tres sitios: el menú «Add node» de la barra superior (`NodeWorkspace.tsx:48`), el menú contextual del lienzo (`NodeWorkspace.tsx:505`) y el puerto «+» de cada nodo (`ConnectedNodeMenu.tsx:32`). Con `accepts` (puerto «+» o enlace soltado en el vacío) solo salen los nodos que aceptan ese tipo como entrada. Los consejos de cada fila (`tip`) salen tras 2,5 s con el puntero encima (`AddNodeItems.tsx:10`) y no existen en táctil: solo pasar el puntero.

## Entradas de la lista

| Control | Dónde aparece | Cuándo aparece | De qué depende | Qué modifica | Influye en | Notas |
| --- | --- | --- | --- | --- | --- | --- |
| Search nodes and tools… | `AddNodeItems.tsx:33` | Solo con `searchable`: el menú del puerto «+» y el menú de un enlace soltado; no en «Add node» de la barra ni en el menú del fondo (`NodeWorkspace.tsx:505`) | `query`, `accepts` | Filtra por texto; con texto, las herramientas salen planas (`AddNodeItems.tsx:41`) | Lista | Busca en nombre, palabras clave y descripción de la herramienta |
| Import images | `AddNodeItems.tsx:34` | Solo menú contextual del fondo sin enlace (`onImport`, `NodeWorkspace.tsx:507`) | — | Abre el selector de archivos en esa posición | [lienzo](lienzo.md) | No sale en «Add node» de la barra |
| Text | `AddNodeItems.tsx:35` | Sin `accepts` (no sale al conectar desde un nodo: un nodo de texto no tiene entradas) | `query` | `newNodeData('text')`: título «Prompt», texto vacío (`flow/actions.ts:40`) | Grafo | Sin tipo de salida hasta tener contenido: la salida de texto existe siempre (`graph.ts:43`) |
| Image | `AddNodeItems.tsx:36` | Si el nodo nuevo tiene una entrada compatible | `accepts` | Nodo de imagen con el modelo y los ajustes actuales del Composer (`flow/actions.ts:45`) | Grafo | El consejo cambia con `accepts` («Use it as a reference» / «Generate images») |
| Video | `AddNodeItems.tsx:37` | Igual | `accepts` | Nodo de vídeo igual | Grafo | «Use it as the first frame» si llega una imagen |
| Audio | `AddNodeItems.tsx:38` | Igual | `accepts` | Nodo de audio; si el modelo del Composer responde con texto (letras) nace con `textOutput` (`flow/actions.ts:48`) | Grafo | |
| 3D model | `AddNodeItems.tsx:39` | Igual | `accepts` | Nodo 3D | Grafo | Tipo `model3d`; acepta texto e imágenes de referencia |
| Tool › y «‹ Tools» | `AddNodeItems.tsx:40`, `AddNodeItems.tsx:23` | Si hay herramientas compatibles; sin texto de búsqueda | `toolIds` = todas las operaciones salvo las de varias entradas (`AddNodeItems.tsx:18`) | Abre la sublista de herramientas | Sublista | La lista incluye operaciones de máscara y voz; ver [hallazgos](hallazgos.md) |
| Una herramienta de la sublista | `AddNodeItems.tsx:26` | Dentro de «Tool ›» (o plana al buscar) | `OP_ICONS`, `OPS[id].input/output` (consejo «image → image») | `newNodeData('tool', { op })`: título = nombre de la operación, parámetros por defecto (`flow/actions.ts:52`) | Grafo | Catálogo completo en [nodos-herramienta](nodos-herramienta.md) |
| Asset | `AddNodeItems.tsx:42` | Solo con `onAsset` y sin `accepts` (menú Add node y menú del fondo) | — | Cierra el menú y abre el panel de la galería (`setUi({ panel: 'gallery' })`, `NodeWorkspace.tsx:55`) | Panel lateral | No crea nodo: el usuario arrastra desde la galería (consejo «Drag one from the gallery onto the canvas») |

## Altas sin el menú

| Control | Dónde aparece | Cuándo aparece | De qué depende | Qué modifica | Influye en | Notas |
| --- | --- | --- | --- | --- | --- | --- |
| Add node (botón de la barra superior) | `NodeWorkspace.tsx:40` | Lienzo completo | Centro visible del lienzo | `addAtCenter` y deja el nodo seleccionado | Grafo | Ver [lienzo](lienzo.md) |
| Duplicate (menú contextual, barra del nodo) | `flow/actions.ts:134` | Nodo seleccionado | Nodo y sus enlaces | Copia con título «(copy N)», sin generación ni sketch y con `outputIndex` 0 (`flow/actions.ts:139`) | Grafo | Los enlaces de entrada se copian sin `sourceHandle`: si venían de un puerto numerado, la copia usa el resultado elegido en el origen ([rastreo 3.5](../rastreo/nodes.md#3-regresiones-y-contradicciones-con-promesas); requiere prueba) |
| Pegar nodos | `arrange.ts:151` | Hay nodos copiados en la app | Portapapeles interno (variable de módulo, no persiste) | Nodos nuevos con enlaces entre sí y desde nodos aún presentes | Grafo | Un nodo de generación pega sin resultado |
| Ref (miniatura «+») en un nodo de imagen, vídeo o 3D | `nodes.tsx:426` | Panel del nodo, si el nodo tiene entradas de imagen libres | `recent` (las 12 imágenes más recientes) | Añade un nodo Asset «Reference» a la izquierda y lo conecta (`nodes.tsx:398`) | Grafo | Detalle en [nodos-generacion](nodos-generacion.md) |
| Acciones rápidas sobre un resultado (Relight, Upscale…) y «More tools» | `nodes.tsx:297` | Barra del nodo seleccionado con resultado | `OPS[id].quick` | `addConnected` con un nodo de herramienta | Grafo | Detalle en [tarjeta-nodo](tarjeta-nodo.md) |
| Composer en Nodes (generación directa) | `engine/actions.ts:359` | Composer en modo imagen, vídeo, audio | Texto y adjuntos del Composer | Crea un nodo Prompt, nodos Reference y el nodo de generación, y lo ejecuta ya | Grafo y gasto | Ver [agente-nodes](agente-nodes.md) |
| Plan del agente | `runtimeShared.ts:298` | El agente propone un plan en Nodes | Plan | Crea nodos borrador (con `planId`) | Grafo | Ver [agente-nodes](agente-nodes.md) |
| Import from Chat | `flow/fromChat.ts:28` | Lienzo completo con resultados del chat que aún no están en el lienzo | `chatWorkNotInNodes` | Nodos con resultado, modelo y ajustes del chat, sin llamadas ni coste | Grafo | Botón y aviso en [lienzo](lienzo.md) |

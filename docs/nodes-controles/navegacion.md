---
type: inventario
title: Panel de navegación de Nodes
description: Panel superior izquierdo del lienzo de Nodes (herramientas Select y Pan, borrar, mapa, deshacer, rehacer, historial, zoom, búsqueda) y los controles reducidos del tablero de Studio.
tags: [nodes, navegacion, zoom, deshacer]
updated: 2026-10-28
related: [lienzo, deshacer-bloqueos, atajos-gestos]
---
# Panel de navegación de Nodes

`CanvasNavigation` se monta dentro de `ReactFlow` solo cuando el lienzo no es embebido (`NodeWorkspace.tsx:466`). En el tablero de Studio se monta `EmbeddedControls` (3 botones). Desde 2026-10-31 es una toolbox vertical arriba a la izquierda (`role="toolbar"`, «Canvas tools»), con el estilo de la barra de vista del Designer; reúne Add node, Select, Pan, Delete, Auto layout, Fit view, Map, Undo, Redo, zoom (+, %, −) y Search, y sus popovers se abren a la derecha. La barra superior de Nodes conserva solo Run all. El minimapa se abre a su derecha. Los botones de icono llevan su nombre como `label`; el texto largo del botón Pan sale como consejo.

| Control | Dónde aparece | Cuándo aparece | De qué depende | Qué modifica | Influye en | Notas |
| --- | --- | --- | --- | --- | --- | --- |
| Add node (+) | `CanvasNavigation.tsx:81`, `NodeWorkspace.tsx:45` | Primer botón de la toolbox, lienzo completo (antes, botón con texto en la barra superior) | `graph`, centro del lienzo | `addAtCenter`; la lista (`AddNodeItems`) se abre a la derecha | Grafo | |
| Select (flecha) | `CanvasNavigation.tsx:82` | Panel, lienzo completo | `tool` | `pickTool('select')`: guarda `ogs.nodeTool.v2` en `localStorage` (`NodeWorkspace.tsx:109`) | Arrastre en el fondo = caja de selección; pan con botón medio o derecho | La preferencia persiste solo en este navegador |
| Pan (mano) | `CanvasNavigation.tsx:83` | Igual | `tool` | `pickTool('pan')` | Arrastre = mover el lienzo; doble pulsación mantenida = caja | Por defecto desde la clave `v2` |
| Delete selected (papelera) | `CanvasNavigation.tsx:84` | Igual; desactivada sin selección | `selectedCount` (nodos y marcos seleccionados) | `deleteNodes(sessionId, [...selected])` (`NodeWorkspace.tsx:478`) | Grafo; deja un aviso con Undo en el hilo (`flow/actions.ts:90`) | Sin confirmación; el consejo muestra «(Del)» |
| Auto layout | `CanvasNavigation.tsx:86` | Toolbox; desactivado sin nodos (antes en la barra superior) | `graph.nodes` | `layoutAll` y encuadre | Grafo, vista | Sin confirmación (H16) |
| Fit view | `CanvasNavigation.tsx:87` | Toolbox; desactivado sin nodos (antes en la barra superior) | — | `rf.fitView({ padding: 0.2 })` 300 ms | Vista | |
| Map | `CanvasNavigation.tsx:88` | Igual | `mapOpen` (estado local) | Muestra u oculta el minimapa (`CanvasNavigation.tsx:105`) | Vista | El minimapa se puede arrastrar y hacer zoom; no persiste |
| Undo | `CanvasNavigation.tsx:90` | Igual | `past` y `blocked` (hay bloqueos o un nodo generando) | `travel('undo')` aplica el grafo anterior (`CanvasNavigation.tsx:72`) | Grafo | Desactivado sin motivo visible mientras algo genera; ver [deshacer-bloqueos](deshacer-bloqueos.md). Clic derecho abre el historial |
| Redo | `CanvasNavigation.tsx:91` | Igual | `future`, `blocked` | `travel('redo')` | Grafo | Igual |
| Lista de historial (clic derecho en Undo o Redo) | `CanvasNavigation.tsx:123` | Tras clic derecho en Undo o Redo | `graphHistory` (hasta 40 entradas, `flow/history.ts:44`) | Elegir la entrada n deshace o rehace n acciones de golpe (`CanvasNavigation.tsx:124`) | Grafo | Cada fila tiene etiqueta («Add …», «Delete …», «Move …», «Edit …», «Change connections», `flow/history.ts:36`) y el detalle «Undo N action(s)» |
| Zoom out (−) | `CanvasNavigation.tsx:95` | Panel | — | `rf.zoomOut` 150 ms | Vista | Repetido en el popover de zoom (`CanvasNavigation.tsx:128`) |
| Porcentaje de zoom | `CanvasNavigation.tsx:94` | Panel | `useViewport().zoom` | Abre el popover «Zoom canvas» con −, %, +, Fit view | Vista | |
| Zoom in (+) | `CanvasNavigation.tsx:93` | Panel | — | `rf.zoomIn` | Vista | |
| Fit view (en el popover de zoom) | `CanvasNavigation.tsx:108` | Popover de zoom | Grafo | `rf.fitView({ padding: 0.2 })` | Vista | Duplicado de «Fit view» de la toolbox |
| Search canvas | `CanvasNavigation.tsx:97` | Panel | `searchPop` | Abre el popover de búsqueda | Selección y vista | |
| Campo «Search prompts and names» + Find matches | `CanvasNavigation.tsx:137`, `CanvasNavigation.tsx:138` | Popover de búsqueda | `query`; se busca al enviar (Intro), no al escribir | Fija `submitted` (`CanvasNavigation.tsx:136`) | Lista de resultados | Busca en título, texto o prompt, título de la generación y en parámetros de herramientas cuyo nombre contenga prompt, instruction o text (`CanvasNavigation.tsx:98`) |
| Resultado de búsqueda | `CanvasNavigation.tsx:141` | Tras una búsqueda con coincidencias | `results` | Selecciona el nodo y lo encuadra (`CanvasNavigation.tsx:141`) | Selección, vista | «No matches in this canvas.» si no hay (`CanvasNavigation.tsx:142`) |
| Close search (X) | `CanvasNavigation.tsx:135` | Popover de búsqueda | — | Cierra el popover | — | |
| Ctrl/⌘+Z, Ctrl/⌘+Y, Ctrl/⌘+Mayús+Z | `CanvasNavigation.tsx:83` | Lienzo completo, cualquier foco salvo campos de texto; no comprueba el foco del tablero (no existe en el embebido) | `blocked` | `travel` (si `blocked` no hace nada y no avisa, `CanvasNavigation.tsx:73`) | Grafo | Listado en Ajustes › Shortcuts (`shortcuts.ts:38`) |
| Zoom out / Zoom in / Fit view (tablero de Studio) | `EmbeddedControls.tsx:9` | Solo en `EmbeddedNodeCanvas` | `useReactFlow` | Zoom 150 ms | Vista | Detalle en [tablero](../studio-controles/tablero.md#nodes-embebido). Sin deshacer, mapa, búsqueda ni herramientas |

---
type: inventario
title: Panel de navegación de Nodes
description: Panel superior izquierdo del lienzo de Nodes (herramientas Select y Pan, borrar, mapa, deshacer, rehacer, historial, zoom, búsqueda) y los controles reducidos del tablero de Studio.
tags: [nodes, navegacion, zoom, deshacer]
updated: 2026-10-28
related: [lienzo, deshacer-bloqueos, atajos-gestos]
---
# Panel de navegación de Nodes

`CanvasNavigation` se monta dentro de `ReactFlow` solo cuando el lienzo no es embebido (`NodeWorkspace.tsx:471`). En el tablero de Studio se monta `EmbeddedControls` (3 botones). El panel está arriba a la izquierda, y el minimapa se abre debajo. Los botones de icono llevan su nombre como `label`; el texto largo del botón Pan sale como consejo.

| Control | Dónde aparece | Cuándo aparece | De qué depende | Qué modifica | Influye en | Notas |
| --- | --- | --- | --- | --- | --- | --- |
| Select (flecha) | `CanvasNavigation.tsx:107` | Panel, lienzo completo | `tool` | `pickTool('select')`: guarda `ogs.nodeTool.v2` en `localStorage` (`NodeWorkspace.tsx:109`) | Arrastre en el fondo = caja de selección; pan con botón medio o derecho | La preferencia persiste solo en este navegador |
| Pan (mano) | `CanvasNavigation.tsx:108` | Igual | `tool` | `pickTool('pan')` | Arrastre = mover el lienzo; doble pulsación mantenida = caja | Por defecto desde la clave `v2` |
| Delete selected (papelera) | `CanvasNavigation.tsx:109` | Igual; desactivada sin selección | `selectedCount` (nodos y marcos seleccionados) | `deleteNodes(sessionId, [...selected])` (`NodeWorkspace.tsx:478`) | Grafo; deja un aviso con Undo en el hilo (`flow/actions.ts:90`) | Sin confirmación; el consejo muestra «(Del)» |
| Map | `CanvasNavigation.tsx:111` | Igual | `mapOpen` (estado local) | Muestra u oculta el minimapa (`CanvasNavigation.tsx:105`) | Vista | El minimapa se puede arrastrar y hacer zoom; no persiste |
| Undo | `CanvasNavigation.tsx:113` | Igual | `past` y `blocked` (hay bloqueos o un nodo generando) | `travel('undo')` aplica el grafo anterior (`CanvasNavigation.tsx:72`) | Grafo | Desactivado sin motivo visible mientras algo genera; ver [deshacer-bloqueos](deshacer-bloqueos.md). Clic derecho abre el historial |
| Redo | `CanvasNavigation.tsx:114` | Igual | `future`, `blocked` | `travel('redo')` | Grafo | Igual |
| Lista de historial (clic derecho en Undo o Redo) | `CanvasNavigation.tsx:123` | Tras clic derecho en Undo o Redo | `graphHistory` (hasta 40 entradas, `flow/history.ts:44`) | Elegir la entrada n deshace o rehace n acciones de golpe (`CanvasNavigation.tsx:124`) | Grafo | Cada fila tiene etiqueta («Add …», «Delete …», «Move …», «Edit …», «Change connections», `flow/history.ts:36`) y el detalle «Undo N action(s)» |
| Zoom out (−) | `CanvasNavigation.tsx:116` | Panel | — | `rf.zoomOut` 150 ms | Vista | Repetido en el popover de zoom (`CanvasNavigation.tsx:128`) |
| Porcentaje de zoom | `CanvasNavigation.tsx:117` | Panel | `useViewport().zoom` | Abre el popover «Zoom canvas» con −, %, +, Fit view | Vista | |
| Zoom in (+) | `CanvasNavigation.tsx:118` | Panel | — | `rf.zoomIn` | Vista | |
| Fit view (en el popover de zoom) | `CanvasNavigation.tsx:131` | Popover de zoom | Grafo | `rf.fitView({ padding: 0.2 })` | Vista | Duplicado de «Fit view» de la barra superior |
| Search canvas | `CanvasNavigation.tsx:120` | Panel | `searchPop` | Abre el popover de búsqueda | Selección y vista | |
| Campo «Search prompts and names» + Find matches | `CanvasNavigation.tsx:137`, `CanvasNavigation.tsx:138` | Popover de búsqueda | `query`; se busca al enviar (Intro), no al escribir | Fija `submitted` (`CanvasNavigation.tsx:136`) | Lista de resultados | Busca en título, texto o prompt, título de la generación y en parámetros de herramientas cuyo nombre contenga prompt, instruction o text (`CanvasNavigation.tsx:98`) |
| Resultado de búsqueda | `CanvasNavigation.tsx:141` | Tras una búsqueda con coincidencias | `results` | Selecciona el nodo y lo encuadra (`CanvasNavigation.tsx:141`) | Selección, vista | «No matches in this canvas.» si no hay (`CanvasNavigation.tsx:142`) |
| Close search (X) | `CanvasNavigation.tsx:135` | Popover de búsqueda | — | Cierra el popover | — | |
| Ctrl/⌘+Z, Ctrl/⌘+Y, Ctrl/⌘+Mayús+Z | `CanvasNavigation.tsx:83` | Lienzo completo, cualquier foco salvo campos de texto; no comprueba el foco del tablero (no existe en el embebido) | `blocked` | `travel` (si `blocked` no hace nada y no avisa, `CanvasNavigation.tsx:73`) | Grafo | Listado en Ajustes › Shortcuts (`shortcuts.ts:38`) |
| Zoom out / Zoom in / Fit view (tablero de Studio) | `EmbeddedControls.tsx:9` | Solo en `EmbeddedNodeCanvas` | `useReactFlow` | Zoom 150 ms | Vista | Detalle en [tablero](../studio-controles/tablero.md#nodes-embebido). Sin deshacer, mapa, búsqueda ni herramientas |

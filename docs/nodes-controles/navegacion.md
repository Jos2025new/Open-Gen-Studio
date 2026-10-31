---
type: inventario
title: Panel de navegación de Nodes
description: Panel superior izquierdo del lienzo de Nodes (herramientas Select y Pan, borrar, mapa, deshacer, rehacer, historial, zoom, búsqueda) y los controles reducidos del tablero de Studio.
tags: [nodes, navegacion, zoom, deshacer]
updated: 2026-10-28
related: [lienzo, deshacer-bloqueos, atajos-gestos]
---
# Panel de navegación de Nodes

`CanvasNavigation` se monta dentro de `ReactFlow` solo cuando el lienzo no es embebido (`NodeWorkspace.tsx:466`). En el tablero de Studio se monta `EmbeddedControls` (3 botones). Desde 2026-10-31 es una toolbox vertical arriba a la izquierda (`role="toolbar"`, «Canvas tools»), con el estilo de la barra de vista del Designer; reúne Add node, Select, Pan y Auto layout; Fit view y Map; Undo, Redo y Delete; zoom (+, %, −) y Search (orden desde 2026-10-31: Auto layout bajo Pan, Delete junto a Undo y Redo), y sus popovers se abren a la derecha. La barra superior de Nodes conserva solo Run all. El minimapa se abre a su derecha. Los botones de icono llevan su nombre como `label`; el texto largo del botón Pan sale como consejo.

| Control | Dónde aparece | Cuándo aparece | De qué depende | Qué modifica | Influye en | Notas |
| --- | --- | --- | --- | --- | --- | --- |
| Add node (+) | `CanvasNavigation.tsx:112`, `NodeWorkspace.tsx:41` | Primer botón de la toolbox, lienzo completo (antes, botón con texto en la barra superior) | `graph`, centro del lienzo | `addAtCenter`; abre a la derecha el panel `NodeLibrary` (buscador, chips de tipo, Media / Nodes / Tools, teclado); ver [biblioteca-nodos](biblioteca-nodos.md#panel-add-node) | Grafo | |
| Select (flecha) | `CanvasNavigation.tsx:113` | Panel, lienzo completo | `tool` | `pickTool('select')`: guarda `ogs.nodeTool.v2` en `localStorage` (`NodeWorkspace.tsx:109`) | Arrastre en el fondo = caja de selección; pan con botón medio o derecho | La preferencia persiste solo en este navegador |
| Pan (mano) | `CanvasNavigation.tsx:114` | Igual | `tool` | `pickTool('pan')` | Arrastre = mover el lienzo; doble pulsación mantenida = caja | Por defecto desde la clave `v2` |
| Auto layout | `CanvasNavigation.tsx:115` | Toolbox; desactivado sin nodos (antes en la barra superior) | `graph.nodes` | `layoutAll` y encuadre | Grafo, vista | Sin confirmación (H16) |
| Fit view | `CanvasNavigation.tsx:117` | Toolbox; desactivado sin nodos (antes en la barra superior) | — | `rf.fitView({ padding: 0.2 })` 300 ms | Vista | |
| Map | `CanvasNavigation.tsx:118` | Igual | `mapOpen` (estado local) | Muestra u oculta el minimapa (`CanvasNavigation.tsx:126`) | Vista | El minimapa se puede arrastrar y hacer zoom; no persiste |
| Undo | `CanvasNavigation.tsx:120` | Igual | `past` y `blocked` (hay bloqueos o un nodo generando) | `travel('undo')` aplica el grafo anterior (`CanvasNavigation.tsx:103`) | Grafo | Desactivado sin motivo visible mientras algo genera; ver [deshacer-bloqueos](deshacer-bloqueos.md). Clic derecho abre el historial |
| Redo | `CanvasNavigation.tsx:121` | Igual | `future`, `blocked` | `travel('redo')` | Grafo | Igual |
| Delete selected (papelera) | `CanvasNavigation.tsx:122` | Igual; desactivada sin selección | `selectedCount` (nodos y marcos seleccionados) | `deleteNodes(sessionId, [...selected])` (`NodeWorkspace.tsx:478`) | Grafo; deja un aviso con Undo en el hilo (`flow/actions.ts:90`) | Sin confirmación; el consejo muestra «(Del)» |
| Lista de historial (clic derecho en Undo o Redo) | `CanvasNavigation.tsx:149` | Tras clic derecho en Undo o Redo | `graphHistory` (hasta 40 entradas, `flow/history.ts:44`) | Elegir la entrada n deshace o rehace n acciones de golpe (`CanvasNavigation.tsx:124`) | Grafo | Cada fila tiene etiqueta («Add …», «Delete …», «Move …», «Edit …», «Change connections», `flow/history.ts:36`) y el detalle «Undo N action(s)» |
| Zoom out (−) | `CanvasNavigation.tsx:126` | Panel | — | `rf.zoomOut` 150 ms | Vista | En el popover de zoom, − y + bajan o suben medio paso del deslizador (×0,71 / ×1,41) |
| Porcentaje de zoom | `CanvasNavigation.tsx:125` | Panel | `useViewport().zoom` | Abre el popover «Zoom canvas» (`ZoomControls`, `CanvasNavigation.tsx:21`): −, porcentaje editable, + y un deslizador | Vista | Sin Fit view desde 2026-10-31 (está en la toolbox) |
| Zoom in (+) | `CanvasNavigation.tsx:124` | Panel | — | `rf.zoomIn` | Vista | |
| Porcentaje editable (popover de zoom) | `CanvasNavigation.tsx:32` | Popover de zoom | `zoom`, borrador local | Enter o salir del campo aplica `rf.zoomTo`, limitado a 5 %–3200 %; Escape restaura | Vista | Acepta coma decimal y «%», como el campo del Designer |
| Deslizador de zoom | `CanvasNavigation.tsx:39` | Popover de zoom | `zoom` | `rf.zoomTo` en escala logarítmica (log2 de 5 % a 3200 %) | Vista | Prueba: `tests/node-zoom-controls.test.ts` |
| Search canvas | `CanvasNavigation.tsx:128` | Panel | `searchPop` | Abre el popover de búsqueda | Selección y vista | |
| Campo «Search prompts and names» + Find matches | `CanvasNavigation.tsx:137`, `CanvasNavigation.tsx:138` | Popover de búsqueda | `query`; se busca al enviar (Intro), no al escribir | Fija `submitted` (`CanvasNavigation.tsx:136`) | Lista de resultados | Busca en título, texto o prompt, título de la generación y en parámetros de herramientas cuyo nombre contenga prompt, instruction o text (`CanvasNavigation.tsx:129`) |
| Resultado de búsqueda | `CanvasNavigation.tsx:141` | Tras una búsqueda con coincidencias | `results` | Selecciona el nodo y lo encuadra (`CanvasNavigation.tsx:141`) | Selección, vista | «No matches in this canvas.» si no hay (`CanvasNavigation.tsx:142`) |
| Close search (X) | `CanvasNavigation.tsx:135` | Popover de búsqueda | — | Cierra el popover | — | |
| Ctrl/⌘+Z, Ctrl/⌘+Y, Ctrl/⌘+Mayús+Z | `CanvasNavigation.tsx:114` | Lienzo completo, cualquier foco salvo campos de texto; no comprueba el foco del tablero (no existe en el embebido) | `blocked` | `travel` (si `blocked` no hace nada y no avisa, `CanvasNavigation.tsx:104`) | Grafo | Listado en Ajustes › Shortcuts (`shortcuts.ts:38`) |
| Zoom out / Zoom in / Fit view (tablero de Studio) | `EmbeddedControls.tsx:9` | Solo en `EmbeddedNodeCanvas` | `useReactFlow` | Zoom 150 ms | Vista | Detalle en [tablero](../studio-controles/tablero.md#nodes-embebido). Sin deshacer, mapa, búsqueda ni herramientas |

---
type: inventario
title: Panel de navegación de Nodes
description: Panel superior izquierdo del lienzo de Nodes (herramientas Select y Pan, borrar, mapa, deshacer, rehacer, historial, zoom, búsqueda) y los controles reducidos del tablero de Studio.
tags: [nodes, navegacion, zoom, deshacer]
updated: 2026-10-28
related: [lienzo, deshacer-bloqueos, atajos-gestos]
---
# Panel de navegación de Nodes

`CanvasNavigation` se monta dentro de `ReactFlow` solo cuando el lienzo no es embebido (`NodeWorkspace.tsx:466`). En el tablero de Studio se monta `EmbeddedControls` (3 botones). Desde 2026-10-31 es una toolbox vertical arriba a la izquierda (`role="toolbar"`, «Canvas tools»), con el estilo de la barra de vista del Designer; reúne Add node, Create y Conversation (abren el panel de [agente-nodes](agente-nodes.md)), Select, Pan, Cut y Auto layout; Fit view y Map; Undo, Redo y Delete; zoom (+, %, −) y Search (orden desde 2026-10-31: Auto layout bajo Pan, Delete junto a Undo y Redo), y sus popovers se abren a la derecha. La barra superior de Nodes conserva solo Run all. El minimapa se abre a su derecha. Los botones de icono llevan su nombre como `label`; el texto largo del botón Pan sale como consejo.

| Control | Dónde aparece | Cuándo aparece | De qué depende | Qué modifica | Influye en | Notas |
| --- | --- | --- | --- | --- | --- | --- |
| Add node (+) | `CanvasNavigation.tsx:96`, `NodeWorkspace.tsx:41` | Primer botón de la toolbox, lienzo completo (antes, botón con texto en la barra superior) | `graph`, centro del lienzo | `addAtCenter`; abre a la derecha el panel `NodeLibrary` (buscador, chips de tipo, Media / Nodes / Tools, teclado); ver [biblioteca-nodos](biblioteca-nodos.md#panel-add-node) | Grafo | |
| Select (flecha) | `CanvasNavigation.tsx:97` | Panel, lienzo completo | `tool` | `pickTool('select')`: guarda `ogs.nodeTool.v2` en `localStorage` (`NodeWorkspace.tsx:109`) | Arrastre en el fondo = caja de selección; pan con botón medio o derecho | La preferencia persiste solo en este navegador |
| Pan (mano) | `CanvasNavigation.tsx:98` | Igual | `tool` | `pickTool('pan')` | Arrastre = mover el lienzo; doble pulsación mantenida = caja | Por defecto desde la clave `v2` |
| Cut connections (tijera) | `CanvasNavigation.tsx:101`, `CutTool.tsx` | Toolbox tras Pan, lienzo completo; desactivada sin conexiones | `tool === 'cut'` (no se recuerda) | Arrastre izquierdo en el fondo dibuja un trazo; las conexiones que cruza se marcan en rojo y al soltar `disconnectEdges` las corta (`NodeWorkspace.tsx:117`) | Grafo (un paso de Undo) | Desde 2026-10-31. Tecla X entra y sale; Escape sale. Botón medio o derecho sigue moviendo el lienzo. Prueba: `tests/node-cut-tool.test.ts` |
| Auto layout | `CanvasNavigation.tsx:99` | Toolbox; desactivado sin nodos (antes en la barra superior) | `graph.nodes` | `layoutAll` y encuadre | Grafo, vista | Sin confirmación (H16) |
| Fit view | `CanvasNavigation.tsx:101` | Toolbox; desactivado sin nodos (antes en la barra superior) | — | `rf.fitView({ padding: 0.2 })` 300 ms | Vista | |
| Map | `CanvasNavigation.tsx:102` | Igual | `mapOpen` (estado local) | Muestra u oculta el minimapa (`CanvasNavigation.tsx:126`) | Vista | El minimapa se puede arrastrar y hacer zoom; no persiste |
| Undo | `CanvasNavigation.tsx:104` | Igual | `past` y `blocked` (hay bloqueos o un nodo generando) | `travel('undo')` aplica el grafo anterior (`CanvasNavigation.tsx:87`) | Grafo | Desactivado sin motivo visible mientras algo genera; ver [deshacer-bloqueos](deshacer-bloqueos.md). Clic derecho abre el historial |
| Redo | `CanvasNavigation.tsx:105` | Igual | `future`, `blocked` | `travel('redo')` | Grafo | Igual |
| Delete selected (papelera) | `CanvasNavigation.tsx:122` | Igual; desactivada sin selección | `selectedCount` (nodos y marcos seleccionados) | `deleteNodes(sessionId, [...selected])` (`NodeWorkspace.tsx:478`) | Grafo; deja un aviso con Undo en el hilo (`flow/actions.ts:90`) | Sin confirmación; el consejo muestra «(Del)» |
| Lista de historial (clic derecho en Undo o Redo) | `CanvasNavigation.tsx:133` | Tras clic derecho en Undo o Redo | `graphHistory` (hasta 40 entradas, `flow/history.ts:44`) | Elegir la entrada n deshace o rehace n acciones de golpe (`CanvasNavigation.tsx:108`) | Grafo | Cada fila tiene etiqueta («Add …», «Delete …», «Move …», «Edit …», «Change connections», `flow/history.ts:36`) y el detalle «Undo N action(s)» |
| Zoom out (−) | `CanvasNavigation.tsx:126` | Panel | — | `rf.zoomOut` 150 ms | Vista | En el popover de zoom, − y + multiplican por 1/√2 y √2 |
| Porcentaje de zoom | `CanvasNavigation.tsx:109` | Panel | `useViewport().zoom` | Abre el popover «Zoom canvas» (`ZoomControls`): −, el deslizador de la app (`InlineSlider` con `log`) con el porcentaje editable, + | Vista | Sin Fit view desde 2026-10-31 (está en la toolbox) |
| Zoom in (+) | `CanvasNavigation.tsx:108` | Panel | — | `rf.zoomIn` | Vista | |
| Porcentaje editable (popover de zoom) | `InlineControls.tsx:16` | Popover de zoom | `zoom`, borrador local | Un valor dentro de 5 %–3200 % se aplica al escribirlo; fuera de rango espera a Enter o a salir y se limita; Escape restaura | Vista | Comportamiento común de `InlineSlider` desde 2026-10-31 |
| Deslizador de zoom | `InlineControls.tsx:16` (`log`) | Popover de zoom | `zoom` | `rf.zoomTo` en escala logarítmica (5 % a 3200 %); arrastre, rueda (×1,1) o flechas | Vista | El deslizador único de la app. Prueba: `tests/node-zoom-controls.test.ts` |
| Search canvas | `CanvasNavigation.tsx:112` | Panel | `searchPop` | Abre el popover de búsqueda | Selección y vista | |
| Campo «Search prompts and names» + Find matches | `CanvasNavigation.tsx:121`, `CanvasNavigation.tsx:122` | Popover de búsqueda | `query`; se busca al enviar (Intro), no al escribir | Fija `submitted` (`CanvasNavigation.tsx:136`) | Lista de resultados | Busca en título, texto o prompt, título de la generación y en parámetros de herramientas cuyo nombre contenga prompt, instruction o text (`CanvasNavigation.tsx:113`) |
| Resultado de búsqueda | `CanvasNavigation.tsx:125` | Tras una búsqueda con coincidencias | `results` | Selecciona el nodo y lo encuadra (`CanvasNavigation.tsx:125`) | Selección, vista | «No matches in this canvas.» si no hay (`CanvasNavigation.tsx:126`) |
| Close search (X) | `CanvasNavigation.tsx:119` | Popover de búsqueda | — | Cierra el popover | — | |
| Ctrl/⌘+Z, Ctrl/⌘+Y, Ctrl/⌘+Mayús+Z | `CanvasNavigation.tsx:98` | Lienzo completo, cualquier foco salvo campos de texto; no comprueba el foco del tablero (no existe en el embebido) | `blocked` | `travel` (si `blocked` no hace nada y no avisa, `CanvasNavigation.tsx:88`) | Grafo | Listado en Ajustes › Shortcuts (`shortcuts.ts:38`) |
| Zoom out / Zoom in / Fit view (tablero de Studio) | `EmbeddedControls.tsx:9` | Solo en `EmbeddedNodeCanvas` | `useReactFlow` | Zoom 150 ms | Vista | Detalle en [tablero](../studio-controles/tablero.md#nodes-embebido). Sin deshacer, mapa, búsqueda ni herramientas |

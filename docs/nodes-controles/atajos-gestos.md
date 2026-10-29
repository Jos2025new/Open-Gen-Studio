---
type: inventario
title: Atajos y gestos de Nodes
description: Todas las teclas, gestos y ayudas que solo aparecen al pasar el puntero en el lienzo de Nodes, con su condición de foco y lo que el listado de Ajustes dice o calla.
tags: [nodes, atajos, gestos]
updated: 2026-10-28
related: [lienzo, navegacion, agrupar-alinear, hallazgos]
---
# Atajos y gestos de Nodes

El listado oficial (Ajustes › Shortcuts) tiene un grupo «Nodes» con 6 líneas (`shortcuts.ts:38`); todo lo demás de esta nota no figura en él. En el lienzo completo los atajos escuchan en `window`; en el tablero de Studio solo valen con el foco dentro del tablero (`useBoardFocus`, `useBoardFocus.ts:7`, ver [tablero](../studio-controles/tablero.md#nodes-embebido)).

| Control | Dónde aparece | Cuándo aparece | De qué depende | Qué modifica | Influye en | Notas |
| --- | --- | --- | --- | --- | --- | --- |
| Ctrl/⌘+Z | `CanvasNavigation.tsx:83` | Lienzo completo; no actúa dentro de campos de texto | `blocked` | Deshacer | Grafo | Listado: «Mod + Z — Undo». No hace nada ni avisa si hay una ejecución |
| Ctrl/⌘+Y y Ctrl/⌘+Mayús+Z | `CanvasNavigation.tsx:87` | Igual | Igual | Rehacer | Grafo | Listado: «Mod + Y — Redo (also Mod + Shift + Z)» |
| Ctrl/⌘+C | `NodeWorkspace.tsx:371` | Foco en el lienzo, nodos seleccionados, nada de texto seleccionado en la página, fuera de campos de texto | `selected`, `insideRef` | `copyNodes` y toast | Portapapeles interno | Listado: «Mod + C / X / V» |
| Ctrl/⌘+X | `NodeWorkspace.tsx:372` | Igual | Igual | `cutNodes` y vacía la selección | Grafo | Borra sin confirmar |
| Ctrl/⌘+V | `NodeWorkspace.tsx:360` | Foco en el lienzo, fuera de campos de texto | Portapapeles del sistema y del app | Imágenes del sistema: nodos Asset; si no hay imágenes y hay nodos copiados: `pasteNodes` | Grafo | Las imágenes tienen prioridad sobre los nodos copiados |
| Ctrl/⌘+G | `NodeWorkspace.tsx:374` | Igual, con 2+ nodos | `selected` | Agrupar | Grupos | Listado: «Mod + G — Group the selected nodes» |
| Ctrl/⌘+Mayús+G | `NodeWorkspace.tsx:373` | Igual, la selección es un grupo entero | `wholeGroup` | Desagrupar o reacoplar | Grupos | Listado: «Mod + Shift + G — Ungroup» |
| Supr o Retroceso | `NodeWorkspace.tsx:459` | Foco dentro del lienzo | `insideRef` | Borra nodos y enlaces seleccionados | Grafo | Listado: «Delete or Backspace — Delete the selection». Sin confirmación |
| Intro o Espacio sobre «+» | `ConnectedNodeMenu.tsx:29` | «+» con el foco (tiene `tabIndex=0`) | — | Abre el selector de nodos | Grafo | No figura en el listado |
| Intro / Esc al renombrar un título de nodo o de grupo | `nodes.tsx:745` | Campo de título abierto | `draft` | Confirmar o cancelar | Nombre | Un grupo: confirma al salir del campo o con Intro (`Operations.tsx:117`) |
| Intro en el buscador del lienzo | `CanvasNavigation.tsx:136` | Popover de búsqueda | `query` | Lanza la búsqueda | Resultados | No busca al escribir |
| Mayús + arrastre / Ctrl o ⌘ + clic | Valores por defecto de `@xyflow/react` 12.12.0 (`selectionKeyCode='Shift'`, `multiSelectionKeyCode`) | Lienzo | Biblioteca | Selección múltiple | Operations | Sin confirmar por prueba |
| Espacio mantenido | `panActivationKeyCode='Space'` (biblioteca) | Lienzo | Biblioteca | Arrastre = pan aunque la herramienta sea Select | Vista | Sin confirmar por prueba |
| Ctrl/⌘ + rueda o pellizco | `zoomActivationKeyCode`, `zoomOnPinch` (biblioteca) | Lienzo | Biblioteca | Zoom | Vista | La rueda sola desplaza (`NodeWorkspace.tsx:462`). Sin confirmar por prueba |
| Teclas de flecha sobre un nodo enfocado | `disableKeyboardA11y=false` (biblioteca) | Nodo enfocado | Biblioteca | Mover el nodo | Posición | Sin confirmar por prueba y sin reflejo en el listado |
| Doble pulsación mantenida en el fondo | `NodeWorkspace.tsx:121` | Herramienta Pan | 350 ms y 12 px | Caja de selección | Selección | Se descubre solo por el consejo del botón Pan |
| Botón medio o derecho + arrastre | `NodeWorkspace.tsx:461` | Herramienta Select | — | Pan | Vista | Dicho en el consejo del botón Select |
| Clic derecho en el fondo / en un nodo | `NodeWorkspace.tsx:441` | Lienzo completo | Posición | Menú Add node / menú de nodo (Duplicate, Delete) | Grafo | Sin menú en el tablero de Studio |
| Clic derecho en Undo o Redo | `CanvasNavigation.tsx:102` | Panel de navegación | `past`/`future` | Lista de historial | Grafo | Dicho en la etiqueta («right-click for history») |
| Doble clic en el título de un nodo / de un grupo | `nodes.tsx:754` | Tarjeta o marco | — | Renombrar | Nombre | Consejo «Double-click to rename» (atributo `title`, aparece al pasar el puntero) |
| Doble clic en el cuerpo de un nodo | `nodes.tsx:810` | Nodo con resultado | — | Abre el visor | Visor | Sin aviso en pantalla |
| Arrastrar un asset sobre el lienzo | `NodeWorkspace.tsx:407` | Lienzo completo | — | Crea un nodo Asset (o 3D) donde se suelta | Grafo | Sin pista visual en el lienzo: la pista dice «Drag one from the gallery onto the canvas» en el menú Asset |
| Arrastrar de «+» o de un puerto numerado y soltar | `connectionDrop.ts:4` | Lienzo completo | — | Abre el selector en el punto | Grafo | Ver [puertos-enlaces](puertos-enlaces.md) |
| «+» y puertos numerados al pasar el puntero | `node.css:18` | Nodo con salida | CSS | Se hacen visibles (el «+» también con el foco) | Conexión | Solo puntero o selección; sin ellos son invisibles pero siguen en el árbol |
| Casilla «agent context» al pasar el puntero | `ui.css:103` | Resultado del nodo | CSS | Aparece | Adjuntos del agente | En táctil siempre visible (`ui.css:115`) |
| Consejos `data-tip` | `nodes.tsx:86` | Pasar el puntero | `TooltipLayer` | Texto de ayuda | — | Contienen información que no está en pantalla (p. ej. «Use output n downstream», «Result n: links from here always use it»); no existen en táctil |

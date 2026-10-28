---
type: inventario
title: Designer embebido en Studio
description: La versión reducida del Designer dentro del tablero de Studio: barra superior, menú de archivo y barra inferior.
tags: [designer, studio, embebido]
updated: 2026-10-28
related: [documentos, toolbox-dock, capas, navegacion-zoom]
---
# Designer embebido en Studio

Comparte `Stage`, el `ToolDock` y el estado `ui` con el Designer completo, pero con menos herramientas y menos controles (`EmbeddedDesignerBar.tsx:12`): `move`, `hand`, `lineart`, `eraser`, `text`, `rect`, `ellipse`, `line`, `curve`, `arrow`, `polygon`, `star`, `sector`, `arc`, `chord`. Si la herramienta activa no está en la lista, vuelve a `move` (`EmbeddedDesigner.tsx:32`). Las teclas y el portapapeles solo actúan con el foco dentro del tablero.

| Control | Dónde está hoy | Qué estado modifica | Cuándo aparece | Notas |
| --- | --- | --- | --- | --- |
| Control | Dónde está hoy | Qué estado modifica | Cuándo aparece | Notas |
| File (botón + menú) | Barra superior del tablero (`EmbeddedFileMenu.tsx:31`) | Abre el menú con vistas menu/new/open/save/export | Siempre | Equivale a New document, Choose canvas, Import, Save y Export del Designer completo |
| File › New… (6 presets) | Menú File (`EmbeddedFileMenu.tsx:36`) | `newBlankDoc` | Menú abierto | Mismos presets que [[documentos]] |
| File › Open… | Menú File (`EmbeddedFileMenu.tsx:37`) | `selectDoc` (lista de miniaturas) | Hay documentos | Reutiliza `DocumentChoices` |
| File › Import image | Menú File (`EmbeddedFileMenu.tsx:38`) | `importDesignFiles` | Hay documento | — |
| File › Save to gallery… | Menú File (`EmbeddedFileMenu.tsx:39`) | Guarda en la galería tras Cancel / Save | Hay documento | — |
| File › Export… (4 formatos) | Menú File (`EmbeddedFileMenu.tsx:40`) | `runDesignOutput` | Hay documento | PNG, JPG, SVG, PDF |
| Nombre del documento | Barra superior (`EmbeddedDesigner.tsx:48`) | Ninguno | Hay documento | Solo texto |
| Select and move | Barra superior (`EmbeddedDesigner.tsx:50`) | `ui.tool = move` | Hay documento | Duplica Edit del dock completo |
| Pan (or hold Space and drag) | Barra superior (`EmbeddedDesigner.tsx:51`) | `ui.tool = hand` | Hay documento | — |
| Undo / Redo | Barra superior (`EmbeddedDesigner.tsx:52`) | `undoDoc` / `redoDoc` | Hay documento | — |
| Zoom out / porcentaje (solo lectura) / Zoom in / Fit canvas | Barra superior (`EmbeddedDesigner.tsx:54`) | Eventos `ogs:designer-zoom` y `ogs:designer-fit` | Hay documento | El porcentaje NO es editable aquí (sí en el Designer completo) |
| ToolDock (herramientas de dibujo, sin Edit ni Pan) | Barra inferior (`EmbeddedDesignerBar.tsx:43`) | Igual que el dock completo ([[toolbox-dock]]) | Hay documento | Recibe `tools = DOCK_TOOLS` |
| Color rápido | Barra inferior (`EmbeddedDesignerBar.tsx:46`) | Color de Text, de relleno de formas, del Eraser (deshabilitado) o de Lineart (`EmbeddedDesignerBar.tsx:19`) | Hay documento | Es el modelo de los chips de color de la propuesta F/G |
| Tamaño rápido (botón + popover con un slider) | Barra inferior (`EmbeddedDesignerBar.tsx:47`) | Tamaño de Text, ancho de forma, tamaño de Eraser o de Lineart | Hay documento | Slider único; etiqueta Size o Width |
| Layers (botón + lista) | Barra inferior (`EmbeddedDesignerBar.tsx:51`) | Abre `EmbeddedLayers` | Hay documento | Solo ojo y aviso de bloqueo por capa (`EmbeddedLayers.tsx:14`); sin candado editable |

## Enlaces

- [[documentos]] · [documentos.md](documentos.md)
- [[toolbox-dock]] · [toolbox-dock.md](toolbox-dock.md)
- [[capas]] · [capas.md](capas.md)
- [[navegacion-zoom]] · [navegacion-zoom.md](navegacion-zoom.md)
- [[README]] · [Índice](README.md)

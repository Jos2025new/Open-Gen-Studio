---
type: inventario
title: Barra superior del Designer
description: Los botones que DesignerWorkspace pone en la barra superior de la app y los que acompañan al lienzo.
tags: [designer, barra, topbar]
updated: 2026-10-28
related: [documentos, tamanos, navegacion-zoom, alinear-editar, capas]
---
# Barra superior del Designer

`DesignerWorkspace` (`DesignerWorkspace.tsx:28`) rellena `TopbarActions` (`DesignerWorkspace.tsx:84`) con estos controles. Los que dependen de `doc` solo aparecen si hay un documento abierto; sin documento hay una pantalla vacía con los 6 presets ([[documentos]]). El orden de izquierda a derecha es el del código, con separadores `topbar-sep` entre grupos.

| Control | Dónde está hoy | Qué estado modifica | Cuándo aparece | Notas | Dónde quedaría en la propuesta | Estado | Mockup |
| --- | --- | --- | --- | --- | --- | --- | --- |
| New document (botón + menú de 6 presets) | Barra superior (`DesignerWorkspace.tsx:85`) | Crea un documento (`newBlankDoc`) | Siempre | Detalle de presets en [[documentos]] | Igual que hoy | se conserva | no dibujado |
| Undo | Barra superior (`DesignerWorkspace.tsx:91`) | `undoDoc` | Hay documento; deshabilitado sin historia | Ctrl+Z | Igual que hoy | se conserva | no dibujado |
| Redo | Barra superior (`DesignerWorkspace.tsx:92`) | `redoDoc` | Hay documento; deshabilitado sin rehacer | Ctrl+Shift+Z o Ctrl+Y | Igual que hoy | se conserva | no dibujado |
| History trimmed (texto) | Barra superior (`DesignerWorkspace.tsx:93`) | Ninguno | Cuando el límite de memoria descartó pasos viejos | Solo informa (tooltip) | Igual que hoy | se conserva | no dibujado |
| Import image | Barra superior (`DesignerWorkspace.tsx:95`) | Abre el selector de archivos (`importDesignFiles`) | Hay documento | El evento `ogs:upload` abre el mismo selector | Igual que hoy | se conserva | no dibujado |
| Transform (botón + menú, `turnOnly`) | Barra superior (`DesignerWorkspace.tsx:96`) | Espejo y giro del objeto o capa ([[alinear-editar]]) | Hay documento; deshabilitado sin selección | DUPLICADO con Transform de la barra Edit y de la Edit card | Igual que hoy | se conserva | no dibujado |
| Show or hide right panel | Barra superior (`DesignerWorkspace.tsx:97`) | Evento `ogs:layers-toggle` (pliega el panel) | Hay documento | Duplica el botón «Collapse layers panel» del propio panel ([[capas]]) | Se queda: la propuesta B8 de quitar el del dock fue descartada, y este es el que se conserva | se conserva | [b8-dock-toggle-duplicado](../mockups/designer-ajustes/b8-dock-toggle-duplicado.html) |
| Selection / Selection · inverted + Deselect | Barra superior (`ToolSettings.tsx:141`) | `setSelection(docId, null)` | Hay selección de píxeles y la herramienta activa no es Select pixels | Duplica Deselect de la tarjeta Select ([[seleccion]]) | Igual que hoy | se conserva | no dibujado |
| Canvas size · W × H (botón + popover) | Barra superior (`CanvasSize.tsx:84`) | Abre el formulario de tamaño ([[tamanos]]) | Hay documento | Misma lógica que la variante Size del dock | Igual que hoy | se conserva | no dibujado |
| Save to gallery (botón + confirmación) | Barra superior (`DesignerWorkspace.tsx:103`) | Abre la confirmación | Hay documento; deshabilitado mientras exporta | Detalle en [[documentos]] | Igual que hoy | se conserva | no dibujado |
| Export (botón + menú de 4 formatos) | Barra superior (`DesignerWorkspace.tsx:113`) | Abre el menú de formatos | Hay documento; deshabilitado mientras exporta | Detalle en [[documentos]] | Igual que hoy | se conserva | no dibujado |
| Import from chat (botón + popover) | Barra superior izquierda (`DesignerWorkspace.tsx:119`) | `chatToDesigner` | Hay imágenes del chat que aún no están en un diseño | Detalle en [[documentos]] | Igual que hoy | se conserva | no dibujado |
| Choose canvas (selector de documentos) | Encima del lienzo (`DocumentPicker.tsx:42`) | Preferencia `ogs:canvas-picker-open` | Hay documento | Detalle en [[documentos]] | Igual que hoy | se conserva | no dibujado |
| Zoom in / Zoom percent / Zoom out / Fit canvas / tool help | Barra vertical «Canvas view» (`DesignerWorkspace.tsx:129`) | Eventos de zoom y `ui.toolHelp` | Hay documento | Detalle en [[navegacion-zoom]] | Igual que hoy | se conserva | no dibujado |
| Línea de ayuda de la herramienta | Encima del lienzo (`ToolHelp.tsx:36`) | `ui.toolHelp` (la X lo apaga) | `ui.toolHelp` no es false | Texto distinto por herramienta | Igual que hoy | se conserva | no dibujado |

## Enlaces

- [[documentos]] · [documentos.md](documentos.md)
- [[tamanos]] · [tamanos.md](tamanos.md)
- [[navegacion-zoom]] · [navegacion-zoom.md](navegacion-zoom.md)
- [[alinear-editar]] · [alinear-editar.md](alinear-editar.md)
- [[capas]] · [capas.md](capas.md)
- [[README]] · [Índice](README.md)

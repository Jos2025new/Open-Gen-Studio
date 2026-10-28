---
type: inventario
title: Selección de píxeles (Rectangle, Lasso, Magic wand)
description: Todos los controles de la selección de píxeles: forma, ajustes de la varita, acciones sobre lo seleccionado, chip de la barra superior y gestos.
tags: [designer, seleccion, select]
updated: 2026-10-28
related: [toolbox-dock, atajos, lienzo-gestos, barra-superior, alinear-editar, degradado]
---
# Selección de píxeles (Rectangle, Lasso, Magic wand)

Las tres variantes (Rectangular selection, Lasso, Magic wand) son la misma herramienta `ui.tool='select'` con `ui.selectShape` distinto (`toolboxModel.ts:28`). La selección en sí no vive en el store: es un módulo (`pixelSelection.ts`, `pixelSelection.ts:48`). Los ajustes salen de `SelectOps` (`ToolSettings.tsx:156`), que en compacto (tira) solo ofrece Deselect y To layer. **La selección de objetos/capas (Edit) es otra cosa**: [[alinear-editar]].

| Control | Dónde está hoy | Qué estado modifica | Cuándo aparece | Notas | Dónde quedaría en la propuesta | Estado | Mockup |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Shape (Rectangle / Lasso / Magic wand) | Dock › tarjeta / Panel Tool (`SelectOps`, `ToolSettings.tsx:156`) (`ToolSettings.tsx:167`) | `ui.selectShape` | Tool = select | Duplica las tres variantes del dock | Panel Tool, rama de la varita: primer control | se conserva | [a4-seleccion-modo](../mockups/designer-ajustes/a4-seleccion-modo.html) |
| Tolerance (slider 0 a 255) | Dock › tarjeta / Panel Tool (`SelectOps`, `ToolSettings.tsx:156`) (`ToolSettings.tsx:169`) | `ui.wand.threshold` (defecto 24) | Shape = Magic wand | Tooltip: bajo = solo ese color | Panel Tool, rama de la varita: un lugar más abajo por la llegada de Mode | se conserva | [a4-seleccion-modo](../mockups/designer-ajustes/a4-seleccion-modo.html) |
| Expand (slider 0 a 12 px) | Dock › tarjeta / Panel Tool (`SelectOps`, `ToolSettings.tsx:156`) (`ToolSettings.tsx:170`) | `ui.wand.expand` | Magic wand | — | Panel Tool, rama de la varita: un lugar más abajo por la llegada de Mode | se conserva | [a4-seleccion-modo](../mockups/designer-ajustes/a4-seleccion-modo.html) |
| Smooth (slider 0 a 4 px, paso 0.5) | Dock › tarjeta / Panel Tool (`SelectOps`, `ToolSettings.tsx:156`) (`ToolSettings.tsx:171`) | `ui.wand.smooth` | Magic wand | — | Panel Tool, rama de la varita: un lugar más abajo por la llegada de Mode | se conserva | [a4-seleccion-modo](../mockups/designer-ajustes/a4-seleccion-modo.html) |
| Mode (New / Add / Subtract) | Dock › tarjeta / Panel Tool (`SelectOps`, `ToolSettings.tsx:156`) (`ToolSettings.tsx:172`) | `ui.wand.mode` | SOLO Magic wand | Rectangle y Lasso no tienen selector de modo: usan Shift (añadir) y Alt (restar) al arrastrar. La propuesta A4 lo coloca tras Shape | Panel Tool, rama de la varita: justo después de Shape, antes de Tolerance | se mueve | [a4-seleccion-modo](../mockups/designer-ajustes/a4-seleccion-modo.html) |
| Sample (Active layer / All layers) | Dock › tarjeta / Panel Tool (`SelectOps`, `ToolSettings.tsx:156`) (`ToolSettings.tsx:173`) | `ui.wand.sample` | Magic wand | — | Panel Tool, rama de la varita: un lugar más abajo por la llegada de Mode | se conserva | [a4-seleccion-modo](../mockups/designer-ajustes/a4-seleccion-modo.html) |
| All (botón) | Dock › tarjeta / Panel Tool (`SelectOps`, `ToolSettings.tsx:156`) (`ToolSettings.tsx:181`) | Selección = toda la página (`selectAll`, con `record`) | Tool = select, no compacto | Ctrl+A | Igual que hoy | se conserva | no dibujado |
| Invert / Inverted (botón) | Dock › tarjeta / Panel Tool (`SelectOps`, `ToolSettings.tsx:156`) (`ToolSettings.tsx:182`) | `invertSelection` | Tool = select, no compacto | El texto pasa a «Inverted» si ya está invertida | Igual que hoy | se conserva | no dibujado |
| Deselect (botón) | Dock › tarjeta / Panel Tool (`SelectOps`, `ToolSettings.tsx:156`) no compacto (`ToolSettings.tsx:183`); tira compacta, «no alcanzable por lectura — requiere prueba en sandbox» (`ToolSettings.tsx:177`) | `setSelection(docId, null)` | Hay selección (deshabilitado si no) | También en el chip de la barra superior | Igual que hoy | se conserva | no dibujado |
| Grow / shrink (slider 1 a 50 px) | Dock › tarjeta / Panel Tool (`SelectOps`, `ToolSettings.tsx:156`) (`ToolSettings.tsx:184`) | Estado local `grow` (defecto 2); no persiste | Tool = select, no compacto | Fija cuántos píxeles mueven Grow y Shrink | Igual que hoy | se conserva | no dibujado |
| Grow (botón) | Dock › tarjeta / Panel Tool (`SelectOps`, `ToolSettings.tsx:156`) (`ToolSettings.tsx:185`) | Selección más ancha `grow` px por lado | Hay selección, no compacto | — | Igual que hoy | se conserva | no dibujado |
| Shrink (botón) | Dock › tarjeta / Panel Tool (`SelectOps`, `ToolSettings.tsx:156`) (`ToolSettings.tsx:186`) | Selección más estrecha | Hay selección, no compacto | — | Igual que hoy | se conserva | no dibujado |
| Delete (botón) | Dock › tarjeta / Panel Tool (`SelectOps`, `ToolSettings.tsx:156`) (`ToolSettings.tsx:187`) | Borra los píxeles seleccionados de la capa raster activa (`clearSelected`) | Hay selección, no compacto | Tecla Delete con selección hace lo mismo | Igual que hoy | se conserva | no dibujado |
| Fill (botón) | Dock › tarjeta / Panel Tool (`SelectOps`, `ToolSettings.tsx:156`) (`ToolSettings.tsx:188`) | Capa nueva con `ui.brush.color`/`opacity` (`fillSelection`) | Hay selección, no compacto | Usa el color del pincel | Igual que hoy | se conserva | no dibujado |
| To layer (botón) | Dock › tarjeta / Panel Tool (`SelectOps`, `ToolSettings.tsx:156`) no compacto (`ToolSettings.tsx:189`); tira compacta, «no alcanzable por lectura — requiere prueba en sandbox» (`ToolSettings.tsx:178`) | Capa nueva con los píxeles (`selectionToLayer`) | Hay selección | Ctrl+J | Igual que hoy | se conserva | no dibujado |
| Chip «Selection» / «Selection · inverted» + Deselect | Barra superior (`ToolSettings.tsx:141`); montada en `DesignerWorkspace.tsx:100` | `setSelection(docId, null)` | Hay selección Y la herramienta no es select | Aviso de que la selección sigue recortando Delete, copiar, cortar y Gradient | Igual que hoy | se conserva | no dibujado |
| Arrastrar un rectángulo / un lazo | Lienzo (`Stage.tsx:620`) | Selección nueva o combinada | select + Rectangle o Lasso | Shift añade, Alt resta; el lazo solo suma puntos cada 2 px de pantalla | Igual que hoy | se conserva | no dibujado |
| Clic con la varita | Lienzo (`Stage.tsx:614`) | Selección por color (`wandSelection` + `combineSelection`) | select + Magic wand | Muestra un aviso si no puede | Igual que hoy | se conserva | no dibujado |
| Arrastrar dentro de la selección (Edit) | Lienzo (`Stage.tsx:50`) | Corta los píxeles a una capa movible (`pixelMove`) | Tool = move y hay selección | Pista: «Drag inside the pixel selection to extract and move it» | Igual que hoy | se conserva | no dibujado |
| Ctrl+A / Ctrl+D / Ctrl+Shift+I / Ctrl+J / Delete | Teclado (`designerKeys.ts:55`) | Como los botones | Foco fuera de campos de texto | Ver [[atajos]] | Igual que hoy | se conserva | no dibujado |
| Copiar / cortar con selección | Teclado del navegador, `designerClipboard` (`designerClipboard.ts:45`) | Portapapeles (imagen PNG); cortar borra tras confirmar | Hay selección | Sin selección, copia la capa raster activa | Igual que hoy | se conserva | no dibujado |

## Enlaces

- [[toolbox-dock]] · [toolbox-dock.md](toolbox-dock.md)
- [[atajos]] · [atajos.md](atajos.md)
- [[lienzo-gestos]] · [lienzo-gestos.md](lienzo-gestos.md)
- [[barra-superior]] · [barra-superior.md](barra-superior.md)
- [[alinear-editar]] · [alinear-editar.md](alinear-editar.md)
- [[degradado]] · [degradado.md](degradado.md)
- [[README]] · [Índice](README.md)

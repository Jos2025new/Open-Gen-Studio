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

| Control | Dónde está hoy | Qué estado modifica | Cuándo aparece | Notas |
| --- | --- | --- | --- | --- |
| Control | Dónde está hoy | Qué estado modifica | Cuándo aparece | Notas |
| Shape (Rectangle / Lasso / Magic wand) | Dock › tarjeta / Panel Tool (`SelectOps`, `ToolSettings.tsx:156`) (`ToolSettings.tsx:167`) | `ui.selectShape` | Tool = select | Duplica las tres variantes del dock |
| Tolerance (slider 0 a 255) | Dock › tarjeta / Panel Tool (`SelectOps`, `ToolSettings.tsx:156`) (`ToolSettings.tsx:169`) | `ui.wand.threshold` (defecto 24) | Shape = Magic wand | Tooltip: bajo = solo ese color |
| Expand (slider 0 a 12 px) | Dock › tarjeta / Panel Tool (`SelectOps`, `ToolSettings.tsx:156`) (`ToolSettings.tsx:170`) | `ui.wand.expand` | Magic wand | — |
| Smooth (slider 0 a 4 px, paso 0.5) | Dock › tarjeta / Panel Tool (`SelectOps`, `ToolSettings.tsx:156`) (`ToolSettings.tsx:171`) | `ui.wand.smooth` | Magic wand | — |
| Mode (New / Add / Subtract) | Dock › tarjeta / Panel Tool (`SelectOps`, `ToolSettings.tsx:156`) (`ToolSettings.tsx:172`) | `ui.wand.mode` | SOLO Magic wand | Rectangle y Lasso no tienen selector de modo: usan Shift (añadir) y Alt (restar) al arrastrar. La propuesta A4 lo coloca tras Shape |
| Sample (Active layer / All layers) | Dock › tarjeta / Panel Tool (`SelectOps`, `ToolSettings.tsx:156`) (`ToolSettings.tsx:173`) | `ui.wand.sample` | Magic wand | — |
| All (botón) | Dock › tarjeta / Panel Tool (`SelectOps`, `ToolSettings.tsx:156`) (`ToolSettings.tsx:181`) | Selección = toda la página (`selectAll`, con `record`) | Tool = select, no compacto | Ctrl+A |
| Invert / Inverted (botón) | Dock › tarjeta / Panel Tool (`SelectOps`, `ToolSettings.tsx:156`) (`ToolSettings.tsx:182`) | `invertSelection` | Tool = select, no compacto | El texto pasa a «Inverted» si ya está invertida |
| Deselect (botón) | Dock › tarjeta / Panel Tool (`SelectOps`, `ToolSettings.tsx:156`) no compacto (`ToolSettings.tsx:183`); tira compacta (`ToolSettings.tsx:177`) | `setSelection(docId, null)` | Hay selección (deshabilitado si no) | También en el chip de la barra superior |
| Grow / shrink (slider 1 a 50 px) | Dock › tarjeta / Panel Tool (`SelectOps`, `ToolSettings.tsx:156`) (`ToolSettings.tsx:184`) | Estado local `grow` (defecto 2); no persiste | Tool = select, no compacto | Fija cuántos píxeles mueven Grow y Shrink |
| Grow (botón) | Dock › tarjeta / Panel Tool (`SelectOps`, `ToolSettings.tsx:156`) (`ToolSettings.tsx:185`) | Selección más ancha `grow` px por lado | Hay selección, no compacto | — |
| Shrink (botón) | Dock › tarjeta / Panel Tool (`SelectOps`, `ToolSettings.tsx:156`) (`ToolSettings.tsx:186`) | Selección más estrecha | Hay selección, no compacto | — |
| Delete (botón) | Dock › tarjeta / Panel Tool (`SelectOps`, `ToolSettings.tsx:156`) (`ToolSettings.tsx:187`) | Borra los píxeles seleccionados de la capa raster activa (`clearSelected`) | Hay selección, no compacto | Tecla Delete con selección hace lo mismo |
| Fill (botón) | Dock › tarjeta / Panel Tool (`SelectOps`, `ToolSettings.tsx:156`) (`ToolSettings.tsx:188`) | Capa nueva con `ui.brush.color`/`opacity` (`fillSelection`) | Hay selección, no compacto | Usa el color del pincel |
| To layer (botón) | Dock › tarjeta / Panel Tool (`SelectOps`, `ToolSettings.tsx:156`) no compacto (`ToolSettings.tsx:189`); tira compacta (`ToolSettings.tsx:178`) | Capa nueva con los píxeles (`selectionToLayer`) | Hay selección | Ctrl+J |
| Chip «Selection» / «Selection · inverted» + Deselect | Barra superior (`ToolSettings.tsx:141`); montada en `DesignerWorkspace.tsx:100` | `setSelection(docId, null)` | Hay selección Y la herramienta no es select | Aviso de que la selección sigue recortando Delete, copiar, cortar y Gradient |
| Arrastrar un rectángulo / un lazo | Lienzo (`Stage.tsx:620`) | Selección nueva o combinada | select + Rectangle o Lasso | Shift añade, Alt resta; el lazo solo suma puntos cada 2 px de pantalla |
| Clic con la varita | Lienzo (`Stage.tsx:614`) | Selección por color (`wandSelection` + `combineSelection`) | select + Magic wand | Muestra un aviso si no puede |
| Arrastrar dentro de la selección (Edit) | Lienzo (`Stage.tsx:50`) | Corta los píxeles a una capa movible (`pixelMove`) | Tool = move y hay selección | Pista: «Drag inside the pixel selection to extract and move it» |
| Ctrl+A / Ctrl+D / Ctrl+Shift+I / Ctrl+J / Delete | Teclado (`designerKeys.ts:55`) | Como los botones | Foco fuera de campos de texto | Ver [[atajos]] |
| Copiar / cortar con selección | Teclado del navegador, `designerClipboard` (`designerClipboard.ts:45`) | Portapapeles (imagen PNG); cortar borra tras confirmar | Hay selección | Sin selección, copia la capa raster activa |

## Enlaces

- [[toolbox-dock]] · [toolbox-dock.md](toolbox-dock.md)
- [[atajos]] · [atajos.md](atajos.md)
- [[lienzo-gestos]] · [lienzo-gestos.md](lienzo-gestos.md)
- [[barra-superior]] · [barra-superior.md](barra-superior.md)
- [[alinear-editar]] · [alinear-editar.md](alinear-editar.md)
- [[degradado]] · [degradado.md](degradado.md)
- [[README]] · [Índice](README.md)

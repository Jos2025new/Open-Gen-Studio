---
type: inventario
title: Panel de capas (Layers)
description: El panel derecho: pestañas, lista de capas, filas, carpetas, barra de acciones, menús, arrastre, selección múltiple y avisos del límite raster.
tags: [designer, capas, layers, panel]
updated: 2026-10-28
related: [propiedades, fx, alinear-editar, documentos, atajos, lienzo-gestos]
---
# Panel de capas (Layers)

`LayersPanel` (`LayersPanel.tsx:85`) es el panel derecho del Designer. Tiene tres pestañas (Properties, Tool, Layers); la lista de capas y su barra de acciones están **siempre** visibles encima (en `layer-shelf`), salvo con el panel plegado. Preferencias propias del panel (no de `ui`): `ogs:layers-width`, `ogs:layers-list-h`, `ogs:layers-collapsed`, `ogs:layers-tab` (`usePref`, `LayersPanel.tsx:96`). El contenido de las pestañas está en [[propiedades]] (Properties), [[toolbox-dock]] (Tool, mismos ajustes que la tarjeta) y [[fx]].

| Control | Dónde está hoy | Qué estado modifica | Cuándo aparece | Notas |
| --- | --- | --- | --- | --- |
| Control | Dónde está hoy | Qué estado modifica | Cuándo aparece | Notas |
| Show layers panel (botón) | Panel plegado (`LayersPanel.tsx:155`) | Preferencia `ogs:layers-collapsed` | Panel plegado | Icono PanelRightOpen |
| Open layers panel to confirm painting (botón) | Panel plegado (`LayersPanel.tsx:156`) | Despliega el panel | Plegado y hay una capa raster pendiente de aprobar | Icono AlertTriangle |
| Collapse layers panel (botón) | Cabecera de pestañas (`LayersPanel.tsx:178`) | `ogs:layers-collapsed` | Panel abierto | Evento `ogs:layers-toggle` hace lo mismo (`LayersPanel.tsx:111`) |
| Pestaña Properties | Cabecera de pestañas (`LayersPanel.tsx:171`) | `ogs:layers-tab` = props | Siempre | Solo la pestaña activa muestra su nombre; las demás lo dicen al pasar el puntero (hover-only) |
| Pestaña Tool | Cabecera de pestañas (`LayersPanel.tsx:171`) | `ogs:layers-tab` = tool | Siempre | «Settings…» de la tira también la abre |
| Pestaña Layers | Cabecera de pestañas (`LayersPanel.tsx:171`) | `ogs:layers-tab` = layers | Siempre | Modo «solo capas» |
| N selected · clear | Cabecera (`LayersPanel.tsx:178`) | `pickLayer` (vacía la multiselección) | ≥2 capas elegidas | — |
| Confirm painting on <capa> (aviso + Cancel / Continue) | Cabecera (`RasterLimitControls.tsx:48`) | `armNextRasterPaint` / `cancelRasterPaintApproval` | Capa raster que alcanzó el límite de trazos editables | Popover de confirmación |
| Resize the layer list (separador horizontal) | Panel (`LayersPanel.tsx:160`) | Preferencia `ogs:layers-list-h` (96 px a 75 % de la ventana) | Panel abierto | Doble clic restablece 240 px |
| Resize layers panel (separador vertical) | Panel (`LayersPanel.tsx:165`) | Preferencia `ogs:layers-width` (200 a 520 px) | Panel abierto | Doble clic restablece 260 px; actualiza `--layers-w` |
| Layer · nombre (cuadro Opacity + Blend) | Panel, bajo las pestañas (`LayersPanel.tsx:180`) | La capa activa (`patchLayer`) | Hay capa activa; deshabilitado si está bloqueada | Detalle en [[propiedades]] |
| Fila de capa (seleccionar) | Lista (`LayersPanel.tsx:209`) | `setActiveLayer` + selección múltiple | Siempre | Clic elige; Ctrl-clic añade o quita; Shift-clic elige el tramo (`LayersPanel.tsx:212`) |
| Miniatura de la capa | Fila (`LayersPanel.tsx:38`) | Ninguno | Capas no FX | Canvas 64×40 con cuadrícula; en FX es un icono |
| Destino del FX «→ capa» | Fila FX (`LayersPanel.tsx:218`) | Ninguno | Capa FX | Dice sobre qué actúa |
| Renombrar con doble clic | Fila (`LayersPanel.tsx:60`) | `patchLayer` {name} (Enter guarda, Esc cancela) | Capas no activas y carpetas | La capa activa muestra además un campo «Name» fijo (`LayersPanel.tsx:221`) |
| Name (campo en línea) | Fila activa (`LayersPanel.tsx:221`) | `patchLayer` {name} al salir del campo | Capa activa; deshabilitado si bloqueada | Duplica el renombrado por doble clic |
| Icono de tipo de capa | Fila (`LayersPanel.tsx:222`) | Ninguno | Siempre | Informativo (raster / vector / text / FX) |
| Pixels unreadable (aviso, clic reintenta) | Fila (`LayerUnreadable.tsx:9`) | Reintenta `ensureBuffers` | Raster cuyos píxeles no se pudieron leer | Icono AlertTriangle |
| Hide / Show (ojo) | Fila (`LayersPanel.tsx:224`) | `patchLayer` {visible} | Cada fila | Ojo a la derecha del nombre |
| Lock / Unlock (candado) | Fila (`LayersPanel.tsx:225`) | `patchLayer` {locked} | Cada fila | Una capa bloqueada no se mueve ni se edita |
| Arrastrar para reordenar | Fila (`LayersPanel.tsx:138`) | `reorderLayer` | Capas no bloqueadas | Una capa bloqueada avisa «is locked. Unlock it to move it.» y no se mueve |
| Doble clic en una fila FX | Fila (`LayersPanel.tsx:208`) | Abre `FxEditorPopover` ([[fx]]) | Capa FX | Gesto sin botón visible |
| Expand / Collapse folder (chevrón) | Cabecera de carpeta (`LayersPanel.tsx:74`) | `patchGroup` {collapsed} | Capa agrupada | — |
| Carpeta: seleccionar sus capas | Cabecera de carpeta (`LayersPanel.tsx:75`) | `selectGroup` + `setActiveLayer` | Capa agrupada | Edit las mueve juntas |
| Carpeta: renombrar (doble clic) | Cabecera de carpeta (`LayersPanel.tsx:77`) | `patchGroup` {name} | Capa agrupada | — |
| Carpeta: Hide / Show | Cabecera de carpeta (`LayersPanel.tsx:80`) | `setGroupFlag('visible')` | Capa agrupada | — |
| Carpeta: Lock / Unlock | Cabecera de carpeta (`LayersPanel.tsx:81`) | `setGroupFlag('locked')` | Capa agrupada | — |
| New layer (botón + menú) | Barra de acciones (`LayersPanel.tsx:230`) | Abre el menú | Siempre | Icono Plus |
| New layer › Raster | Menú New layer (`LayersPanel.tsx:233`) | `addEmptyLayer('raster')` | Menú abierto | «Pixels: paint, images» |
| New layer › Vector | Menú New layer (`LayersPanel.tsx:234`) | `addEmptyLayer('vector')` | Menú abierto | «Shapes and lineart» |
| New layer › Text | Menú New layer (`LayersPanel.tsx:235`) | `addEmptyLayer('text')` | Menú abierto | — |
| Filters and effects (FX) | Barra de acciones (`FxPanel.tsx:35`) | Abre el menú FX ([[fx]]) | Siempre; deshabilitado si la capa está bloqueada | Icono Sparkles (el mismo de Operations) |
| Duplicate layer | Barra de acciones (`LayersPanel.tsx:240`) | `duplicateLayer` | Hay capa activa | Atajo Ctrl+J con selección de píxeles es otra cosa («To layer») |
| Operations (botón + popover) | Barra de acciones (`LayersPanel.tsx:241`) | Abre la lista de operaciones y su `OpForm` | Capa raster activa y no bloqueada | Lista = `OPS` con entrada y salida imagen, sin `fx` (`LayersPanel.tsx:306`); el resultado es capa nueva encima |
| Move layer up | Barra de acciones (`LayersPanel.tsx:242`) | `moveLayer(+1)` | Hay capa activa; deshabilitado si ya es la superior | Bloqueada: avisa |
| Move layer down | Barra de acciones (`LayersPanel.tsx:243`) | `moveLayer(-1)` | Hay capa activa; deshabilitado si es la inferior | — |
| Delete layer / Delete N layers | Barra de acciones (`LayersPanel.tsx:244`) | `deleteLayers` | Hay capa activa; deshabilitado si todas las elegidas están bloqueadas | Sin confirmación propia (se puede deshacer) |
| More layer actions (botón + menú) | Barra de acciones (`LayersPanel.tsx:245`) | Abre el menú | Hay capa activa | Icono MoreHorizontal |
| More › Merge down | Menú More (`LayersPanel.tsx:248`) | `mergeDown` | Menú abierto; deshabilitado en la capa inferior o bloqueada | Muestra Ctrl+E |
| More › Rasterize layer | Menú More (`LayersPanel.tsx:249`) | `rasterizeLayer` | Capa que no es raster ni FX | — |
| More › Group layers | Menú More (`LayersPanel.tsx:252`) | `groupLayers` | Menú abierto; requiere ≥2 elegidas | Muestra Ctrl+G |
| More › Ungroup this folder | Menú More (`LayersPanel.tsx:251`) | `ungroup` | Todas las elegidas están en la misma carpeta | Sustituye a Group layers |
| More › Restore panel layout | Menú More (`LayersPanel.tsx:253`) | Ancho 260, lista 240, pestaña props | Menú abierto | — |
| Pestaña Tool: panel Align (solo con Edit) | Pestaña Tool (`LayersPanel.tsx:261`) | Ver [[alinear-editar]] | Tool = move | Misma `AlignControls` que la Edit card |
| Pestaña Tool: ajustes de la herramienta | Pestaña Tool (`LayersPanel.tsx:265`) | Según herramienta ([[toolbox-dock]]) | Tool distinto de hand | Con hand: «Pan has no additional settings.» (`LayersPanel.tsx:265`) |
| Texto de lista vacía | Lista (`LayersPanel.tsx:227`) | Ninguno | Documento sin capas | — |
| Límite de trazos: «N/M strokes · P/Q segments» | Bajo una capa raster (`RasterLimitControls.tsx:18`) | Ninguno | Raster en modo Design, con trazos editables o aplanada | Informativo |
| Pixels · strokes flattened | Bajo la capa (`RasterLimitControls.tsx:31`) | Ninguno | Capa con `paintFlattened` | Deshacer restaura los trazos |
| Disable limit / Enable limit (+ confirmación Cancel / Disable) | Bajo la capa (`RasterLimitControls.tsx:37`) | `patchLayer` {paintLimitDisabled} | Raster no aplanada; deshabilitado si bloqueada | Confirma en popover contextual |

## Enlaces

- [[propiedades]] · [propiedades.md](propiedades.md)
- [[fx]] · [fx.md](fx.md)
- [[alinear-editar]] · [alinear-editar.md](alinear-editar.md)
- [[documentos]] · [documentos.md](documentos.md)
- [[atajos]] · [atajos.md](atajos.md)
- [[lienzo-gestos]] · [lienzo-gestos.md](lienzo-gestos.md)
- [[README]] · [Índice](README.md)

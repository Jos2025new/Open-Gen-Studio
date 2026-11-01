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

| Control | Dónde está hoy | Qué estado modifica | Cuándo aparece | Notas | Dónde quedaría en la propuesta | Estado | Mockup |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Barra de pestañas (Properties, Tool, Layers) | Panel desanclado (`LayersPeek.tsx`, `PanelPeekHandle`) | Preferencia `ogs:layers-collapsed` (desanclado = plegado de antes) y `ogs:layers-tab` | Panel desanclado | Desde 2026-10-31 no queda franja vacía: las tres pestañas, apiladas en una barra vertical arriba a la derecha (como la toolbox lateral), y el borde derecho. Al pasar el puntero o enfocar una pestaña, el panel **se asoma** en ella, flotando a la izquierda de la barra, alineado arriba y a `--canvas-pop-gap`, con su ancho (`usePanelPeek`), sin mover nada; al salir se esconde tras una pausa breve (no con un menú suyo abierto). Clic en una pestaña: ancla el panel en ella | Igual que hoy | se conserva | no dibujado |
| Open layers panel to confirm painting (botón) | Bajo las pestañas de la barra del panel desanclado (`LayersPeek.tsx`) | Despliega el panel | Plegado y hay una capa raster pendiente de aprobar | Icono AlertTriangle | Igual que hoy | se conserva | no dibujado |
| Collapse layers panel / Pin layers panel (botón) | Cabecera de pestañas (`LayersPanel.tsx`) | `ogs:layers-collapsed` | Panel anclado o asomado | Anclado: lo desancla. Asomado: «Pin layers panel» lo ancla. Evento `ogs:layers-toggle` alterna igual (`LayersPanel.tsx:111`) | Igual que hoy | se conserva | no dibujado |
| Pestaña Properties | Cabecera de pestañas (`LayersPanel.tsx:171`) | `ogs:layers-tab` = props | Siempre | Solo la pestaña activa muestra su nombre; las demás lo dicen al pasar el puntero (hover-only) | Igual; el navegador (D14) se coloca encima de las pestañas | se conserva | [d14-navegador](../mockups/designer-ajustes/d14-navegador.html) |
| Pestaña Tool | Cabecera de pestañas (`LayersPanel.tsx:171`) | `ogs:layers-tab` = tool | Siempre | «Settings…» de la tira también la abre | Igual; el navegador (D14) se coloca encima de las pestañas | se conserva | [d14-navegador](../mockups/designer-ajustes/d14-navegador.html) |
| Pestaña Layers | Cabecera de pestañas (`LayersPanel.tsx:171`) | `ogs:layers-tab` = layers | Siempre | Modo «solo capas» | Igual; el navegador (D14) se coloca encima de las pestañas | se conserva | [d14-navegador](../mockups/designer-ajustes/d14-navegador.html) |
| N selected · clear | Cabecera (`LayersPanel.tsx:178`) | `pickLayer` (vacía la multiselección) | ≥2 capas elegidas | — | Igual que hoy | se conserva | no dibujado |
| Confirm painting on <capa> (aviso + Cancel / Continue) | Cabecera (`RasterLimitControls.tsx:48`) | `armNextRasterPaint` / `cancelRasterPaintApproval` | Capa raster que alcanzó el límite de trazos editables | Popover de confirmación | Igual que hoy | se conserva | no dibujado |
| Resize the layer list (separador horizontal) | Panel (`LayersPanel.tsx:160`) | Preferencia `ogs:layers-list-h` (96 px a 75 % de la ventana) | Panel abierto | Doble clic restablece 240 px | Igual que hoy | se conserva | no dibujado |
| Resize layers panel (separador vertical) | Panel (`LayersPanel.tsx:165`) | Preferencia `ogs:layers-width` (200 a 520 px) | Panel abierto | Doble clic restablece 260 px; actualiza `--layers-w` | Igual que hoy | se conserva | no dibujado |
| Layer · nombre (cuadro Opacity + Blend) | Panel, bajo las pestañas (`LayersPanel.tsx:180`) | La capa activa (`patchLayer`) | Hay capa activa; deshabilitado si está bloqueada | Detalle en [[propiedades]] | Igual que hoy | se conserva | no dibujado |
| Fila de capa (seleccionar) | Lista (`LayersPanel.tsx:209`) | `setActiveLayer` + selección múltiple | Siempre | Clic elige; Ctrl-clic añade o quita; Shift-clic elige el tramo (`LayersPanel.tsx:212`) | Igual | se conserva | [a2-capas-acciones](../mockups/designer-ajustes/a2-capas-acciones.html) |
| Miniatura de la capa | Fila (`LayersPanel.tsx:38`) | Ninguno | Capas no FX | Canvas 64×40 con cuadrícula; en FX es un icono | Igual que hoy | se conserva | no dibujado |
| Destino del FX «→ capa» | Fila FX (`LayersPanel.tsx:218`) | Ninguno | Capa FX | Dice sobre qué actúa | Igual que hoy | se conserva | no dibujado |
| Renombrar con doble clic | Fila (`LayersPanel.tsx:60`) | `patchLayer` {name} (Enter guarda, Esc cancela) | Capas no activas y carpetas | La capa activa muestra además un campo «Name» fijo (`LayersPanel.tsx:221`) | Igual que hoy | se conserva | no dibujado |
| Name (campo en línea) | Fila activa (`LayersPanel.tsx:221`) | `patchLayer` {name} al salir del campo | Capa activa; deshabilitado si bloqueada | Duplica el renombrado por doble clic | Igual que hoy | se conserva | no dibujado |
| Icono de tipo de capa | Fila (`LayersPanel.tsx:222`) | Ninguno | Siempre | Informativo (raster / vector / text / FX) | Igual; en capas FX de efecto Flame en lugar de Sparkles (B7) | se conserva | [a2-capas-acciones](../mockups/designer-ajustes/a2-capas-acciones.html), [b-iconos](../mockups/designer-ajustes/b-iconos.html) |
| Pixels unreadable (aviso, clic reintenta) | Fila (`LayerUnreadable.tsx:9`) | Reintenta `ensureBuffers` | Raster cuyos píxeles no se pudieron leer | Icono AlertTriangle | Igual que hoy | se conserva | no dibujado |
| Hide / Show (ojo) | Fila (`LayersPanel.tsx:224`) | `patchLayer` {visible} | Cada fila | Ojo a la derecha del nombre | A la izquierda de cada fila | se mueve | [a2-capas-acciones](../mockups/designer-ajustes/a2-capas-acciones.html) |
| Lock / Unlock (candado) | Fila (`LayersPanel.tsx:225`) | `patchLayer` {locked} | Cada fila | Una capa bloqueada no se mueve ni se edita | A la derecha de la fila, ya sin el ojo al lado | se conserva | [a2-capas-acciones](../mockups/designer-ajustes/a2-capas-acciones.html) |
| Arrastrar para reordenar | Fila (`LayersPanel.tsx:138`) | `reorderLayer` | Capas no bloqueadas | Una capa bloqueada avisa «is locked. Unlock it to move it.» y no se mueve | Igual que hoy | se conserva | no dibujado |
| Doble clic en una fila FX | Fila (`LayersPanel.tsx:208`) | Abre `FxEditorPopover` ([[fx]]) | Capa FX | Gesto sin botón visible | Igual que hoy | se conserva | no dibujado |
| Expand / Collapse folder (chevrón) | Cabecera de carpeta (`LayersPanel.tsx:74`) | `patchGroup` {collapsed} | Capa agrupada | — | Igual que hoy | se conserva | no dibujado |
| Carpeta: seleccionar sus capas | Cabecera de carpeta (`LayersPanel.tsx:75`) | `selectGroup` + `setActiveLayer` | Capa agrupada | Edit las mueve juntas | Igual que hoy | se conserva | no dibujado |
| Carpeta: renombrar (doble clic) | Cabecera de carpeta (`LayersPanel.tsx:77`) | `patchGroup` {name} | Capa agrupada | — | Igual que hoy | se conserva | no dibujado |
| Carpeta: Hide / Show | Cabecera de carpeta (`LayersPanel.tsx:80`) | `setGroupFlag('visible')` | Capa agrupada | — | Ojo a la izquierda también en la cabecera de carpeta, por coherencia (propuesta mía, sin confirmar) | se mueve | no dibujado |
| Carpeta: Lock / Unlock | Cabecera de carpeta (`LayersPanel.tsx:81`) | `setGroupFlag('locked')` | Capa agrupada | — | Igual que hoy | se conserva | no dibujado |
| New layer (botón + menú) | Barra de acciones (`LayersPanel.tsx:230`) | Abre el menú | Siempre | Icono Plus | Barra de acciones ENCIMA de la lista | se mueve | [a2-capas-acciones](../mockups/designer-ajustes/a2-capas-acciones.html) |
| New layer › Raster | Menú New layer (`LayersPanel.tsx:233`) | `addEmptyLayer('raster')` | Menú abierto | «Pixels: paint, images» | Igual que hoy | se conserva | no dibujado |
| New layer › Vector | Menú New layer (`LayersPanel.tsx:234`) | `addEmptyLayer('vector')` | Menú abierto | «Shapes and lineart» | Igual que hoy | se conserva | no dibujado |
| New layer › Text | Menú New layer (`LayersPanel.tsx:235`) | `addEmptyLayer('text')` | Menú abierto | — | Igual que hoy | se conserva | no dibujado |
| Filters and effects (FX) | Barra de acciones (`FxPanel.tsx:35`) | Abre el menú FX ([[fx]]) | Siempre; deshabilitado si la capa está bloqueada | Icono Sparkles (el mismo de Operations) | Barra de acciones ENCIMA de la lista; icono Zap en lugar de Sparkles (B6) | se mueve | [a2-capas-acciones](../mockups/designer-ajustes/a2-capas-acciones.html), [b-iconos](../mockups/designer-ajustes/b-iconos.html) |
| Duplicate layer | Barra de acciones (`LayersPanel.tsx:240`) | `duplicateLayer` | Hay capa activa | Atajo Ctrl+J con selección de píxeles es otra cosa («To layer») | Barra de acciones ENCIMA de la lista | se mueve | [a2-capas-acciones](../mockups/designer-ajustes/a2-capas-acciones.html) |
| Operations (botón + popover) | Barra de acciones (`LayersPanel.tsx:241`) | Abre la lista de operaciones y su `OpForm` | Capa raster activa y no bloqueada | Lista = `OPS` con entrada y salida imagen, sin `fx` (`LayersPanel.tsx:306`); el resultado es capa nueva encima | Barra de acciones ENCIMA de la lista; conserva Sparkles (es la IA) | se mueve | [a2-capas-acciones](../mockups/designer-ajustes/a2-capas-acciones.html), [b-iconos](../mockups/designer-ajustes/b-iconos.html) |
| Move layer up | Barra de acciones (`LayersPanel.tsx:242`) | `moveLayer(+1)` | Hay capa activa; deshabilitado si ya es la superior | Bloqueada: avisa | Barra DEBAJO de la lista (misma clase layer-actions), separada de la de arriba | se conserva | [a2-capas-acciones](../mockups/designer-ajustes/a2-capas-acciones.html) |
| Move layer down | Barra de acciones (`LayersPanel.tsx:243`) | `moveLayer(-1)` | Hay capa activa; deshabilitado si es la inferior | — | Barra DEBAJO de la lista (misma clase layer-actions), separada de la de arriba | se conserva | [a2-capas-acciones](../mockups/designer-ajustes/a2-capas-acciones.html) |
| Delete layer / Delete N layers | Barra de acciones (`LayersPanel.tsx:244`) | `deleteLayers` | Hay capa activa; deshabilitado si todas las elegidas están bloqueadas | Sin confirmación propia (se puede deshacer) | Barra DEBAJO de la lista (misma clase layer-actions), separada de la de arriba | se conserva | [a2-capas-acciones](../mockups/designer-ajustes/a2-capas-acciones.html) |
| More layer actions (botón + menú) | Barra de acciones (`LayersPanel.tsx:245`) | Abre el menú | Hay capa activa | Icono MoreHorizontal | Barra DEBAJO de la lista (misma clase layer-actions), separada de la de arriba | se conserva | [a2-capas-acciones](../mockups/designer-ajustes/a2-capas-acciones.html) |
| More › Merge down | Menú More (`LayersPanel.tsx:248`) | `mergeDown` | Menú abierto; deshabilitado en la capa inferior o bloqueada | Muestra Ctrl+E | Igual que hoy | se conserva | no dibujado |
| More › Rasterize layer | Menú More (`LayersPanel.tsx:249`) | `rasterizeLayer` | Capa que no es raster ni FX | — | Igual que hoy | se conserva | no dibujado |
| More › Group layers | Menú More (`LayersPanel.tsx:252`) | `groupLayers` | Menú abierto; requiere ≥2 elegidas | Muestra Ctrl+G | Igual que hoy | se conserva | no dibujado |
| More › Ungroup this folder | Menú More (`LayersPanel.tsx:251`) | `ungroup` | Todas las elegidas están en la misma carpeta | Sustituye a Group layers | Igual que hoy | se conserva | no dibujado |
| More › Restore panel layout | Menú More (`LayersPanel.tsx:253`) | Ancho 260, lista 240, pestaña props | Menú abierto | — | Igual que hoy | se conserva | no dibujado |
| Pestaña Tool: panel Align (solo con Edit) | Pestaña Tool (`LayersPanel.tsx:261`) | Ver [[alinear-editar]] | Tool = move | Misma `AlignControls` que la Edit card | Igual; el navegador (D14) se coloca encima de las pestañas | se conserva | [d14-navegador](../mockups/designer-ajustes/d14-navegador.html) |
| Pestaña Tool: ajustes de la herramienta | Pestaña Tool (`LayersPanel.tsx:265`) | Según herramienta ([[toolbox-dock]]) | Tool distinto de hand | Con hand: «Pan has no additional settings.» (`LayersPanel.tsx:265`) | Igual; el navegador (D14) se coloca encima de las pestañas | se conserva | [d14-navegador](../mockups/designer-ajustes/d14-navegador.html) |
| Texto de lista vacía | Lista (`LayersPanel.tsx:227`) | Ninguno | Documento sin capas | — | Igual que hoy | se conserva | no dibujado |
| Límite de trazos: «N/M strokes · P/Q segments» | Bajo una capa raster (`RasterLimitControls.tsx:18`) | Ninguno | Raster en modo Design, con trazos editables o aplanada | Informativo | Igual que hoy | se conserva | no dibujado |
| Pixels · strokes flattened | Bajo la capa (`RasterLimitControls.tsx:31`) | Ninguno | Capa con `paintFlattened` | Deshacer restaura los trazos | Igual que hoy | se conserva | no dibujado |
| Disable limit / Enable limit (+ confirmación Cancel / Disable) | Bajo la capa (`RasterLimitControls.tsx:37`) | `patchLayer` {paintLimitDisabled} | Raster no aplanada; deshabilitado si bloqueada | Confirma en popover contextual | Igual que hoy | se conserva | no dibujado |

## Enlaces

- [[propiedades]] · [propiedades.md](propiedades.md)
- [[fx]] · [fx.md](fx.md)
- [[alinear-editar]] · [alinear-editar.md](alinear-editar.md)
- [[documentos]] · [documentos.md](documentos.md)
- [[atajos]] · [atajos.md](atajos.md)
- [[lienzo-gestos]] · [lienzo-gestos.md](lienzo-gestos.md)
- [[README]] · [Índice](README.md)

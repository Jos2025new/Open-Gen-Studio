---
type: inventario
title: Menús contextuales y popovers
description: Los clics derechos que existen en el Designer (solo dos) y la lista de popovers que abren los botones.
tags: [designer, menus, popovers, contextual]
updated: 2026-10-28
related: [guias, selector-de-color, capas, barra-superior, lienzo-gestos]
---
# Menús contextuales y popovers

El Designer NO tiene un menú de clic derecho general: una búsqueda de `onContextMenu` en `components/designer`, `components/studio` y `components/ui` solo encuentra dos usos (`Stage.tsx:1336` y `InlineControls.tsx:61`). El resto de la página usa el menú nativo del navegador. Abajo van los dos, y a continuación todos los popovers abiertos por un botón, para que el reagrupado no pierda ninguno.

| Control | Dónde está hoy | Qué estado modifica | Cuándo aparece | Notas | Dónde quedaría en la propuesta | Estado | Mockup |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Control | Dónde está hoy | Qué estado modifica | Cuándo aparece | Notas | Igual que hoy | se conserva | no dibujado |
| Clic derecho en una regla | Reglas del lienzo (`Stage.tsx:1336`) | `clearGuides`; aviso «Guides cleared» | Reglas visibles y hay guías | Sin menú: borra todas las guías al instante, sin confirmar | Igual que hoy | se conserva | no dibujado |
| Clic derecho en una muestra guardada | Selector de color (`InlineControls.tsx:61`) | `removeSwatch` (la quita de `ui.swatches`) | Muestra guardada (no las recientes) | Sin menú ni confirmación; detalle en [[selector-de-color]] | Igual que hoy | se conserva | no dibujado |
| Popover Snap | Barra Edit (`SnapControl.tsx:17`) | Casillas de snap ([[alinear-editar]]) | Tool = move | 220 px, `bottom-start` | Igual que hoy | se conserva | no dibujado |
| Popover Transform | Barra Edit y Edit card (`ToolSettings.tsx:129`) | Espejo y giro ([[alinear-editar]]) | Con selección | 220 px | Igual que hoy | se conserva | no dibujado |
| Popover Shape (parámetros) | Tira contextual (`ShapePaint.tsx:101`) | `PrimFields` ([[tira-contextual]]) | Forma con parámetros | 240 px | Igual que hoy | se conserva | no dibujado |
| Popover del selector de color | Cualquier `InlineColor` (`InlineControls.tsx:51`) | Color, alfa, tipo, paradas ([[selector-de-color]]) | Siempre que haya un color | Muestra recientes y guardadas | Igual que hoy | se conserva | no dibujado |
| Popover New layer | Barra de capas (`LayersPanel.tsx:230`) | Crea capa ([[capas]]) | Siempre | 180 px | Igual que hoy | se conserva | no dibujado |
| Popover Filters and effects | Barra de capas (`FxPanel.tsx:35`) | Crea FX ([[fx]]) | Siempre | 260 px | Igual que hoy | se conserva | no dibujado |
| Popover Layer operations | Barra de capas (`LayersPanel.tsx:305`) | Operaciones sobre la capa raster ([[capas]]) | Capa raster no bloqueada | 320 px; formulario `OpForm` con «atrás» | Igual que hoy | se conserva | no dibujado |
| Popover More layer actions | Barra de capas (`LayersPanel.tsx:245`) | Merge down, Rasterize, Group, Restore ([[capas]]) | Hay capa | 220 px, abre hacia arriba | Igual que hoy | se conserva | no dibujado |
| Popover del editor FX | Fila FX (`FxPanel.tsx:105`) | Editor FX ([[fx]]) | Doble clic en fila FX | 300 px | Igual que hoy | se conserva | no dibujado |
| Popover Change editable-stroke limit | Bajo capa raster (`RasterLimitControls.tsx:39`) | `paintLimitDisabled` ([[capas]]) | Raster con trazos editables | Confirmación contextual (sin `confirm()` nativo) | Igual que hoy | se conserva | no dibujado |
| Popover Confirm painting on this layer | Cabecera del panel (`RasterLimitControls.tsx:55`) | Aprobación de pintura ([[capas]]) | Capa raster pendiente | 320 px | Igual que hoy | se conserva | no dibujado |
| Popover Painting on a layer with editable strokes | Junto al clic (`DrawingChoice.tsx:32`) | Elección Drawing/Design ([[propiedades]]) | Pintar con trazos editables | 340 px | Igual que hoy | se conserva | no dibujado |
| Popover Document presets | Barra superior (`DesignerWorkspace.tsx:86`) | Nuevo documento ([[documentos]]) | Siempre | — | Igual que hoy | se conserva | no dibujado |
| Popover Save to gallery | Barra superior (`DesignerWorkspace.tsx:103`) | Confirmación ([[documentos]]) | Hay documento | 260 px | Igual que hoy | se conserva | no dibujado |
| Popover Export format | Barra superior (`DesignerWorkspace.tsx:114`) | Exportación ([[documentos]]) | Hay documento | — | Igual que hoy | se conserva | no dibujado |
| Popover Canvas size | Barra superior (`CanvasSize.tsx:85`) | Tamaño ([[tamanos]]) | Hay documento | 250 px | Igual que hoy | se conserva | no dibujado |
| Popover Import from chat | Barra superior izquierda (`ImportFromChat.tsx:64`) | Importar imágenes ([[documentos]]) | Imágenes pendientes | 360 px | Igual que hoy | se conserva | no dibujado |

## Enlaces

- [[guias]] · [guias.md](guias.md)
- [[selector-de-color]] · [selector-de-color.md](selector-de-color.md)
- [[capas]] · [capas.md](capas.md)
- [[barra-superior]] · [barra-superior.md](barra-superior.md)
- [[lienzo-gestos]] · [lienzo-gestos.md](lienzo-gestos.md)
- [[README]] · [Índice](README.md)

---
type: inventario
title: Edit, alinear y transformar
description: Todo lo que ofrece la herramienta Edit (move): modo Object/Layer, snap, Transform, Align con sus 10 acciones y 6 referencias, Distribute y los ajustes de tamaño.
tags: [designer, edit, align, transform, snap]
updated: 2026-10-28
related: [tira-contextual, guias, toolbox-dock, capas, lienzo-gestos, huecos]
---
# Edit, alinear y transformar

Edit es la herramienta `move`. Su barra (`ToolSettings`, `ToolSettings.tsx:250`) y la **Edit card** (`EditCard.tsx:28`) comparten `EditOps`. `AlignControls` (`AlignControls.tsx:37`) es el panel de alinear: 10 acciones (5 horizontales y 5 verticales; las 4 «a borde de ancla» son anchor-edge), 2 de distribuir, 2 de tamaño y 6 referencias.

| Control | Dónde está hoy | Qué estado modifica | Cuándo aparece | Notas |
| --- | --- | --- | --- | --- |
| Control | Dónde está hoy | Qué estado modifica | Cuándo aparece | Notas |
| Edit: Object / Layer (segmentado) | Barra Edit (`ToolSettings.tsx:62`); también en propiedades de capa | `ui.selectMode` | Tool = move | Object se deshabilita (con motivo) si la capa activa es raster sin objetos |
| Auto-select (interruptor) | Barra Edit (`ToolSettings.tsx:72`) | `ui.autoSelect` | Tool = move | Un clic actúa sobre la capa superior bajo el puntero |
| Move selection · drag inside (texto) | Barra Edit (`ToolSettings.tsx:250`) | Ninguno | Tool = move y hay selección de píxeles | Solo informa; arrastrar dentro corta la selección a una capa |
| Snap (botón + popover) | Barra Edit (`SnapControl.tsx:17`) | Abre el popover | Tool = move | Icono Magnet; el estado es por modo (Drawing/Design) en `ui.snapByMode` |
| Snap while moving (casilla) | Popover Snap (`SnapControl.tsx:20`) | `ui.snapByMode[modo].on` | Popover abierto | Interruptor general |
| Page edges and center (casilla) | Popover Snap (`SnapControl.tsx:21`) | `snapByMode[modo].page` | Snap activado | — |
| Other layers (casilla) | Popover Snap (`SnapControl.tsx:22`) | `snapByMode[modo].layers` | Snap activado | — |
| Guides (casilla) | Popover Snap (`SnapControl.tsx:23`) | `snapByMode[modo].guides` | Snap activado | DUPLICADO con «Snap to guides» de la tarjeta Guides ([[guias]]) |
| Equal spacing (casilla) | Popover Snap (`SnapControl.tsx:24`) | `snapByMode[modo].equalSpacing` | Snap activado | — |
| Path nodes (casilla) | Popover Snap (`SnapControl.tsx:25`) | `snapByMode[modo].nodes` | Snap activado | — |
| Aviso «Hold Alt while dragging to move freely» | Popover Snap (`SnapControl.tsx:26`) | Ninguno | Popover abierto | Alt desactiva el snap al arrastrar |
| Align (botón) | Barra Edit (`ToolSettings.tsx:127`) | Solo envía `ogs:designer-panel` «tool» (abre el panel) | Tool = move; deshabilitado si capa bloqueada o sin selección | No alinea por sí mismo; abre el panel Tool |
| Transform (botón + menú) | Barra Edit (`ToolSettings.tsx:129`) | Abre el menú | Tool = move; deshabilitado con capa bloqueada o sin selección | También en la Edit card si no hay tira |
| Mirror left ↔ right | Menú Transform (`ToolSettings.tsx:41`) | `turnLayers` / `turnPickedObjects` (`flip-h`) | Menú abierto | Deshabilitado por capa si `turnProblem` da motivo |
| Mirror top ↕ bottom | Menú Transform (`ToolSettings.tsx:42`) | `flip-v` | Menú abierto | — |
| Rotate 90° right | Menú Transform (`ToolSettings.tsx:43`) | `rotate-cw` | Menú abierto | — |
| Rotate 90° left | Menú Transform (`ToolSettings.tsx:44`) | `rotate-ccw` | Menú abierto | — |
| Rotate 180° | Menú Transform (`ToolSettings.tsx:45`) | `rotate-180` | Menú abierto | — |
| Influence (slider 1–500 px) | Barra Edit (`ToolSettings.tsx:250`) | `ui.lineartInfluence` | Tool = move | Radio del arrastre de nodos/curvas Lineart; DUPLICADO en Lineart modo Edit ([[lineart]]) |
| Estilo de la curva seleccionada | Barra Edit (`ToolSettings.tsx:250`) | Estilo del trazo de la curva (`applyCurveStyle`) | Tool = move y hay una curva seleccionada | Mismos campos que Lineart ([[lineart]]) |
| Relative to: Page | Panel de alinear (`AlignControls.tsx:25`) | Estado local de EditCard `prefs.relativeTo` | Edit card con ≥1 objeto | Defecto 1 objeto; no persiste |
| Relative to: Selection | Panel de alinear (`AlignControls.tsx:25`) | `prefs.relativeTo` | Edit card | Defecto con varios objetos |
| Relative to: First selected | Panel de alinear (`AlignControls.tsx:26`) | `prefs.relativeTo` | Edit card | Las 4 referencias de ancla piden ≥2 objetos para las acciones edge |
| Relative to: Last selected | Panel de alinear (`AlignControls.tsx:26`) | `prefs.relativeTo` | Edit card | — |
| Relative to: Biggest | Panel de alinear (`AlignControls.tsx:27`) | `prefs.relativeTo` | Edit card | — |
| Relative to: Smallest | Panel de alinear (`AlignControls.tsx:27`) | `prefs.relativeTo` | Edit card | — |
| As group (casilla) | Panel de alinear (`AlignControls.tsx:55`) | `prefs.alignAsGroup` | Edit card; ≥2 objetos y no con referencia Selection | Mueve el conjunto manteniendo separación |
| Align left | Panel de alinear (`AlignControls.tsx:11`) | `alignLayers` / `alignPickedObjects` (`left`) | Edit card | Icono AlignStartVertical |
| Center horizontally | Panel de alinear (`AlignControls.tsx:12`) | `center` | Edit card | — |
| Align right | Panel de alinear (`AlignControls.tsx:13`) | `right` | Edit card | — |
| Align left edge to anchor’s right edge | Panel de alinear (`AlignControls.tsx:14`) | `left-to-right` | Edit card; requiere ancla de ≥2 objetos | Acción anchor-edge |
| Align right edge to anchor’s left edge | Panel de alinear (`AlignControls.tsx:15`) | `right-to-left` | Edit card; requiere ancla | Acción anchor-edge |
| Align top | Panel de alinear (`AlignControls.tsx:18`) | `top` | Edit card | — |
| Center vertically | Panel de alinear (`AlignControls.tsx:19`) | `middle` | Edit card | — |
| Align bottom | Panel de alinear (`AlignControls.tsx:20`) | `bottom` | Edit card | — |
| Align top edge to anchor’s bottom edge | Panel de alinear (`AlignControls.tsx:21`) | `top-to-bottom` | Edit card; requiere ancla | Acción anchor-edge |
| Align bottom edge to anchor’s top edge | Panel de alinear (`AlignControls.tsx:22`) | `bottom-to-top` | Edit card; requiere ancla | Acción anchor-edge |
| Even horizontal gaps | Panel de alinear (`AlignControls.tsx:66`) | `distributeLayers` / `distributePickedObjects` (`h`) | Edit card con ≥3 objetos | Con menos, queda inerte con motivo |
| Even vertical gaps | Panel de alinear (`AlignControls.tsx:67`) | Distribuir `v` | Edit card con ≥3 objetos | — |
| Fit inside page | Panel de alinear (`AlignControls.tsx:70`) | `fitLayer(…, 'contain')` | Una sola capa raster en modo Layer | Texto del botón visible |
| Fill page | Panel de alinear (`AlignControls.tsx:71`) | `fitLayer(…, 'cover')` | Una sola capa raster en modo Layer | — |
| Boolean (soon) | Edit card › Combine (`toolboxModel.ts:36`) | Ninguno (deshabilitado) | ≥2 objetos | Aviso «Soon» (tooltip); mismo `MULTI_SOON` que el dock |
| Form builder (soon) | Edit card › Combine (`toolboxModel.ts:36`) | Ninguno (deshabilitado) | ≥2 objetos | Idem |
| Encabezado «On N objects/layers» | Panel de alinear y menú Transform (`ToolSettings.tsx:111`) | Ninguno | Con selección | Dice sobre qué actúan |

## Enlaces

- [[tira-contextual]] · [tira-contextual.md](tira-contextual.md)
- [[guias]] · [guias.md](guias.md)
- [[toolbox-dock]] · [toolbox-dock.md](toolbox-dock.md)
- [[capas]] · [capas.md](capas.md)
- [[lienzo-gestos]] · [lienzo-gestos.md](lienzo-gestos.md)
- [[huecos]] · [huecos.md](huecos.md)
- [[README]] · [Índice](README.md)

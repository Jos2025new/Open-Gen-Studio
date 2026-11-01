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

| Control | Dónde está hoy | Qué estado modifica | Cuándo aparece | Notas | Dónde quedaría en la propuesta | Estado | Mockup |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Edit: Object / Layer (segmentado) | Barra Edit (`ToolSettings.tsx:62`); también en propiedades de capa | `ui.selectMode` | Tool = move | Object se deshabilita (con motivo) si la capa activa es raster sin objetos | Igual que hoy | se conserva | no dibujado |
| Auto-select (interruptor) | Barra Edit (`ToolSettings.tsx:72`) | `ui.autoSelect` | Tool = move | Un clic actúa sobre la capa superior bajo el puntero | Igual que hoy | se conserva | no dibujado |
| Move selection · drag inside (texto) | Barra Edit (`ToolSettings.tsx:250`) | Ninguno | Tool = move y hay selección de píxeles | Solo informa; arrastrar dentro corta la selección a una capa | Igual que hoy | se conserva | no dibujado |
| Snap (botón + popover) | Barra Edit (`SnapControl.tsx:17`) | Abre el popover | Tool = move | Icono Magnet; el estado es por modo (Drawing/Design) en `ui.snapByMode` | Igual que hoy | se conserva | no dibujado |
| Snap while moving (casilla) | Popover Snap (`SnapControl.tsx:20`) | `ui.snapByMode[modo].on` | Popover abierto | Interruptor general | Igual que hoy | se conserva | no dibujado |
| Page edges and center (casilla) | Popover Snap (`SnapControl.tsx:21`) | `snapByMode[modo].page` | Snap activado | — | Igual que hoy | se conserva | no dibujado |
| Other layers (casilla) | Popover Snap (`SnapControl.tsx:22`) | `snapByMode[modo].layers` | Snap activado | — | Igual que hoy | se conserva | no dibujado |
| Guides (casilla) | Popover Snap (`SnapControl.tsx:23`) | `snapByMode[modo].guides` | Snap activado | DUPLICADO con «Snap to guides» de la tarjeta Guides ([[guias]]) | Igual que hoy | se conserva | no dibujado |
| Equal spacing (casilla) | Popover Snap (`SnapControl.tsx:24`) | `snapByMode[modo].equalSpacing` | Snap activado | — | Igual que hoy | se conserva | no dibujado |
| Path nodes (casilla) | Popover Snap (`SnapControl.tsx:25`) | `snapByMode[modo].nodes` | Snap activado | — | Igual que hoy | se conserva | no dibujado |
| Aviso «Hold Alt while dragging to move freely» | Popover Snap (`SnapControl.tsx:26`) | Ninguno | Popover abierto | Alt desactiva el snap al arrastrar | Igual que hoy | se conserva | no dibujado |
| Align (botón) | Barra Edit (`ToolSettings.tsx:127`) | Solo envía `ogs:designer-panel` «tool» (abre el panel) | Tool = move; deshabilitado si capa bloqueada o sin selección | No alinea por sí mismo; abre el panel Tool | Igual que hoy | se conserva | no dibujado |
| Transform (botón + menú) | Barra Edit (`ToolSettings.tsx:129`) | Abre el menú | Tool = move; deshabilitado con capa bloqueada o sin selección | También en la Edit card si no hay tira | Igual que hoy | se conserva | no dibujado |
| Mirror left ↔ right | Menú Transform (`ToolSettings.tsx:41`) | `turnLayers` / `turnPickedObjects` (`flip-h`) | Menú abierto | Deshabilitado por capa si `turnProblem` da motivo | Igual que hoy | se conserva | no dibujado |
| Mirror top ↕ bottom | Menú Transform (`ToolSettings.tsx:42`) | `flip-v` | Menú abierto | — | Igual que hoy | se conserva | no dibujado |
| Rotate 90° right | Menú Transform (`ToolSettings.tsx:43`) | `rotate-cw` | Menú abierto | — | Igual que hoy | se conserva | no dibujado |
| Rotate 90° left | Menú Transform (`ToolSettings.tsx:44`) | `rotate-ccw` | Menú abierto | — | Igual que hoy | se conserva | no dibujado |
| Rotate 180° | Menú Transform (`ToolSettings.tsx:45`) | `rotate-180` | Menú abierto | — | Igual que hoy | se conserva | no dibujado |
| Influence (slider 1–500 px) | Barra Edit (`ToolSettings.tsx:250`) | `ui.lineartInfluence` | Tool = move | Radio del arrastre de nodos/curvas Lineart; DUPLICADO en Lineart modo Edit ([[lineart]]) | Igual que hoy | se conserva | no dibujado |
| Estilo de la curva seleccionada | Barra Edit (`ToolSettings.tsx:250`) | Estilo del trazo de la curva (`applyCurveStyle`) | Tool = move y hay una curva seleccionada | Mismos campos que Lineart ([[lineart]]) | Igual que hoy | se conserva | no dibujado |
| Relative to: Page | Panel de alinear (`AlignControls.tsx:25`) | Estado local de EditCard `prefs.relativeTo` | Edit card con ≥1 objeto | Defecto 1 objeto; no persiste | Panel de alinear: select «Relative to», arriba, sin cambio | se conserva | [c11-alinear](../mockups/designer-ajustes/c11-alinear.html) |
| Relative to: Selection | Panel de alinear (`AlignControls.tsx:25`) | `prefs.relativeTo` | Edit card | Defecto con varios objetos | Panel de alinear: select «Relative to», arriba, sin cambio | se conserva | [c11-alinear](../mockups/designer-ajustes/c11-alinear.html) |
| Relative to: First selected | Panel de alinear (`AlignControls.tsx:26`) | `prefs.relativeTo` | Edit card | Las 4 referencias de ancla piden ≥2 objetos para las acciones edge | Panel de alinear: select «Relative to»; el mockup solo dibuja Page y Selection, las otras 4 referencias no pueden perderse | se conserva | no dibujado |
| Relative to: Last selected | Panel de alinear (`AlignControls.tsx:26`) | `prefs.relativeTo` | Edit card | — | Panel de alinear: select «Relative to»; el mockup solo dibuja Page y Selection, las otras 4 referencias no pueden perderse | se conserva | no dibujado |
| Relative to: Biggest | Panel de alinear (`AlignControls.tsx:27`) | `prefs.relativeTo` | Edit card | — | Panel de alinear: select «Relative to»; el mockup solo dibuja Page y Selection, las otras 4 referencias no pueden perderse | se conserva | no dibujado |
| Relative to: Smallest | Panel de alinear (`AlignControls.tsx:27`) | `prefs.relativeTo` | Edit card | — | Panel de alinear: select «Relative to»; el mockup solo dibuja Page y Selection, las otras 4 referencias no pueden perderse | se conserva | no dibujado |
| As group (casilla) | Panel de alinear (`AlignControls.tsx:55`) | `prefs.alignAsGroup` | Edit card; ≥2 objetos y no con referencia Selection | Mueve el conjunto manteniendo separación | Panel de alinear: arriba, sin cambio | se conserva | [c11-alinear](../mockups/designer-ajustes/c11-alinear.html) |
| Align left | Panel de alinear (`AlignControls.tsx:11`) | `alignLayers` / `alignPickedObjects` (`left`) | Edit card | Icono AlignStartVertical | Fila «Align» (6 iconos en una fila) | se mueve | [c11-alinear](../mockups/designer-ajustes/c11-alinear.html) |
| Center horizontally | Panel de alinear (`AlignControls.tsx:12`) | `center` | Edit card | — | Fila «Align» (6 iconos en una fila) | se mueve | [c11-alinear](../mockups/designer-ajustes/c11-alinear.html) |
| Align right | Panel de alinear (`AlignControls.tsx:13`) | `right` | Edit card | — | Fila «Align» (6 iconos en una fila) | se mueve | [c11-alinear](../mockups/designer-ajustes/c11-alinear.html) |
| Align left edge to anchor’s right edge | Panel de alinear (`AlignControls.tsx:14`) | `left-to-right` | Edit card; requiere ancla de ≥2 objetos | Acción anchor-edge | Fila «Align», segunda línea o grupo propio (decisión abierta). El mockup NO dibuja estas 4 acciones: hay que conservarlas | se mueve | no dibujado |
| Align right edge to anchor’s left edge | Panel de alinear (`AlignControls.tsx:15`) | `right-to-left` | Edit card; requiere ancla | Acción anchor-edge | Fila «Align», segunda línea o grupo propio (decisión abierta). El mockup NO dibuja estas 4 acciones: hay que conservarlas | se mueve | no dibujado |
| Align top | Panel de alinear (`AlignControls.tsx:18`) | `top` | Edit card | — | Fila «Align» (6 iconos en una fila) | se mueve | [c11-alinear](../mockups/designer-ajustes/c11-alinear.html) |
| Center vertically | Panel de alinear (`AlignControls.tsx:19`) | `middle` | Edit card | — | Fila «Align» (6 iconos en una fila) | se mueve | [c11-alinear](../mockups/designer-ajustes/c11-alinear.html) |
| Align bottom | Panel de alinear (`AlignControls.tsx:20`) | `bottom` | Edit card | — | Fila «Align» (6 iconos en una fila) | se mueve | [c11-alinear](../mockups/designer-ajustes/c11-alinear.html) |
| Align top edge to anchor’s bottom edge | Panel de alinear (`AlignControls.tsx:21`) | `top-to-bottom` | Edit card; requiere ancla | Acción anchor-edge | Fila «Align», segunda línea o grupo propio (decisión abierta). El mockup NO dibuja estas 4 acciones: hay que conservarlas | se mueve | no dibujado |
| Align bottom edge to anchor’s top edge | Panel de alinear (`AlignControls.tsx:22`) | `bottom-to-top` | Edit card; requiere ancla | Acción anchor-edge | Fila «Align», segunda línea o grupo propio (decisión abierta). El mockup NO dibuja estas 4 acciones: hay que conservarlas | se mueve | no dibujado |
| Even horizontal gaps | Panel de alinear (`AlignControls.tsx:66`) | `distributeLayers` / `distributePickedObjects` (`h`) | Edit card con ≥3 objetos | Con menos, queda inerte con motivo | Fila «Distribute» con etiqueta | se mueve | [c11-alinear](../mockups/designer-ajustes/c11-alinear.html) |
| Even vertical gaps | Panel de alinear (`AlignControls.tsx:67`) | Distribuir `v` | Edit card con ≥3 objetos | — | Fila «Distribute» con etiqueta | se mueve | [c11-alinear](../mockups/designer-ajustes/c11-alinear.html) |
| Fit inside page | Panel de alinear (`AlignControls.tsx:70`) | `fitLayer(…, 'contain')` | Una sola capa raster en modo Layer | Texto del botón visible | Fila «Page» con etiqueta | se mueve | [c11-alinear](../mockups/designer-ajustes/c11-alinear.html) |
| Fill page | Panel de alinear (`AlignControls.tsx:71`) | `fitLayer(…, 'cover')` | Una sola capa raster en modo Layer | — | Fila «Page» con etiqueta | se mueve | [c11-alinear](../mockups/designer-ajustes/c11-alinear.html) |
| Boolean (soon) | Edit card › Combine (`toolboxModel.ts:36`) | Ninguno (deshabilitado) | ≥2 objetos | Estado anterior: aviso «Soon» con `MULTI_SOON`. Superado el 2026-11-01 (`d2ba3496`): ya es el grupo de [booleanas](booleanas.md) | Igual que hoy | se conserva | no dibujado |
| Form builder (soon) | Edit card › Combine (`toolboxModel.ts:36`) | Ninguno (deshabilitado) | ≥2 objetos | Estado anterior: «Soon». Superado el 2026-11-01: el Shape Builder (Shift+M) está en [booleanas](booleanas.md) | Igual que hoy | se conserva | no dibujado |
| Encabezado «On N objects/layers» | Panel de alinear y menú Transform (`ToolSettings.tsx:111`) | Ninguno | Con selección | Dice sobre qué actúan | Igual que hoy | se conserva | no dibujado |

## Enlaces

- [[tira-contextual]] · [tira-contextual.md](tira-contextual.md)
- [[guias]] · [guias.md](guias.md)
- [[toolbox-dock]] · [toolbox-dock.md](toolbox-dock.md)
- [[capas]] · [capas.md](capas.md)
- [[lienzo-gestos]] · [lienzo-gestos.md](lienzo-gestos.md)
- [[huecos]] · [huecos.md](huecos.md)
- [[README]] · [Índice](README.md)

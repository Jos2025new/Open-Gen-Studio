---
type: inventario
title: Formas y líneas (Rectangle, Ellipse, Line, Polygon/Star)
description: Ajustes de las formas que se dibujan arrastrando (rectángulo, elipse y sus tipos, línea y flecha, polígono y estrella) para la siguiente forma.
tags: [designer, formas, shapes]
updated: 2026-10-28
related: [curva, tira-contextual, propiedades, selector-de-color, lienzo-gestos, toolbox-dock]
---
# Formas y líneas (Rectangle, Ellipse, Line, Polygon/Star)

Todas usan `ui.shape` para la **siguiente** forma (`store.ts:177`); la forma ya dibujada se edita con la tira contextual ([[tira-contextual]]) o con Properties ([[propiedades]]). El bloque de ajustes es una sola rama de `ToolSettings` (`ToolSettings.tsx:267`) que cambia según la herramienta. Herramientas: rect, ellipse (con sector, arc, chord), line (con arrow), polygon (con star) y curve ([[curva]]). Sector, arc, chord, star y arrow no tienen botón propio: viven dentro de Type, Shape y Arrow.

| Control | Dónde está hoy | Qué estado modifica | Cuándo aparece | Notas | Dónde quedaría en la propuesta | Estado | Mockup |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Fill (color + casilla «No fill») | Dock › tarjeta / Panel Tool (`ToolSettings`, rama de formas `ToolSettings.tsx:267`), primera fila (`ToolSettings.tsx:267`) | `ui.shape.fill` (null = sin relleno) | rect, ellipse, sector, arc, chord, polygon, star; oculto con line, curve y arrow | Muestra el hex. Popover de [[selector-de-color]] sin alfa | Igual que hoy | se conserva | no dibujado |
| Stroke (color + casilla «No stroke») | Dock › tarjeta / Panel Tool (`ToolSettings`, rama de formas `ToolSettings.tsx:267`) (`ToolSettings.tsx:268`) | `ui.shape.stroke` (null = sin trazo) | Todas las formas y líneas | Por defecto sin trazo (`stroke: null`, `store.ts:235`) | Igual que hoy | se conserva | no dibujado |
| Width (slider 1 a 40 px) | Dock › tarjeta / Panel Tool (`ToolSettings`, rama de formas `ToolSettings.tsx:267`) (`ToolSettings.tsx:269`) | `ui.shape.strokeWidth` | Todas las formas y líneas | En Edit el ancho de una forma elegida llega a 0 (Stroke popover) | Igual que hoy | se conserva | no dibujado |
| Type (select: Whole, Slice, Arc, Chord) | Dock › tarjeta / Panel Tool (`ToolSettings`, rama de formas `ToolSettings.tsx:267`) (`ShapeKindFields.tsx:21`) | `ui.tool` = ellipse / sector / arc / chord (`toolForEllipseType`) | Tool en {ellipse, sector, arc, chord} | Sustituye a tres herramientas sueltas | Igual que hoy | se conserva | no dibujado |
| Start (slider 0 a 360 °) | Dock › tarjeta / Panel Tool (`ToolSettings`, rama de formas `ToolSettings.tsx:267`) (`ShapeKindFields.tsx:23`) | `ui.shape.primParams.a0` (defecto 0) | Type distinto de Whole | — | Igual que hoy | se conserva | no dibujado |
| End (slider 0 a 360 °) | Dock › tarjeta / Panel Tool (`ToolSettings`, rama de formas `ToolSettings.tsx:267`) (`ShapeKindFields.tsx:24`) | `ui.shape.primParams.a1` (defecto 270) | Type distinto de Whole | — | Igual que hoy | se conserva | no dibujado |
| Make whole (botón) | Dock › tarjeta / Panel Tool (`ToolSettings`, rama de formas `ToolSettings.tsx:267`) (`ShapeKindFields.tsx:25`) | `ui.tool = 'ellipse'` | Type distinto de Whole | Vuelve a elipse entera | Igual que hoy | se conserva | no dibujado |
| Shape (Polygon / Star, 2 botones) | Dock › tarjeta / Panel Tool (`ToolSettings`, rama de formas `ToolSettings.tsx:267`) (`ShapeKindFields.tsx:34`) | `ui.tool` = polygon / star | Tool = polygon o star | Es el único selector entre las dos | Igual que hoy | se conserva | no dibujado |
| Corners (slider 3 a 24) | Dock › tarjeta / Panel Tool (`ToolSettings`, rama de formas `ToolSettings.tsx:267`) (`ShapeKindFields.tsx:35`) | `ui.shape.sides` (defecto 5) | polygon, star | Mismo máximo (24) al editar la forma | Igual que hoy | se conserva | no dibujado |
| Spoke ratio (slider 10 a 100 %) | Dock › tarjeta / Panel Tool (`ToolSettings`, rama de formas `ToolSettings.tsx:267`) (`ShapeKindFields.tsx:36`) | `ui.shape.primParams.inner` (defecto 0.5) | Solo star | — | Igual que hoy | se conserva | no dibujado |
| Rounded (slider 0 a 100 %) | Dock › tarjeta / Panel Tool (`ToolSettings`, rama de formas `ToolSettings.tsx:267`) (`ShapeKindFields.tsx:37`) | `ui.shape.primParams.round` | polygon, star | — | Igual que hoy | se conserva | no dibujado |
| Arrow (interruptor) | Dock › tarjeta / Panel Tool (`ToolSettings`, rama de formas `ToolSettings.tsx:267`) (`ShapeKindFields.tsx:43`) | `ui.tool` = arrow / line | Tool = line o arrow | Arrow no tiene ajustes propios: las puntas solo se cambian después en el popover Stroke de la forma elegida | Igual que hoy | se conserva | no dibujado |
| Rx (slider) | Dock › tarjeta / Panel Tool (`ToolSettings`, rama de formas `ToolSettings.tsx:267`) vía `ShapeLookFields` (`ShapeLookFields.tsx:29`) | `ui.shape.rx` | Solo rect | Máximo igual a la mitad del ancho de la forma elegida; aquí fijo (200 si w=0) | Igual que hoy | se conserva | no dibujado |
| Ry (slider) | Dock › tarjeta / Panel Tool (`ToolSettings`, rama de formas `ToolSettings.tsx:267`) (`ShapeLookFields.tsx:30`) | `ui.shape.ry` | Solo rect | — | Igual que hoy | se conserva | no dibujado |
| Sharp corners (botón) | Dock › tarjeta / Panel Tool (`ToolSettings`, rama de formas `ToolSettings.tsx:267`) (`ShapeLookFields.tsx:31`) | `ui.shape.rx`/`ry` = 0 (`SHARP`) | Solo rect; deshabilitado si ya es 0 | Shift+clic en un tirador de esquina hace lo mismo | Igual que hoy | se conserva | no dibujado |
| Join (3 iconos: Miter, Round, Bevel) | Dock › tarjeta / Panel Tool (`ToolSettings`, rama de formas `ToolSettings.tsx:267`) (`ShapeLookFields.tsx:35`) | `ui.shape.join` (defecto round) | Todas, solo no compacto | Oculto con `compact` `ShapeLookFields.tsx:34`; esa rama en la tira con una herramienta de forma es «no alcanzable por lectura — requiere prueba en sandbox» | Igual que hoy | se conserva | no dibujado |
| Miter limit (slider 1 a 20) | Dock › tarjeta / Panel Tool (`ToolSettings`, rama de formas `ToolSettings.tsx:267`) (`ShapeLookFields.tsx:36`) | `ui.shape.miter` | Join = Miter, no compacto | — | Igual que hoy | se conserva | no dibujado |
| Cap (3 iconos: Butt, Round, Square) | Dock › tarjeta / Panel Tool (`ToolSettings`, rama de formas `ToolSettings.tsx:267`) (`ShapeLookFields.tsx:37`) | `ui.shape.cap` (defecto round) | No compacto | — | Igual que hoy | se conserva | no dibujado |
| Dashes (select: Solid, Dots, Dashes, Long dashes, Dash dot) | Dock › tarjeta / Panel Tool (`ToolSettings`, rama de formas `ToolSettings.tsx:267`) (`ShapeLookFields.tsx:38`) | `ui.shape.dash` | No compacto | — | Igual que hoy | se conserva | no dibujado |
| Dash offset (slider 0 a 20) | Dock › tarjeta / Panel Tool (`ToolSettings`, rama de formas `ToolSettings.tsx:267`) (`ShapeLookFields.tsx:39`) | `ui.shape.dashOffset` | Con una raya elegida, no compacto | — | Igual que hoy | se conserva | no dibujado |
| Stroke behind fill (interruptor) | Dock › tarjeta / Panel Tool (`ToolSettings`, rama de formas `ToolSettings.tsx:267`) (`ShapeLookFields.tsx:40`) | `ui.shape.paintOrder` (`'stroke'`) | No compacto | Orden de pintado | Igual que hoy | se conserva | no dibujado |
| Dibujar (arrastrar) | Lienzo (`Stage.tsx:877`) | Una forma nueva: en la capa vector activa si está vacía, si no en una capa vector nueva (`insertLayer`) | Cualquier herramienta de forma | Pista: «Drag to draw a rectangle» (ToolHelp, `ToolHelp.tsx:22`) | Igual que hoy | se conserva | no dibujado |
| Shift mientras se arrastra | Lienzo (`Stage.tsx:1116`) | Solo la vista previa y la forma final | Formas con caja: cuadrado/círculo; line, curve, arrow y arc: pasos de 45° | Sin chip en pantalla | Igual que hoy | se conserva | no dibujado |

## Enlaces

- [[curva]] · [curva.md](curva.md)
- [[tira-contextual]] · [tira-contextual.md](tira-contextual.md)
- [[propiedades]] · [propiedades.md](propiedades.md)
- [[selector-de-color]] · [selector-de-color.md](selector-de-color.md)
- [[lienzo-gestos]] · [lienzo-gestos.md](lienzo-gestos.md)
- [[toolbox-dock]] · [toolbox-dock.md](toolbox-dock.md)
- [[README]] · [Índice](README.md)

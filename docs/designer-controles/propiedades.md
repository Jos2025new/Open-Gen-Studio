---
type: inventario
title: Propiedades de la capa (pestaña Properties)
description: Apariencia, geometría, texto, trazos y formas de la capa activa, y los avisos de pintura sobre capas con trazos editables.
tags: [designer, propiedades, capas, geometria]
updated: 2026-10-28
related: [capas, fx, texto, formas, tira-contextual, lienzo-gestos]
---
# Propiedades de la capa (pestaña Properties)

Todo esto vive en `LayersPanel` (`LayersPanel.tsx:271`) y se deshabilita con la capa bloqueada. La apariencia (Opacity y Blend) se muestra encima de las pestañas, también fuera de Properties. El contenido cambia con el tipo de capa: FX muestra el editor de [[fx]]; el resto muestra `LayerGeometry` y, según el tipo, texto, trazos o formas. Con la pestaña Properties y sin capa activa: «Select a layer to see its properties.» (`LayersPanel.tsx:267`).

| Control | Dónde está hoy | Qué estado modifica | Cuándo aparece | Notas |
| --- | --- | --- | --- | --- |
| Control | Dónde está hoy | Qué estado modifica | Cuándo aparece | Notas |
| Opacity (slider %) | Panel, apariencia (`LayersPanel.tsx:183`) | `layer.opacity` (`patchLayer`) | Hay capa activa, cualquier pestaña | — |
| Blend (select) | Panel, apariencia (`LayersPanel.tsx:184`) | `layer.blend`; lista = `BLEND_MODES` | Hay capa activa | Sin vista previa |
| Layer properties (resumen plegable) | Pestaña Properties (`LayersPanel.tsx:270`) | Estado local `propertiesOpen` | Pestaña Properties con capa | Se abre por defecto |
| Position and size: X, Y, W, H (campos) | Pestaña Properties (`LayerGeometry.tsx:22`) | Mueve o escala la capa (`translateLayer` / `scaleLayer`); un paso de deshacer por arrastre | Capa con contenido visible | Sin contenido: «Draw or place something on this layer to position it.» (`LayerGeometry.tsx:28`) |
| Arrastrar la letra X/Y/W/H (scrub) | Pestaña Properties (`LayerGeometry.tsx:59`) | Mismo valor, en vivo; Shift = ×10 | Capa desbloqueada | Gesto sin icono (solo el tooltip lo dice) |
| Width and height keep their ratio (candado) | Pestaña Properties (`LayerGeometry.tsx:93`) | Estado local `lock` | Capa con contenido | No persiste |
| Allow painting on this image | Pestaña Properties (`LayersPanel.tsx:273`) | `layer.allowPaint` | Raster con imagen de origen | — |
| Text (área de texto) | Pestaña Properties (`LayersPanel.tsx:275`) | `layer.text` | Capa de texto | DUPLICADO con la edición en el lienzo |
| Font (select) | Pestaña Properties (`LayersPanel.tsx:276`) | `layer.fontFamily` (`FONT_NAMES`) | Capa de texto | DUPLICADO con la tira de texto ([[texto]]) |
| Size (campo 4–1000) | Pestaña Properties (`LayersPanel.tsx:277`) | `layer.fontSize` | Capa de texto | Campo numérico, sin slider |
| Weight (select 300–900) | Pestaña Properties (`LayersPanel.tsx:277`) | `layer.fontWeight` | Capa de texto | — |
| Text color | Pestaña Properties (`LayersPanel.tsx:278`) | `layer.color` | Capa de texto | — |
| Alignment (select left/center/right) | Pestaña Properties (`LayersPanel.tsx:279`) | `layer.align` | Capa de texto | Es un select, en la tira es otro control |
| Texto «Styling N picked strokes…» | Pestaña Properties (`LayersPanel.tsx:289`) | Ninguno | Vector con trazos | Dice a qué trazos afecta |
| Estilo de trazos (Size, presets, Color, Opacity, Pressure thinning, Smoothing, Streamline) | Pestaña Properties (`LayersPanel.tsx:290`) | `layer.strokes[*]` elegidos o todos | Vector con trazos | Los mismos `StrokeStyleFields` que Lineart ([[lineart]]) |
| Estilo de trazos (Angle, Fixation, Min width, Texture, Spacing, Jitter, Seed, Taper start, Taper end) | Pestaña Properties (`StrokeStyleFields.tsx:25`) | `layer.strokes[*]` | Vector con trazos; Spacing, Jitter y Seed solo con textura | Angle sale de `BrushTipShape` en modo `angleOnly` (`StrokeStyleFields.tsx:24`) |
| Texto «Picked shape… / N shapes» | Pestaña Properties (`LayersPanel.tsx:297`) | Ninguno | Vector con formas | — |
| Fill (por forma) | Pestaña Properties (`LayersPanel.tsx:298`) | `shape.fill` y alfa (`paintOpacityPatch`) | Cada forma de la capa (o solo las elegidas) | Aquí es un `InlineColor`, en la tira un `PaintSwatch` con degradados: dos controles distintos para lo mismo |
| Stroke (por forma) | Pestaña Properties (`LayersPanel.tsx:299`) | `shape.stroke` y alfa | Cada forma | Ídem |
| Stroke width (slider 0–40) | Pestaña Properties (`LayersPanel.tsx:300`) | `shape.strokeWidth` | Cada forma | — |
| Rx / Ry / Sharp corners (por forma) | Pestaña Properties (`LayersPanel.tsx:301` corners}) | `shape.rx`, `ry`, radios | Forma `rect` | — |
| Blur (por forma) | Pestaña Properties (misma línea que arriba) | `shape.blur` | Cada forma | — |
| Join / Miter limit / Cap / Dashes / Dash offset / Stroke behind fill (por forma) | Pestaña Properties (`ShapeLookFields.tsx:38`) | `shape.join`, `miter`, `cap`, `dash`, `dashOffset`, `paintOrder` | Cada forma; Miter limit solo con Join = Miter, Dash offset solo con dashes | Solo aquí y en la tarjeta de formas, nunca en la tira |
| Flatten and paint | Aviso sobre el lienzo (`DrawingChoice.tsx:36`) | `applyDrawingChoice('flatten')` | Pintar en Drawing sobre una capa con trazos editables | Popover junto al clic (`DrawingChoicePrompt`, `DesignerWorkspace.tsx:150`) |
| Paint in Design | Aviso (`DrawingChoice.tsx:37`) | `applyDrawingChoice('design')` | Idem | — |
| New layer (aviso) | Aviso (`DrawingChoice.tsx:38`) | `applyDrawingChoice('newLayer')` | Idem | — |
| Don't show again | Aviso (`DrawingChoice.tsx:40`) | `setDrawingPreference` (guarda la elección) | Idem | Estado local `remember` hasta elegir |
| Close (aviso) | Aviso (`DrawingChoice.tsx:41`>Close}) | `cancelDrawingChoice` (no pinta) | Idem | Esc o clic fuera hacen lo mismo |

## Enlaces

- [[capas]] · [capas.md](capas.md)
- [[fx]] · [fx.md](fx.md)
- [[texto]] · [texto.md](texto.md)
- [[formas]] · [formas.md](formas.md)
- [[tira-contextual]] · [tira-contextual.md](tira-contextual.md)
- [[lienzo-gestos]] · [lienzo-gestos.md](lienzo-gestos.md)
- [[README]] · [Índice](README.md)

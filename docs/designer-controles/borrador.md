---
type: inventario
title: Borrador (Eraser)
description: Qué controles tiene el borrador, cuáles del pincel desaparecen y cuándo se bloquea.
tags: [designer, borrador, eraser]
updated: 2026-10-28
related: [pincel, pincel-avanzado, toolbox-dock, atajos, lienzo-gestos]
---
# Borrador (Eraser)

Eraser (`ui.tool='eraser'`, tecla E) usa los mismos campos de `ui.brush` que Brush: tamaño, opacidad, dureza, forma de punta, taper, estabilizar, presión y espejo son **compartidos** (cambiar uno cambia el otro). Se pinta con `BrushSettings erase` (`ToolSettings.tsx:266`). Solo trabaja en capas raster: ver Cuándo.

| Control | Dónde está hoy | Qué estado modifica | Cuándo aparece | Notas |
| --- | --- | --- | --- | --- |
| Control | Dónde está hoy | Qué estado modifica | Cuándo aparece | Notas |
| Variante Eraser | Dock › familia Eraser, única variante (`toolboxModel.ts:29`) | `ui.tool='eraser'` | Deshabilitada si la capa activa no es raster, está bloqueada, oculta o es imagen protegida (`rules.ts:60`) | La fila de variantes solo repite el icono (ver [[toolbox-dock]]) |
| Drawing / Design | Tarjeta/panel/compacto, como en Brush (`ToolSettings.tsx:266`) | `doc.paintMode` | Eraser activo | Igual que [[pincel]] |
| Vista previa, presets de tamaño, Size, Opacity, Texture | Tarjeta y panel, como en Brush (`BrushSettings.tsx:109`) | `ui.brush.size`, `opacity`, `texture`, `textureStrength` | Eraser activo | Textura y opacidad también borran con grano/parcialmente. Detalle en [[pincel]] |
| Color (chip) | Oculto: `!erase` (`BrushSettings.tsx:112`) | — | Nunca con Eraser | En Studio el botón «Color» sale deshabilitado con «The eraser has no color» (`EmbeddedDesignerBar.tsx:45`) |
| Tip, Hardness, Angle, Roundness, Follow stroke, Mirror | Pestaña Tip / panel (`BrushSettings.tsx:123`) | `ui.brush.hardness`, `angle`, `roundness`, `follow`, `mirror` | Eraser activo | Dureza compartida con Brush y con Pencil/Airbrush |
| Taper start/end, Stabilize, Smoothing | Pestaña Stroke / panel (`BrushSettings.tsx:131`) | `ui.brush.taperStart`, `taperEnd`, `stabilization`, `smoothing` | Eraser activo | Compartidos con Brush |
| Simulate pressure, Speed influence, Pressure → size, Min size, Pressure → density, Min density | Pestaña Pressure / panel (`BrushSettings.tsx:140`) | `ui.brush.simulatePressure`, `pressureSpeed`, `pressureSize`, `minSize`, `pressureDensity`, `minDensity` | Eraser activo | Compartidos con Brush |
| Blend y Keep opacity | Ocultos: la pestaña Blend no existe con Eraser (`BrushSettings.tsx:119` | — | Nunca con Eraser | `!erase` en `BrushSettings.tsx:151` |
| Follow stroke ruler | Tira contextual (`ContextStrip.tsx:109`) | `ui.strokeRuler.on` | Brush o Eraser con regla colocada | Ver [[regla]] |
| Motivo de bloqueo en la página | Texto sobre el lienzo (`Stage.tsx:1353`) | Ninguno | Eraser sobre capa no válida | Cursor `not-allowed` |
| Borrado de píxeles seleccionados (Delete) | Atajo, ver [[seleccion]] y [[atajos]] | Píxeles de la capa raster activa | Hay selección de píxeles | No es del Eraser pero es la otra forma de borrar |

## Enlaces

- [[pincel]] · [pincel.md](pincel.md)
- [[pincel-avanzado]] · [pincel-avanzado.md](pincel-avanzado.md)
- [[toolbox-dock]] · [toolbox-dock.md](toolbox-dock.md)
- [[atajos]] · [atajos.md](atajos.md)
- [[lienzo-gestos]] · [lienzo-gestos.md](lienzo-gestos.md)
- [[README]] · [Índice](README.md)

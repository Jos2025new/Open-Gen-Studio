---
type: inventario
title: Pincel: bloque principal, vista previa y compacto
description: Controles del pincel (Brush, Pencil, Airbrush) que se ven siempre: modo Drawing/Design, vista previa, tamaños, color, tamaño, opacidad y textura; más el modo compacto.
tags: [designer, pincel, brush]
updated: 2026-10-28
related: [pincel-avanzado, borrador, selector-de-color, regla, lienzo-gestos, toolbox-dock, estado-compartido]
---
# Pincel: bloque principal, vista previa y compacto

`BrushSettings` (`BrushSettings.tsx:91`) se pinta en tres lugares según los parámetros: **tarjeta** del dock (`card`, `BrushSettings.tsx:106`), **panel Tool** sin tarjeta (el `return` final, `BrushSettings.tsx:157`) y **compacto** (`compact`, `BrushSettings.tsx:99`). El llamador es `ToolSettings` (`ToolSettings.tsx:266`). Brush, Pencil y Airbrush son la misma herramienta (`ui.tool='brush'`); Eraser usa los mismos campos de `ui.brush` ([[borrador]]). El resto de ajustes (Tip, Stroke, Pressure, Blend) está en [[pincel-avanzado]].

## Cabecera y fila principal

| Control | Dónde está hoy | Qué estado modifica | Cuándo aparece | Notas |
| --- | --- | --- | --- | --- |
| Drawing / Design (segmentado) | Toolbox dock › tarjeta del pincel, cabecera (`ToolSettings.tsx:266`); Panel derecho › Tool (rama sin tarjeta), arriba (`ToolSettings.tsx:266`); Edit card › tira contextual (rama `compact`) (misma llamada) | `doc.paintMode` vía `setDoc` (`PaintModeToggle.tsx:11`); no toca `ui` | Tool = brush o eraser; `modeToggle` por defecto true | Cambiar no aplana ni reescribe trazos. Tooltips explican Drawing (píxeles directos) y Design (trazos editables hasta el límite) |
| Vista previa del trazo (canvas 260×56) | Toolbox dock › tarjeta del pincel cabecera (`BrushSettings.tsx:109`); Panel derecho › Tool (rama sin tarjeta) (`BrushSettings.tsx:157`) | Ninguno (solo lectura; dibuja con el motor `stampSegment`) | Tool = brush o eraser | Se redibuja con todo `ui.brush`; tamaño grande se recorta al 40 % del alto. Hoy ocupa la parte superior; no está en el compacto |
| Presets de tamaño (14 botones: 2, 5, 8, 12, 16, 24, 32, 40, 48, 64, 80, 96, 128, 200) | Toolbox dock › tarjeta del pincel (`BrushSettings.tsx:110`) ; Panel derecho › Tool (rama sin tarjeta) (`BrushSettings.tsx:158`); definición `SizePresets.tsx:7` y valores `brushEngine.ts:76` | `ui.brush.size` vía `set` → `setUi` (`BrushSettings.tsx:93`) | Tool = brush o eraser | Se repite en Lineart con el filtro 1 a 120, que deja 12 (`StrokeStyleFields.tsx:18`). El que coincide con el tamaño actual sale activo (`aria-checked`). NO aprobada la reducción 14→8 |
| Color (chip redondo `iconOnly`, con alpha) | Toolbox dock › tarjeta del pincel fila `brush-row` (`BrushSettings.tsx:112`); Panel derecho › Tool (rama sin tarjeta) (`BrushSettings.tsx:160`) | `ui.brush.color`; la «A» del selector escribe `ui.brush.opacity` (`BrushSettings.tsx:112`) | Brush/Pencil/Airbrush; oculto con Eraser (`!erase`) | Comparte `ui.brush.color` con Fill, Gradient y Eyedropper. Selector completo en [[selector-de-color]] |
| Size (slider con icono Circle, 1 a 240 px) | Toolbox dock › tarjeta del pincel (`BrushSettings.tsx:113`); Panel derecho › Tool (rama sin tarjeta) (`BrushSettings.tsx:161`) | `ui.brush.size` vía `set` → `setUi` (`BrushSettings.tsx:93`) | Tool = brush o eraser | Solo el icono, el nombre «Size» sale en `data-tip`. Rueda del ratón sobre el slider mueve un paso (`InlineSlider`) |
| Opacity (slider con icono Droplet, 1 a 100 %) | Toolbox dock › tarjeta del pincel (`BrushSettings.tsx:114`); Panel derecho › Tool (rama sin tarjeta) (`BrushSettings.tsx:162`) | `ui.brush.opacity` vía `set` → `setUi` (`BrushSettings.tsx:93`) (mínimo 0.01) | Tool = brush o eraser | Duplicado en el selector de color como «A» |
| Texture (select con icono: None, Paper, Canvas, Grain) | Toolbox dock › tarjeta del pincel (`BrushSettings.tsx:115`); Panel derecho › Tool (rama sin tarjeta) (`BrushSettings.tsx:163`) | `ui.brush.texture` y, si pasa de None con fuerza 0, `ui.brush.textureStrength = 0.5` vía `set` → `setUi` (`BrushSettings.tsx:93`) | Tool = brush o eraser | Solo muestra un disco (el engine dibuja la textura; «None» = disco vacío con raya roja) `BrushSettings.tsx:63`; el nombre y el valor salen solo en el tooltip |
| Texture strength (slider 0 a 100 %) | Toolbox dock › tarjeta del pincel en la pestaña Tip, primera fila (`BrushSettings.tsx:122`); Panel derecho › Tool (rama sin tarjeta) bajo la fila principal (`BrushSettings.tsx:165`) | `ui.brush.textureStrength` vía `set` → `setUi` (`BrushSettings.tsx:93`) | Tool = brush o eraser y `texture != none` | En la tarjeta queda dentro de una pestaña, lejos de Texture |
| Aviso «not allowed» / pista del escenario | Lienzo (`Stage.tsx:1353`) | Ninguno | Brush/Eraser con capa bloqueada (`blocked`) | Cursor `not-allowed` y un texto sobre la página con el motivo de `toolBlockReason` |
| Cursor del pincel (círculo del tamaño) | Lienzo (`BrushCursor.tsx:5`) | Ninguno | Brush/Eraser con el puntero sobre la página | Solo hover; el cursor del sistema se oculta (`cursor: none`) |

## Compacto (tira contextual del Edit card)

| Control | Dónde está hoy | Qué estado modifica | Cuándo aparece | Notas |
| --- | --- | --- | --- | --- |
| Size (slider con nombre) | Edit card › tira contextual (rama `compact`) (`BrushSettings.tsx:100`) | `ui.brush.size` vía `set` → `setUi` (`BrushSettings.tsx:93`) | Tool = brush/eraser con `ContextStrip` visible (la caja lo muestra solo dentro del Edit card, ver [[tira-contextual]]) | Sin presets ni vista previa |
| Color con nombre y alpha | Edit card › tira contextual (rama `compact`) (`BrushSettings.tsx:101`) | `ui.brush.color` y `ui.brush.opacity` (alpha) vía `set` → `setUi` (`BrushSettings.tsx:93`) | Solo Brush | Aquí SÍ es un botón con texto «Color» y valor |
| Opacity (slider con nombre) | Edit card › tira contextual (rama `compact`) (`BrushSettings.tsx:102`) | `ui.brush.opacity` vía `set` → `setUi` (`BrushSettings.tsx:93`) | Brush/Eraser | Igual que arriba |
| Follow stroke ruler (interruptor) | Tira contextual, tras los ajustes (`ContextStrip.tsx:109`) | `ui.strokeRuler.on` vía `setRuler` (`ContextStrip.tsx:109`) | Brush o Eraser y existe una regla colocada en este documento | Duplicado de «Snap brush to ruler» del Ruler tool ([[regla]]) |
| Settings… (botón) | Tira contextual, extremo (`ContextStrip.tsx:110`) | Evento `ogs:designer-panel` → pestaña Tool/Props del panel derecho (`LayersPanel.tsx:117`) | Siempre que la tira sea visible | Es el camino a «todos los ajustes» desde la tira |
| Alt+clic (Brush) | Lienzo (`Stage.tsx:626`) | `ui.brush.color` y color reciente (`rememberColor`) | Tool = brush o fill | Recoge el color visible bajo el puntero; avisa si la página es transparente ahí |

## Enlaces

- [[pincel-avanzado]] · [pincel-avanzado.md](pincel-avanzado.md)
- [[borrador]] · [borrador.md](borrador.md)
- [[selector-de-color]] · [selector-de-color.md](selector-de-color.md)
- [[regla]] · [regla.md](regla.md)
- [[lienzo-gestos]] · [lienzo-gestos.md](lienzo-gestos.md)
- [[toolbox-dock]] · [toolbox-dock.md](toolbox-dock.md)
- [[estado-compartido]] · [estado-compartido.md](estado-compartido.md)
- [[README]] · [Índice](README.md)

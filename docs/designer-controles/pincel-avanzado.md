---
type: inventario
title: Pincel: pestañas Tip, Stroke, Pressure y Blend
description: Los ajustes del pincel fuera del bloque principal: punta, trazo, presión y mezcla, en la tarjeta del dock (pestañas) y en el panel Tool (lista larga).
tags: [designer, pincel, brush, avanzado]
updated: 2026-10-28
related: [pincel, borrador, estado-compartido, toolbox-dock]
---
# Pincel: pestañas Tip, Stroke, Pressure y Blend

Misma fuente que [[pincel]] (`BrushSettings.tsx`). **Tarjeta del dock**: cuatro pestañas que comparten una celda para que no cambie el alto (`BrushSettings.tsx:105`); la pestaña activa es estado local `tab` (`BrushSettings.tsx:98`), no persiste. **Panel Tool**: lista larga sin pestañas; los controles de presión finos quedan tras el interruptor local «Advanced settings» (`BrushSettings.tsx:184`), que tampoco persiste. Todos escriben `ui.brush` (`set`, `BrushSettings.tsx:93`). Con Eraser desaparecen Blend y Keep opacity.

| Control | Dónde está hoy | Qué estado modifica | Cuándo aparece | Notas |
| --- | --- | --- | --- | --- |
| Control | Dónde está hoy | Qué estado modifica | Cuándo aparece | Notas |
| Selector de pestañas Tip / Stroke / Pressure / Blend | Dock › tarjeta del pincel, columna derecha (`BrushSettings.tsx:119`) | Estado local `tab` (no es `ui`) | Solo la tarjeta del dock; Blend solo con Brush (`!erase`) | La rama sin tarjeta no tiene pestañas |
| Tip (4 opciones con icono: Hard, Firm, Soft, Airbrush) | Tarjeta, pestaña Tip (`BrushSettings.tsx:123`); Panel Tool (`BrushSettings.tsx:175`) | `ui.brush.hardness` = 1 / 0.7 / 0.4 / 0.05 (`TIP_PRESETS`, `brushEngine.ts:71`) | Brush y Eraser | Es la misma magnitud que el slider Hardness; Pencil y Airbrush del dock fijan Hard y Airbrush |
| Hardness (slider 0 a 100 %) | Tarjeta, pestaña Tip (`BrushSettings.tsx:124`); Panel Tool (`BrushSettings.tsx:176`) | `ui.brush.hardness` | Brush y Eraser | Defecto 1 (`BRUSH_DEFAULTS.hardness`) |
| Widget de forma de punta (elipse con 3 tiradores) | Tarjeta, pestaña Tip (`BrushSettings.tsx:125`); Panel Tool (`BrushSettings.tsx:177`); definición `BrushTipShape.tsx:11` | `ui.brush.angle` (arrastrar la flecha) y `ui.brush.roundness` (arrastrar los dos puntos) | Brush y Eraser | Los tiradores solo se ven con hover (`data-tip` «Drag to turn the tip» / «Drag to squeeze the tip»). Sin teclado |
| Angle (slider −180 a 180 °) | Dentro del widget (`BrushTipShape.tsx:43`) | `ui.brush.angle` | Brush y Eraser | También lo usa el plumín de Lineart (`angleOnly`) |
| Roundness (slider 1 a 100 %) | Dentro del widget (`BrushTipShape.tsx:44`) | `ui.brush.roundness` | Brush y Eraser | No existe en la versión `angleOnly` de Lineart |
| Follow stroke (interruptor) | Tarjeta, pestaña Tip (`BrushSettings.tsx:126`); Panel Tool (`BrushSettings.tsx:178`) | `ui.brush.follow` | Brush y Eraser | Tooltip: «Needs Roundness below 100 %» |
| Mirror (interruptor) | Tarjeta, pestaña Tip (`BrushSettings.tsx:127`); Panel Tool (`BrushSettings.tsx:179`) | `ui.brush.mirror` | Brush y Eraser | Refleja cada trazo sobre el eje vertical central de la página |
| Taper start (slider 0 a 500 px, admite más al escribir) | Tarjeta, pestaña Stroke (`BrushSettings.tsx:131`); Panel Tool (`BrushSettings.tsx:167`) | `ui.brush.taperStart` | Brush y Eraser | `allowManualOverflow`: el campo numérico no limita al máximo |
| Taper end (slider 0 a 500 px) | Tarjeta, pestaña Stroke (`BrushSettings.tsx:132`); Panel Tool (`BrushSettings.tsx:168`) | `ui.brush.taperEnd` | Brush y Eraser | Igual que Taper start |
| Stabilize (slider 0 a 10) | Tarjeta, pestaña Stroke (`BrushSettings.tsx:135`); Panel Tool (`BrushSettings.tsx:171`) | `ui.brush.stabilization` | Brush y Eraser | Un comentario del código dice que vive en la pestaña Tool (`BrushSettings.tsx:103`) |
| Smoothing (slider 0 a 10) | Tarjeta, pestaña Stroke (`BrushSettings.tsx:136`); Panel Tool (`BrushSettings.tsx:172`) | `ui.brush.smoothing` | Brush y Eraser | Distinto de `smoothing` de Lineart (otro objeto, `ui.lineart`) |
| Simulate pressure (interruptor) | Tarjeta, pestaña Pressure (`BrushSettings.tsx:140`); Panel Tool, visible siempre (`BrushSettings.tsx:180`) | `ui.brush.simulatePressure` | Brush y Eraser | Presión por velocidad |
| Speed influence (slider 25 a 200 %) | Tarjeta, pestaña Pressure (`BrushSettings.tsx:141`); Panel Tool (`BrushSettings.tsx:181`) | `ui.brush.pressureSpeed` | Solo con `simulatePressure` activo | Defecto 1 |
| Lectura de presión (texto de estado) | Tarjeta, pestaña Pressure; Panel Tool (`BrushSettings.tsx:80`, usos `BrushSettings.tsx:143`) | Ninguno (lee `lastPressure`) | Solo con `simulatePressure` apagado | Avisa si el dispositivo no manda presión; avisa «paint once» hasta el primer trazo |
| Pressure → size (interruptor) | Tarjeta, pestaña Pressure (`BrushSettings.tsx:144`); Panel Tool dentro de Advanced settings (`BrushSettings.tsx:186`) | `ui.brush.pressureSize` (activo salvo `false`) | Brush y Eraser; en el panel, con Advanced settings | En el panel está oculto por defecto |
| Min size (slider 0 a 100 %) | Tarjeta, pestaña Pressure (`BrushSettings.tsx:145`); Panel Tool dentro de Advanced (`BrushSettings.tsx:187`) | `ui.brush.minSize` (defecto 0.2) | Igual; deshabilitado si Pressure → size está apagado | — |
| Pressure → density (interruptor) | Tarjeta, pestaña Pressure (`BrushSettings.tsx:146`); Panel Tool dentro de Advanced (`BrushSettings.tsx:188`) | `ui.brush.pressureDensity` | Brush y Eraser; en el panel, con Advanced | Apagado por defecto |
| Min density (slider 0 a 100 %) | Tarjeta, pestaña Pressure (`BrushSettings.tsx:147`); Panel Tool dentro de Advanced (`BrushSettings.tsx:189`) | `ui.brush.minDensity` (defecto 0.2) | Deshabilitado si Pressure → density está apagado | — |
| Advanced settings (interruptor) | Panel Tool, solo rama sin tarjeta (`BrushSettings.tsx:184`) | Estado local `advanced` (`BrushSettings.tsx:97`) | Brush y Eraser en el panel Tool | Se cierra al cambiar de herramienta o de panel. La tarjeta no lo tiene |
| Blend (select: Normal, Multiply, Screen, Overlay, Darken, Lighten) | Tarjeta, pestaña Blend (`BrushSettings.tsx:150`); Panel Tool (`BrushSettings.tsx:174`) | `ui.brush.blend` | Solo Brush (`!erase`) | Son 6, no los 16 modos de capa |
| Keep opacity (interruptor) | Tarjeta, pestaña Blend (`BrushSettings.tsx:151`); Panel Tool dentro de Advanced (`BrushSettings.tsx:190`) | `ui.brush.keepOpacity` | Solo Brush; en el panel, con Advanced | Pinta solo donde la capa ya tiene píxeles |

## Enlaces

- [[pincel]] · [pincel.md](pincel.md)
- [[borrador]] · [borrador.md](borrador.md)
- [[estado-compartido]] · [estado-compartido.md](estado-compartido.md)
- [[toolbox-dock]] · [toolbox-dock.md](toolbox-dock.md)
- [[README]] · [Índice](README.md)

---
type: inventario
title: Curve y la familia Pen
description: La herramienta Curve (arco con curvatura) y las variantes de Pen que aún no existen.
tags: [designer, curva, pen]
updated: 2026-10-28
related: [formas, lineart, toolbox-dock, tira-contextual]
---
# Curve y la familia Pen

Curve es una forma de trazo que se curva respecto a la recta entre dos puntos. Comparte `ui.shape` con las demás formas ([[formas]]); en el dock cuelga de la familia Pen junto a [[lineart]] (`toolboxModel.ts:27`). No tiene tecla de atajo (`shortcuts.ts:4`).

| Control | Dónde está hoy | Qué estado modifica | Cuándo aparece | Notas | Dónde quedaría en la propuesta | Estado | Mockup |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Bend (slider −100 a 100 %) | Dock › tarjeta / Panel Tool (`ToolSettings.tsx:273`) | `ui.shape.bend` (defecto 30) | Tool = curve | Tooltip: negativo curva al otro lado. Es el único ajuste propio | Igual que hoy | se conserva | no dibujado |
| Stroke, Width, Join, Cap, Dashes, Dash offset, Stroke behind fill | Dock › tarjeta / Panel Tool (misma rama que [[formas]]) | `ui.shape.*` | Tool = curve; Fill no se ofrece | Join, Cap, Dashes y Stroke behind fill no salen en la rama compacta (tira con otra herramienta: «código muerto por lectura (`f11a0dd`; [rastreo 2.6](../rastreo/designer.md)) — requiere decisión y prueba en sandbox») | Igual que hoy | se conserva | no dibujado |
| Dibujar (arrastrar) | Lienzo (`Stage.tsx:540`) | Forma nueva con `toolPath('curve', …)` | Tool = curve | Pista: «Drag to draw a curve · Bend sets how far it bows» | Igual que hoy | se conserva | no dibujado |
| Variante Bezier pen (soon) | Dock › Pen (`toolboxModel.ts:27`) | Ninguno | Deshabilitada | «A vector Bezier pen is planned.» | Igual que hoy | se conserva | no dibujado |
| Variante Cutter (soon) | Dock › Pen (`toolboxModel.ts:27`) | Ninguno | Deshabilitada | «A path cutter is planned.» | Igual que hoy | se conserva | no dibujado |

## Enlaces

- [[formas]] · [formas.md](formas.md)
- [[lineart]] · [lineart.md](lineart.md)
- [[toolbox-dock]] · [toolbox-dock.md](toolbox-dock.md)
- [[tira-contextual]] · [tira-contextual.md](tira-contextual.md)
- [[README]] · [Índice](README.md)

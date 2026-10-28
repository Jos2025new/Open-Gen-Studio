---
type: inventario
title: Cuentagotas (Eyedropper)
description: El Eyedropper y el Alt+clic que recoge color con el pincel y el relleno.
tags: [designer, cuentagotas, eyedropper]
updated: 2026-10-28
related: [relleno, pincel, selector-de-color, atajos]
---
# Cuentagotas (Eyedropper)

Eyedropper (tecla I, icono pipette) recoge el color **visible** bajo el puntero, con todas las capas compuestas (`ToolHelp.tsx:16`). Escribe `ui.brush.color`, el mismo que usan Brush, Fill y Gradient.

| Control | Dónde está hoy | Qué estado modifica | Cuándo aparece | Notas |
| --- | --- | --- | --- | --- |
| Control | Dónde está hoy | Qué estado modifica | Cuándo aparece | Notas |
| Picked (color) | Dock › tarjeta / Panel Tool (`ToolSettings.tsx:234`) | `ui.brush.color` | Tool = eyedropper | Es solo un `InlineColor` más; no distingue color principal de secundario (no hay secundario) |
| Pista «Click the page to pick its visible color» | Dock › tarjeta / Panel Tool (`ToolSettings.tsx:234`) | Ninguno | Tool = eyedropper | Texto fijo |
| Clic en la página | Lienzo (`Stage.tsx:626`) | `ui.brush.color` y color reciente (`rememberColor`, `ui.swatches.recent`) | Tool = eyedropper | Si la página es transparente ahí, avisa «Nothing to pick here» y no cambia nada |
| Alt + clic con Brush o Fill | Lienzo (misma rama) | `ui.brush.color` | Tool = brush o fill | No existe con Eraser, Gradient ni formas |

## Enlaces

- [[relleno]] · [relleno.md](relleno.md)
- [[pincel]] · [pincel.md](pincel.md)
- [[selector-de-color]] · [selector-de-color.md](selector-de-color.md)
- [[atajos]] · [atajos.md](atajos.md)
- [[README]] · [Índice](README.md)

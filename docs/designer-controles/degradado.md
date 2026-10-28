---
type: inventario
title: Degradado (Gradient)
description: Controles de la herramienta Gradient, su gesto en el lienzo y los tiradores del degradado de una forma.
tags: [designer, degradado, gradient]
updated: 2026-10-28
related: [relleno, selector-de-color, tira-contextual, propiedades, lienzo-gestos, seleccion]
---
# Degradado (Gradient)

Gradient (tecla U) arrastra una línea del primer al segundo color y deja el resultado en una capa nueva, dentro de la selección de píxeles si la hay (`ToolHelp.tsx:19`). Su objeto es `ui.gradient` (`store.ts:164`); el color principal es `ui.brush.color`. La rama está en `ToolSettings` (`ToolSettings.tsx:235`).

| Control | Dónde está hoy | Qué estado modifica | Cuándo aparece | Notas | Dónde quedaría en la propuesta | Estado | Mockup |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Control | Dónde está hoy | Qué estado modifica | Cuándo aparece | Notas | Igual que hoy | se conserva | no dibujado |
| Shape (Linear / Radial) | Dock › tarjeta / Panel Tool / tira (`ToolSettings.tsx:239`) | `ui.gradient.shape` | Tool = gradient | — | Igual | se conserva | [c13-gradiente-end](../mockups/designer-ajustes/c13-gradiente-end.html) |
| Color | Dock › tarjeta / Panel Tool / tira (`ToolSettings.tsx:240`) | `ui.brush.color` | Tool = gradient | Es el color del pincel, no uno propio | Igual | se conserva | [c13-gradiente-end](../mockups/designer-ajustes/c13-gradiente-end.html) |
| To (Second color / Transparent) | Dock › tarjeta / Panel Tool / tira (`ToolSettings.tsx:241`) | `ui.gradient.mode` (`two` / `fade`) | Tool = gradient | C13 propone llamarlo «End» | Mismo sitio; la etiqueta «To» pasa a «End» (mismas opciones) | se conserva | [c13-gradiente-end](../mockups/designer-ajustes/c13-gradiente-end.html) |
| Second (color) | Dock › tarjeta / Panel Tool / tira (`ToolSettings.tsx:242`) | `ui.gradient.color2` | Tool = gradient y To = Second color | — | Igual | se conserva | [c13-gradiente-end](../mockups/designer-ajustes/c13-gradiente-end.html) |
| ⇄ (intercambiar colores) | Dock › tarjeta / Panel Tool (`ToolSettings.tsx:244`) | Intercambia `ui.brush.color` y `ui.gradient.color2` | Tool = gradient, no compacto | No sale en la tira | Igual | se conserva | [c13-gradiente-end](../mockups/designer-ajustes/c13-gradiente-end.html) |
| Reverse (interruptor) | Dock › tarjeta / Panel Tool (`ToolSettings.tsx:245`) | `ui.gradient.reverse` | Tool = gradient, no compacto | No sale en la tira | Igual | se conserva | [c13-gradiente-end](../mockups/designer-ajustes/c13-gradiente-end.html) |
| Opacity (slider 1 a 100 %) | Dock › tarjeta / Panel Tool / tira (`ToolSettings.tsx:247`) | `ui.gradient.opacity` | Tool = gradient | Distinta de la opacidad del pincel | Igual que hoy | se conserva | no dibujado |
| Arrastrar una línea | Lienzo (`Stage.tsx:604`) | Capa raster nueva (`applyGradient`) | Tool = gradient | Vista previa mientras se arrastra | Igual que hoy | se conserva | no dibujado |
| Shift mientras se arrastra | Lienzo (`Stage.tsx:1090`) | Ángulo de la línea | Tool = gradient | Pasos de 45° | Igual que hoy | se conserva | no dibujado |
| Tiradores del degradado de una forma (centro/inicio/fin) | Lienzo (`ShapeHandles.tsx:75`) | `fillGradient` / `strokeGradient` de la forma elegida | Tool = move, modo Objects y una forma con degradado | Solo hover/arrastre; tooltip «Fill gradient start…» | Igual que hoy | se conserva | no dibujado |
| Tipo Solid / Linear / Radial y stop Start / End de una forma | Popover Fill/Stroke de la tira (`ShapePaint.tsx:58`) | `fillGradient`/`strokeGradient` de la forma (`patchShape`) | Forma elegida con Edit (Objects) | El stop activo (Start/End) es estado local: se pierde al cambiar de selección. Ver [[tira-contextual]] | Igual que hoy | se conserva | no dibujado |

## Enlaces

- [[relleno]] · [relleno.md](relleno.md)
- [[selector-de-color]] · [selector-de-color.md](selector-de-color.md)
- [[tira-contextual]] · [tira-contextual.md](tira-contextual.md)
- [[propiedades]] · [propiedades.md](propiedades.md)
- [[lienzo-gestos]] · [lienzo-gestos.md](lienzo-gestos.md)
- [[seleccion]] · [seleccion.md](seleccion.md)
- [[README]] · [Índice](README.md)

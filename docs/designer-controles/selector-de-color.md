---
type: inventario
title: Selector de color (InlineColor)
description: El popover de color que usan todas las herramientas: plano, canales, hex, recientes y guardados.
tags: [designer, color, popover]
updated: 2026-10-28
related: [pincel, relleno, degradado, formas, texto, lineart, propiedades, estado-compartido]
---
# Selector de color (InlineColor)

`InlineColor` (`InlineControls.tsx:51`) es el único selector de color del Designer. Cada llamador le pasa su propio valor y su `onChange` (por eso el mismo popover escribe `ui.brush.color`, `ui.shape.fill`, `ui.text.color`, `ui.lineart.color`, el color de una forma elegida, etc.). Lo común está aquí; dónde se usa, en cada nota.

| Control | Dónde está hoy | Qué estado modifica | Cuándo aparece | Notas |
| --- | --- | --- | --- | --- |
| Control | Dónde está hoy | Qué estado modifica | Cuándo aparece | Notas |
| Botón de color (swatch + etiqueta + valor opcional) | Cada herramienta con color (`InlineControls.tsx:64`) | Abre/cierra el popover (`usePopover`); al cerrar guarda el color como reciente (`rememberColor`, `InlineControls.tsx:57`) | Siempre que el llamador lo pinte | `iconOnly` = chip redondo sin texto (pincel, Studio); `showValue` añade el hex (Fill, Stroke, Text color) |
| Plano de color (saturación × brillo) | Popover (`InlineControls.tsx:69`); definición `ColorPlane.tsx:16` | El color del llamador | Popover abierto | Puntero (arrastrar) o flechas (1 %, con Shift 10 %) |
| Selector HSLA / RGBA | Popover (`ColorChannels.tsx:11`, selector `ColorChannels.tsx:32`) | Estado local `mode` del popover | Popover abierto | Alterna H S L ↔ R G B |
| Canales (3 sliders con degradado) | Popover (`ColorChannels.tsx:34`) | El color del llamador | Popover abierto | Tono 0 a 359, S y L 0 a 100; en RGB 0 a 255 |
| A (slider de alfa) | Popover (`ColorChannels.tsx:41`) | La opacidad del llamador (`ui.brush.opacity` en el pincel; `fillOpacity`/`strokeOpacity` en una forma) | Solo si el llamador pasa `alpha` | Duplica el slider Opacity del pincel |
| Campos numéricos H/S/L o R/G/B (+ A) | Popover (`ColorChannels.tsx:46`) | El color y la opacidad | Popover abierto | Escribir un valor |
| Hex (campo `#RRGGBB` o `#RRGGBBAA`) | Popover (`InlineControls.tsx:74`) | El color; con 9 dígitos también la opacidad | Popover abierto | Acepta pegado |
| Vista previa del color | Popover (`InlineControls.tsx:73`) | — | Popover abierto | Solo lectura |
| Save (enlace) | Popover (`InlineControls.tsx:75`) | `ui.swatches.saved` (`saveSwatch`, `swatches.ts:24`) | Popover abierto; deshabilitado si ya está guardado | Persiste |
| Recent (muestras) | Popover (`InlineControls.tsx:77`) | El color del llamador al pulsar | Si hay recientes | Se llenan al cerrar el popover, no al arrastrar |
| Saved (muestras, clic derecho borra) | Popover (`InlineControls.tsx:78`) | Color del llamador; clic derecho llama a `removeSwatch` (`swatches.ts:31`) | Si hay guardados | ÚNICO menú contextual de color: el clic derecho borra sin confirmación (tooltip «right-click to remove») |
| Hueco `children` del popover | Bajo los canales (`InlineControls.tsx:71`) | Lo que ponga cada llamador | Según llamador | Casilla «No fill»/«No stroke» (formas, `ToolSettings.tsx:267`), selector Solid/Linear/Radial y Start/End (`ShapePaint.tsx:58`), y las opciones del trazo (`ShapePaint.tsx:82`) |

## Enlaces

- [[pincel]] · [pincel.md](pincel.md)
- [[relleno]] · [relleno.md](relleno.md)
- [[degradado]] · [degradado.md](degradado.md)
- [[formas]] · [formas.md](formas.md)
- [[texto]] · [texto.md](texto.md)
- [[lineart]] · [lineart.md](lineart.md)
- [[propiedades]] · [propiedades.md](propiedades.md)
- [[estado-compartido]] · [estado-compartido.md](estado-compartido.md)
- [[README]] · [Índice](README.md)

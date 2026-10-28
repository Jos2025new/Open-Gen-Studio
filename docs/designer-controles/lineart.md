---
type: inventario
title: Lineart (Pen)
description: Controles de Lineart: modo Draw/Edit, estilo del trazo (tamaño, presión, plumín, textura, taper) y edición de puntos.
tags: [designer, lineart, vector]
updated: 2026-10-28
related: [curva, propiedades, pincel, lienzo-gestos, atajos, toolbox-dock]
---
# Lineart (Pen)

Lineart (tecla P) dibuja trazos vectoriales editables con presión en una capa vector sin formas. Su estilo vive en `ui.lineart` (`StrokeStyle`, `store.ts:166`); los mismos campos (`StrokeStyleFields`, `StrokeStyleFields.tsx:13`) editan los trazos ya dibujados en [[propiedades]]. No tiene versión compacta: la rama sirve igual en tarjeta, panel y tira (`ToolSettings.tsx:263`).

| Control | Dónde está hoy | Qué estado modifica | Cuándo aparece | Notas |
| --- | --- | --- | --- | --- |
| Control | Dónde está hoy | Qué estado modifica | Cuándo aparece | Notas |
| Mode (Draw / Edit) | Dock › tarjeta; Panel Tool; tira (`ToolSettings.tsx:264`) | `ui.lineartMode` (`setUi`, no persiste) | Tool = lineart | Edit: mueve puntos de un trazo; cambiar a Edit no cambia la herramienta |
| Size (slider 1 a 120 px) | Dock › tarjeta / Panel Tool (`StrokeStyleFields.tsx:17`) | `ui.lineart.size` | Lineart en modo Draw | Tope distinto al del pincel (240) |
| Presets de tamaño (12: 2 a 96) | Dock › tarjeta / Panel Tool (`StrokeStyleFields.tsx:18`) | `ui.lineart.size` | Lineart en modo Draw | El mismo componente que el pincel, filtrado a 1 a 120 |
| Color | Dock › tarjeta / Panel Tool (`StrokeStyleFields.tsx:19`) | `ui.lineart.color` | Lineart en modo Draw | Muestra el hex; NO tiene alfa en el popover (usa Opacity) |
| Opacity (5 a 100 %) | Dock › tarjeta / Panel Tool (`StrokeStyleFields.tsx:20`) | `ui.lineart.opacity` | Lineart en modo Draw | Mínimo 0.05 |
| Pressure thinning (−1 a 1) | Dock › tarjeta / Panel Tool (`StrokeStyleFields.tsx:21`) | `ui.lineart.thinning` | Lineart en modo Draw | Perfect-freehand |
| Smoothing (0 a 1) | Dock › tarjeta / Panel Tool (`StrokeStyleFields.tsx:22`) | `ui.lineart.smoothing` | Lineart en modo Draw | Distinto de Smoothing del pincel (0 a 10) |
| Streamline (0 a 1) | Dock › tarjeta / Panel Tool (`StrokeStyleFields.tsx:23`) | `ui.lineart.streamline` | Lineart en modo Draw | — |
| Widget de ángulo del plumín (Angle) | Dock › tarjeta / Panel Tool (`StrokeStyleFields.tsx:24`) | `ui.lineart.nibAngle` | Lineart en modo Draw | Solo ángulo (sin Roundness); defecto `NIB_DEFAULT_ANGLE` |
| Fixation (0 a 100 %) | Dock › tarjeta / Panel Tool (`StrokeStyleFields.tsx:25`) | `ui.lineart.nibFixation` | Lineart en modo Draw | — |
| Min width (0 a 100 %) | Dock › tarjeta / Panel Tool (`StrokeStyleFields.tsx:26`) | `ui.lineart.nibMin` | Lineart en modo Draw | — |
| Texture (Solid ink, Pencil grain, Chalk, Dry bristle) | Dock › tarjeta / Panel Tool (`StrokeStyleFields.tsx:27`) | `ui.lineart.texture.stamp` (con spacing 0.15, jitter 0.4, seed aleatoria al activarla) | Lineart en modo Draw | Las tres huellas salen de `STAMPS` (`brushTextures.ts:29`) |
| Spacing (5 a 100 %) | Dock › tarjeta / Panel Tool (`StrokeStyleFields.tsx:29`) | `ui.lineart.texture.spacing` | Con una textura elegida | — |
| Jitter (0 a 100 %) | Dock › tarjeta / Panel Tool (`StrokeStyleFields.tsx:30`) | `ui.lineart.texture.jitter` | Con una textura elegida | — |
| Seed (campo numérico) | Dock › tarjeta / Panel Tool (`StrokeStyleFields.tsx:31`) | `ui.lineart.texture.seed` | Con una textura elegida | «Same seed, same grain» |
| Taper start (px) | Dock › tarjeta / Panel Tool (`StrokeStyleFields.tsx:33`) | `ui.lineart.taperStart` | Lineart en modo Draw | Admite más del tope al escribir |
| Taper end (px) | Dock › tarjeta / Panel Tool (`StrokeStyleFields.tsx:34`) | `ui.lineart.taperEnd` | Lineart en modo Draw | — |
| Influence (slider 1 a 500 px) | Dock › tarjeta / Panel Tool (`ToolSettings.tsx:265`) | `ui.lineartInfluence` (no persiste, defecto 80) | Lineart en modo Edit; también aparece en Edit | Radio al que arrastrar un punto arrastra a sus vecinos |
| Estilo de la curva elegida (los mismos campos de arriba) | Dock › tarjeta / Panel Tool, bajo Influence (`ToolSettings.tsx:265`) | Los trazos de la capa vector activa (`mutateDoc`) | Modo Edit y hay curva elegida en la capa activa, visible y desbloqueada | La tira contextual pasa `selectedCurve={null}` (`ContextStrip.tsx:107`), así que solo sale en la tarjeta del dock y en el panel Tool |
| Dibujar (arrastrar) | Lienzo (`Stage.tsx:871`) | Nuevo trazo en la capa Lineart activa o en una capa vector nueva | Tool = lineart, modo Draw | Usa la presión del lápiz si la hay (`e.pressure`) |
| Alt + arrastrar (curvar un trazo) | Lienzo (`Stage.tsx:861`) | Puntos del trazo (`bendStroke`) | Lineart; trazos en la capa | Anunciado en la ayuda de la herramienta (`ToolHelp.tsx:20`) |
| Arrastrar puntos / pista del escenario | Lienzo (`Stage.tsx:1349`) | Puntos de la curva elegida | Lineart en modo Edit | Pista cerrable: «Select a stroke · Drag its points · Influence…» |

## Enlaces

- [[curva]] · [curva.md](curva.md)
- [[propiedades]] · [propiedades.md](propiedades.md)
- [[pincel]] · [pincel.md](pincel.md)
- [[lienzo-gestos]] · [lienzo-gestos.md](lienzo-gestos.md)
- [[atajos]] · [atajos.md](atajos.md)
- [[toolbox-dock]] · [toolbox-dock.md](toolbox-dock.md)
- [[README]] · [Índice](README.md)

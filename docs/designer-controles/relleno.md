---
type: inventario
title: Relleno (Fill)
description: Controles del cubo de pintura: color, opacidad, umbral, expandir y suavizar.
tags: [designer, relleno, fill]
updated: 2026-10-28
related: [degradado, cuentagotas, selector-de-color, pincel, seleccion, toolbox-dock]
---
# Relleno (Fill)

Fill (tecla G) rellena la zona de color parecido bajo el clic y deja el resultado en una **capa nueva** (`ToolHelp.tsx:18`). Sus valores son campos de `ui.brush` (no tiene objeto propio): color y opacidad se comparten con el pincel (`ToolSettings.tsx:255`).

| Control | Dónde está hoy | Qué estado modifica | Cuándo aparece | Notas | Dónde quedaría en la propuesta | Estado | Mockup |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Color | Dock › tarjeta / Panel Tool (`ToolSettings.tsx:255`) | `ui.brush.color` (`setUi({ brush })`) | Tool = fill | El mismo color que el pincel; selector sin alfa (la opacidad va aparte) | Igual que hoy | se conserva | no dibujado |
| Opacity (slider 1 a 100 %) | Dock › tarjeta / Panel Tool (`ToolSettings.tsx:257`) | `ui.brush.opacity` | Tool = fill | Compartida con el pincel | Igual que hoy | se conserva | no dibujado |
| Threshold (slider 0 a 255) | Dock › tarjeta / Panel Tool (`ToolSettings.tsx:258`) | `ui.brush.fillThreshold` (defecto 24) | Tool = fill | Cuánto puede diferir un color y seguir contando como la zona | Igual que hoy | se conserva | no dibujado |
| Expand (slider 0 a 12 px) | Dock › tarjeta / Panel Tool (`ToolSettings.tsx:260`) | `ui.brush.fillExpand` | Tool = fill, no compacto | No sale en la tira | Igual que hoy | se conserva | no dibujado |
| Smooth (slider 0 a 4 px) | Dock › tarjeta / Panel Tool (`ToolSettings.tsx:261`) | `ui.brush.fillSmooth` | Tool = fill, no compacto | No sale en la tira | Igual que hoy | se conserva | no dibujado |
| Rellenar (clic en la página) | Lienzo (`Stage.tsx:635`) | Capa raster nueva con la zona (`fillRegion`) | Tool = fill | Si falla, un aviso con el motivo | Igual que hoy | se conserva | no dibujado |
| Alt + clic (recoger color) | Lienzo (`Stage.tsx:626`) | `ui.brush.color` | Tool = fill o brush | Mismo gesto que el Cuentagotas | Igual que hoy | se conserva | no dibujado |

## Enlaces

- [[degradado]] · [degradado.md](degradado.md)
- [[cuentagotas]] · [cuentagotas.md](cuentagotas.md)
- [[selector-de-color]] · [selector-de-color.md](selector-de-color.md)
- [[pincel]] · [pincel.md](pincel.md)
- [[seleccion]] · [seleccion.md](seleccion.md)
- [[toolbox-dock]] · [toolbox-dock.md](toolbox-dock.md)
- [[README]] · [Índice](README.md)

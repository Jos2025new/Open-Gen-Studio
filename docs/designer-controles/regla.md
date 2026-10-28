---
type: inventario
title: Regla del pincel (Ruler)
description: La herramienta Ruler: tipos de guía (recta, elipse, perspectiva), el interruptor de seguimiento y su limpieza.
tags: [designer, regla, ruler]
updated: 2026-10-28
related: [pincel, borrador, tira-contextual, toolbox-dock, guias]
---
# Regla del pincel (Ruler)

Ruler (tecla K) coloca una guía discontinua que el **pincel** sigue (líneas paralelas, elipses concéntricas o rayos a un punto de fuga). No es la regla de página ni las guías ([[guias]]). Estado: `ui.strokeRuler` (la guía, por documento, `store.ts:155`) y `ui.strokeRulerKind` (qué tipo coloca el siguiente arrastre), ambos persisten. Ajustes en `RulerSettings` (`StrokeRulerOverlay.tsx:53`).

| Control | Dónde está hoy | Qué estado modifica | Cuándo aparece | Notas | Dónde quedaría en la propuesta | Estado | Mockup |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Ruler (select Straight / Ellipse / Perspective) | Dock › tarjeta / Panel Tool (`StrokeRulerOverlay.tsx:58`) | `ui.strokeRulerKind` y, si hay guía, `ui.strokeRuler.kind` (`setRuler`) | Tool = ruler | Duplica las tres variantes del dock (Straight, Ellipse, Perspective ruler) | Igual que hoy | se conserva | no dibujado |
| Vanishing points (One / Two) | Dock › tarjeta / Panel Tool (`StrokeRulerOverlay.tsx:59`) | `ui.strokeRuler.points` (solo si ya existe una guía) | Tool = ruler y tipo Perspective | Sin guía colocada no hace nada | Igual que hoy | se conserva | no dibujado |
| Snap brush to ruler (interruptor) | Dock › tarjeta / Panel Tool (`StrokeRulerOverlay.tsx:60`) | `ui.strokeRuler.on` | Tool = ruler; no actúa sin guía | DUPLICADO en la tira del pincel como «Follow stroke ruler» ([[pincel]]) | Igual que hoy | se conserva | no dibujado |
| Clear ruler (botón) | Dock › tarjeta / Panel Tool (`StrokeRulerOverlay.tsx:61`) | `ui.strokeRuler = null` | Tool = ruler; deshabilitado sin guía | — | Igual que hoy | se conserva | no dibujado |
| Texto de ayuda de la regla | Dock › tarjeta / Panel Tool (`StrokeRulerOverlay.tsx:62`) | Ninguno | Tool = ruler | Cambia con Perspective | Igual que hoy | se conserva | no dibujado |
| Arrastrar en la página (colocar la guía) | Lienzo (`StrokeRulerOverlay.tsx:38`) | `ui.strokeRuler` nueva con `kind` y `points` | Tool = ruler | Crea la guía con `on: true` | Igual que hoy | se conserva | no dibujado |
| Tiradores redondos de la guía | Lienzo (`StrokeRulerOverlay.tsx:45`) | Extremos o esquinas de `ui.strokeRuler` | Tool = ruler y hay guía | Solo con la herramienta Ruler activa | Igual que hoy | se conserva | no dibujado |
| Guía discontinua visible | Lienzo (`StrokeRulerOverlay.tsx:11`) | Ninguno | Hay guía en este documento, con cualquier herramienta | Se ve atenuada (`is-off`) si `on` es false | Igual que hoy | se conserva | no dibujado |
| Seguimiento del pincel | Lienzo (`Stage.tsx:1054`) | Posición de cada punto del trazo | Brush/Eraser con la guía activada | Solo el pincel raster; Lineart y formas no la usan | Igual que hoy | se conserva | no dibujado |

## Enlaces

- [[pincel]] · [pincel.md](pincel.md)
- [[borrador]] · [borrador.md](borrador.md)
- [[tira-contextual]] · [tira-contextual.md](tira-contextual.md)
- [[toolbox-dock]] · [toolbox-dock.md](toolbox-dock.md)
- [[guias]] · [guias.md](guias.md)
- [[README]] · [Índice](README.md)

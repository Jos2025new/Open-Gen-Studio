---
type: inventario
title: Tamaño de página (Sizes)
description: El formulario de tamaño de lienzo: formato, orientación, ancho, alto, unidad, DPI, color de página, ancla y recorte.
tags: [designer, tamanos, canvas, sizes]
updated: 2026-10-28
related: [toolbox-dock, barra-superior, documentos, guias]
---
# Tamaño de página (Sizes)

`CanvasSize` (`CanvasSize.tsx:13`) existe en dos sitios con el mismo formulario: como popover del botón «Canvas size» de la barra superior, y como tarjeta en línea (`inline`) cuando se abre la variante Sizes de Layout en el dock (`ToolDock.tsx:135`). Los valores de ancho y alto son estado local hasta pulsar Apply; la unidad y el DPI sí persisten en `ui` (`pageUnit`, `pageDpi`). El lado máximo es `MAX_SIDE` = 8192 px (`canvasSize.ts:15`).

| Control | Dónde está hoy | Qué estado modifica | Cuándo aparece | Notas |
| --- | --- | --- | --- | --- |
| Control | Dónde está hoy | Qué estado modifica | Cuándo aparece | Notas |
| Canvas size · W × H (botón) | Barra superior (`CanvasSize.tsx:84`) | Abre el popover | Hay documento | Solo en modo popover |
| Format (select) | Formulario (`CanvasSize.tsx:63`) | Estado local `w`, `h`; 8 entradas: Custom, A4, A5, Letter, Square 1080×1080, Story 1080×1920, HD 1920×1080, 4K 3840×2160 (`pageUnits.ts:22`) | Formulario abierto | Los de papel guardan mm y recalculan con el DPI |
| Portrait / Landscape (segmentado) | Formulario (`CanvasSize.tsx:64`) | Intercambia `w` y `h` locales | Formulario abierto | — |
| W (campo numérico) | Formulario (`CanvasSize.tsx:65`) | `w` local (máx. 8192 px) | Formulario abierto | En la unidad elegida |
| H (campo numérico) | Formulario (`CanvasSize.tsx:66`) | `h` local | Formulario abierto | — |
| Unidad px / mm / in (segmentado) | Formulario (`CanvasSize.tsx:67`) | `ui.pageUnit` | Formulario abierto | Persiste |
| DPI (campo 1–1200) | Formulario (`CanvasSize.tsx:68`) | `ui.pageDpi` | Unidad distinta de px | Defecto 96 |
| Page color | Formulario (`CanvasSize.tsx:69`) | Color local; se aplica a `doc.background` con Apply | Formulario abierto | — |
| Keep ratio (casilla) | Formulario (`CanvasSize.tsx:70`) | Estado local `lock` y `ratio` | Formulario abierto | No persiste |
| Anchor (rejilla de 9 botones) | Formulario (`CanvasSize.tsx:73`) | Estado local `anchor` | Formulario abierto | Dice dónde queda la página actual; sin texto en cada botón (solo `aria-label`) |
| Center (botón) | Formulario (`CanvasSize.tsx:76`) | `anchor` = middle-center | Anclaje distinto del centro | — |
| Trim to content | Formulario (`CanvasSize.tsx:78`) | `trimToContent`: la página se ajusta a las capas visibles | Formulario abierto | Se rechaza si pasa de 8192 |
| Apply | Formulario (`CanvasSize.tsx:79`) | `resizeCanvas` y, si cambió, `doc.background` | Formulario abierto | Error si el lado no está entre 1 y 8192 |

## Enlaces

- [[toolbox-dock]] · [toolbox-dock.md](toolbox-dock.md)
- [[barra-superior]] · [barra-superior.md](barra-superior.md)
- [[documentos]] · [documentos.md](documentos.md)
- [[guias]] · [guias.md](guias.md)
- [[README]] · [Índice](README.md)

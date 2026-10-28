---
type: inventario
title: Estado compartido del Designer
description: Campos de ui y del documento que tocan los controles del Designer, con su línea en store.ts, si persisten y su defecto.
tags: [designer, estado, store]
updated: 2026-10-28
related: [toolbox-dock, pincel, capas, atajos]
---
# Estado compartido del Designer

Qué estado guarda cada control. `ui` vive en `store.ts` (`UiState`); se cambia con `setUi` (`store.ts:578`). El documento se cambia con `setDoc` (`store.ts:566`) o con las acciones de `engine/design/actions.ts`. «Persiste» = está en `PersistedUi` (`persistUi.ts:33`); los demás se pierden al recargar.

## Campos de `ui`

| Campo | Línea | Persiste | Defecto | Lo usan |
| --- | --- | --- | --- | --- |
| `ui.tool` | `store.ts:144` | sí | `'move'` (`store.ts:232`) | toolbox-dock, atajos, todas las herramientas |
| `ui.brush` (size, color, opacity, hardness, angle, roundness, follow, mirror, simulatePressure, pressureSpeed, pressureSize, minSize, pressureDensity, minDensity, texture, textureStrength, blend, keepOpacity, taperStart, taperEnd, stabilization, smoothing, fillThreshold, fillExpand, fillSmooth) | `store.ts:146` | sí | size 24, color `#ffffff`, opacity 1 (`store.ts:233`); el resto sin valor = `BRUSH_DEFAULTS` (`brushEngine.ts:74`) | Brush, Eraser (comparten el mismo objeto), Fill (color, opacity, fill*), Gradient (color), Eyedropper (color) |
| `ui.lineart` (StrokeStyle) | `store.ts:166` | sí | `DEFAULT_STROKE_STYLE` | Lineart |
| `ui.lineartMode`, `ui.lineartInfluence` | `store.ts:167` | no | `'draw'`, 80 | Lineart, Edit |
| `ui.shape` (fill, stroke, strokeWidth, radius, sides, bend, primParams, rx, ry, join, cap, miter, dash, dashOffset, paintOrder) | `store.ts:177` | sí | fill `#d4f25a`, stroke null, strokeWidth 4 | formas, líneas, curva |
| `ui.text` (TextStyle) | `store.ts:178` | sí | `DEFAULT_TEXT_STYLE` (Inter, 96, 700, `#ffffff`) | Text |
| `ui.gradient` | `store.ts:164` | sí | linear, two, `#000000`, opacidad 1 (en `ToolSettings`) | Gradient |
| `ui.selectShape`, `ui.wand` | `store.ts:150` | sí | `'rect'`; wand threshold 24, expand 0, smooth 0, replace, all | Select pixels |
| `ui.selectMode`, `ui.autoSelect` | `store.ts:172` | `selectMode` no, `autoSelect` sí | `'objects'`; false | Edit |
| `ui.snapByMode` | `store.ts:170` | no | por modo: Drawing apagado, Design encendido | Edit (Snap), Guides |
| `ui.rulers`, `ui.showGuides`, `ui.lockGuides` | `store.ts:153` | sí | false, true, false | Guides, Stage |
| `ui.strokeRuler`, `ui.strokeRulerKind` | `store.ts:155` | sí | null, `'line'` | Ruler, Brush |
| `ui.shapeLockRadii` | `store.ts:158` | no | false | tira contextual (Lock radii) |
| `ui.toolHelp` | `store.ts:160` | sí | true | línea de ayuda, ViewToggles |
| `ui.designerDock` | `store.ts:162` | no | `'tools'` | Composer, ToolPalette |
| `ui.drawingChoice` | `store.ts:174` | sí | sin valor = preguntar | DrawingChoicePrompt |
| `ui.swatches` (recent, saved) | `store.ts:148` | sí | vacío | todo `InlineColor` |
| `ui.pageUnit`, `ui.pageDpi` | `persistUi.ts:5` | sí | `px`, 96 | Sizes |

## Estado del documento y locales

- Documento (`DesignDoc`): `paintMode` ('drawing'/'design', `types.ts:880`), `guides` {x,y}, `layers`, `groups`, `activeLayerId`, `background`, `width`, `height`. Se cambia con `setDoc`/`mutateDoc`/`patchLayer`; el deshacer es por documento (`record`, `undoDoc`).
- Selección de píxeles: módulo `pixelSelection.ts` (fuera del store), con `useSelectionVersion`. Selección de objetos/capas: `objectSelection.ts` y `selection.ts` (stores zustand por documento).
- Preferencias del navegador (`usePref`, localStorage): `ogs:layers-width`, `ogs:layers-list-h`, `ogs:layers-collapsed`, `ogs:layers-tab`, `ogs:canvas-picker-open`; consejos cerrados en `ogs.designer.hintsClosed` (`StageEditHint.tsx:32`).
- Locales de componente (se pierden al desmontar): pestaña Tip/Stroke/Pressure/Blend del pincel, `advanced` del panel del pincel, `grow` de Selection, stop Start/End del degradado de una forma, `propertiesOpen`, `alignPrefs`, formulario de Sizes.
- Eventos de ventana que conectan superficies: `ogs:designer-zoom`, `ogs:designer-fit`, `ogs:designer-view`, `ogs:layers-toggle`, `ogs:designer-panel` (detalle `'layers'|'props'|'tool'`), `ogs:upload`, `ogs:pan`.

## Enlaces

- [[toolbox-dock]] · [toolbox-dock.md](toolbox-dock.md)
- [[pincel]] · [pincel.md](pincel.md)
- [[capas]] · [capas.md](capas.md)
- [[atajos]] · [atajos.md](atajos.md)
- [[README]] · [Índice](README.md)

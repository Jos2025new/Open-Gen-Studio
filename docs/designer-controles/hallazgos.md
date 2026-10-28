---
type: inventario
title: Hallazgos de la lectura del código
description: Hechos comprobados al leer el Designer que afectan al reagrupado: duplicados, controles ocultos, textos desfasados y huecos de atajos.
tags: [designer, hallazgos]
updated: 2026-10-28
related: [README, tira-contextual, atajos, propiedades, menus-contextuales]
---
# Hallazgos de la lectura del código

Cada hallazgo sale de leer el código en esta pasada (el mismo `file:línea` está en la matriz de su superficie). No hay hallazgos «sin confirmar» salvo los marcados. Sustituyen a la lista del inventario antiguo, de la que se descartó el punto sobre el anidado de `designerKeys` (ya no existe en el código actual).

## Duplicados (mismo estado, dos controles)

- Snap to guides (tarjeta Guides, `GuidesCard.tsx:32`) y Guides del popover Snap de Edit (`SnapControl.tsx:23`) escriben el mismo campo `snapByMode[modo].guides` ([[guias]], [[alinear-editar]]).
- Follow stroke ruler (tira, `ContextStrip.tsx:109`) y Snap brush to ruler (tarjeta Ruler, `StrokeRulerOverlay.tsx:60`) escriben `ui.strokeRuler.on` ([[regla]]).
- Influence aparece en la barra Edit (`ToolSettings.tsx:250`) y en Lineart modo Edit (`ToolSettings.tsx:265`); es el mismo `ui.lineartInfluence`.
- Transform (espejo y giro) está en la barra superior (`DesignerWorkspace.tsx:96`), en la barra Edit (`ToolSettings.tsx:129`) y en la Edit card (`EditCard.tsx:38`) ([[barra-superior]]).
- Show or hide right panel (barra superior, `DesignerWorkspace.tsx:97`) y Collapse layers panel (`LayersPanel.tsx:178`) hacen lo mismo ([[capas]]).
- El nombre de la capa activa se edita con un campo fijo (`LayersPanel.tsx:221`) y además con doble clic en las demás filas.
- El texto de una capa (Text, Font, Size, Weight, Color, Align) se edita en Properties (`LayersPanel.tsx:276`) y en la tira de texto seleccionado (`ContextStrip.tsx:78`) ([[propiedades]]).
- Fill y Stroke de una forma son un `InlineColor` simple en Properties (`LayersPanel.tsx:298`) y un `PaintSwatch` con degradados en la tira (`ContextStrip.tsx:102`).
- Selection chip de la barra superior (`ToolSettings.tsx:141`) repite Deselect de la tarjeta Select ([[seleccion]]).

## Controles que solo existen en un sitio poco evidente

- Join, Miter limit, Cap, Dashes, Dash offset y Stroke behind fill de una forma NO están en la tira contextual (`compact` los oculta, `ShapeLookFields.tsx:34`); sí están en la tarjeta de formas y en Properties ([[tira-contextual]]).
- Ctrl+E (Merge down) funciona (`designerKeys.ts:51`) pero no aparece en Settings → Shortcuts (`shortcuts.ts:49`). Ctrl+Y (rehacer) tampoco está en la lista del Designer ([[atajos]]).
- Doble clic en una fila FX abre su editor (`LayersPanel.tsx:208`), sin botón visible. El resto de gestos sin botón están en [[lienzo-gestos]].
- La rejilla de ancla de Canvas size solo tiene `aria-label` en cada botón (`CanvasSize.tsx:73`); el movimiento se ve, la posición no se rotula ([[tamanos]]).
- Deshabilitado sin motivo visible: los botones de herramienta bloqueados por `toolBlockReason` solo reciben `disabled`; el motivo no se muestra en el botón ([[toolbox-dock]]).
- El zoom no tiene atajos de teclado: ni `designerKeys` ni `shortcutGroups` los incluyen; solo botones, campo y Ctrl+rueda ([[navegacion-zoom]]).

## Textos desfasados

- La ayuda de Star dice «Sides, Inner and Round are in the strip» (`ToolHelp.tsx:25`), pero los controles se llaman Corners, Spoke ratio y Rounded (`ShapeKindFields.tsx:36`).
- La ayuda de Sector, Arc y Chord dice «From and To (degrees)» (`ToolHelp.tsx:26`), pero los controles se llaman Start y End (`ShapeKindFields.tsx:23`). El punto C13 de la propuesta («To» → «End») ya apunta a esto ([[formas]]).
- El comentario de `ViewToggles` habla de «page rulers and guides», pero el componente solo contiene el botón de ayuda (`ToolHelp.tsx:47`).

## Acciones destructivas sin confirmación (se pueden deshacer)

- Delete layer (`LayersPanel.tsx:244`), Clear all guides (`GuidesCard.tsx:43`), el clic derecho en una regla (`Stage.tsx:1336`) y el clic derecho en una muestra guardada (`InlineControls.tsx:61`) ejecutan al instante ([[menus-contextuales]]).

## Enlaces

- [[README]] · [README.md](README.md)
- [[tira-contextual]] · [tira-contextual.md](tira-contextual.md)
- [[atajos]] · [atajos.md](atajos.md)
- [[propiedades]] · [propiedades.md](propiedades.md)
- [[menus-contextuales]] · [menus-contextuales.md](menus-contextuales.md)
- [[README]] · [Índice](README.md)

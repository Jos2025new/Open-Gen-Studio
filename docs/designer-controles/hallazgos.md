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

- Join, Miter limit, Cap, Dashes, Dash offset y Stroke behind fill de una forma NO están en la rama compacta de la tira (`compact` los oculta, `ShapeLookFields.tsx:34`); sí están en la tarjeta de formas y en Properties ([[tira-contextual]]).
- Ctrl+E (Merge down) funciona (`designerKeys.ts:51`) pero no aparece en Settings → Shortcuts (`shortcuts.ts:49`). Ctrl+Y (rehacer) tampoco está en la lista del Designer ([[atajos]]).
- Doble clic en una fila FX abre su editor (`LayersPanel.tsx:208`), sin botón visible. El resto de gestos sin botón están en [[lienzo-gestos]].
- La rejilla de ancla de Canvas size solo tiene `aria-label` en cada botón (`CanvasSize.tsx:73`); el movimiento se ve, la posición no se rotula ([[tamanos]]).
- Deshabilitado sin motivo visible: los botones de herramienta bloqueados por `toolBlockReason` solo reciben `disabled`; el motivo no se muestra en el botón ([[toolbox-dock]]).
- El zoom no tiene atajos de teclado: ni `designerKeys` ni `shortcutGroups` los incluyen; solo botones, campo y Ctrl+rueda ([[navegacion-zoom]]).

## Textos desfasados

- La ayuda de Star dice «Sides, Inner and Round are in the strip» (`ToolHelp.tsx:25`), pero los controles se llaman Corners, Spoke ratio y Rounded (`ShapeKindFields.tsx:36`).
- La ayuda de Sector, Arc y Chord dice «From and To (degrees)» (`ToolHelp.tsx:26`), pero los controles se llaman Start y End (`ShapeKindFields.tsx:23`). Es un texto desfasado distinto de C13: C13 propone renombrar el selector «To» → «End» del degradado ([[degradado]]), no estos campos de ángulo.
- El comentario de `ViewToggles` habla de «page rulers and guides», pero el componente solo contiene el botón de ayuda (`ToolHelp.tsx:47`).

## Acciones destructivas sin confirmación

- Delete layer (`LayersPanel.tsx:244`), Clear all guides (`GuidesCard.tsx:43`), y el clic derecho en una regla (`Stage.tsx:1336`) ejecutan al instante ([[menus-contextuales]]); si cada una crea un paso de deshacer queda «sin confirmar». El clic derecho en una muestra guardada (`InlineControls.tsx:61`) también ejecuta al instante, pero NO crea paso de deshacer: `removeSwatch` (`swatches.ts:31`) solo cambia `ui.swatches`, estado de interfaz y no historial del documento.

## Hallazgos del inventario antiguo (2026-10-23), recomprobados

Los nueve puntos del apartado 8 de [Inventario 2](../inventario-herramientas-designer-2.md) se volvieron a comprobar contra el código actual.

- **Siguen vigentes**: (1) Brush, Eraser, Fill, Gradient, Text, Select y las formas pierden campos en la rama compacta (cada nota de herramienta marca cuáles); (2) Line y Spacing de un texto ya creado no se editan en ningún sitio, y Weight va de 100 a 900 en la herramienta (`ToolSettings.tsx:202`) pero de 300 a 900 en Properties (`LayersPanel.tsx:277`); (3) con una forma elegida (Edit abierto) la tira sustituye a los ajustes de Edit, y Object/Layer y Auto-select solo quedan en la tarjeta o la pestaña Tool ([[alinear-editar]]); (4) Grow / shrink y el estado de Advanced settings son locales y se pierden al cambiar de herramienta ([[seleccion]], [[pincel-avanzado]]); (5) Influence se ve en Edit aunque no haya curvas, y la edición de la curva elegida pasa `selectedCurve={null}` en la tira (`ContextStrip.tsx:107`); (8) siete herramientas siguen sin tecla (Polygon, Star, Sector, Arc, Chord, Curve, Arrow, `shortcuts.ts:4`).
- **Han cambiado**: (9) Arrow ya tiene un interruptor «Arrow» dentro de los ajustes de Line (`ShapeKindFields.tsx:43`); sus puntas siguen cambiándose después desde el popover de Stroke de una forma elegida ([[formas]]).
- **Ya no se reproducen**: (7) el máximo de Sides: hoy `Corners` llega a 24 tanto al crear (`ShapeKindFields.tsx:35`) como al editar (`PrimFields.tsx:29`). (6) Las «ramas inalcanzables» de `designerKeys`: en el código actual la cadena es plana y las ramas de Delete de capas (`designerKeys.ts:88`) y de teclas de herramienta (`designerKeys.ts:93`) son alcanzables. El punto 6 de [Técnico 2](../designer-tecnico-2.md) repite el hallazgo antiguo y conviene corregirlo (no se ha tocado en esta pasada).

## Enlaces

- [[README]] · [README.md](README.md)
- [[tira-contextual]] · [tira-contextual.md](tira-contextual.md)
- [[atajos]] · [atajos.md](atajos.md)
- [[propiedades]] · [propiedades.md](propiedades.md)
- [[menus-contextuales]] · [menus-contextuales.md](menus-contextuales.md)
- [[README]] · [Índice](README.md)

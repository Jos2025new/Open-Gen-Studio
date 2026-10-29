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
- El texto de una capa (Text, Font, Size, Weight, Color, Align) se edita en Properties (`LayersPanel.tsx:276`) ([[propiedades]]). La tira de texto seleccionado (`ContextStrip.tsx:78`) existe en el código, pero es código muerto por lectura (`tool === 'text'` frente a un montaje solo con la variante Edit, `f11a0dd`): respondido por lectura, requiere decisión (quitar o conectar) y prueba en sandbox ([[tira-contextual]]).
- Fill y Stroke de una forma son un `InlineColor` simple en Properties (`LayersPanel.tsx:298`) y un `PaintSwatch` con degradados en la tira (`ContextStrip.tsx:102`).
- Selection chip de la barra superior (`ToolSettings.tsx:141`) repite Deselect de la tarjeta Select ([[seleccion]]).

## Controles que solo existen en un sitio poco evidente

- Join, Miter limit, Cap, Dashes, Dash offset y Stroke behind fill de una forma NO están en la rama compacta de la tira (`compact` los oculta, `ShapeLookFields.tsx:34`); sí están en la tarjeta de formas y en Properties ([[tira-contextual]]).
- Ctrl+E (Merge down) funciona (`designerKeys.ts:51`) pero no aparece en Settings → Shortcuts (`shortcuts.ts:49`). Ctrl+Y (rehacer) tampoco está en la lista del Designer ([[atajos]]).
- Doble clic en una fila FX abre su editor (`LayersPanel.tsx:208`), sin botón visible. El resto de gestos sin botón están en [[lienzo-gestos]].
- La rejilla de ancla de Canvas size solo tiene `aria-label` en cada botón (`CanvasSize.tsx:73`); el movimiento se ve, la posición no se rotula ([[tamanos]]).
- Deshabilitado sin motivo visible: los botones de herramienta bloqueados por `toolBlockReason` solo reciben `disabled`; el motivo no se muestra en el botón ([[toolbox-dock]]).
- El zoom no tiene atajos de teclado: ni `designerKeys` ni `shortcutGroups` los incluyen; solo botones, campo, Ctrl+rueda y paradas de rueda a 25, 50, 100, 150 y 200 % (`wheelZoom.ts`, `ZOOM_STOPS`, `c04a908`) ([[navegacion-zoom]]). Respondido por lectura; añadir atajos **requiere decisión** (sin decisión encontrada).

## Textos desfasados

- **Estado (2026-10-29):** sigue abierto, no corregido: la ayuda dice «Sides» (código `ToolHelp.tsx:24`, releído); en pantalla se vieron las ayudas con «strip» (ver abajo) pero no se comprobó «Sides»/«From and To». Antes: respondido por lectura, no corregido (sin fila propia en [rastreo 5](../rastreo/designer.md)); corregir el texto no necesita prueba. La ayuda de Polygon también dice «Sides is in the strip» (`ToolHelp.tsx:24`) y el control es Corners. Referencia de rastreo: sin confirmar la fila exacta.
- La ayuda de Star dice «Sides, Inner and Round are in the strip» (`ToolHelp.tsx:25`), pero los controles se llaman Corners, Spoke ratio y Rounded (`ShapeKindFields.tsx:36`).
- La ayuda de Sector, Arc y Chord dice «From and To (degrees)» (`ToolHelp.tsx:26`), pero los controles se llaman Start y End (`ShapeKindFields.tsx:23`). Es un texto desfasado distinto de C13: C13 propone renombrar el selector «To» → «End» del degradado ([[degradado]]), no estos campos de ángulo.
- El comentario de `ViewToggles` habla de «page rulers and guides», pero el componente solo contiene el botón de ayuda (`ToolHelp.tsx:47`).

## Acciones destructivas sin confirmación

- Delete layer (`LayersPanel.tsx:244`), Clear all guides (`GuidesCard.tsx:43`), y el clic derecho en una regla (`Stage.tsx:1336`) ejecutan al instante ([[menus-contextuales]]); **respondido por lectura** para Delete layer: `deleteLayers` pasa por `mutateDoc`, un solo paso para varias capas (`actions.ts:273-279`; [rastreo 4](../rastreo/designer.md)); que se vea así en pantalla **requiere prueba**. Clear all guides y el clic derecho en regla siguen «sin confirmar». El clic derecho en una muestra guardada (`InlineControls.tsx:61`) también ejecuta al instante, pero NO crea paso de deshacer: `removeSwatch` (`swatches.ts:31`) solo cambia `ui.swatches`, estado de interfaz y no historial del documento.

## Hallazgos del inventario antiguo (2026-10-23), recomprobados

Los nueve puntos del apartado 8 de [Inventario 2](../inventario-herramientas-designer-2.md) se volvieron a comprobar contra el código actual.

- **Siguen vigentes**: (1) Brush, Eraser, Fill, Gradient, Text, Select y las formas pierden campos en la rama compacta (cada nota de herramienta marca cuáles); (2) Line y Spacing de un texto ya creado no se editan en ningún sitio, y Weight va de 100 a 900 en la herramienta (`ToolSettings.tsx:202`) pero de 300 a 900 en Properties (`LayersPanel.tsx:277`); (3) con una forma elegida (Edit abierto) la tira sustituye a los ajustes de Edit, y Object/Layer y Auto-select solo quedan en la tarjeta o la pestaña Tool ([[alinear-editar]]); (4) Grow / shrink y el estado de Advanced settings son locales y se pierden al cambiar de herramienta ([[seleccion]], [[pincel-avanzado]]); (5) Influence se ve en Edit aunque no haya curvas, y la edición de la curva elegida pasa `selectedCurve={null}` en la tira (`ContextStrip.tsx:107`); (8) siete herramientas siguen sin tecla (Polygon, Star, Sector, Arc, Chord, Curve, Arrow, `shortcuts.ts:4`).
- **Han cambiado**: (9) Arrow ya tiene un interruptor «Arrow» dentro de los ajustes de Line (`ShapeKindFields.tsx:43`); sus puntas siguen cambiándose después desde el popover de Stroke de una forma elegida ([[formas]]).
- **Ya no se reproducen**: (7) el máximo de Sides: hoy `Corners` llega a 24 tanto al crear (`ShapeKindFields.tsx:35`) como al editar (`PrimFields.tsx:29`). (6) Las «ramas inalcanzables» de `designerKeys`: en el código actual la cadena es plana y las ramas de Delete de capas (`designerKeys.ts:88`) y de teclas de herramienta (`designerKeys.ts:93`) son alcanzables. El punto 6 de [Técnico 2](../designer-tecnico-2.md) repite el hallazgo antiguo y conviene corregirlo (no se ha tocado en esta pasada).

## Estado frente al rastreo (2026-10-28)

Ver [rastreo del Designer](../rastreo/designer.md).

- Rama de texto de la tira (`ContextStrip.tsx:78`): código muerto por lectura desde `f11a0dd`; respondido por lectura, requiere decisión (quitar o conectar) y prueba en sandbox.
- Weight 100-900 frente a 300-900: confirmado en código (`ToolSettings.tsx:202`, `LayersPanel.tsx:277`) y visto en sandbox (2026-10-29). El usuario lo declaró **bug**, no decisión (S3); sigue sin corregir.
- Sculpt aparece como «soon» sin icono propio (`toolboxModel.ts:28`): respondido por lectura; requiere decisión sobre el icono.
- `rasterizeLayer` no tiene un test unitario propio según el rastreo 1.1, pero sí está cubierto dentro del E2E combinado «merge, rasterize, grow/shrink and mirror» (`tests-e2e/designer-tools.spec.ts:4,30,52`). La auditoría de ubicación no ejecutó ese E2E; no inferir ejecución desde su existencia. Fusionar también tiene tests (`tests/designer-layer-fixes.test.ts:31`).
- Ctrl pulsado durante el arrastre apaga el imán y muestra distancias a los vecinos (`Stage.tsx:1028-1036`): respondido por lectura; completa la nota de [[lienzo-gestos]].
- Ctrl+E y Ctrl+Y fuera de la lista de atajos: sin decisión encontrada; requiere decisión.

## Enlaces

- [[README]] · [README.md](README.md)
- [[tira-contextual]] · [tira-contextual.md](tira-contextual.md)
- [[atajos]] · [atajos.md](atajos.md)
- [[propiedades]] · [propiedades.md](propiedades.md)
- [[menus-contextuales]] · [menus-contextuales.md](menus-contextuales.md)
- [[README]] · [Índice](README.md)

## Sandbox y decisiones del 2026-10-29 (todo abierto, nada corregido)

Fuente visual: [[revision-ubicacion]] (prueba en `npm run dev:sandbox`, puerto 5183, `agent-browser`; capturas en `.sandbox/capturas/` de `task/workflow-ask-first`, con copia en el ZIP indicado en la revisión). Las filas «bug» S1 y S3 las declaró el usuario; S6 es una decisión de ubicación; S10 extra es un hallazgo sin atribución al usuario ([[huecos]] §3). Los commits posteriores a a4377c9 no cambiaron las rutas de código que corresponden a S1–S10; por eso siguen sin arreglo integrado. Esto no significa que no haya cobertura automatizada para comportamientos relacionados: por ejemplo, `Auto-select` tiene tests unitarios y un recorrido E2E documentado en historia 032 (ver [[huecos]] §6); no se ejecutaron en esta revisión visual.

La misma sesión delegó cambios independientes de distancias entre vecinos, zoom con rueda y `AgentGlow` (commits b9bc783, c04a908, a0be491 y 44311e3), que luego se integraron en esta rama. El reporte de esa implementación registra `npm test` completo en verde (407 archivos aprobados, 5 omitidos; 2749 pruebas aprobadas, 5 omitidas) y aclara que no comprobó el navegador. Esos tests cubren los cambios citados, no los casos S1–S10 de esta revisión.

| Id | Qué pasa | Evidencia | Estado |
| --- | --- | --- | --- |
| S1 | Tras pulsar una variante (p. ej. Edit) y luego R, O, L o M, la tarjeta no sigue a la tecla: sigue llamándose «Edit settings» con otra herramienta activa y ninguna variante marcada. Abriendo desde el botón de familia sí sigue. Con la familia Brush, M y G cambian la herramienta pero la tarjeta sigue «Brush settings» | Visto en sandbox; `ToolDock.tsx:60,64-67`, `toolboxModel.ts:50-52` | **Bug abierto** (usuario) |
| S3 | Weight 100-900 en la herramienta y 300-900 en Properties; Properties de un texto creado no tiene Line ni Spacing | Visto en sandbox; Size 1-500 frente a 4-1000 solo por lectura | **Bug abierto** (usuario); prioridad grave |
| S6 | Join, Cap, Dashes y Stroke behind fill de una forma elegida solo están en Properties (panel de ~4 filas con desplazamiento); la tira compacta de Edit no los trae | Visto en sandbox; `ShapeLookFields.tsx:34` | **Decidido** que van en la toolbox ([[huecos]] §3); sin implementar. Prioridad clave |
| S10 extra | Con una capa de texto activa y una forma de otra capa aún elegida, la tarjeta dice «Edit → Text 3» pero muestra los controles de la forma («On 1 object of Rectangle 2») | Visto en sandbox | **Bug abierto**: muestra controles de otra capa |
| S4 | Select, Lasso y Wand (y Fill, Gradient, Eyedropper) cuelgan de la familia Brush | `toolboxModel.ts:28` (lectura); en sandbox se probaron M (Select) y G (Fill), no las demás variantes | Requiere decisión (sin decisión del usuario) |
| S5 | Sector, Arc, Chord, Star y Arrow no tienen botón (fila Edit: Edit, Pan, Rectangle, Ellipse, Line, Polygon/Star) | Visto en sandbox | Requiere decisión |
| Ayudas | Las ayudas de Text, Brush y Eraser dicen «strip» aunque los ajustes están en la tarjeta (`ToolHelp.tsx:17,21,32`); Polygon/Star dicen «Sides» (control: Corners) y Sector/Arc/Chord «From and To» (control: Start/End) | «strip» visto en sandbox; Sides y From/To solo por lectura | Texto a corregir, abierto |
| Guides | La fila de la tarjeta Guides sale cortada (Orientation y «Clear all guides» recortados) | Visto en sandbox (`p8-guides-card.png`) | Bug abierto de maquetación |
| S7 | Eraser deshabilitado sobre una capa de texto: el motivo sale en el tooltip de la variante; el botón de familia sigue activo y la tecla E no hace nada ni avisa | Visto en sandbox (corrige la lectura anterior, que decía «sin motivo visible») | Requiere decisión |
| Dock | La fila de variantes se solapa con el botón «Conversation»; Sculpt y Blur («soon») se pintan con icono «?»; los iconos de variante no tienen etiqueta visible | Visto en sandbox | Abierto, sin decisión |
| Layout (decisión) | Size, Opacity y Color siempre visibles y en ese orden, con textura junto al color; el relleno vectorial es textura o degradado; Contextual Task Bar como idea del usuario | [[huecos]] §3; [investigación](investigacion-disposicion-interfaz.md) | Decidido, sin implementar |

No se probó en pantalla: doble clic para editar un FX, los límites de Size, ni «Sides»/«From and To».

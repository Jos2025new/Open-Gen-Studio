---
type: revision
title: Revisión de localización y accesibilidad de los controles del Designer
description: Hoja para que una persona compruebe en el sandbox si cada control clave se encuentra, aparece cuando hace falta y está donde se buscaría; con sospechas por lectura.
tags: [designer, controles, revision, ubicacion]
updated: 2026-10-29
related: [README, hallazgos, tira-contextual, toolbox-dock, atajos]
---
# Revisión de localización y accesibilidad

Que un control exista en código no basta: si la persona lo busca y no aparece donde lo espera, se frustra. Esta hoja es para revisar **en el sandbox** (`npm run dev:sandbox`, puerto 5183; nunca la app real). Solo cubre los controles clave de cada herramienta; el inventario completo está en el [índice](README.md). Una revisión no autoriza cambiar nada.

**Casillas** (tres por control, en este orden): `[ ] lo encuentro sin atajos` · `[ ] aparece cuando lo necesito` · `[ ] está donde lo buscaría`. Anota en «Nota» lo que falle y dónde lo buscabas.

**Dónde puede estar un ajuste.** Tarjeta del dock: Dock › familia › chevron «Show tool settings» (`ToolDock.tsx:120,124`, `ToolSettings` con `card`, `ToolDock.tsx:134`). Panel lateral: pestaña **Tool** (`LayersPanel.tsx:260,265`) con los mismos `ToolSettings` sin `compact`. **Properties** (`LayersPanel.tsx:269`): ajustes de la capa elegida, no de la herramienta. Tira contextual (`ContextStrip`): solo dentro de la tarjeta Edit (ver S1).

**Atajos de herramienta** (`shortcuts.ts:4`): V Edit, H Pan, M Select, I Eyedropper, B Brush, G Fill, U Gradient, P Lineart, E Eraser, R Rect, O Ellipse, L Line, T Text, K Ruler. Sin tecla: Pencil, Airbrush, Curve, Polygon, Star, Sector/Arc/Chord, Arrow, Lasso y Wand como variante, Guides y Sizes.

## Pasos de prueba para los casos ya sospechosos

- **P1. Tecla con la tarjeta abierta (S1).** Abre la tarjeta Edit (familia Edit › Edit › chevron). Pulsa R, luego O, L y M. Mira: ¿la barra de variantes marca la herramienta nueva? ¿la tarjeta enseña los ajustes de Rectangle/Ellipse/Line/Select o los de Edit? Repite con la tarjeta de Brush abierta y pulsa M, G, E. Repite cerrando antes la tarjeta.
- **P2. Misma familia, clic frente a tecla.** Clic en la variante Rectangle y pulsa O; luego pulsa O sin haber hecho clic antes. ¿Cambia el resultado?
- **P3. Peso de texto.** Herramienta Text (T) › Weight: anota el rango (100-900). Crea un texto, abre Properties › Weight: anota el rango (300-900). Intenta poner 100 o 200 en el texto ya creado y editar Line y Spacing de ese texto en cualquier sitio.
- **P4. Controles que dependen de otro.** Brush: Texture strength solo con textura distinta de None; Speed influence solo con Simulate pressure; Min size/density con sus interruptores. Gradient: Second solo con To = Second color. Lineart: Influence solo en modo Edit. Anota si entendiste por qué faltaba cada uno antes de activarlo.
- **P5. Forma elegida: tira frente a Tool.** Dibuja un rectángulo, elígelo con Edit. Busca Join, Cap, Dashes, Dash offset, Stroke behind fill: ¿en la tira? ¿en Properties? ¿en la pestaña Tool? Con la forma elegida, busca Object/Layer y Auto-select.
- **P6. Bloqueos.** Selecciona una capa bloqueada, oculta, de texto y de imagen protegida y mira Eraser, Text y Edit en el dock: ¿se ve el motivo en el botón o solo está apagado? (`ToolDock.tsx:117` pasa `disabled`; el motivo sale de `rules.ts:50`.)
- **P7. Otro camino al mismo ajuste.** Cambia Fill/Stroke de una forma desde Properties y desde la tira; cambia el tamaño del pincel desde la tarjeta y desde la pestaña Tool: ¿mismo nombre y mismo sitio?
- **P8. Sin ratón ni gestos.** Sin usar rueda, doble clic ni clic derecho: zoom al 200 %, ajustar a pantalla, editar un FX, borrar una guía.

## Brush, Pencil, Airbrush (familia Brush; B)

Montaje: la tarjeta aparece con `BrushSettings card` (`ToolSettings.tsx:266`); el panel Tool usa la rama sin `card`; la rama `compact` (`BrushSettings.tsx:99`) solo existe para la tira. Pencil y Airbrush son preajustes de dureza de Brush (`ToolDock.tsx:82-83`), no herramientas distintas.

| Control | Dónde hoy | Cuándo | Atajo / oculto | Nombres | Casillas |
| --- | --- | --- | --- | --- | --- |
| Size | Cabecera de la tarjeta (`BrushSettings.tsx:113`); Tool (`:161`) | Tool = brush o eraser | — | «Size» igual en ambos | [ ] [ ] [ ] |
| Opacity | Tarjeta (`:114`); Tool (`:162`); también como alfa dentro del selector Color (`:112`) | idem | El alfa del color es otra puerta al mismo valor | «Opacity» y alfa | [ ] [ ] [ ] |
| Color | Tarjeta, solo icono (`:112`); Tool (`:160`) | Brush y no Eraser (`!erase`) | Solo icono, sin etiqueta visible en la tarjeta | «Color» | [ ] [ ] [ ] |
| Texture | Tarjeta (`:115`); Tool (`:163`) | siempre | Solo icono en la tarjeta | «Texture» | [ ] [ ] [ ] |
| Texture strength | Debajo de Texture (`:122`,`:165`) | solo si Texture ≠ None | Aparece al elegir textura | — | [ ] [ ] [ ] |
| Tip / Hardness / Angle | Pestaña Tip (`:123-124`); Tool (`:175-176`) | pestaña Tip activa en la tarjeta | Pestaña no visible hasta pulsarla | «Tip» frente a variantes Pencil/Airbrush | [ ] [ ] [ ] |
| Stabilize / Smoothing / Taper | Pestaña Stroke (`:131-136`); Tool (`:167-172`) | — | El compacto los manda a la pestaña Tool (`:103`) | — | [ ] [ ] [ ] |
| Pressure → size/density, Min | Pestaña Pressure (`:144-147`); Tool tras «Advanced settings» (`:184-189`) | Pestaña Pressure o interruptor Advanced | En Tool, escondidos tras un interruptor | «Pressure» frente a «Advanced settings» | [ ] [ ] [ ] |
| Blend, Keep opacity | Pestaña Blend (`:150-151`); Tool (`:174`) | Brush, no Eraser | La pestaña Blend no existe en Eraser (`:119`) | — | [ ] [ ] [ ] |
| Mirror, Follow stroke, Simulate pressure | Tarjeta (`:126-140`); Tool (`:178-180`) | Speed influence solo con Simulate pressure (`:141`) | — | — | [ ] [ ] [ ] |

## Eraser (E)

Misma `BrushSettings` con `erase`: sin Color, sin Blend ni Keep opacity. Bloqueada si la capa activa no es raster, está bloqueada, oculta o es imagen protegida (`rules.ts:55-60`).

| Control | Dónde hoy | Cuándo | Atajo / oculto | Nombres | Casillas |
| --- | --- | --- | --- | --- | --- |
| Size, Opacity, Texture, Tip, Stabilize, Pressure | Como Brush (arriba) | Tool = eraser | — | Igual que Brush | [ ] [ ] [ ] |
| Motivo del bloqueo | Solo `disabled` en el botón (`ToolDock.tsx:117`) | Capa no apta | Motivo no visible en el botón | — | [ ] [ ] [ ] |
| Follow stroke ruler | Tira (`ContextStrip.tsx:109`) | Eraser/Brush con guía de Ruler | Código muerto por lectura (S2); real: tarjeta Ruler | «Follow stroke ruler» frente a «Snap brush to ruler» | [ ] [ ] [ ] |

## Fill (G) y Gradient (U)

| Control | Dónde hoy | Cuándo | Atajo / oculto | Nombres | Casillas |
| --- | --- | --- | --- | --- | --- |
| Fill: Color, Opacity, Threshold | Tarjeta/Tool (`ToolSettings.tsx:256-258`) | Tool = fill | — | Color es el mismo `brush.color` que Brush | [ ] [ ] [ ] |
| Fill: Expand, Smooth, Contiguous… | Tarjeta/Tool (`:260-261`) | Solo sin `compact` (`:259`) | No existen en la tira | — | [ ] [ ] [ ] |
| Gradient: Shape, Color, To | Tarjeta/Tool (`:239-241`) | Tool = gradient | «To» pide el segundo extremo | «To» (propuesto «End», C13) | [ ] [ ] [ ] |
| Gradient: Second | (`:242`) | Solo con To = Second color | Aparece al cambiar To | — | [ ] [ ] [ ] |
| Gradient: Reverse, Opacity | (`:245,247`) | Tool = gradient | — | — | [ ] [ ] [ ] |
| Destino «new layer» | Tira (`ContextStrip.tsx:36`) | Solo en Edit card (S2) | Sin aviso en pantalla de que crea capa nueva | — | [ ] [ ] [ ] |

## Lineart / Pen (P) y Curve

Familia Pen: Lineart y Curve; Bezier pen y Cutter son «soon».

| Control | Dónde hoy | Cuándo | Atajo / oculto | Nombres | Casillas |
| --- | --- | --- | --- | --- | --- |
| Mode Draw / Edit | Tarjeta/Tool (`ToolSettings.tsx:264`) | Tool = lineart | — | «Edit» aquí no es la herramienta Edit | [ ] [ ] [ ] |
| Influence | (`:265`) | Solo Lineart en modo Edit | Aparece al cambiar a Edit | Igual que en la barra Edit (`:250`) | [ ] [ ] [ ] |
| Estilo de trazo (grosor, textura) | (`:265`) y Properties (`LayersPanel.tsx:289`) | Con un trazo elegido (`selectedCurve`) | Dos sitios: herramienta y Properties | Mismo `StrokeStyleFields` | [ ] [ ] [ ] |
| Curve: Bend | (`:273`) | Tool = curve | Sin atajo para Curve | — | [ ] [ ] [ ] |
| Alt+arrastrar para curvar un trazo | Lienzo | Lineart | Solo atajo/gesto (`shortcuts.ts:66`) | — | [ ] [ ] [ ] |

## Ruler (K)

| Control | Dónde hoy | Cuándo | Atajo / oculto | Nombres | Casillas |
| --- | --- | --- | --- | --- | --- |
| Tipo Straight / Ellipse / Perspective | Variantes de la familia (`toolboxModel.ts:31`) y selector en la tarjeta (`StrokeRulerOverlay.tsx:58`) | Tool = ruler | K abre la última | Dos controles para lo mismo | [ ] [ ] [ ] |
| Vanishing points | Tarjeta (`:59`) | Perspective y guía ya colocada | No hace nada sin guía | — | [ ] [ ] [ ] |
| Snap brush to ruler / Clear ruler | Tarjeta (`:60-61`) | Tool = ruler | — | Duplicado «Follow stroke ruler» | [ ] [ ] [ ] |

## Text (T)

| Control | Dónde hoy | Cuándo | Atajo / oculto | Nombres | Casillas |
| --- | --- | --- | --- | --- | --- |
| Font, Size, Weight, Color, Align (próximo texto) | Tarjeta/Tool (`ToolSettings.tsx:200-204`) | Tool = text | Weight 100-900 | Properties los llama «Text color», «Alignment» | [ ] [ ] [ ] |
| Line, Spacing | (`:206-207`) | Solo sin `compact` (`:205`) | Un texto ya creado no los edita en ningún sitio | — | [ ] [ ] [ ] |
| Texto de una capa existente | Properties (`LayersPanel.tsx:276-281`) | Capa de texto elegida; Weight 300-900 | Tira de texto no se monta (S2) | Size 4-1000 frente a 1-500 | [ ] [ ] [ ] |
| Destino «New text» / «(selected)» | Tira (`ContextStrip.tsx:37`) | Solo Edit card | — | — | [ ] [ ] [ ] |

## Formas: Rect (R), Ellipse (O), Line (L), Polygon, Star, Sector/Arc/Chord, Arrow

Todas en la familia Edit, junto a Edit y Pan (`toolboxModel.ts:25`). Ajustes: `ToolSettings.tsx:267-274`.

| Control | Dónde hoy | Cuándo | Atajo / oculto | Nombres | Casillas |
| --- | --- | --- | --- | --- | --- |
| Fill | Tarjeta/Tool (`:267`) | No en line, curve ni arrow | — | Properties: «Fill»; tira: swatch con degradados | [ ] [ ] [ ] |
| Stroke, Width | (`:268-269`) | Formas | — | «Width» frente a «Stroke width» (Properties) | [ ] [ ] [ ] |
| Ellipse: tipo (Sector/Arc/Chord), Start, End | (`:270`, `ShapeKindFields.tsx:23`) | Ellipse y sus variantes | Sector/Arc/Chord no tienen botón: tipo dentro de Ellipse | Ayuda dice «From/To» (`ToolHelp.tsx:26`) | [ ] [ ] [ ] |
| Polygon / Star: Corners, Spoke ratio, Rounded | (`:271`, `ShapeKindFields.tsx:35-36`) | Un botón «Polygon / Star» | Star sin botón propio | Ayuda dice «Sides, Inner» | [ ] [ ] [ ] |
| Line: Arrow | (`:272`, `ShapeKindFields.tsx:43`) | Tool = line | Arrow sin botón propio | — | [ ] [ ] [ ] |
| Join, Cap, Dashes, Miter, Stroke behind fill | Tarjeta/Tool vía `ShapeLookFields` (`:274`) | Solo sin `compact` | Con la forma elegida solo en Properties | — | [ ] [ ] [ ] |
| Edit shape / nodos | Doble clic o botón en la tira (`ContextStrip.tsx:105`) | Forma elegida con Edit | Doble clic (`shortcuts.ts:67`) | — | [ ] [ ] [ ] |

## Select pixels (M), Lasso, Wand; Move/Edit (V); Eyedropper (I); Hand (H)

| Control | Dónde hoy | Cuándo | Atajo / oculto | Nombres | Casillas |
| --- | --- | --- | --- | --- | --- |
| Select: Shape (Rectangle/Lasso/Magic wand) | Variantes de la familia Brush (`toolboxModel.ts:28`) y selector (`ToolSettings.tsx:167`) | Tool = select | Select vive en la familia **Brush** | Dos sitios | [ ] [ ] [ ] |
| Wand: Tolerance, Expand, Smooth, Mode, Sample | (`:169-173`) | Solo con Shape = Wand | Aparecen al cambiar a Wand | «Smooth/Expand» repetidos en Fill | [ ] [ ] [ ] |
| Grow / shrink, Deselect, Invert | (`:184`); Ctrl+D, Ctrl+Shift+I | Con selección activa (`:146`) | Solo Ctrl+D/Ctrl+Shift+I en teclado | Chip «Deselect» en barra superior | [ ] [ ] [ ] |
| Edit: Object/Layer, Auto-select | Tool (`ToolSettings.tsx:250`) | Tool = move; con forma elegida no están en la tira | Sustituidos por la tira (P5) | — | [ ] [ ] [ ] |
| Edit: Transform, Align, Distribute | Tarjeta Edit (`EditCard.tsx:38-40`) | Transform: 1 objeto; Align: ≥1 | Transform en tres sitios | — | [ ] [ ] [ ] |
| Eyedropper: Picked | (`:234`) | Tool = eyedropper | Alt+clic con Brush/Fill (`shortcuts.ts:54`) | — | [ ] [ ] [ ] |
| Hand | Variante Pan | Siempre | H, Espacio, rueda, botón central; sin tarjeta (`LayersPanel.tsx:265`) | «Pan» frente a «Hand» | [ ] [ ] [ ] |

## Guides, Canvas size, FX, Capas, Navegación

| Control | Dónde hoy | Cuándo | Atajo / oculto | Nombres | Casillas |
| --- | --- | --- | --- | --- | --- |
| Guides: Snap to guides, Clear all | Familia **Layout** › Guides (`ToolDock.tsx:135-136`) | Variante Guides abierta | Sin atajo; Shift+R solo alterna reglas | Snap duplicado en Edit › Snap | [ ] [ ] [ ] |
| Canvas size (Sizes) | Familia Layout › Sizes (`ToolDock.tsx:135`) | Variante Sizes abierta | Ancla solo con `aria-label` (`CanvasSize.tsx:73`) | «Sizes» frente a «Canvas size» | [ ] [ ] [ ] |
| FX: añadir | Menú FX en cabecera de capas (`LayersPanel.tsx:238`) | Panel de capas visible | Fuera del dock | — | [ ] [ ] [ ] |
| FX: editar | Properties (`LayersPanel.tsx:272`); doble clic en la fila (`:208`) | FX elegida | Doble clic sin botón | — | [ ] [ ] [ ] |
| Capa: Opacity, Blend | Cabecera de capas (`LayersPanel.tsx:183-184`) | Hay capa activa | — | Distinto del Opacity de la herramienta | [ ] [ ] [ ] |
| Capa: Delete, Merge down (Ctrl+E), Duplicate | Barra de capas (`LayersPanel.tsx:240,244`; Merge down en More, `:248`) | Hay capa | Ctrl+E fuera de Settings → Shortcuts | — | [ ] [ ] [ ] |
| Mostrar/ocultar panel derecho | Botón Layers del dock (`ToolDock.tsx:156`); barra superior | — | Dos botones | «Show or hide right panel» frente a «Collapse layers panel» | [ ] [ ] [ ] |
| Zoom in/out, %, Fit | Barra vertical Canvas view (`DesignerWorkspace.tsx:132-145`) | Hay documento | Sin teclas; Ctrl+rueda | — | [ ] [ ] [ ] |

## Sospechas por lectura

Estados: **respondido por lectura**, **requiere prueba**, **requiere decisión**. No se propone solución.

| # | Sospecha | Evidencia | Estado |
| --- | --- | --- | --- |
| S1 | Pulsar R, O, L o M con una tarjeta abierta puede dejar visible la tarjeta de la variante anterior (p. ej. Edit) con otra herramienta activa. El reductor solo borra `variantId` al cambiar de familia (`toolboxModel.ts:52`); R/O/L están en la misma familia Edit que Edit (`:25`), y M cae en la familia Brush (`:28`). `selectedVariant` prefiere `dockState.variantId` (`ToolDock.tsx:60`); el efecto solo despacha si cambia la familia (`:64-67`). | `ToolDock.tsx:60,64-67`, `toolboxModel.ts:50-52` | requiere prueba (P1, P2) |
| S2 | La tira contextual se monta solo en `EditCard`, que el dock monta solo con la variante Edit (`ToolDock.tsx:133`); sus ramas de texto, Follow stroke ruler, destino de Fill/Gradient y compact de Brush/Eraser no tienen otro montaje. | `EditCard.tsx:37`, `ContextStrip.tsx:78,109` | respondido por lectura; uso real de la rama compact con R/O/L/M requiere prueba (P1) |
| S3 | Weight 100-900 al crear y 300-900 en Properties; Size 1-500 frente a 4-1000; Line y Spacing sin sitio para un texto existente. | `ToolSettings.tsx:201-207`, `LayersPanel.tsx:277` | respondido por lectura; requiere decisión |
| S4 | Select, Lasso, Wand, Fill, Gradient y Eyedropper cuelgan de la familia **Brush**; un usuario que busque «Select» no lo encuentra en Edit. | `toolboxModel.ts:28` | requiere decisión |
| S5 | Sector, Arc, Chord, Star y Arrow no tienen botón: se eligen dentro de los ajustes de Ellipse, Polygon y Line, y su ayuda usa nombres que no coinciden. | `toolboxModel.ts:25`, `ToolHelp.tsx:24-26` | respondido por lectura; requiere prueba de si se encuentran |
| S6 | Join, Cap, Dashes, Dash offset, Stroke behind fill de una forma elegida no están en la tira (`compact`); solo en Properties. | `ShapeLookFields.tsx:34` | respondido por lectura; requiere prueba (P5) |
| S7 | Botones de herramienta bloqueados sin motivo visible. | `ToolDock.tsx:117`, `rules.ts:50` | respondido por lectura; requiere decisión (P6) |
| S8 | Controles que dependen de otro (Texture strength, Second, Influence, Speed influence, Vanishing points) aparecen/desaparecen sin pista. | `BrushSettings.tsx:122,141`, `ToolSettings.tsx:242,265` | requiere prueba (P4) |
| S9 | Zoom sin atajos; FX se edita con doble clic; Ctrl+E y Ctrl+Y fuera de la lista de atajos. | `designerKeys.ts:51`, `shortcuts.ts:49`, `LayersPanel.tsx:208` | respondido por lectura; requiere decisión (P8) |
| S10 | Edit con forma elegida: la tira sustituye a los ajustes de Edit y Object/Layer y Auto-select quedan solo en Tool. | `ContextStrip.tsx:107`, `EditCard.tsx:35` | respondido por lectura; requiere prueba (P5) |

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

## Visto en sandbox

Prueba del 2026-10-29 en `npm run dev:sandbox` (puerto 5183, `.sandbox/data`) con `agent-browser`, documento Square 1:1 con dos rectángulos y una capa de texto. Capturas en `.sandbox/capturas/` (ignorado por git). Resultado: **visto** (como decía la lectura), **no visto** o **distinto** (la pantalla no coincide con la lectura).

| Caso | Resultado | Qué se ve | Captura |
| --- | --- | --- | --- |
| P1 / S1, familia Edit con la variante Edit pulsada | **visto** | Con la tarjeta Edit abierta, R, O y L cambian de herramienta pero la tarjeta sigue llamándose «Edit settings», contiene la tarjeta Edit con una tira compacta («Rectangle», Fill, Stroke, Width, Rx, Ry, Sharp corners, Settings…) y ninguna variante queda marcada (solo el botón de familia). M cierra la tarjeta y pasa a la familia Brush | `s1-edit-variant-open.png`, `s1-after-r.png`, `s1-after-o.png`, `s1-after-l.png`, `s1-after-m.png` |
| P1, abriendo la tarjeta desde el botón de familia | **distinto** | Con la tarjeta Edit abierta desde el botón de familia (sin pulsar la variante), R, O y L sí muestran su propia tarjeta («Rectangle settings»…) y marcan su variante | `p1-edit-open.png`, `p1-key-r.png`, `p1-key-o.png`, `p1-key-l.png`, `p1-key-m.png` |
| P1 / S1, familia Brush abierta, teclas M, G | **visto** | La herramienta cambia (Fill, selección) y la tarjeta muestra los ajustes de Fill, pero se sigue llamando «Brush settings» y ninguna variante queda marcada. E se ignora sin aviso con una capa de texto activa | `p1-brush-open.png`, `p1b-key-m.png`, `p1b-key-g.png`, `p1b-key-e.png` |
| P2, clic en variante y luego O | **visto** | Con la variante pulsada la tarjeta no sigue a la tecla (ver S1); con la tarjeta cerrada la tecla solo cambia la herramienta | `p2-click-rect-then-o.png`, `p2-key-o.png` |
| P3 / S3, texto: pesos | **visto** | Herramienta Text: Weight ofrece 100 a 900; Properties de una capa de texto: 300 a 900 | `s3-weight-tool-options.png`, `s3-properties-text-layer.png` |
| P3 / S3, Line y Spacing | **visto** | La tarjeta de Text los tiene (Line, Spacing); Properties de un texto ya creado muestra X, Y, W, H, Text, Font, Size, Weight, Text color, Alignment: sin Line ni Spacing. Con Edit y una capa de texto activa la tarjeta no trae campos de texto | `s3-text-tool-card.png`, `s3-properties-text-layer.png`, `s3-edit-with-text-layer.png` |
| S3, rangos de Size (1-500 frente a 4-1000) | **no visto** | No se leyeron los límites en pantalla; queda como respondido por lectura | — |
| P4, dependencias | **visto** | Brush: Texture strength aparece al elegir Paper. Lineart: Influence solo en modo Edit; en Draw solo se ve «Mode Draw». Gradient: Second visible con To = Second color (no se probó Transparent). Sin pista previa de por qué faltaban | `p4-brush-card.png`, `p4-brush-texture-strength.png`, `p4-lineart-draw.png`, `p4-lineart-edit-influence.png`, `p4-gradient-card.png` |
| P5 / S10, forma elegida con Edit | **visto** | Con una forma elegida la tarjeta Edit muestra la tira («Edit → Rectangle 2», Fill, Stroke, Blur, Edit shape, Settings…) y Align; no aparecen Object/Layer ni Auto-select (sí sin forma elegida) | `s10-edit-shape-picked.png` |
| S10, extra | **distinto** | Con una capa de texto activa y una forma de otra capa aún elegida, la tarjeta dice «Edit → Text 3» pero enseña los controles de la forma («On 1 object of Rectangle 2») | `s3-edit-with-text-layer.png` |
| P5 / S6, Join, Cap, Dashes, Stroke behind fill | **visto** | Tira de forma elegida: ninguno. Properties: están, pero el panel muestra unas cuatro filas a la vez y hay que desplazarse. Al crear con la tarjeta Rectangle (variante pulsada) sí están todos; con la tira compacta dentro de Edit no | `s6-properties-picked-shape.png`, `p1-key-r.png`, `s1-after-r.png` |
| S5, formas sin botón propio | **visto** | La fila Edit muestra solo Edit, Pan, Rectangle, Ellipse, Line y Polygon/Star; Sector, Arc, Chord, Star y Arrow no tienen icono. Las ayudas decían «strip» aunque los ajustes están en la tarjeta (Text: «font, size and colour are in the strip»; Brush: «the layer named in the strip»; Eraser: «size and opacity are in the strip»). Los nombres de ayuda frente a campos (Sides/Corners, From/To) no se comprobaron en pantalla | `p1-key-r.png`, `s3-text-tool-card.png`, `p4-brush-card.png`, `p6-eraser-on-text-layer.png` |
| P6 / S7, bloqueos | **distinto** | Con una capa de texto activa la variante Eraser aparece deshabilitada y su motivo sale en un tooltip al pasar el puntero («"Text 3" is a text layer. Erasing only works on raster layers.»); el botón de familia sigue activo y la tecla E no hace nada ni avisa | `p6-eraser-on-text-layer.png` |
| P7, mismo ajuste en dos sitios | **visto** | Tamaño y opacidad del pincel: en la tarjeta solo icono y número; en la pestaña Tool con etiqueta y entre más ajustes, en un panel de unas cuatro filas con desplazamiento. Fill/Stroke de forma: mismos nombres en tira y Properties | `p7-brush-tool-tab.png` |
| P8, sin gestos | **visto** | Zoom: campo de porcentaje y botones Zoom in/out/Fit canvas visibles (200 % tecleado y Fit a 41 %). Guides: dentro de Layout › Guides, con la fila de la tarjeta cortada (Orientation, «Clear all guides» recortados). Editar un FX por doble clic: no probado; el menú «Filters and effects» sí se abre | `p8-zoom-200.png`, `p8-guides-card.png`, `p8-fx-menu.png` |
| Dock, cosas vistas de paso | **visto** | La fila de variantes se solapa con el botón «Conversation»; Sculpt y Blur («soon») se pintan con un icono «?»; los iconos de variante no llevan etiqueta visible (solo tooltip) | `p1b-key-m.png`, `p4-brush-card.png` |

Prioridad indicada por el usuario: S3 grave (confirmado: el peso cambia de rango y Line/Spacing no tienen sitio en un texto existente); nombres de ayuda que no coinciden, importante; S6 clave, porque el subtoolbox debía evitarlo (confirmado: la tira de forma no los trae); todo debe estar accesible y agrupado como esperaría un usuario. Sin rediseños ni decisiones; estados de las sospechas: S1, S3, S6, S10 pasan a «visto en sandbox, requiere decisión»; S5 y S7 quedan «requiere decisión» con las salvedades de la tabla.

## Investigaciones previas

Fechas del documento o de su commit. «Usuario» = lo dice el documento como decisión o aprobación suya; «agente» = propuesta sin aprobación localizada.

| Ruta | Fecha | Qué decide o recomienda | Origen |
| --- | --- | --- | --- |
| [propuesta-gui-pintura.md](../propuesta-gui-pintura.md) | 2026-10-10 | Paleta agrupada por familias, barra de estado que enseña la herramienta y sus modificadores; superada el mismo día por plan-designer-ux. Cita del usuario: todo accesible, lo no descubierto se aprende al usar (SketchUp, ibisPaint, Feather 3D) | principios del usuario; el resto, agente |
| [plan-designer-ux.md](../plan-designer-ux.md) | 2026-10-10 | Paso 1: franja contextual con los controles esenciales y destino visible; paso 4: herramientas por familia, Relleno y degradado en un grupo, Regla y cuentagotas visibles. Principio: lugares estables, contenido contextual, acceso reconocible | el usuario aprobó el plan; el reparto concreto, agente |
| [propuesta-toolbox-dock.md](../propuesta-toolbox-dock.md) | 2026-10-23 | Barra contextual única que sustituye a ContextStrip; texto o forma seleccionada mantienen lo de `ContextStrip.tsx:72-80`; ▲ abre el panel completo con `ToolSettings` (extender a formas y texto). Descarta el contador n/m (usuario). Sin implementar | simpleza del usuario; diseño, agente |
| [plan-toolbox-dock.md](../plan-toolbox-dock.md) | 2026-10-23 | Drawing: familia **Color** = Fill, Gradient, Magic wand, Lasso, Rect; Design: familia Shapes con las 9 formas; Pen y Layout. Referencias Photoshop, Illustrator, Affinity, SAI 2, Krita. Aprobado por el usuario: dock real, variantes y selector de modo; pidió no hacer pasadas 2/3 ni rediseños | usuario (dock, variantes, modo); agrupación por familias, agente |
| [mockups/designer-ajustes/](../mockups/designer-ajustes/index.html) | 2026-10-28 | Maquetas A1-G (orden del pincel, selección, guías, alinear, gradiente «End», navegador, variantes); no dibujan texto ni los controles de forma de S6 | agente; propuesta abierta |
| [designer-controles/huecos.md](huecos.md) y [README.md](README.md) | 2026-10-28 | Qué pierden las maquetas y decisiones abiertas | agente |
| [rastreo/designer.md](../rastreo/designer.md) | 2026-10-28 | Estado de cada hallazgo (3.7 pesos de texto, 2.6 tira muerta) | agente |
| `git log` b258f6e, 1c2b24f, f11a0dd, d057856 | 2026-10-23 | b258f6e: las formas viven en la fila Edit, sin familia Shapes; 1c2b24f: una caja de herramientas para ambos modos «en el orden de la maqueta»; f11a0dd: ContextStrip se queda porque «aún tiene los controles de forma/texto/nodos que el dock no tiene» | commits del agente en la rama de implementación |

Sobre los cuatro asuntos, lo localizado:

- **Select/Lasso/Wand/Fill/Gradient/Eyedropper en Brush** (`toolboxModel.ts:28`): el plan proponía una familia **Color** (Fill, Gradient, Wand, Lasso, Rect) separada de Brush; el código final los reúne en Brush. No encontré decisión del usuario sobre ese reparto; solo aprobó el dock y las variantes. Estado: requiere decisión.
- **Texto, herramienta frente a Properties**: propuesta-toolbox-dock.md quiere extender el panel completo al texto y conservar la rama de texto de la tira; la tira de texto no se monta hoy (S2). No hay decisión sobre los rangos 100-900 / 300-900 ni sobre Line/Spacing. Estado: requiere decisión.
- **Join, Cap, Dashes, Stroke behind fill**: ninguna investigación los trata; f11a0dd dice que la tira conserva los controles de forma, pero no los cuatro. Estado: requiere decisión.
- **Formas sin botón propio**: b258f6e las puso en la fila Edit; plan-toolbox-dock.md proponía Shapes con las 9 formas. No hay decisión sobre Sector/Arc/Chord/Star/Arrow. Estado: requiere decisión.

No hay informes de subagentes anteriores sobre este tema en `/tmp/claude-1000/*/` (solo copias de maquetas y scripts de otras sesiones). No se hallaron documentos de quant-ux ni pencil sobre la disposición; los de Krita, SAI, Photoshop, Illustrator y Affinity están citados en plan-toolbox-dock.md.

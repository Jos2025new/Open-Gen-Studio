# Inventario de herramientas del Designer

Verificado cruzando dos inventarios independientes contra el código (2026-10-23).

Inventario exacto, sacado del código (2026-10-23, rama `task/workflow-ask-first`), de cada herramienta del Designer y de todos sus ajustes. Las etiquetas de los controles están tal como salen en el código (en inglés). Nada está inventado: lo que no se encontró en el código no figura. «Verificado» aquí significa leído en el código; no se ejecutó la app.

## Índice

Este documento es la primera parte; la segunda es [inventario-herramientas-designer-2.md](inventario-herramientas-designer-2.md).

1. [Cómo leer las tablas](#1-cómo-leer-las-tablas)
2. [Estado compartido y valores por defecto](#2-estado-compartido-y-valores-por-defecto)
3. [Herramientas, una a una](#3-herramientas-una-a-una): Edit, Pan, Select pixels, Eyedropper, Fill, Gradient, Brush, Eraser, Lineart, Ruler, Text, formas (Rectangle, Ellipse, Polygon, Star, Sector, Arc, Chord) y líneas (Line, Curve, Arrow)
4. [Controles que dependen de la selección](inventario-herramientas-designer-2.md#4-controles-que-dependen-de-la-selección) (barra contextual y pestaña Properties), parte 2
5. [Acciones de objeto y de capa](inventario-herramientas-designer-2.md#5-acciones-de-objeto-y-de-capa), parte 2
6. [Atajos de teclado](inventario-herramientas-designer-2.md#6-atajos-de-teclado), parte 2
7. [Controles fuera de ToolSettings](inventario-herramientas-designer-2.md#7-controles-fuera-de-toolsettings), parte 2
8. [Hallazgos](inventario-herramientas-designer-2.md#8-hallazgos), parte 2

## 1. Cómo leer las tablas

Hay tres lugares donde aparecen los ajustes de una herramienta:

- **Compacto**: la barra contextual `ContextStrip` sobre la caja de herramientas (`ContextStrip.tsx:107` llama a `ToolSettings` con `compact`). También la usa el Designer incrustado en Studio, solo para Text y las formas (`EmbeddedDesignerBar.tsx:17,49`).
- **Completo**: la pestaña **Tool** del panel derecho (`LayersPanel.tsx:260-266`), sin `compact`. Es la que abre el botón `Settings…` de la barra.
- **Properties**: la pestaña del panel derecho para la capa seleccionada (parte 2, sección 4).

Columnas: `control` (etiqueta exacta) | `tipo` (slider, select, segmented, toggle, color, button, presets) | `opciones o rango + unidad + paso` | `defecto` | `compacto` (sí/no) | `condición` | `archivo:línea`. Los rangos son `min–max` y el paso es 1 si no se dice otra cosa. Abreviaturas de archivo, todas en `src/components/designer/` salvo que se indique: **TS** `ToolSettings.tsx`, **BS** `BrushSettings.tsx`, **SSF** `StrokeStyleFields.tsx`, **SLF** `ShapeLookFields.tsx`, **SP** `ShapePaint.tsx`, **PF** `PrimFields.tsx`, **CS** `ContextStrip.tsx`, **LP** `LayersPanel.tsx`, **SRO** `StrokeRulerOverlay.tsx`.

Tipos de control de `InlineControls.tsx`: `InlineSlider` (campo-pista con valor editable; rueda del ratón mueve un paso), `InlineToggle` (interruptor), `InlineSelect` (botón que abre lista), `InlineChoice` (opciones lado a lado), `InlineColor` (selector con hex, recientes y guardados).

## 2. Estado compartido y valores por defecto

`DEFAULT_UI` (`src/store/store.ts:233-239`): `tool: 'move'`, `brush: { size: 24, color: '#ffffff', opacity: 1 }`, `lineart: DEFAULT_STROKE_STYLE`, `shape: { fill: '#d4f25a', stroke: null, strokeWidth: 4, radius: 0 }`, `text: DEFAULT_TEXT_STYLE`. El resto de campos de `ui` (`wand`, `gradient`, `lineartMode`, `lineartInfluence`, `selectShape`, `selectMode`, `autoSelect`, `snapByMode`) no tienen valor inicial en el store: los defectos de las tablas son los respaldos del componente que los lee.

Valores compartidos entre herramientas, para no sorprenderse:

- `ui.brush.color` lo usan Brush, Fill (`Color`), Gradient (`Color`), Eyedropper (`Picked`) y el botón `Fill` de Select pixels.
- `ui.brush.opacity` lo usan Brush, Eraser, Fill y el botón `Fill` de Select pixels.
- `ui.lineartInfluence` (defecto 80) lo escriben el `Influence` de Lineart (modo Edit) y el de Edit (TS:249).
- `ui.shape` es único para las diez herramientas de forma y línea; cambiar `Fill` en Rectangle lo cambia en Ellipse.

Valores por defecto de los motores: `BRUSH_DEFAULTS = { hardness: 1, minSize: 0.2, minDensity: 0.2, textureStrength: 0.5 }` (`src/engine/design/brushEngine.ts:64`); `DEFAULT_STROKE_STYLE = { color '#ffffff', size 8, thinning 0.6, smoothing 0.5, streamline 0.5, taperStart 0, taperEnd 0, opacity 1 }` (`src/engine/design/strokes.ts:16`); `DEFAULT_TEXT_STYLE = { fontFamily 'Inter', fontSize 96, fontWeight 700, color '#ffffff', align 'left', lineHeight 1.1, letterSpacing 0 }` (`src/engine/design/doc.ts:25`); `WAND_DEFAULT = { threshold 24, expand 0, smooth 0, mode 'replace', sample 'all' }` (TS:152); gradiente `{ shape 'linear', mode 'two', color2 '#000000', opacity 1 }` (TS:235).

## 3. Herramientas, una a una

Las 21 herramientas son las de `DesignTool` (`src/engine/design/rules.ts:31`). Dónde está cada una en el carril (`ToolRail.tsx:30-36`): familia Edit: `move`, `hand`; Select: `select`; Paint: `brush`, `eraser`, `lineart`, grupo Fill and gradient (`fill`, `gradient`); Shapes and text: grupo Shapes and lines (`rect`, `ellipse`, `polygon`, `star`, `sector`, `arc`, `chord`, `line`, `curve`, `arrow`), `text`; Guides and color: `ruler`, `eyedropper`. Bloqueos (`toolBlockReason`, `rules.ts:50`): `hand`, `select`, `eyedropper`, `gradient` y `brush` nunca se bloquean; `move` se bloquea sin capa activa o con capa bloqueada; `eraser` exige capa raster visible y desbloqueada.

### 3.1 Edit (`move`, tecla V)

Barra «Edit settings» (TS:249). No tiene versión compacta distinta: compacto y completo muestran lo mismo, salvo que la barra contextual lo sustituye cuando hay una forma elegida (parte 2, sección 4).

| control | tipo | opciones | defecto | compacto | condición | archivo:línea |
|---|---|---|---|---|---|---|
| Edit | segmented | `Object` / `Layer` | Object | sí | `Object` se desactiva si la capa activa no tiene trazos o formas editables (`strokeObjectsAvailable`) | TS:62-65 |
| Auto-select | toggle | on/off | off | sí | | TS:69-72 |
| Move selection · drag inside | texto fijo | | | sí | solo con selección de píxeles | TS:249 |
| Snap | button+popover | ver parte 2, sección 7 | | sí (también en el carril junto a Edit) | | `SnapControl.tsx:17` |
| Align | button | abre la pestaña Tool con el panel Align | | sí | deshabilitado si capa bloqueada o nada elegido | TS:126 |
| Transform | button+menú | `Mirror left ↔ right`, `Mirror top ↕ bottom`, `Rotate 90° right`, `Rotate 90° left`, `Rotate 180°` | | sí | deshabilitado si capa bloqueada o nada elegido | TS:39-45,128 |
| Influence | slider | 1–500 px | 80 | sí | escribe `lineartInfluence`; tiene sentido para curvas de Lineart (aparece siempre en Edit) | TS:249 |
| (estilo de curva) | grupo SSF | ver 3.9 | | no | solo en la pestaña Tool: exige `selectedCurve` que sea un trazo de la capa activa, vectorial, visible y desbloqueada; la barra contextual pasa `selectedCurve={null}` | TS:222-229,249; CS:107 |

Además, en la pestaña Tool, con Edit activo, aparece primero la sección **Align** (`LP:261-264`, parte 2, sección 7).

### 3.2 Pan (`hand`, tecla H)

Sin ajustes. `ToolSettings` y `ContextStrip` devuelven `null` (TS:231, CS:59); la pestaña Tool muestra «Pan has no additional settings.» (LP:265).

### 3.3 Select pixels (`select`, tecla M)

Barra «Selection settings» (TS:165). `SelectOps` recibe `compact`.

| control | tipo | opciones | defecto | compacto | condición | archivo:línea |
|---|---|---|---|---|---|---|
| Shape | select | `Rectangle`, `Lasso`, `Magic wand` | Rectangle | sí | | TS:166 |
| Tolerance | slider | 0–255 | 24 | sí | solo con Magic wand | TS:168 |
| Expand | slider | 0–12 px | 0 | sí | solo con Magic wand | TS:169 |
| Smooth | slider | 0–4 px, paso 0.5 | 0 | sí | solo con Magic wand | TS:170 |
| Mode | select | `New`, `Add`, `Subtract` | New | sí | solo con Magic wand (Shift suma y Alt resta con cualquier forma) | TS:171 |
| Sample | select | `Active layer`, `All layers` | All layers | sí | solo con Magic wand | TS:172 |
| Deselect | button | Ctrl+D | | sí | deshabilitado sin selección | TS:176,182 |
| To layer | button | Ctrl+J | | sí | deshabilitado sin selección | TS:177,188 |
| All | button | Ctrl+A | | no | | TS:180 |
| Invert / Inverted | button | Ctrl+Shift+I | | no | el texto cambia a `Inverted` si ya lo está | TS:181 |
| Grow / shrink | slider | 1–50 px | 2 (estado local, no se guarda) | no | | TS:183 |
| Grow | button | | | no | deshabilitado sin selección | TS:184 |
| Shrink | button | | | no | deshabilitado sin selección | TS:185 |
| Delete | button | borra los píxeles elegidos de la capa raster activa | | no | deshabilitado sin selección | TS:186 |
| Fill | button | rellena con el color y la opacidad de Brush, en capa nueva | | no | deshabilitado sin selección | TS:187 |

Con otra herramienta activa y una selección viva, la barra superior muestra el chip `Selection` / `Selection · inverted` con `Deselect` (`SelectionChip`, TS:140-150).

### 3.4 Eyedropper (`eyedropper`, tecla I)

Barra «Eyedropper settings» (TS:233). Compacto igual que completo.

| control | tipo | opciones | defecto | compacto | condición | archivo:línea |
|---|---|---|---|---|---|---|
| Picked | color | hex | `#ffffff` (`brush.color`) | sí | | TS:233 |
| «Click the page to pick its visible color» | texto | | | sí | | TS:233 |

Alt-clic con Brush o Fill también toma color (etiqueta del carril, `ToolRail.tsx:16`).

### 3.5 Fill (`fill`, tecla G)

| control | tipo | opciones | defecto | compacto | condición | archivo:línea |
|---|---|---|---|---|---|---|
| Color | color | hex | `#ffffff` | sí | | TS:255 |
| Opacity | slider | 1–100 %, paso 1 | 100 | sí | | TS:256 |
| Threshold | slider | 0–255 | 24 (respaldo `brush.fillThreshold ?? 24`) | sí | | TS:257 |
| Expand | slider | 0–12 px | 0 | no | | TS:259 |
| Smooth | slider | 0–4 px, paso 0.5 | 0 | no | | TS:260 |

El resultado va siempre a una capa nueva (`editTarget`, CS:36).

### 3.6 Gradient (`gradient`, tecla U)

| control | tipo | opciones | defecto | compacto | condición | archivo:línea |
|---|---|---|---|---|---|---|
| Shape | select | `Linear`, `Radial` | Linear | sí | | TS:238 |
| Color | color | hex | `#ffffff` (`brush.color`) | sí | | TS:239 |
| To | select | `Second color`, `Transparent` | Second color | sí | | TS:240 |
| Second | color | hex | `#000000` | sí | solo si `To` = Second color | TS:241 |
| ⇄ | button | intercambia Color y Second | | no | | TS:243 |
| Reverse | toggle | on/off | off | no | | TS:244 |
| Opacity | slider | 1–100 %, paso 1 | 100 | sí | | TS:246 |

### 3.7 Brush (`brush`, tecla B) y 3.8 Eraser (`eraser`, tecla E)

Mismo componente (`BrushSettings`, `erase` distingue). Primero siempre va `Paint mode` (TS:265).

| control | tipo | opciones | defecto | compacto | condición | archivo:línea |
|---|---|---|---|---|---|---|
| Paint mode | segmented | `Drawing`, `Design` | según el documento (`paintModeOf`) | sí | guarda en el documento, no en `ui` | `PaintModeToggle.tsx:13-16` |
| Stroke preview | canvas (no es control) | | | no | | BS:108 |
| Size presets | presets | 1, 2, 3, 5, 8, 12, 16, 24, 32, 48, 64, 96, 128, 200 px | | no | | BS:77-83; `brushEngine.ts:66` |
| Color | color (en completo, solo icono, con alfa) | hex | `#ffffff` | sí | solo Brush; el Eraser no lo muestra | BS:103,111 |
| Size | slider | 1–240 px | 24 | sí | | BS:102,112 |
| Opacity | slider | 1–100 %, paso 1 | 100 | sí | | BS:104,113 |
| Texture | select (solo icono) | `None`, `Paper`, `Canvas`, `Grain` | None | no | | BS:114; `brushEngine.ts:57` |
| Texture strength | slider | 0–100 %, paso 1 | 0 mostrado; al elegir textura pasa a 50 si estaba en 0 | no | solo si Texture ≠ None | BS:114,116 |
| Taper start | slider | 0–500 px (admite valores mayores al teclear) | 0 | no | | BS:118 |
| Taper end | slider | 0–500 px (admite valores mayores) | 0 | no | | BS:119 |
| Stabilize | slider | 0–10 | 0 | no | | BS:122 |
| Smoothing | slider | 0–10 | 0 | no | | BS:123 |
| Blend | select | `Normal`, `Multiply`, `Screen`, `Overlay`, `Darken`, `Lighten` | Normal | no | solo Brush | BS:125; `brushEngine.ts:56` |
| Tip | choice | `Hard` (1), `Firm` (0.7), `Soft` (0.4), `Airbrush` (0.05) de dureza | Hard | no | sin selección si la dureza es otra | BS:126; `brushEngine.ts:61` |
| Hardness | slider | 0–100 %, paso 1 | 100 | no | | BS:127 |
| Mirror | toggle | refleja cada trazo en el eje vertical central de la página | off | no | | BS:128 |
| Simulate pressure | toggle | presión por velocidad | off | no | | BS:129 |
| Speed influence | slider | 25–200 %, paso 5 | 100 | no | solo con Simulate pressure | BS:130 |
| (aviso de presión) | texto | lo que envió el último trazo | | no | solo sin Simulate pressure | BS:86-92,132 |
| Advanced settings | toggle | muestra/oculta lo siguiente; estado local, se cierra al cambiar de herramienta | off | no | | BS:100,133 |
| Pressure → size | toggle | on/off | on | no | solo con Advanced settings | BS:135 |
| Min size | slider | 0–100 % | 20 | no | Advanced; deshabilitado si Pressure → size está off | BS:136 |
| Pressure → density | toggle | on/off | off | no | solo con Advanced settings | BS:137 |
| Min density | slider | 0–100 % | 20 | no | Advanced; deshabilitado si Pressure → density está off | BS:138 |
| Keep opacity | toggle | pinta solo donde la capa ya tiene píxeles | off | no | Advanced y solo Brush | BS:139 |
| Follow stroke ruler | toggle | | valor de la regla | sí (solo barra contextual) | solo si hay regla en la página | CS:109 |

El comentario del código lo confirma: Smoothing y Stabilize «live in the Tool tab» (BS:105). El texto de la barra contextual dice qué capa se pinta: `Brush → <capa>` o `new layer` (CS:33).

### 3.9 Lineart (`lineart`, tecla P)

| control | tipo | opciones | defecto | compacto | condición | archivo:línea |
|---|---|---|---|---|---|---|
| Mode | select | `Draw`, `Edit` | Draw | sí | | TS:263 |
| Influence | slider | 1–500 px | 80 | sí | solo modo Edit | TS:264 |
| Size | slider | 1–120 px | 8 | sí | | SSF:12 |
| Color | color (con valor) | hex | `#ffffff` | sí | | SSF:13 |
| Opacity | slider | 5–100 % | 100 | sí | | SSF:14 |
| Pressure thinning | slider | −1 a 1, paso 0.01 | 0.6 | sí | | SSF:15 |
| Smoothing | slider | 0–1, paso 0.01 | 0.5 | sí | | SSF:16 |
| Streamline | slider | 0–1, paso 0.01 | 0.5 | sí | | SSF:17 |
| Texture | select | `Solid ink`, `Pencil grain`, `Chalk`, `Dry bristle` | Solid ink | sí | | SSF:18; `brushTextures.ts:29-57` |
| Spacing | slider | 5–100 %, paso 1 | 15 | sí | solo con Texture ≠ Solid ink | SSF:20 |
| Jitter | slider | 0–100 % | 40 | sí | solo con Texture ≠ Solid ink | SSF:21 |
| Seed | número | entero ≥ 0 («Same seed, same grain») | aleatoria al elegir textura | sí | solo con Texture ≠ Solid ink | SSF:22 |
| Taper start | slider | 0–500 px (admite mayores) | 0 | sí | | SSF:24 |
| Taper end | slider | 0–500 px (admite mayores) | 0 | sí | | SSF:25 |

En modo Draw los campos editan `ui.lineart` (el estilo de los trazos nuevos); en modo Edit y con una curva elegida (solo pestaña Tool) editan esa curva (TS:264). Alt+arrastrar dobla un trazo (atajo, sección 6).

### 3.10 Ruler (`ruler`, tecla K)

`RulerSettings` (SRO:53-64), igual en compacto y completo.

| control | tipo | opciones | defecto | compacto | condición | archivo:línea |
|---|---|---|---|---|---|---|
| Ruler | select | `Straight`, `Ellipse`, `Perspective` | Straight | sí | | SRO:58 |
| Vanishing points | select | `One`, `Two` | Two | sí | solo con Perspective; sin efecto si no hay regla colocada | SRO:59 |
| Snap brush to ruler | toggle | los trazos de Brush siguen la guía | off | sí | sin efecto si no hay regla colocada | SRO:60 |
| Clear ruler | button | quita la guía | | sí | deshabilitado sin regla | SRO:61 |
| (texto de ayuda) | texto | cambia con el tipo | | sí | | SRO:62 |

### 3.11 Text (`text`, tecla T)

Campos de `TextStyleFields` (TS:197-209); para el **texto siguiente** actúan sobre `ui.text`.

| control | tipo | opciones | defecto | compacto | condición | archivo:línea |
|---|---|---|---|---|---|---|
| Font | select | `Inter`, `Grotesk`, `Serif`, `Display`, `Condensed`, `Mono` | Inter | sí | | TS:199; `doc.ts:10-17` |
| Size | slider | 1–500 px | 96 | sí | | TS:200 |
| Weight | select | 100, 200, 300, 400, 500, 600, 700, 800, 900 | 700 | sí | | TS:201 |
| Color | color | hex | `#ffffff` | sí | | TS:202 |
| Align | select | `left`, `center`, `right` | left | sí | | TS:203 |
| Line | slider | 0.5–3, paso 0.1 | 1.1 | no | | TS:205 |
| Spacing | slider | −10 a 40 px, paso 0.5 | 0 | no | | TS:206 |
| «For the next text you add. A selected text is changed in Properties.» | texto | | | no | | TS:252 |

### 3.12 Formas y líneas

Las diez comparten `ui.shape` (TS:266-277). Se muestra en la barra «<tool> settings». `Fill` no aparece en Line, Curve ni Arrow.

Controles comunes:

| control | tipo | opciones | defecto | compacto | condición | archivo:línea |
|---|---|---|---|---|---|---|
| Fill / «Fill · none» | color con casilla `No fill` | hex | `#d4f25a` | sí | no en Line, Curve, Arrow | TS:266 |
| Stroke / «Stroke · none» | color con casilla `No stroke` | hex | `#ffffff` al activarlo (el valor inicial es sin trazo: `stroke: null`) | sí | | TS:267 |
| Width | slider | 1–40 px | 4 | sí | | TS:268 |
| Rx | slider | 0 a la mitad de la anchura (200 si no hay forma), paso 0.5, admite mayores | 0 | sí | solo Rectangle | SLF:29 |
| Ry | slider | ídem, para la altura | 0 | sí | solo Rectangle | SLF:30 |
| Sharp corners | button | pone las esquinas rectas | | sí | solo Rectangle; deshabilitado si ya son rectas | SLF:31 |
| Join | choice | `Miter join`, `Round join`, `Bevel join` | round | no | | SLF:35 |
| Miter limit | slider | 1–20, paso 0.5 | 4 (`MITER_DEFAULT`, `shapeLook.ts:16`) | no | solo con Join = miter | SLF:36 |
| Cap | choice | `Butt cap`, `Round cap`, `Square cap` | round | no | | SLF:37 |
| Dashes | select | `Solid`, `Dots` (1 1), `Dashes` (4 2), `Long dashes` (8 4), `Dash dot` (4 2 1 2) | Solid | no | | SLF:15-18,38 |
| Dash offset | slider | 0–20, paso 0.5 | 0 | no | solo con un patrón de trazo | SLF:39 |
| Stroke behind fill | toggle | orden de pintado | off | no | | SLF:40 |

Controles propios de cada herramienta:

| herramienta | control | tipo | rango | defecto | compacto | archivo:línea |
|---|---|---|---|---|---|---|
| Rectangle (R), Ellipse (O) | solo los comunes (Rx, Ry y Sharp corners solo en Rectangle) | | | | | |
| Polygon | Sides | slider | 3–12 | 5 | sí | TS:269 |
| Polygon | Round | slider | 0–100 % | 0 | sí | TS:271 |
| Star | Sides | slider | 3–12 | 5 | sí | TS:269 |
| Star | Inner | slider | 10–100 % | 50 | sí | TS:270 |
| Star | Round | slider | 0–100 % | 0 | sí | TS:271 |
| Sector, Arc, Chord | From | slider | 0–360° | 0 | sí | TS:273 |
| Sector, Arc, Chord | To | slider | 0–360° | 270 | sí | TS:274 |
| Curve | Bend | slider | −100 a 100 % | 30 | sí | TS:276 |
| Line (L), Arrow | solo Stroke, Width y los comunes de trazo | | | | | |

No hay ningún control propio de Arrow en `ToolSettings` (ni de puntas): las puntas (`Start arrow` / `End arrow`) solo existen para una forma ya elegida (parte 2, sección 4.3). `ShapeLookFields` se llama sin `blur` en las herramientas, así que `Blur` no está para la forma siguiente.

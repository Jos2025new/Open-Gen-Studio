# Inventario de herramientas del Designer, parte 2

Continuación de [inventario-herramientas-designer.md](inventario-herramientas-designer.md), que trae el índice completo, cómo leer las tablas (abreviaturas TS, BS, SSF, SLF, SP, PF, CS, LP, SRO) y las tablas de cada herramienta (secciones 1 a 3). Esta parte cubre las secciones 4 a 8. Referencias a «3.x» o «sección 3» apuntan a la primera parte.

## 4. Controles que dependen de la selección

### 4.1 Orden de decisión de la barra contextual (CS:72-107)

1. `tool === 'move'` y varios caminos (path) elegidos, o edición de nodos de varios caminos: grupo «Multiple path nodes».
2. `tool === 'text'` con una capa de texto activa: grupo «Selected text».
3. `tool === 'move'`, modo `Object`, y una sola forma elegida en una capa vectorial desbloqueada: grupo «Selected shape» o «Editing shape».
4. Si no, `ToolSettings` compacto.

Después, siempre que toque: `MultiRectangleRadii` (Edit y ≥ 2 rectángulos), `Follow stroke ruler` (Brush/Eraser con regla) y el botón `Settings…` (abre la pestaña `props` si hay texto o forma elegidos y `tool` si no, CS:110). Al salir de Edit se cierra la edición de forma (CS:58). La etiqueta «<Herramienta> → <capa>» nombra lo que cambiará el siguiente gesto (`editTarget`, CS:31-40).

### 4.2 Texto elegido (CS:78-79)

Los cinco campos compactos de 3.11 (Font, Size, Weight, Color, Align) sobre la capa de texto; no hacen nada si la capa está bloqueada. **Line y Spacing de un texto ya creado no se pueden cambiar** desde esta barra ni desde Properties (hallazgo, sección 8).

### 4.3 Forma elegida (CS:80-106)

Fuera de edición:

| control | tipo | opciones | compacto | condición | archivo:línea |
|---|---|---|---|---|---|
| Shape | button+popover | PF: Sides (3–24), Inner (10–100 %), Round (0–100 %) en Polygon y Star; From, To (0–360°) en Sector, Arc, Chord | sí | solo si la forma es un primitivo | SP:96-104; PF:14-22 |
| Fill | swatch+popover | tipo `Solid` / `Linear gradient` / `Radial gradient`; `Start` / `End` (parada del degradado); color y alfa | sí | | SP:58-78 |
| Stroke | swatch+popover | lo mismo que Fill y además: Width 0–40 px; `Start arrow`, `End arrow` (`None`, `Triangle`, `Open arrow`, `Circle`, `Square`, `Bar`); `Scale stroke` (toggle) | sí | las puntas, solo en `line` y `path`; Scale stroke solo en `path` | SP:82-92 |
| Blur | slider | 0–100 %, paso 0.1 | sí | | SLF:33 |
| Edit shape / Edit nodes | button | entra en edición | sí | solo rect, ellipse y path (el texto dice Edit nodes en path) | CS:105 |

Dentro de edición (`Editing shape` / `Editing nodes`, CS:82-99):

| control | tipo | opciones | condición | archivo:línea |
|---|---|---|---|---|
| W, H | slider | 1 a max(4000, tamaño actual redondeado arriba) px; se puede teclear más; conserva el signo; valor mostrado en valor absoluto con un decimal | siempre | SLF:63-68 |
| Shape | button | como arriba | primitivo | CS:85 |
| Rx, Ry, Sharp corners | slider, slider, button | como 3.12 | solo rect | CS:86 |
| Blur | slider | 0–100 % | siempre | CS:86 |
| Lock radii | toggle | Rx y Ry juntos (`ui.shapeLockRadii`, defecto off) | solo rect | CS:87 |
| Node | choice | `Cusp node (Shift+C)`, `Smooth node (Shift+S)`, `Symmetric node (Shift+Y)` | path con un nodo elegido | CS:88 |
| Break | button | Shift+B | path con ≥ 1 nodo elegido | CS:89 |
| Join / Join with segment | button | Shift+J / Alt+J | path con ≥ 2 nodos | CS:91-92 |
| Delete segment | button | | path con ≥ 2 nodos | CS:93 |
| Make line / Make curve | button | Shift+L / Shift+U | path con ≥ 2 nodos | CS:94-95 |
| Delete node | button | Delete; Ctrl+Delete une los vecinos en recta | path con un nodo elegido | CS:97 |
| Convert to path | button | Object to Path | forma que no es path, o primitivo | CS:98 |
| Done | button | Esc | siempre | CS:99 |

Join, Cap, Dashes, Miter limit y Stroke behind fill **no** están en la barra contextual de una forma elegida (se llama a `ShapeLookFields` con `compact`, CS:86,104); solo en la pestaña Properties.

### 4.4 Varios caminos o varios rectángulos

- Varios caminos: etiqueta `N paths selected` con `Edit nodes`, o `Editing nodes · N paths` con `Done`; texto de ayuda sobre clic, Shift-clic y marquesina (CS:72-77). Teclas del modo (`MultiPathNodes.tsx:24-32`): Esc limpia nodos y luego sale, Ctrl/⌘+A elige todos los nodos, Delete/Backspace no hace nada (para no borrar los objetos).
- Varios rectángulos (Edit, ≥ 2): fila `Rounding · N rectangles` (`· Mixed` si difieren) con `Rx`, `Ry` (0 a media anchura/altura máxima, paso 0.5), `Sharp corners` y `Convert to paths` (`MultiRectangleRadii.tsx:34-42`).

### 4.5 Pestaña Properties (LP:180-304)

Arriba, siempre que haya capa: **Layer appearance** con `Opacity` (0–100 %) y `Blend` (select nativo con 16 modos: normal, multiply, screen, overlay, darken, lighten, color-dodge, color-burn, soft-light, hard-light, difference, exclusion, hue, saturation, color, luminosity; `render.ts:31-47`). Después, en «Layer properties» (se desactiva si la capa está bloqueada):

| bloque | controles | condición | archivo:línea |
|---|---|---|---|
| Geometría | X, Y, W, H en px (escribir o arrastrar la letra, 1 px por píxel de ratón; Shift ×10; W y H mínimo 1, sin máximo) y un candado de proporción (activo al montar solo en raster con imagen de origen; estado local) | capa no fx con contenido; si no, «Draw or place something on this layer to position it.» | `LayerGeometry.tsx:88-96` |
| FX | `FxEditor` (ver sección 7) | capa fx | LP:272 |
| Imagen | `Allow painting on this image` (toggle) | raster con imagen de origen | LP:273 |
| Texto | `Text` (área), `Font`, `Size` (número 4–1000), `Weight` (300–900; sin 100 ni 200), `Text color`, `Alignment` (left/center/right) | capa de texto | LP:274-280 |
| Trazos | SSF completo (3.9) sobre los trazos elegidos, o sobre todos si no hay ninguno elegido | capa vectorial con trazos | LP:281-292 |
| Formas | por cada forma (la elegida, o todas): `Fill`, `Stroke` (color con alfa), `Stroke width` (0–40 px, admite mayores), `Rx`, `Ry`, `Sharp corners` (rect), `Blur`, `Join`, `Miter limit`, `Cap`, `Dashes`, `Dash offset`, `Stroke behind fill` | capa vectorial con formas | LP:293-302 |

Properties **no** incluye los degradados de relleno, las puntas de flecha ni `Shape` (Sides, Inner, Round, From, To) de una forma: esos solo están en la barra contextual (4.3).

## 5. Acciones de objeto y de capa

| acción | dónde vive | notas | archivo:línea |
|---|---|---|---|
| Elegir objetos / capas | modo `Edit` Object o Layer (3.1); clic, Ctrl-clic para más; en la lista de capas Ctrl-clic y Shift-clic (rango) | | TS:62-65; LP:209-216 |
| Align | botón `Align` de la barra o del carril, panel Align en la pestaña Tool | `Relative to` (`Page`, `Selection`, `First selected`, `Last selected`, `Biggest`, `Smallest`), `As group`, diez botones de alineación (cinco por fila: `Align left`, `Center horizontally`, `Align right`, `Align left edge to anchor’s right edge`, `Align right edge to anchor’s left edge`, y los cuatro análogos verticales con `Align top`, `Center vertically`, `Align bottom`; los cuatro de borde a ancla exigen ≥ 2 elementos y un ancla distinto de Page/Selection) y dos de reparto | `AlignControls.tsx:10-73` |
| Distribute | `Even horizontal gaps`, `Even vertical gaps` | necesita ≥ 3 elementos (AlignControls:46-47,66-67) | `AlignControls.tsx:65-68` |
| Fit inside page, Fill page | panel Align | una sola capa raster | `AlignControls.tsx:69-72`; TS:120-121 |
| Transform | menú `Transform` (3.1) y también en la barra superior (`turnOnly`) | actúa sobre objetos o capas elegidos | TS:128; `DesignerWorkspace.tsx:96` |
| New layer | `+` de la lista | `Raster`, `Vector`, `Text` | LP:230-237 |
| FX layer | menú `FxMenu` | | LP:238 |
| Duplicate layer | botón | | LP:240 |
| Operations | botón (solo raster) | operaciones de imagen: la capa resultante va encima | LP:241,305-307 |
| Move layer up / down | botones, o arrastrar la fila | las bloqueadas no se mueven | LP:242-243 |
| Delete layer / Delete N layers | botón | deshabilitado si todas están bloqueadas | LP:244 |
| More layer actions | menú | `Merge down` (Ctrl+E), `Rasterize layer` (no raster ni fx), `Group layers` (Ctrl+G, ≥ 2) / `Ungroup this folder`, `Restore panel layout` | LP:245-255 |
| Mostrar/ocultar, bloquear | iconos por fila y por carpeta | | LP:224-225,80-81 |
| Renombrar | doble clic en el nombre | Enter acepta, Esc cancela | LP:60-66 |
| Carpeta | colapsar, seleccionar, ojo, candado | | LP:69-83 |
| Convert to path, Edit shape | barra contextual (4.3) | | CS:98,105 |

## 6. Atajos de teclado

Fuentes: `src/engine/shortcuts.ts` (lista que ve Settings → Shortcuts) y `src/components/designer/designerKeys.ts`.

**Herramientas** (`DESIGN_TOOL_KEYS`, `shortcuts.ts:4`): V Edit, H Pan, M Select pixels, I Eyedropper, B Brush, G Fill, U Gradient, P Lineart, E Eraser, R Rectangle, O Ellipse, L Line, T Text, K Ruler. **Sin tecla**: Polygon, Star, Sector, Arc, Chord, Curve, Arrow. Las etiquetas del carril indican la tecla entre paréntesis, por ejemplo `(V)` (`ToolRail.tsx:14-21`); en los menús de formas solo Rectangle (R), Ellipse (O) y Line (L) la muestran (`ToolRail.tsx:41,44`).

**Globales del Designer** (`designerKeys.ts`):

| teclas | acción | línea |
|---|---|---|
| Ctrl/⌘+S | guardar ahora | 32 |
| Ctrl+Z | deshacer | 37-40 |
| Ctrl+Shift+Z, Ctrl+Y | rehacer | 37-40 |
| Shift+R | mostrar/ocultar reglas y guías (no en el Designer incrustado) | 41-43 |
| Ctrl+G | agrupar las capas elegidas (avisa si hay menos de dos) | 44-49 |
| Ctrl+E | fusionar la capa activa hacia abajo | 50-53 |
| Ctrl+A / Ctrl+D | seleccionar todo / deseleccionar píxeles | 54-60 |
| Ctrl+Shift+I | invertir la selección | 54-60 |
| Ctrl+J | píxeles elegidos a capa nueva | 54-61 |
| Delete / Backspace | con un nodo elegido: borra el nodo (Ctrl: une en recta); con selección de píxeles: borra sus píxeles; con objetos elegidos: borra solo esos | 62-77 |
| Ctrl+X | con selección de píxeles o con objetos elegidos, ver arriba | 66,72 |
| Flechas | mueven los objetos elegidos 1 px (Shift: 10 px); sin objetos, desplazan la vista | 78-86 |
| Delete / Backspace (sin nada más) | intención: borrar las capas elegidas (las bloqueadas se quedan); **inalcanzable por lectura**, ver hallazgo 6 | 87-92 |
| Teclas de herramienta | intención: cambiar de herramienta si no está bloqueada; **inalcanzable por lectura**, ver hallazgo 6 | 93-96 |

Los atajos se ignoran con foco en un campo de texto o con un popover o lightbox abierto (línea 33).

**Edición de nodos** (`PathNodes.tsx:33-72`, `shortcuts.ts:67-77`): Shift+C / Shift+S / Shift+Y tipo de nodo; Shift+L / Shift+U segmentos a línea / curva; Shift+J y Alt+J unir; Shift+B romper; Ctrl/⌘+A todos los nodos; flechas 2 px del documento (Shift 20 px; Alt 1 px de pantalla, Alt+Shift 10 px de pantalla); Esc limpia nodos y luego sale; Delete / Ctrl+Delete. Shift-clic alterna un nodo; Shift-arrastre añade con marquesina; Ctrl-arrastre selecciona fuera; Ctrl+Shift-arrastre quita dentro.

**Otros** (`shortcuts.ts:54-72`): Espacio (mantener) desplaza (`Stage.tsx:571`); Alt-clic con Brush o Fill toma color; Alt al mover, sin imán; Alt+arrastrar con Lineart dobla un trazo; Shift al arrastrar Gradient, Line, Curve o Arrow fija la dirección en pasos de 45° y, en las otras formas, hace la caja cuadrada (`Stage.tsx:1091-1121`); doble clic en Edit edita los tiradores de una forma o los nodos de un path; Ctrl+arrastrar un tirador de esquina mueve Rx y Ry juntos; Mod+C / Mod+V copian los píxeles de la capa y pegan imágenes.

## 7. Controles fuera de ToolSettings

- **Snap** (`SnapControl.tsx`): botón imán con popover. Casillas: `Snap while moving`, y debajo (desactivadas si lo anterior está off) `Page edges and center`, `Other layers`, `Guides`, `Equal spacing`, `Path nodes`; texto «Hold Alt while dragging to move freely.» La tolerancia de imán es fija, 10 px de pantalla (`snap.ts:25`). Se guarda por modo de pintura (`ui.snapByMode`): en `design` el defecto es todo activado; en `drawing`, `on` es falso y el resto activado (`snap.ts:15-18`). Aparece en la barra de Edit y en el carril junto a Edit (`ToolRail.tsx:99`).
- **Align** (`AlignControls.tsx`): panel de la pestaña Tool cuando la herramienta es Edit; botón `Align` en el carril (deshabilitado si no está activa Edit: «Switch to Edit to align the selection.»).
- **Transform**: menú de TS:128, además en la barra superior (`DesignerWorkspace.tsx:96`).
- **Límite de trazos de capa raster** (`RasterLimitControls.tsx`): bajo cada capa raster, en Design o con trazos editables, se ve `n/64 strokes · m/8192 segments` (`rasterLimit.ts:4,6`), con aviso `approaching limit` al 80 %; botón `Disable limit` / `Enable limit` (con confirmación y Cancel); si la capa se aplanó: «Pixels · strokes flattened». Al llegar al límite sale un aviso con `Cancel` y `Continue` (`RasterLimitApproval`, líneas 48-65).
- **History trimmed**: texto junto a Undo/Redo en la barra superior cuando el historial perdió pasos por memoria (`DesignerWorkspace.tsx:52,93`); límite por defecto 512 MiB, sin ajuste en la interfaz (`history.ts:28`).
- **Barra superior** (`DesignerWorkspace.tsx:84-120`): `New document` (presets), `Undo`, `Redo`, `Import image`, Transform, `Show or hide right panel`, chip `Selection`, `Canvas size`, `Save to gallery` (confirmación), `Export` (formatos), zoom (`Zoom in`, `Zoom percent`).
- **Selector de color** (`InlineColor`, popover de 260 px, común a todos los colores): plano de saturación/brillo (flechas 1 %, Shift 10 %; `ColorPlane.tsx:28-34`); `Color channels` `HSLA` / `RGBA` (por defecto HSLA, estado local) con sliders y campos numéricos H 0–359, S y L 0–100, R G B 0–255, paso 1; `A` 0–100 % solo si el llamador pasa alfa (Brush, Fill/Stroke de formas, Properties); campo `Hex` (`#RRGGBB`, o `#RRGGBBAA` si hay alfa); `Save`; listas `Recent` (se recuerda el color al cerrar) y `Saved` (clic derecho borra) (`ColorChannels.tsx:7-50`, `InlineControls.tsx:51-82`).
- **Capas FX** (`FxPanel.tsx`; en Properties o con doble clic en la fila): `Applies to` (`Layer below` / `Everything below`); una operación simple muestra sus parámetros y `Edit as filter layer` / `Edit as effect layer`; la pila tiene por operación un interruptor `Turn off`/`Turn on`, el nombre (abre sus parámetros), `Move … up (applied later)` / `down (applied earlier)` y `Remove` con confirmación `Remove`/`Cancel`; `Add filter` / `Add effect` (select con `Choose…`). Menú del pie `Filters and effects`: `New filter layer`, `New effect layer` y cada tipo suelto. Parámetros (`src/engine/fx/defs.ts:26-38`, rango, paso, defecto): Brightness Amount 0–3, 0.05, 1.2; Contrast 0–3, 0.05, 1.3; Saturation 0–3, 0.05, 1.5; Hue Degrees −180–180°, 1, 30; Grayscale, Sepia, Invert Amount 0–1, 0.05, 1; Levels Input black 0–1/0, Input white 0–1/1, Midtones (gamma) 0.1–5/1, Output black 0–1/0, Output white 0–1/1 (paso 0.01); Curves Shadows (25 %) 0.25, Midtones (50 %) 0.5, Highlights (75 %) 0.75 (0–1, 0.01); Blur Radius 0–100 px, 0.5, 4; Glow Strength 0–2, 0.05, 0.8 y Radius 1–100 px, 1, 12; Drop shadow Blur 0–100 px/12, Offset x y −200–200 px/8, Color `#000000`, Opacity 0–1, 0.05, 0.6; Lens flare Intensity 0–2, 0.05, 1, Position x 0–1/0.75, Position y 0–1/0.25, Size 0.05–1/0.3 (0.01), Color `#ffd9a0`.
- **Operations** (botón de capas raster): lista las operaciones de `OPS` con entrada y salida imagen salvo `fx` (`LP:306`); cada una abre `OpForm`. No se enumeran aquí.
- **Dock**: `ui.designerDock` (`tools` por defecto, o `prompt`) y `ui.toolHelp` (línea de ayuda sobre el lienzo, activa salvo que se apague; `store.ts:156-162`).
- **Pestañas del panel** (`LP:171`): `Properties`, `Tool`, `Layers`. La preferencia `ogs:layers-tab` tiene por defecto `props`.

## 8. Hallazgos

Cosas que el código muestra y que conviene saber (todas por lectura del código; ninguna se comprobó ejecutando la app).

1. **Solo en completo, no en compacto**: Brush y Eraser pierden casi todo en compacto (quedan Paint mode, Size, Color, Opacity). Fill pierde Expand y Smooth; Gradient pierde ⇄ y Reverse; Text pierde Line y Spacing; Select pierde All, Invert, Grow / shrink, Grow, Shrink, Delete y Fill; las formas pierden Join, Miter limit, Cap, Dashes, Dash offset y Stroke behind fill.
2. **Sin ningún lugar de edición**: Line y Spacing de un texto ya creado (la barra y Properties solo editan fuente, tamaño, peso, color y alineación). Además, Properties ofrece `Weight` 300–900, mientras que Text ofrece 100–900.
3. **Barra contextual de forma elegida**: sustituye a los ajustes de Edit, así que con una forma elegida desaparecen de esa barra `Edit`, `Auto-select`, `Snap`, `Align` y `Transform`. `Snap` y `Align` siguen en el carril, `Transform` en la barra superior; `Edit` (Object/Layer) y `Auto-select` solo quedan en la pestaña Tool.
4. **Sin guardar**: `Grow / shrink`, `Advanced settings` (Brush) y el paso de stop `Start` / `End` de los degradados se pierden al cambiar de herramienta o de selección.
5. **Edit muestra `Influence`** (de Lineart) aunque no haya curvas; y la edición de una curva elegida de Lineart solo sale en la pestaña Tool (la barra contextual pasa `selectedCurve={null}`).
6. **Posible defecto en `designerKeys.ts:78-97`**: los bloques de Delete de capas y de las teclas de herramienta están anidados dentro de la rama de las flechas, que exige que `e.key` sea una flecha; por la lectura, esas dos ramas no podrían alcanzarse. El test `studio-designer.test.ts:163-175` solo comprueba que la tecla `b` no cambia de herramienta en el Designer incrustado, lo que se cumpliría igual. Conviene verificarlo con una prueba antes de decidir nada.
7. **Límites distintos para el mismo parámetro**: `Sides` llega a 12 al crear (TS:269) y a 24 al editar una forma (PF:16).
8. **Sin tecla**: siete herramientas (Polygon, Star, Sector, Arc, Chord, Curve, Arrow).
9. **Arrow no tiene ajustes propios**: la herramienta se configura con los mismos campos de línea; sus puntas solo se cambian después, desde el popover de `Stroke` de la forma elegida.

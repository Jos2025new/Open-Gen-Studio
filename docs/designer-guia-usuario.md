# Guía del Designer

Guía para quien usa el Designer, sin rutas de código. Los nombres de botones y ajustes van en inglés, tal como salen en pantalla. Cada herramienta enlaza a su ficha técnica por si necesitas el detalle exacto de un ajuste: [[inventario-herramientas-designer]] (herramientas) y [[designer-tecnico]] (cómo está hecho). Esta guía describe lo que el código permite; no se ejecutó la app para escribirla.

## Índice

- [[#Crear y abrir un documento]]
- [[#El lienzo]]
- [[#La barra superior]]
- [[#Ajustes de una herramienta]]
- Herramientas: [[#Edit (mover y editar)]], [[#Pan (mover la vista)]], [[#Select pixels (selección)]], [[#Eyedropper (cuentagotas)]], [[#Fill (cubo)]], [[#Gradient (degradado)]], [[#Brush (pincel)]], [[#Eraser (borrador)]], [[#Lineart (línea artística)]], [[#Ruler (regla de trazos)]], [[#Text (texto)]], [[#Formas y líneas]]
- [[#Drawing y Design]]
- [[#Capas]]
- [[#Selección]]
- [[#Efectos]]
- [[#Tamaño del lienzo]]
- [[#Exportar y guardar en la galería]]
- [[#Atajos de teclado]]
- [[#Consejos]]

## Crear y abrir un documento

Un documento del Designer es una página con capas. Cada conversación guarda sus propios diseños.

- **Nuevo**: pulsa `New document` (el botón `+` de la barra superior) y elige un tamaño: Square 1:1 (1080 × 1080), Portrait 4:5 (1080 × 1350), Story 9:16 (1080 × 1920), Landscape 16:9 (1920 × 1080), Poster 2:3 (1200 × 1800) o A4 portrait (1240 × 1754). Si todavía no hay ningún diseño, la pantalla "Start a design" muestra esos mismos tamaños.
- **Cambiar de documento**: pulsa `Choose canvas`, la píldora con el nombre del diseño. Se despliegan las miniaturas de todos los diseños de la conversación; un clic abre uno. Se queda desplegada hasta que la cierres.
- **Traer una imagen**: `Import image` abre un selector de archivos. Acepta PNG, JPEG, WebP, GIF, SVG, HEIC, HEIF y EPS. Cada imagen se coloca como una capa. Un SVG se abre como un diseño nuevo con sus formas editables. Si un archivo no se puede leer, un aviso dice por qué.
- **Traer imágenes del chat**: si el chat tiene imágenes que aún no están en un diseño, aparece un selector para importarlas, "As layers of one" (todas en un diseño) o "Each as a design" (un diseño por imagen).

Un documento nuevo se pinta en modo Drawing (ver [[#Drawing y Design]]). Detalle técnico: [[designer-tecnico#Importar y exportar]].

## El lienzo

- **Zoom**: los botones `Zoom in` y `Zoom out`, o escribe un porcentaje en el campo `Zoom percent` y pulsa Enter (de 5 % a 3200 %). `Fit canvas` ajusta la página a la pantalla.
- **Mover la vista**: con la herramienta Pan, o manteniendo Espacio y arrastrando. Con las flechas del teclado, si no hay nada elegido, también se desplaza la vista.
- **Reglas y guías**: el botón de reglas (o Shift+R) muestra reglas en los bordes. Arrastra desde una regla para sacar una guía; las guías se guardan con el documento y sirven de imán al mover.
- **Ayuda de la herramienta**: una línea sobre el lienzo explica la herramienta activa. El botón `?` de los controles de vista la oculta o la vuelve a mostrar.
- **Panel derecho**: el botón `Show or hide right panel` lo oculta. Ver [[#Capas]].

## La barra superior

De izquierda a derecha:

- `New document`: crea un diseño (ver arriba).
- `Undo` y `Redo`: deshacer y rehacer. Si aparece "History trimmed", los pasos más viejos se descartaron para no gastar memoria.
- `Import image`: trae archivos.
- `Transform`: gira o refleja lo elegido (ver [[#Edit (mover y editar)]]).
- `Show or hide right panel`.
- Un chip `Selection` aparece cuando hay una selección de píxeles y usas otra herramienta; trae `Deselect`.
- `Canvas size`: cambia el tamaño de la página (ver [[#Tamaño del lienzo]]).
- `Save to gallery` y `Export` (ver [[#Exportar y guardar en la galería]]).

Detalle técnico: [[designer-tecnico-2#Barra superior]], dentro de [[designer-tecnico-2#Superficies de la interfaz]].

## Ajustes de una herramienta

Cada herramienta tiene sus ajustes en dos sitios:

1. **La barra rápida** encima de las herramientas, con lo más usado. A la izquierda dice qué herramienta está activa y sobre qué capa actuará el próximo gesto ("Brush → Layer 2", por ejemplo).
2. **La pestaña `Tool`** del panel derecho, con todos los ajustes. El botón `Settings…` de la barra rápida la abre.

Cuando eliges un texto o una forma, la barra rápida cambia para editar ese objeto en lugar de los ajustes de la herramienta. Los ajustes de la capa elegida (posición, tamaño, texto, bordes) están en la pestaña `Properties`.

Todos los campos numéricos son deslizadores: arrastra, escribe un valor o usa la rueda del ratón para mover un paso. Los colores abren un selector con plano, canales (`HSLA` o `RGBA`), campo `Hex`, una lista `Recent` y otra `Saved` (el botón `Save` guarda el color actual; clic derecho en uno guardado lo borra). Algunos colores aceptan también transparencia con el canal `A`.

Qué ajustes existen en cada barra: [[inventario-herramientas-designer#1. Cómo leer las tablas]]. Superficies: [[designer-tecnico-2#Superficies de la interfaz]].

## Edit (mover y editar)

**Qué hace**: elige, mueve, gira y alinea. **Cuándo usarla**: para recolocar lo que ya dibujaste. Tecla: V.

- `Edit` tiene dos modos: `Object` (elige un trazo o una forma dentro de una capa) y `Layer` (elige la capa entera). `Object` se desactiva si la capa activa no tiene trazos ni formas editables.
- `Auto-select`: al hacer clic en el lienzo, elige lo que haya bajo el puntero sin pasar por la lista de capas.
- Ctrl-clic añade a la elección. Arrastrar sobre un hueco dibuja una marquesina para elegir varias cosas a la vez.
- `Snap`: el imán. Mientras mueves, los bordes y centros se pegan a los de la página, a otras capas y a las guías. Mantén Alt al arrastrar para mover libremente. Ver [[#Capas]] para más detalle.
- `Align`: alinea lo elegido respecto a la página, la selección u otro elemento (`Relative to`), con diez botones de alineación y dos de reparto (`Even horizontal gaps`, `Even vertical gaps`, desde tres elementos).
- `Transform`: `Mirror left ↔ right`, `Mirror top ↕ bottom`, `Rotate 90° right`, `Rotate 90° left`, `Rotate 180°`.
- Doble clic en una forma entra en su edición: tiradores de esquinas y tamaño, o nodos si es un camino. `Esc` o `Done` sale.
- Las flechas del teclado mueven lo elegido 1 px (Shift: 10 px).

Técnico: [[inventario-herramientas-designer#3.1 Edit (`move`, tecla V)]]; atajos y acciones: [[inventario-herramientas-designer-2#5. Acciones de objeto y de capa]]; arquitectura: [[designer-tecnico#Edit y Pan]].

## Pan (mover la vista)

**Qué hace**: arrastra el lienzo para moverte por él; no cambia el diseño. **Cuándo usarla**: al hacer zoom. Tecla: H. También vale mantener Espacio con cualquier otra herramienta. No tiene ajustes.

Técnico: [[inventario-herramientas-designer#3.2 Pan (`hand`, tecla H)]]; [[designer-tecnico#Edit y Pan]].

## Select pixels (selección)

**Qué hace**: marca una zona de píxeles para trabajar solo en ella. **Cuándo usarla**: para borrar, rellenar, copiar a otra capa o mover una parte de una imagen. Tecla: M.

- `Shape`: `Rectangle`, `Lasso` (a mano alzada) o `Magic wand` (elige por color parecido).
- Solo para `Magic wand`: `Tolerance` (cuánto color parecido entra), `Expand` y `Smooth` (agrandar y suavizar el borde), `Mode` (`New`, `Add`, `Subtract`) y `Sample` (`Active layer` o `All layers`).
- Mantén Shift para sumar a la selección y Alt para restar, con cualquier forma.
- Botones: `Deselect`, `To layer` (los píxeles elegidos pasan a una capa nueva), `All`, `Invert`, `Grow / shrink` con `Grow` y `Shrink`, `Delete` (borra los píxeles elegidos de la capa ráster activa) y `Fill` (rellena con el color y la opacidad del pincel, en una capa nueva). `Grow / shrink`, `All`, `Invert`, `Delete` y `Fill` solo salen en la pestaña `Tool`.
- Con la herramienta Edit puedes arrastrar dentro de la selección para mover los píxeles.

Ver [[#Selección]]. Técnico: [[inventario-herramientas-designer#3.3 Select pixels (`select`, tecla M)]]; [[designer-tecnico#Selección de píxeles]].

## Eyedropper (cuentagotas)

**Qué hace**: toma el color visible bajo el clic y lo deja como color del pincel. **Cuándo usarla**: para repetir un color que ya está en la imagen. Tecla: I. También funciona Alt-clic con el pincel o el cubo. El ajuste `Picked` muestra el color tomado.

Técnico: [[inventario-herramientas-designer#3.4 Eyedropper (`eyedropper`, tecla I)]]; [[designer-tecnico#Cuentagotas, cubo y degradado]].

## Fill (cubo)

**Qué hace**: rellena una zona de color parecido en una capa nueva. **Cuándo usarla**: para colorear áreas cerradas. Tecla: G (comparte botón con Gradient).

Ajustes: `Color`, `Opacity`, `Threshold` (cuánto color parecido se rellena) y, en la pestaña `Tool`, `Expand` y `Smooth` del borde.

Técnico: [[inventario-herramientas-designer#3.5 Fill (`fill`, tecla G)]]; [[designer-tecnico#Cuentagotas, cubo y degradado]].

## Gradient (degradado)

**Qué hace**: pinta una transición de color arrastrando de un punto a otro. **Cuándo usarla**: fondos, sombras suaves. Tecla: U. Shift al arrastrar fija la dirección en pasos de 45°.

Ajustes: `Shape` (`Linear` o `Radial`), `Color`, `To` (`Second color` o `Transparent`), `Second` (el segundo color) y `Opacity`. En la pestaña `Tool` también `Reverse` y el botón ⇄ que intercambia los dos colores.

Técnico: [[inventario-herramientas-designer#3.6 Gradient (`gradient`, tecla U)]]; [[designer-tecnico#Cuentagotas, cubo y degradado]].

## Brush (pincel)

**Qué hace**: pinta píxeles en una capa ráster, con punta, textura y presión del lápiz. **Cuándo usarla**: ilustración y retoque. Tecla: B. Si la capa activa no admite pintura, pinta en su propia capa `Paint`.

Ajustes rápidos: `Paint mode` (`Drawing` o `Design`, ver [[#Drawing y Design]]), `Color`, `Size` (1 a 240 px), `Opacity`. En la pestaña `Tool`: ayudas de tamaño, `Texture` (`None`, `Paper`, `Canvas`, `Grain`) con `Texture strength`, `Taper start` y `Taper end`, `Stabilize` y `Smoothing`, `Blend` (`Normal`, `Multiply`, `Screen`, `Overlay`, `Darken`, `Lighten`), `Tip` (`Hard`, `Firm`, `Soft`, `Airbrush`), `Hardness` y `Mirror` (refleja el trazo en el eje vertical central).

Si usas lápiz con presión, la presión cambia tamaño y densidad. Sin lápiz, la presión se simula a partir de la velocidad de la mano; hay un ajuste de `Speed influence`. Las imágenes colocadas o generadas están protegidas del pincel hasta que actives `Allow painting on this image` en `Properties`.

Técnico: [[inventario-herramientas-designer#3.7 Brush (`brush`, tecla B) y 3.8 Eraser (`eraser`, tecla E)]]; [[designer-tecnico#Pincel y borrador]].

## Eraser (borrador)

**Qué hace**: borra píxeles de una capa ráster. **Cuándo usarla**: corregir trazos o recortar una imagen. Tecla: E. Solo actúa sobre una capa ráster visible y desbloqueada; si no, la herramienta se desactiva y su consejo dice por qué. Comparte ajustes con el pincel salvo `Color` y `Blend`.

Técnico: [[inventario-herramientas-designer#3.7 Brush (`brush`, tecla B) y 3.8 Eraser (`eraser`, tecla E)]]; [[designer-tecnico#Pincel y borrador]].

## Lineart (línea artística)

**Qué hace**: dibuja trazos vectoriales con presión que sigues pudiendo editar. **Cuándo usarla**: rotulado, líneas limpias. Tecla: P.

- `Mode`: `Draw` (trazos nuevos) o `Edit` (cambiar los existentes; `Influence` controla cuánto se contagia al deformar).
- Ajustes del trazo: `Size`, `Color`, `Opacity`, `Pressure thinning`, `Smoothing`, `Streamline`, `Texture` (`Solid ink`, `Pencil grain`, `Chalk`, `Dry bristle`; con textura salen `Spacing`, `Jitter` y `Seed`), `Taper start` y `Taper end`.
- Alt al arrastrar dobla un trazo existente.

Técnico: [[inventario-herramientas-designer#3.9 Lineart (`lineart`, tecla P)]]; [[designer-tecnico#Lineart y Ruler]].

## Ruler (regla de trazos)

**Qué hace**: coloca una guía que el pincel puede seguir. **Cuándo usarla**: líneas rectas, elipses o perspectiva. Tecla: K.

Ajustes: `Ruler` (`Straight`, `Ellipse`, `Perspective`), `Vanishing points` (`One` o `Two`, solo en perspectiva), `Snap brush to ruler` (los trazos del pincel siguen la guía) y `Clear ruler`. Mientras la regla está colocada, Brush y Eraser ofrecen `Follow stroke ruler`.

Técnico: [[inventario-herramientas-designer#3.10 Ruler (`ruler`, tecla K)]]; [[designer-tecnico#Lineart y Ruler]].

## Text (texto)

**Qué hace**: crea una capa de texto. **Cuándo usarla**: títulos, rótulos. Tecla: T. Haz clic en el lienzo y escribe.

Ajustes: `Font` (Inter, Grotesk, Serif, Display, Condensed, Mono), `Size`, `Weight`, `Color`, `Align` y, en la pestaña `Tool`, `Line` (interlineado) y `Spacing` (entre letras). Estos ajustes valen para el **texto siguiente**; un texto ya creado se cambia en `Properties` (texto, fuente, tamaño, peso, color, alineación). Hoy el interlineado y el espaciado de un texto ya creado no se pueden editar.

Técnico: [[inventario-herramientas-designer#3.11 Text (`text`, tecla T)]]; [[designer-tecnico#Text]].

## Formas y líneas

**Qué hace**: crea formas vectoriales editables. **Cuándo usarla**: logotipos, iconos, marcos, flechas. Diez herramientas en un solo botón: Rectangle (R), Ellipse (O), Polygon, Star, Sector, Arc, Chord, Line (L), Curve y Arrow. Las que no traen letra no tienen tecla.

Ajustes comunes: `Fill` (con casilla `No fill`; no en las líneas), `Stroke` (con `No stroke`), `Width`; en la pestaña `Tool`, `Join`, `Miter limit`, `Cap`, `Dashes`, `Dash offset` y `Stroke behind fill`. Propios: Rectangle tiene `Rx`, `Ry` y `Sharp corners` (esquinas redondeadas o rectas); Polygon y Star, `Sides` y `Round`; Star, además, `Inner`; Sector, Arc y Chord, `From` y `To` (ángulos); Curve, `Bend`. Shift al arrastrar hace la caja cuadrada o fija la dirección de la línea en pasos de 45°.

Una forma ya creada se edita con Edit: elige la forma y cambia `Fill`, `Stroke`, `Blur`, y en `Stroke` las puntas `Start arrow` y `End arrow` (`None`, `Triangle`, `Open arrow`, `Circle`, `Square`, `Bar`). `Edit shape` o doble clic muestra tiradores; en un camino, nodos (`Cusp`, `Smooth`, `Symmetric`) con `Break`, `Join`, `Delete segment`, `Make line`, `Make curve` y `Delete node`. `Convert to path` convierte una forma en nodos editables. Todos los ajustes de una forma están en la pestaña `Properties`, salvo los degradados, las puntas de flecha y `Shape`.

Técnico: [[inventario-herramientas-designer#3.12 Formas y líneas]]; forma elegida: [[inventario-herramientas-designer-2#4.3 Forma elegida (CS:80-106)]]; [[designer-tecnico#Formas y líneas]].

## Drawing y Design

Brush y Eraser tienen dos modos de pintar, que eliges con `Paint mode`:

- **Drawing**: el trazo va directo a los píxeles de la capa, como en Krita, GIMP o Photoshop. No hay límite de trazos. Es el modo de los documentos nuevos.
- **Design**: los trazos quedan editables (se pueden elegir y mover con Edit) hasta un límite de 64 trazos o 8192 segmentos por capa; al llegar, la capa se aplana en un solo paso de deshacer y un aviso te deja `Cancel` o `Continue`. Bajo la capa se ve `n/64 strokes · m/8192 segments`.

Si pintas en Drawing sobre una capa que aún tiene trazos editables, el Designer pregunta qué hacer: aplanar, pasar a Design o crear una capa nueva. "Don't show again" recuerda la elección; cerrar la pregunta no hace nada. El imán (`Snap`) recuerda por separado sus ajustes en cada modo.

Técnico: [[designer-tecnico-2#Pregunta de Dibujo o Diseño]]; [[designer-tecnico#Visión general]].

## Capas

El panel derecho tiene tres pestañas: `Properties` (la capa elegida), `Tool` y `Layers` (solo la lista). Se puede ensanchar arrastrando su borde.

- **Tipos**: Raster (píxeles), Vector (formas y Lineart), Text y FX (filtros y efectos). El botón `+` de la lista crea `Raster`, `Vector` o `Text`; las capas FX salen del menú de efectos.
- **Elegir**: clic; Ctrl-clic suma; Shift-clic elige un rango.
- **Por fila**: ojo para mostrar u ocultar, candado para bloquear. Doble clic en el nombre para renombrar (Enter acepta, Esc cancela). Arrastra una fila para reordenarla.
- **Apariencia**: `Opacity` y `Blend` (16 modos, de `normal` a `luminosity`) de la capa elegida. En `Properties` también `X`, `Y`, `W`, `H`.
- **Acciones**: duplicar, `Operations` (operaciones de imagen sobre una capa ráster; el resultado va encima), subir y bajar, borrar, y el menú `More layer actions` con `Merge down` (Ctrl+E), `Rasterize layer`, `Group layers` (Ctrl+G) y `Ungroup this folder`.
- **Carpetas**: agrupa dos o más capas; el ojo, el candado y el clic actúan sobre todas.
- **Capa con píxeles ilegibles**: se marca en la lista; un clic reintenta leerla. Hasta entonces el Designer no la sobrescribe con píxeles en blanco.

Técnico: [[designer-tecnico-2#Panel derecho]]; acciones: [[inventario-herramientas-designer-2#5. Acciones de objeto y de capa]]; modelo: [[designer-tecnico#Visión general]].

## Selección

Hay tres selecciones distintas:

1. **Capas**: con Ctrl-clic o Shift-clic en la lista. Edit en modo `Layer` actúa sobre ellas.
2. **Objetos** dentro de una capa: con Edit en modo `Object`, clic o marquesina sobre trazos y formas.
3. **Píxeles**: con Select pixels. Se puede invertir (Ctrl+Shift+I), seleccionar todo (Ctrl+A), quitar (Ctrl+D) y pasar a capa (Ctrl+J). Deshacer y rehacer devuelven también la selección que había.

Seleccionar nunca guarda ni cambia el diseño por sí solo. Delete borra lo que corresponda: el nodo elegido, los píxeles seleccionados o los objetos elegidos.

Técnico: [[designer-tecnico#Estado del store]]; descripción de comportamiento: [designer-selection](features/designer-selection.md).

## Efectos

Los filtros y efectos son capas FX: no tocan los píxeles originales y se pueden quitar o reordenar. Menú del pie del panel: `Filters and effects` con `New filter layer`, `New effect layer` y cada tipo suelto.

- `Applies to`: `Layer below` (solo la capa de debajo) o `Everything below`.
- Filtros: Brightness, Contrast, Saturation, Hue, Grayscale, Sepia, Invert, Levels, Curves. Efectos: Blur, Glow, Drop shadow, Lens flare.
- En una pila, cada operación se puede apagar (`Turn off`), subir o bajar (se aplican de abajo arriba) y quitar (`Remove`, con confirmación). `Add filter` / `Add effect` añade otra.

Los rangos de cada parámetro están en el inventario. Técnico: [[inventario-herramientas-designer-2#7. Controles fuera de ToolSettings]]; [[designer-tecnico#Capas FX]].

## Tamaño del lienzo

El botón `Canvas size` de la barra superior (muestra el tamaño actual) abre un panel con `W` y `H` (de 1 a 8192 px), `Keep ratio`, una cuadrícula `Anchor` que decide dónde se queda la página actual dentro de la nueva, `Trim to content` (reduce la página a lo visible) y `Apply`. Cambiar el tamaño mueve las capas, no las recorta ni las reescala, y se deshace en un solo paso. Una selección de píxeles se descarta porque ya no encaja.

Técnico: [[designer-tecnico#Límites de recursos]]; [[designer-tecnico-2#Popovers]].

## Exportar y guardar en la galería

- `Save to gallery`: guarda el diseño como imagen PNG en la galería de la app, tras una confirmación (`Save` o `Cancel`).
- `Export`: descarga un archivo. PNG (conserva la transparencia), JPG (fondo blanco), SVG (capas, texto y formas editables) o PDF (vectorial; el texto, en fuentes estándar).
- Si el SVG no puede conservar algo, un aviso lo dice. En PNG y JPG con filtros o efectos, hay un tope de tamaño (8192 px de lado); si no se puede exportar, sale un aviso en vez de reducir la imagen en silencio.

Técnico: [[designer-tecnico#Importar y exportar]].

## Atajos de teclado

**Herramientas**: V Edit, H Pan, M Select pixels, I Eyedropper, B Brush, G Fill, U Gradient, P Lineart, E Eraser, R Rectangle, O Ellipse, L Line, T Text, K Ruler. Polygon, Star, Sector, Arc, Chord, Curve y Arrow no tienen tecla.

**Generales**: Ctrl+S guardar, Ctrl+Z deshacer, Ctrl+Shift+Z o Ctrl+Y rehacer, Shift+R reglas y guías, Ctrl+G agrupar capas, Ctrl+E fusionar hacia abajo, Ctrl+A / Ctrl+D / Ctrl+Shift+I / Ctrl+J para la selección de píxeles, flechas para mover (Shift: 10 px). Espacio mantenido desplaza la vista. Alt-clic con Brush o Fill toma un color. Los atajos no actúan mientras escribes en un campo.

**Nodos de un camino**: Shift+C / S / Y cambian el tipo de nodo; Shift+L / U vuelven rectos o curvos los segmentos; Shift+J y Alt+J unen; Shift+B rompe; Delete borra el nodo.

Tabla completa: [[inventario-herramientas-designer-2#6. Atajos de teclado]]; [[designer-tecnico-2#Atajos]].

## Consejos

- Antes de pintar, mira la etiqueta de la barra rápida (qué capa cambiará). Si la herramienta aparece apagada, pasa el puntero: dice el motivo (capa bloqueada, oculta o de otro tipo).
- Para filtros no destructivos usa capas FX, no operaciones sobre la imagen.
- Para trazos que quieras seguir ajustando, pinta en Design o usa Lineart; para pintura libre, Drawing.
- Para una línea recta con el pincel, coloca una regla con Ruler y activa `Follow stroke ruler`.
- Alt mientras arrastras desactiva el imán en ese movimiento.
- Un texto con el interlineado equivocado hoy se rehace; no se puede editar después.
- Si aparece "History trimmed", deshacer ya no llega tan atrás.

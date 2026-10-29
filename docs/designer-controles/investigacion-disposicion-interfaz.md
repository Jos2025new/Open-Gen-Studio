# Disposición de interfaz en editores gráficos (pasada 2)

Solo lectura. Fecha de consulta: 2026-10-29. Método: `agent-browser --headed` (Chrome real; sin él Adobe devuelve «Access Denied»), curl para affinity.help/docs.krita.org, y código local de GIMP/Inkscape.

Leyenda de fuente: **P** = primaria (documentación oficial del fabricante o código fuente local), **S** = secundaria (tutorial o resumen de buscador), **SV** = sin verificar (no encontré o no pude abrir la fuente; no lo afirmo).
Aviso: «Página X» sin más es la URL. Las filas con «(snippet)» vienen de un resumen de búsqueda sobre una página oficial que no abrí entera.

Rutas base: ADOBE_PS = https://helpx.adobe.com/photoshop/desktop ; AI = https://helpx.adobe.com/illustrator ; AFF = https://affinity.help/designer2/en-US.lproj/pages ; GIMPSRC = /home/samuel/Descargas/gimp-master ; INKSRC = /home/samuel/Descargas/inkscape-src.

---

## 1. Agrupación en la caja de herramientas: Selección (rect, lazo, varita), Relleno, Degradado, Cuentagotas

| App | Respuesta | Fuente | Tipo |
|---|---|---|---|
| Photoshop | La página de herramientas de selección lista Marquee rectangular/elíptico/fila/columna, Lazo/poligonal/magnético, Selección rápida, Varita y Selección de objetos, pero NO dice qué comparte flyout. La página de pintura lista Degradado, Bote de pintura y Cuentagotas como herramientas distintas, sin decir el grupo. Lo oficial confirma que la barra se organiza «en grupos» editables (Edit > Toolbar) | ADOBE_PS/make-selections/get-started-selections/selection-tools-overview.html ; ADOBE_PS/apply-painting-techniques/fill-objects-selections-layers/painting-tools-overview.html ; ADOBE_PS/get-started/set-up-toolbars-panels/customize-the-toolbar.html | P (lista) |
| Photoshop | Agrupación por defecto: Marquee (4) en un grupo; Lazo (3) en otro; Selección rápida+Varita+Sel. objetos en otro; Degradado+Bote de pintura en un grupo (tecla G); Cuentagotas en el grupo de medición (con Muestra de color, Regla, Nota, Contar) | https://glensmith.co.uk/photoshop/tools ; https://sf.massart.edu/wp-content/uploads/2022/10/Photoshop-03_The-Photoshop-Toolbar.pdf (vía buscador) | S |
| Illustrator | Mecanismo: triángulo en esquina inferior derecha; mantener pulsado abre las ocultas; Alt/Option+clic rota entre ocultas; el usuario puede crear grupos arrastrando desde el cajón «All Tools». Qué herramientas concretas comparten grupo en la barra por defecto: no lo verifiqué | AI/using/tools.html | P (mecanismo) / SV (membresía) |
| Photopea | Iconos con flecha contienen el grupo; clic mantenido abre el menú (ej. Lazo). Membresías concretas: SV | https://www.photopea.com/learn/workspace | P (mecanismo) / SV (membresía) |
| Affinity Designer | La página del panel de herramientas solo dice que es personalizable (añadir/quitar). Qué comparte flyout: SV | AFF/Panels/toolsPanel.html | P (solo personalizable) / SV |
| GIMP (3.x) | Código `etc/toolrc`: grupo {Rect select, Ellipse select}; grupo {Free select, Scissors, Foreground select}; grupo {Fuzzy select (varita), By color select}; grupo {Bucket fill, Gradient}; grupo {Color picker, Measure}; Crop, Eraser, Path, Text, Zoom van sueltas. La varita NO comparte grupo con el rectángulo | GIMPSRC/etc/toolrc (líneas 17-147 aprox.) | P (código) |
| Inkscape | Sin flyouts: `ToolToolbar` monta una lista plana de botones (FlowBox) con separadores; cada botón se puede ocultar por preferencia | INKSRC/src/ui/toolbar/tool-toolbar.cpp (set_visible_buttons) | P (código) |
| Krita | El manual lista cada herramienta como página propia (Selección rect, elíptica, a mano, poligonal, contigua, color similar, magnética; Fill; Gradient; Color Sampler). Si comparten botón/flyout en la caja: SV (la página `toolbox` da 404) | https://docs.krita.org/en/reference_manual/tools.html | P (lista) / SV (agrupación) |
| Figma | No aplica a selección de píxeles; sí hay un único menú «Shape tools» (ver pregunta 2) | https://help.figma.com/hc/en-us/articles/360040450133-Shape-tools | P |
| Procreate | Selección: SV. Relleno: SV (no lo abrí) | — | SV |
| SAI | SV | — | SV |
| ibisPaint | Herramientas se eligen en una «ventana de selección de herramientas»; hay Cuentagotas rápido que evita abrirla. Grupos concretos: SV | https://ibispaint.com/lecture/index.jsp?no=151&lang=en | P (parcial) |

## 2. Formas: ¿botón propio o dentro de otra herramienta?

| App | Respuesta | Fuente | Tipo |
|---|---|---|---|
| Photoshop | Un grupo de herramientas «Shapes»: Rectángulo, Elipse, Triángulo, Polígono, Estrella, Línea, Forma personalizada. Un único slot en la barra, el resto en el flyout. Sin arco/sector en la lista | ADOBE_PS/draw-shapes-paths/create-shapes/drawing-tools-overview.html ; Drawing page «Draw shapes» (https://helpx.adobe.com/photoshop/desktop/…/ «shapes tool group») | P |
| Illustrator | Solo pude abrir «Draw lines»: la Línea (Line Segment) es herramienta propia con diálogo de longitud/ángulo. Grupo de formas y arco/espiral: SV | AI/using/drawing-simple-lines-shapes.html | P (línea) / SV (resto) |
| Affinity Designer | Lista oficial de formas: Rectángulo, Elipse, Rect. redondeado, Triángulo, Rombo, Trapecio, Polígono, Estrella, Doble estrella, Estrella cuadrada, Flecha, Donut, **Pie/Segment** (sector), Medialuna, Engranaje, Nube, Llamadas, Lágrima, Corazón, Espiral. Se «elige una de las herramientas de forma del panel de herramientas» y sus parámetros salen en la barra contextual. Si es flyout o varios botones: SV | AFF/CurvesShapes/about_geometricShapes.html ; AFF/CurvesShapes/draw_geometricShapes.html | P |
| Figma | Un menú «Shape tools» tras la flecha junto a Rectángulo: Rectángulo (R), Línea (L), Flecha (Shift+L), Elipse, Polígono, Estrella | https://help.figma.com/hc/en-us/articles/360040450133-Shape-tools | P |
| Photopea | Herramientas Rectángulo, Elipse, Polígono, etc.; cada una con modo Path/Shape/Pixels en el menú superior. Una «Parametric Shape» dibuja Polígono, Estrella y Espiral con parámetros | https://www.photopea.com/learn/vg-creating (y blog 3.8 «live shapes») | P (snippet) |
| Krita | Herramientas independientes en el manual: Línea recta, Rectángulo, Elipse, Polígono, Polilínea, Bézier, Camino a mano alzada. Opciones: Relleno, Contorno, tamaño, Round X/Y. Arco/sector no listado | https://docs.krita.org/en/reference_manual/tools.html ; https://docs.krita.org/en/reference_manual/tools/rectangle.html | P |
| Inkscape | Cada forma tiene su propia herramienta y barra: Rect, Arc (elipse/arco/segmento: el sector va DENTRO de la herramienta Arc), Star (estrella/polígono en una), 3D box, Spiral. Flecha = marcadores (barra Marker) sobre pluma/lápiz | INKSRC/src/ui/toolbar/toolbars.cpp (tabla `toolbar_data`) | P (código) |
| GIMP | Rectángulo y elipse son de selección (no dibujan formas). En `toolrc` hay `gimp-shape-tool` sin grupo junto a Path y Text; qué hace: SV | GIMPSRC/etc/toolrc | P (código) / SV |
| Procreate | QuickShape: se dibuja y se mantiene el dedo; la forma se corrige y aparece «Edit Shape» en la barra superior. No hay botón de herramienta por forma | https://help.procreate.com/procreate/handbook/guides/quickshape | P (snippet) |
| SAI / ibisPaint | SV | — | SV |

## 3. Ajustes de la herramienta activa (dónde) y del pincel siempre visibles

| App | Respuesta | Fuente | Tipo |
|---|---|---|---|
| Photoshop | Barra de opciones arriba: «muestra ajustes de la herramienta seleccionada». Pincel: selector de preset, tamaño y dureza, Mode, Opacity, Flow, aerógrafo, presión para tamaño/opacidad, Smoothing (0-100). Además la Contextual Task Bar flotante «según herramienta o tarea» | ADOBE_PS/get-started/learn-the-basics/workspace-overview.html ; ADOBE_PS/apply-painting-techniques/brushes-presets/paint-with-brush-or-pencil-tool.html | P |
| Illustrator | Dos vistas equivalentes: panel Properties (vertical, por secciones) y panel Control (barra horizontal arriba); «muestran las opciones del objeto, herramienta o flujo seleccionado». Doble clic en la herramienta abre su diálogo de opciones | AI/using/workspace-basics.html ; AI/using/tools.html ; AI/using/properties-panel.html | P |
| Affinity | Barra contextual bajo la barra de herramientas y sobre el documento; se actualiza con la herramienta. Brush siempre visible: SV | https://affinity.help/publisher2/en-US.lproj/pages/Workspace/contextBar.html (mismo texto en designer2) | P |
| Photopea | Barra superior bajo el menú, contenido distinto por herramienta (Pincel: opacidad; Texto: tamaño) | https://www.photopea.com/learn/workspace (+ snippet) | P |
| Figma | Panel derecho de propiedades según selección (no por herramienta) | https://help.figma.com/hc/en-us/articles/360049283914-Apply-and-adjust-stroke-properties | P |
| Inkscape | Una «barra de controles de herramienta» por herramienta; se muestra una sola a la vez y se oculta la anterior | INKSRC/src/ui/toolbar/toolbars.cpp | P (código) |
| Procreate | Barra lateral izquierda con deslizador de tamaño (arriba) y de opacidad (abajo), siempre visibles; ajustes finos arrastrando de lado; la barra se puede mover en altura | https://help.procreate.com/procreate/handbook/interface-gestures/interface | P |
| ibisPaint | «Quick slider» con tamaño y opacidad como atajo a la ventana de propiedades del pincel | https://ibispaint.com/lecture/index.jsp?no=07&lang=en | P (snippet) |
| Photoshop iPad | Al tocar un icono de herramienta salen sus opciones; flotante, con asa para moverlo o acoplarlo abajo; no todas las herramientas tienen | https://helpx.adobe.com/photoshop/using/workspace-ipad.html | P |
| Krita | Pop-up palette sobre el lienzo: pinceles favoritos, color, rotación, zoom. El docker «Tool Options» es el sitio de ajustes por herramienta (página no abierta) | https://docs.krita.org/en/reference_manual/popup-palette.html | P (pop-up) / SV (docker) |
| GIMP / SAI | SV | — | SV |

## 4. Trazo de un objeto YA creado

| App | Qué está a mano | Qué exige otro panel/diálogo | Fuente | Tipo |
|---|---|---|---|---|
| Illustrator | Documentado en la barra Control: color de trazo (cuadro Stroke / muestras), **weight**, **perfil de anchura** (Width Profile). Properties panel: sección Appearance con fill/stroke/opacidad y enlaces subrayados/elipsis «para controles más expandibles» | Stroke panel (Window > Stroke): dash/gap, alinear trazo centro/dentro/fuera, miter limit (1-500), cap (butt/round/projecting), join (miter/round/bevel), flechas, perfiles. Que el Control panel traiga cap/join/dash: no documentado, SV | AI/using/stroke-object.html ; AI/using/properties-panel.html | P |
| Photoshop (formas) | Contextual Task Bar: Fill, **Stroke: color, ancho y tipo**, Duplicar capa. También «Shape Properties» en Properties panel y en barra de opciones | Cap/join/alinear del trazo: la página «Modify fill and stroke» no la abrí → SV | ADOBE_PS/…/drawing-shapes (página «Draw shapes») | P / SV |
| Affinity | La barra contextual de Pen y de herramientas de forma incluye «Stroke properties» (dash/punteado confirmado). Lista exacta de controles en la barra: SV | Panel Stroke: Style (ninguno/sólido/discontinuo/textura), Width, Cap (round/butt/square), Join (round/bevel/miter), Miter, **Align** (centrado/dentro/fuera), **Draw Behind Fill**, Scale with Object, Dash, Phase, Pressure | AFF/Panels/strokePanel.html ; AFF/CurvesShapes/dot_dash_lines.html | P |
| Figma | Siempre en la sección Stroke del panel derecho (no hace falta menú): fill, Position (dentro/fuera/centro, con vista previa al pasar el ratón), Weight, perfil de anchura, trazos individuales por lado, End points (cap/flecha) en trazos abiertos | «Advanced stroke settings»: Dashed (dash, gap, dash-cap none/round/square) y Dotted. Join en Figma: SV | https://help.figma.com/hc/en-us/articles/360049283914-Apply-and-adjust-stroke-properties | P |
| Inkscape | Las barras de Select y Rect no contienen controles de trazo (búsqueda en código: 0 resultados de join/cap/dash) | Diálogo Fill and Stroke con pestañas «Stroke paint» y «Stroke style» | INKSRC/src/ui/toolbar/{select,rect}-toolbar.cpp ; INKSRC/src/ui/dialog/fill-and-stroke.cpp | P (código) |
| Photopea | Con cualquier herramienta vectorial activa, la barra superior muestra Fill y Stroke de la capa de forma actual | Resto (cap/join/dash) SV | https://www.photopea.com/learn/vg-creating (snippet) | P / SV |
| Krita | Opciones de herramienta de forma: Relleno, Contorno (pincel), Round X/Y — para lo que se va a dibujar. Editar trazo de un objeto vectorial ya hecho: SV | https://docs.krita.org/en/reference_manual/tools/rectangle.html | P / SV |
| Procreate / GIMP / SAI / ibisPaint | SV (apps de píxel; no abrí nada específico) | — | SV |

## 5. Texto

| App | Respuesta | Fuente | Tipo |
|---|---|---|---|
| Photoshop | Los controles de carácter están en 4 sitios: panel Character, panel Properties, **barra de opciones del Type tool** y Contextual Task Bar con Type activo. Se aplican a caracteres seleccionados o a la capa completa; sobre texto ya creado se activa con doble clic en la capa o seleccionando la capa. Tamaño: puntos por defecto o con unidad (in, cm, mm, pt, px, pica). Leading «auto» = 120 % del tamaño. Rangos numéricos de tamaño/leading/tracking: SV. Que la barra y el panel ofrezcan el mismo conjunto y rango: no documentado → SV | ADOBE_PS/text-typography/characters-glyphs/format-characters.html ; https://helpx.adobe.com/photoshop/using/line-character-spacing.html | P |
| Illustrator | Panel Character muestra por defecto solo las opciones más usadas («Show Options» para todas); Properties panel tiene sección Character e icono de **fuente variable** (peso y tamaño óptico) cuando el texto usa una. Leading auto = 120 %. Rangos: SV | AI/desktop/design-with-text/edit-format-text/character-panel-overview.html ; AI/using/properties-panel.html ; AI/using/line-character-spacing.html | P |
| Affinity | Formato de carácter «desde la barra contextual, el menú Text y el panel Character». Character: familia, tamaño, estilo, variaciones de fuente (ejes), kerning y tracking en milésimas de em (permilles), baseline, escalado. Rangos: SV | AFF/Text/characters.html ; AFF/Panels/characterPanel.html | P |
| Krita | Herramienta Texto: opciones mínimas (crear con preset, convertir tipo, abrir docker). El estilo vive en el docker Text Properties. «Type Setting Mode» edita en el lienzo tamaño de fuente, interlineado y baseline shift arrastrando líneas métricas | https://docs.krita.org/en/reference_manual/tools/text.html | P |
| Inkscape | Barra del Text tool con tamaño de fuente (selector), interlineado (con menú numérico y selector de unidad) e interletraje (menú con «Normal»). Rangos del spinbutton: están en un archivo `.ui` que esta copia del código no incluye → SV | INKSRC/src/ui/toolbar/text-toolbar.cpp (líneas 108-156, 243-248) | P (código) / SV (rangos) |
| Procreate | Doble toque en el texto abre el «Text Entry Companion»; tocar el nombre de la fuente abre **Edit Style** con deslizadores (tamaño, kerning, tracking, baseline…); se reabre igual sobre texto ya creado | https://help.procreate.com/procreate/handbook/text/text-edit | P |
| ibisPaint | Pestañas Size (deslizador), Spacing (deslizador) y espaciado entre filas (deslizador) al añadir texto | https://ibispaint.com/lecture/index.jsp?no=37&lang=en | P |
| Photopea / Figma / GIMP / SAI | SV | — | SV |

Rangos documentados: ninguno numérico en las páginas oficiales abiertas (Adobe, Affinity, Procreate). Las unidades sí (puntos, milésimas de em).

## 6. Tablet y accesibilidad: lo frecuente a un toque

| App | Respuesta | Fuente | Tipo |
|---|---|---|---|
| Procreate | Barra lateral: tamaño y opacidad (deslizadores), Undo y Redo (flechas; mantener = deshacer rápido; hasta 250 acciones), botón Modify (cuentagotas al tocar; al mantener+tocar elige color; reprogramable). Barra a izquierda o derecha, movible en altura, ocultable (entonces gestos hover) | https://help.procreate.com/procreate/handbook/interface-gestures/interface ; …/gestures | P |
| Procreate gestos | Deshacer: toque con dos dedos (mantener = rápido); rehacer: tres dedos (confirmar en el handbook de gestos; el foro cita swipe, antiguo) | https://help.procreate.com/procreate/handbook/interface-gestures/gestures | P / S (foro) |
| ibisPaint | Quick slider (tamaño+opacidad); Undo/Redo botones; dos dedos = deshacer, tres = rehacer; botones − / + de tamaño de pincel; cuentagotas rápido; v14.0 bloqueo de pincel (tamaño y opacidad fijos al cambiar de pincel) | https://ibispaint.com/lecture/index.jsp?no=151&lang=en ; https://ibispaint.com/lecture/index.jsp?no=08&lang=en | P |
| Photoshop iPad | Undo/Redo en barra de cabecera; dos dedos = deshacer, tres = rehacer; «Touch shortcut» (círculo movible) con acción primaria y secundaria por herramienta (ej. Pincel → Borrador / Cuentagotas; Marquee → proporción fija); opciones de herramienta flotantes | https://helpx.adobe.com/in/photoshop/using/touch-gesture-shortcuts-ipad.html ; https://helpx.adobe.com/photoshop/using/workspace-ipad.html | P |
| Affinity iPad | SV | — | SV |
| SAI | SV | — | SV |

## 7. ¿Cambia la barra/panel contextual al cambiar de herramienta con la tecla de atajo?

| App | Respuesta | Fuente | Tipo |
|---|---|---|---|
| Photoshop | La barra de opciones «muestra ajustes de la herramienta seleccionada»; los atajos seleccionan herramienta (misma API de selección). No hay documentado caso en que no siga | ADOBE_PS/get-started/learn-the-basics/workspace-overview.html ; atajos por tutoriales | P (inferencia) |
| Illustrator | Seleccionar «pulsando el atajo de la herramienta» es un método oficial de selección; Properties/Control cambian «según la selección o herramienta activa» | AI/using/tools.html ; AI/using/properties-panel.html | P (inferencia) |
| Affinity | «Cada vez que seleccionas una herramienta nueva, la barra contextual muestra sus opciones» | affinity.help …/Workspace/contextBar.html | P (inferencia) |
| Inkscape | Una sola barra visible; al cambiar la herramienta activa se oculta la anterior y se asigna escritorio a la nueva (`setDesktop`). Por qué vía entra el atajo: SV, pero toda la lógica cuelga del cambio de herramienta | INKSRC/src/ui/toolbar/toolbars.cpp | P (código) |
| Photopea | Barra superior con contenido por herramienta; teclas cambian herramienta | https://www.photopea.com/learn/workspace | P (inferencia) |
| Figma | El panel derecho sigue la selección, no la herramienta; el atajo solo cambia el cursor | help.figma.com (stroke / shape tools) | P (inferencia) |
| Procreate, SAI, ibisPaint, Krita, GIMP | SV | — | SV |

Conclusión del punto: en ninguna fuente abierta se documenta una excepción. Todas modelan «herramienta activa» como un único estado del que cuelga la barra; la tecla solo cambia ese estado.

---

## Lo que hacen casi todas

- Una barra/panel contextual que sigue la herramienta o la selección (Photoshop, Illustrator, Affinity, Photopea, Inkscape) y se actualiza al cambiar de herramienta por cualquier vía.
- Herramientas agrupadas en flyouts con triángulo (Photoshop, Illustrator, Photopea, GIMP); formas reunidas en un solo grupo/menú (Photoshop, Figma).
- El conjunto completo del trazo (cap, join, dash, alinear) vive en un panel dedicado (Illustrator Stroke, Affinity Stroke, Inkscape Fill and Stroke, Figma Advanced stroke).
- En tablet: tamaño y opacidad como dos deslizadores siempre visibles; deshacer con dos dedos, rehacer con tres (Procreate, ibisPaint, Photoshop iPad).
- Texto: el panel Character/Properties es el sitio completo; los controles básicos (fuente, tamaño) se duplican en una barra de acceso rápido.

## Divergencias

- Flyouts frente a botones planos: GIMP y Photoshop agrupan; Inkscape no agrupa (lista plana ocultable); Affinity lo deja a la personalización.
- Formas: un grupo con herramientas por forma (Photoshop, Figma), una herramienta paramétrica (Photopea: Polígono/Estrella/Espiral; Inkscape: Star y Arc con sector dentro), o gesto sin herramienta (Procreate QuickShape).
- Sector/arco: botón propio de forma en Affinity (Pie/Segment); parámetro dentro de la herramienta Arc en Inkscape; ausente en las listas de Photoshop y Krita.
- Sitio del trazo de un objeto existente: Figma lo muestra siempre en el panel (sección Stroke), Illustrator reparte entre Control/Properties y Stroke, Inkscape exige un diálogo.
- Dónde viven los ajustes: barra fija (Photoshop, Photopea, Inkscape), panel por selección (Figma, Illustrator Properties), flotante (Photoshop CTB, Photoshop iPad), lateral permanente (Procreate).

## Dónde alguna va MÁS ALLÁ del estándar

- **Affinity — barra contextual por objeto**: las formas muestran en la barra sus parámetros propios y presets, «Convert to Curves», y propiedades de trazo (dash) en las herramientas Pen y de forma; la barra del Node tool cambia según sea forma o curva. Fuente: AFF/CurvesShapes/draw_geometricShapes.html (P).
- **Photoshop — Contextual Task Bar flotante**: sobre una forma ofrece Fill, color/ancho/tipo de Stroke y Duplicar; con texto, alineación, espaciado y estilo de fuente. Fuente: ADOBE_PS/…/workspace-overview.html y página «Draw shapes» (P).
- **Illustrator — controles que aparecen solo si aplican**: Width Profile (herramienta Width o trazo variable), Corners al elegir una esquina con Direct Selection, Opciones de mezcla, icono de fuente variable (peso, tamaño óptico), Borrar efecto. Fuente: AI/using/properties-panel.html (P).
- **Photopea — Fill y Stroke de la capa de forma en la barra superior** cuando hay herramienta vectorial activa (snippet de https://www.photopea.com/learn/vg-creating, P).
- **Figma — trazo siempre expuesto**: posición (con vista previa al pasar el ratón), peso, extremos y trazos por lado sin abrir ningún panel adicional (P).
- **Krita — Type Setting Mode**: tamaño, interlineado y baseline shift se editan arrastrando guías sobre el propio texto en el lienzo (P).
- **Procreate — Edit Style al doble toque sobre el texto** con deslizadores; **Photoshop iPad — Touch shortcut** convierte modificadores de herramienta en un botón de pulgar (P).

---

## Notas de verificación y límites

- Adobe bloquea WebFetch y el Chrome sin cabecera; con `agent-browser --headed` sí se leyeron. Páginas inexistentes (404 en Adobe): `/photoshop/using/tools.html`, `/photoshop/using/tool-options-bar.html`, `/illustrator/desktop/…/contextual-task-bar.html`.
- No abrí: docs.krita.org docker Tool Options (404), GIMP docs (404), manual de SAI, página Affinity iPad, Procreate selección/relleno, páginas de Photoshop «Modify fill and stroke for shapes» y Character de Photoshop con rangos.
- Inkscape: no están en esta copia los archivos `share/ui/*.ui`, de ahí que rangos de spinbuttons y membresía exacta de botones queden SV.

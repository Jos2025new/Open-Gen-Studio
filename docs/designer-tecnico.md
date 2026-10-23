# Designer: documento técnico

Maestro técnico del Designer (2026-10-23, rama `task/workflow-ask-first`). Todo sale de la lectura del código, con `archivo:línea`; no se ejecutó la app. Los ajustes exactos de cada herramienta no se repiten aquí: la fuente de verdad es [[inventario-herramientas-designer]] (partes 1) y [[inventario-herramientas-designer-2]] (parte 2). La explicación para usuarios está en [[designer-guia-usuario]]. Detalle de comportamiento y pruebas por rasgo: [features/designer.md](features/designer.md) y [features/designer-selection.md](features/designer-selection.md).

Este documento tiene dos partes: esta (arquitectura, motor, persistencia, importar y exportar, herramientas) y [[designer-tecnico-2]] (superficies de la interfaz, hallazgos, trabajo pendiente y pruebas).

## Índice

1. [[#Visión general]]
2. [[#Componentes de la interfaz]]
3. [[#Estado del store]]
4. [[#Motor del documento]]
5. [[#Render y Stage]]
6. [[#Persistencia]]
7. [[#Importar y exportar]]
8. [[#Designer incrustado en Studio]]
9. [[#Herramientas]]
10. Parte 2: [[designer-tecnico-2#Superficies de la interfaz]], [[designer-tecnico-2#Hallazgos conocidos]], [[designer-tecnico-2#Trabajo de diseño pendiente]], [[designer-tecnico-2#Pruebas]]

Rutas abreviadas: `UI/` es `src/components/designer/`, `ENG/` es `src/engine/design/`.

## Visión general

El Designer es el espacio de trabajo de diseño por capas. `App.tsx:75` monta `DesignerWorkspace` cuando `ui.workspace` es el Designer. Un documento (`DesignDoc`, `src/engine/types.ts:868`) es una página con `width`, `height`, `background`, `layers` ordenadas de abajo arriba, `groups` (carpetas), `guides`, `paintMode` y `activeLayerId`. Los documentos viven dentro de la sesión (`session.docs`, `session.activeDocId`; `store.ts:222-223`), por eso cada chat tiene sus diseños.

Cuatro tipos de capa (`Layer`, `types.ts:857`), cada uno con las propiedades comunes de `LayerBase` (`visible`, `locked`, `opacity`, `blend`, `transform`, `groupId`; `types.ts:782`):

| Tipo | Contenido | Dónde se define |
|---|---|---|
| `raster` | Píxeles en un buffer de canvas más trazos editables (`paintStrokes`) hasta un límite | `types.ts:810`; buffers en `ENG/raster.ts` |
| `vector` | `shapes` (rectángulo, elipse, camino, primitivos) y `strokes` de Lineart; opcional `pixelMask` | `types.ts:840` |
| `text` | `text`, posición, ancho y `TextStyle` | `types.ts:849` |
| `fx` | Filtros y efectos no destructivos (`ops`, `scope` `below` o `layer`) | `src/engine/fx/types.ts:25` |

Qué contenido acepta cada tipo lo decide una sola tabla: `ACCEPTS` en `ENG/rules.ts:7` (`layerAccepts`, `placementError`). Una imagen colocada o generada está protegida contra el pincel salvo `allowPaint` (`isProtectedImage`, `rules.ts:27`).

Contrato de la ADR 0016 (Dibujo y Diseño): `paintModeOf` (`ENG/paintMode.ts:13`) decide si el pincel escribe píxeles (`drawing`) o deja trazos editables (`design`); un documento nuevo nace en `drawing` (`createDoc`, `ENG/doc.ts:44`). Ver [decisión 0016](decisions/0016-dibujo-y-diseno.md).

## Componentes de la interfaz

Todo está en `UI/` (45 archivos). Papel de los principales:

| Archivo | Papel |
|---|---|
| `DesignerWorkspace.tsx` | Raíz. Barra superior (`TopbarActions`), selector de documentos, paleta, ayuda, `Stage`, `LayersPanel`, atajos globales (`designerKey`, línea 63, en `DesignerWorkspace.tsx`) e importación (`DesignerWorkspace.tsx:84-120`) |
| `Stage.tsx` (1388 líneas) | Lienzo: vista (zoom y desplazamiento), reglas, entrada de puntero para todas las herramientas, selección y edición de objetos (`Stage`, línea 157) |
| `StagePaintCommit.ts` | Confirma un trazo de pincel: aplana, pide la decisión de Dibujo o Diseño, aplica el límite |
| `ToolPalette.tsx` / `ToolRail.tsx` | Carril de herramientas por familias (`RAIL`, `ToolRail.tsx:30`); `railTools()` (línea 55) lo usa el test de inventario |
| `ContextStrip.tsx` | Barra contextual sobre el carril (`ContextStrip`, línea 42); cambia de contenido según herramienta y selección |
| `ToolSettings.tsx` | Ajustes de la herramienta activa, en versión `compact` y completa (`ToolSettings`, línea 211) |
| `BrushSettings.tsx`, `StrokeStyleFields.tsx`, `ShapeLookFields.tsx`, `ShapePaint.tsx`, `PrimFields.tsx` | Campos de pincel, trazos de Lineart, aspecto de formas, relleno y borde, parámetros de primitivos |
| `LayersPanel.tsx` | Panel derecho: pestañas Properties, Tool y Layers; lista de capas, carpetas, acciones (`LayersPanel`, línea 85) |
| `FxPanel.tsx`, `LayerGeometry.tsx`, `AlignControls.tsx` | Edición de capas FX, X/Y/W/H, alineación y reparto |
| `PathNodes.tsx`, `MultiPathNodes.tsx`, `ShapeKnots.tsx`, `ShapeHandles.tsx` | Edición de nodos de un camino o de varios, tiradores de formas y degradados |
| `TextEditor.tsx` | Edición de texto sobre el lienzo |
| `InlineControls.tsx` | Los únicos controles de ajuste (deslizador, interruptor, lista, opciones, color); contrato `single-controls` de [map-contracts-2.md](map-contracts-2.md) |
| `ColorPlane.tsx`, `ColorChannels.tsx` | Selector de color |
| `SnapControl.tsx`, `SnapIndicator.tsx`, `snapIdle.ts` | Imán: popover, guías visibles y vigilancia de inactividad |
| `RasterLimitControls.tsx`, `DrawingChoice.tsx`, `LayerUnreadable.tsx`, `PaintModeToggle.tsx` | Límite de trazos, pregunta de Dibujo o Diseño, capa con píxeles ilegibles (D30), selector Drawing o Design |
| `CanvasSize.tsx`, `DocumentPicker.tsx` | Tamaño de página y miniaturas de documentos |
| `designerKeys.ts`, `designerClipboard.ts`, `designerFile.ts` | Atajos globales, copiar y pegar píxeles, importar y exportar |
| `ToolHelp.tsx` | Línea de ayuda de la herramienta y alternadores de vista (`ViewToggles`) |
| `StrokeRulerOverlay.tsx`, `BrushCursor.tsx` | Regla de trazos y cursor del pincel |

Los componentes grandes se dividieron para respetar el límite de 30 KB por archivo (por ejemplo `StagePaintCommit.ts`, `StageEditMarquee.ts`, `ENG/rasterCompose.ts`, `ENG/rasterDraw.ts`).

## Estado del store

El estado del Designer está en dos sitios:

- **Persistido en la sesión**: `session.docs` y `session.activeDocId`. Los cambios de documento pasan por `mutateDoc` (`ENG/actions.ts:42`), que registra el paso de deshacer salvo `record: false`.
- **Preferencias de interfaz** (`ui`, `store.ts`): `DEFAULT_UI` (`store.ts:232`) da `tool: 'move'`, `brush`, `lineart`, `shape` y `text`. El resto de campos (`wand`, `gradient`, `lineartMode`, `lineartInfluence`, `selectShape`, `selectMode`, `autoSelect`, `snapByMode`, `rulers`, `strokeRuler`, `strokeRulerKind`, `shapeLockRadii`, `toolHelp`, `designerDock`) se declaran en `UiState` (`store.ts:120`, campos hasta ~170) sin valor inicial. La tabla de valores por defecto y de qué herramienta comparte qué campo está en [[inventario-herramientas-designer#2. Estado compartido y valores por defecto]].
- **Fuera del store persistido, a propósito** (seleccionar no debe guardar): la selección de capas (`useLayerSelection`, `ENG/selection.ts:10`), la de objetos (`useObjectSelection`, `ENG/objectSelection.ts:13`), la edición de forma (`useShapeEdit`, `objectSelection.ts:29`), la selección de píxeles (`ENG/pixelSelection.ts:44`) y la regla de trazos (`ENG/strokeRuler.ts:27`).
- **Preferencias del navegador** (`usePref`): `ogs:layers-tab` (pestaña del panel, defecto `props`; `LayersPanel.tsx:103`) y `ogs:canvas-picker-open` (`DocumentPicker.tsx`).

Eventos de ventana que conectan piezas sin pasar por el store: `ogs:designer-zoom`, `ogs:designer-fit`, `ogs:designer-view`, `ogs:designer-panel`, `ogs:layers-toggle`, `ogs:upload`, `ogs:pan` (usos en `DesignerWorkspace.tsx`, `ContextStrip.tsx`, `designerKeys.ts`).

## Motor del documento

Todo el motor está en `ENG/` (`src/engine/design/`, unos 100 archivos), puro salvo donde toca canvas.

### Documento y capas

- `doc.ts`: constructores (`createDoc`, `newRasterLayer`, `newVectorLayer`, `newTextLayer`), `DOC_PRESETS` (`doc.ts:35`: Square 1:1 1080×1080, Portrait 4:5 1080×1350, Story 9:16 1080×1920, Landscape 16:9 1920×1080, Poster 2:3 1200×1800, A4 portrait 1240×1754), `FONT_STACKS` (seis familias), operaciones de capa (`insertLayer`, `updateLayer`, `removeLayer`, `moveLayer`, `reorderLayer`) y `DEFAULT_TEXT_STYLE` (`doc.ts:25`).
- `actions.ts`: capa de acciones con efectos sobre el store (documentos, capas, aplanar, fusionar hacia abajo, rasterizar, duplicar, deshacer y rehacer en `undoDoc`/`redoDoc`, colocar assets, exportar). Importado por 47 módulos (ver [map.md](map.md)).
- `groups.ts` (carpetas: una carpeta es un nombre sobre un tramo de capas, `groupId` en cada capa), `selection.ts` y `objectSelection.ts` (selección), `autoSelect.ts`, `marquee.ts`, `objectOps.ts` y `nudge.ts` (operaciones sobre objetos elegidos), `transform.ts`, `affine.ts` y `matrix.ts` (transformaciones).

### Capas ráster

- `raster.ts`: buffers de píxeles como instantáneas inmutables (copy-on-write; cabecera `raster.ts:14-18`), cada buffer guardado como una caja alrededor de sus píxeles (`rasterSurface.ts`). Funciones centrales: `getBuffer`, `getRasterSurface`, `ensureBuffers`, `beginEdit`/`commitEdit`, `beginLiveStroke`.
- Trazos editables y límite: un `RasterStroke` guarda segmentos, color y punta. En Diseño, una capa conserva hasta 64 trazos o 8192 segmentos y luego se aplana en el mismo paso de deshacer (`rasterLimit.ts:4,6`; aviso al 80 %, línea 7). En Dibujo no hay límite. Ver [raster-limit.md](raster-limit.md).
- `rasterCompose.ts` (base más trazos), `rasterDirty.ts` y `rasterBounds.ts` (zonas sucias y cajas), `rasterStrokeMask.ts` y `rasterStrokes.ts` (máscaras y cajas de trazos), `rasterHistoryTiles.ts` (mosaicos de 64×64 compartidos entre pasos de deshacer), `rasterMissing.ts` (por qué una edición ráster no puede correr: píxeles que fallaron al leer, D30).

### Pincel y trazos

- `brushEngine.ts`: punta ráster con dureza, presión sobre tamaño y densidad, textura (`none`, `paper`, `canvas`, `grain`), mezcla (seis modos) y `BRUSH_DEFAULTS` (`brushEngine.ts:64`). Un solo motor dibuja el trazo en vivo, el reconstruido y la vista previa de los ajustes (contrato `brush-one-engine`).
- `brushStroke.ts`: lo que el lienzo registra mientras el puntero se mueve; presión de lápiz y presión simulada que sigue la velocidad de la mano, no la frecuencia de eventos (`penPressure`, `brushStroke.ts:21`). `brushControl.ts` (suavizado y estabilizado, `brushPoint`, línea 5), `brushTextures.ts`.
- `strokes.ts`: trazos vectoriales de Lineart con presión (perfect-freehand); se reemplazan, nunca se mutan (cabecera `strokes.ts:10-13`); `DEFAULT_STROKE_STYLE` en `strokes.ts:16`.
- `strokeRuler.ts`: regla de trazos recta, elíptica o en perspectiva (`RulerKind`, línea 11).
- `symmetry.ts` y `ENG/nodeTypes.ts`: avisos de "no cambió nada" tras girar o reflejar, y tipos de nodo.

### Formas, caminos y relleno

`shapeTools.ts` y `shapeDraw.ts` (creación), `primitives.ts` y `primKnots.ts` (polígono, estrella, sector, arco, cuerda), `shapeLook.ts` (relleno, trazo, esquinas, difuminado; `MITER_DEFAULT`), `gradient.ts` y `gradientPaint.ts` (el degradado editable se guarda en coordenadas de página; contrato `gradient-frame`), `markers.ts` (puntas de flecha, una geometría unitaria; contrato `arrowhead-frame`), `path.ts`, `pathNodes.ts`, `pathNodeOps.ts`, `segmentDrag.ts`, `multiPathEdit.ts`, `multiRectEdit.ts` (edición de nodos y de varios elementos), `fill.ts` (cubo de pintura), `vectorMask.ts` (máscara de píxeles de una capa vectorial).

### Selección de píxeles

`pixelSelection.ts` (selección, invertir, ampliar y reducir), `pixelMove.ts` (mover lo seleccionado), `hitAlpha.ts` y `objectHit.ts` (qué hay bajo el puntero), `autoSelect.ts`.

### Reglas de herramienta

`DesignTool` (`rules.ts:31`) lista las 21 herramientas. `toolBlockReason` (`rules.ts:50`) devuelve el motivo por el que una herramienta no puede actuar sobre la capa activa o `null`:

- Nunca bloquean `hand`, `select`, `eyedropper`, `gradient` (línea 51) ni `brush` (línea 65: pinta en su propia capa si la activa no admite trazos).
- `move` exige capa activa y desbloqueada (líneas 52-56).
- `eraser` exige capa ráster, desbloqueada, visible y no protegida (líneas 58-64).
- Las herramientas de forma y texto crean una capa de su tipo si hace falta; solo bloquea una capa de su tipo bloqueada (línea 69).

### Capas FX

Registro único en `src/engine/fx/defs.ts` (ADR 0011, [decisión 0011](decisions/0011-capas-fx.md)); trece tipos: brightness, contrast, saturation, hue, grayscale, sepia, invert, blur, levels, curves, glow, shadow, flare (`fx/types.ts:9`). `fxPlan` (`fx/plan.ts:18`) decide qué filtra cada capa y en qué orden; lo usan el lienzo y la exportación SVG (contrato `fx-plan`). Los comandos (`runFx`, `ENG/fx.ts:6`) los comparten el panel y el agente (`designerFx.ts`, `designerTools.ts` en `src/engine/agent/`). Parámetros y rangos: [[inventario-herramientas-designer-2#7. Controles fuera de ToolSettings]].

### Límites de recursos

| Límite | Valor | Dónde |
|---|---|---|
| Lado máximo de página | 8192 px | `canvasSize.ts:15` |
| Lado máximo y píxeles al exportar con FX | 8192 px y 33 554 432 px | `exportLimits.ts:2-3` |
| Zoom máximo | 32 (3200 %) | `viewCoordinates.ts:11` |
| Pasos de deshacer por documento | 40 | `history.ts:26` |
| Memoria de píxeles del historial | 512 MiB por defecto, sin ajuste en la interfaz | `history.ts:28` |
| Presupuesto de cachés del editor | 256 MiB (FX de capa, FX below, máscaras de trazo; nunca el dibujo) | `cacheBudget.ts:60` |
| Caché de FX below | 48 000 000 px | `belowFxCache.ts:12` |
| Trazos editables por capa ráster | 64 trazos o 8192 segmentos | `rasterLimit.ts:4,6` |

### Historial

`history.ts` guarda instantáneas del documento con los buffers por referencia (copy-on-write), la selección de píxeles y las selecciones de capas y objetos, para que deshacer y rehacer devuelvan también lo que estaba elegido (`Snapshot`, `history.ts:11`). Cuando el límite de bytes descarta pasos, la barra superior lo dice con "History trimmed" (`DesignerWorkspace.tsx:52,93`).

## Render y Stage

- `render.ts`: `drawDoc` (`render.ts:251`) dibuja el documento capa por capa en coordenadas de página. Sin FX y en el editor usa la página retenida (`retainedPage.ts`: recompone solo la región que un cambio ensucia; márgenes de FX en `fxMargin`, línea 31; `retainedPlanner.ts` mantiene pasos estables). Con FX, `drawWithFx`; el resultado filtrado de cada capa se reutiliza mientras no cambie lo que lee (clave de contenido con `drawRevision.ts` y versión del buffer; contrato `fx-editor-cache`). `exportDoc` (`render.ts:466`) siempre calcula, sin cachés.
- `Stage.tsx` posee el `<canvas>`, la vista (zoom y desplazamiento; `viewCoordinates.ts`), las reglas (`Ruler`, línea 104) y todo el manejo de puntero (`onPointerDown`, línea 593). Delega: confirmar trazos en `StagePaintCommit.ts`, marquesina de Edit en `StageEditMarquee.ts`, imanes en `snapSession.ts`/`snap.ts` (tolerancia fija de 10 px de pantalla, `snap.ts:25`), nodos en `PathNodes.tsx`, vista previa del cursor en `cursorPreview.ts`/`useCursorPreview.ts`.
- Rendimiento: el protocolo y las sondas están en [depuracion.md](depuracion.md#protocolo); lo medido hoy, en la sección "Qué se mide hoy" de ese documento.

## Persistencia

Las reglas de guardado están en [persistencia-protegida.md](persistencia-protegida.md) (regla 5 de AGENTS.md): este documento no las reformula. Lo que importa al Designer:

- Los documentos (metadatos, capas, trazos editables, formas, texto) viajan con la sesión por el guardado protegido (`flushWrite` y `saveNow` de `store.ts`, zona protegida).
- Los píxeles de cada capa ráster no van en la sesión: se guardan como PNG en IndexedDB con la clave `raster:<layerId>` (`keyFor`, `raster.ts:28`; escritura en `writeLayer`, `raster.ts:484`, zona protegida). Una escritura se programa 700 ms después del último cambio (`PERSIST_DELAY_MS`, `raster.ts:450`) y `flushRaster` (`raster.ts:519`) la fuerza al ocultar o cerrar la pestaña (`raster.ts:534-536`).
- Una capa cuyos píxeles no se pudieron leer nunca se guarda en blanco encima (D30); se marca en Layers y un clic reintenta (`LayerUnreadable.tsx`, `rasterMissing.ts`).
- Cambios que toquen estas funciones exigen la autorización explícita de la regla 5. Ver también la [arquitectura del guardado](arquitectura-guardado.md).

## Importar y exportar

Todo en `designerFile.ts` y `ENG/actions.ts`.

| Acción | Código |
|---|---|
| Importar imagen | `importDesignFiles` (`designerFile.ts:19`); acepta PNG, JPEG, WebP, GIF, SVG, HEIC/HEIF y EPS (`IMPORT_ACCEPT`, línea 17). HEIC y EPS pasan antes por conversión a PNG; lo que no se puede leer dice por qué en un aviso. Las imágenes se colocan con `placeImportedImages` (`importImages.ts`) |
| Importar SVG | Un SVG se convierte en un diseño propio con carpetas, formas editables e imágenes para lo que no se puede editar (`importSvgFile`, `svgImport/apply.ts:7`; sanea antes, contrato `svg-import`) |
| Traer desde el chat | `chatToDesigner` y `chatImagesNotInDesigner` (`fromChat.ts`), con el selector "As layers of one" o "Each as a design" (`DesignerWorkspace.tsx`) |
| Exportar a archivo | `exportDocFile` (`actions.ts:440`): PNG y JPG por `exportDoc`; SVG por `docToSvg` (`export.ts:107`); PDF por `svgToPdf` (`export.ts:174`, vectorial, texto en fuentes estándar). Formatos y etiquetas en `EXPORT_FORMATS` (`designerFile.ts:11`) |
| Guardar en la galería | `saveDocToGallery` (`actions.ts:467`): exporta PNG y lo guarda como asset de origen `design` |
| Límites al exportar | `checkExportSize` (`exportLimits.ts:5`): el tope de píxeles solo limita cuando hay FX efectivos |
| Copiar y pegar | `designerClipboard` (`designerClipboard.ts:14`): copia los píxeles de la capa y pega imágenes |

Los errores de exportación llegan al aviso (`runDesignOutput`, `designerFile.ts`), sin reducir la imagen en silencio (contrato `raster-export-resolution`). El SVG avisa de lo que el archivo no pudo conservar (`svgDeps().notice`, `actions.ts:455`).

## Designer incrustado en Studio

Studio muestra una versión reducida en su tablero (`StudioBoard.tsx:33` monta `EmbeddedDesigner`). Es otra raíz con los mismos `Stage`, motor y campos:

- `EmbeddedDesigner.tsx:23`: barra superior propia (menú de archivo `EmbeddedFileMenu`, nombre, Select and move, Pan, Undo, Redo, zoom), el `Stage` y una barra inferior.
- `EmbeddedDesignerBar.tsx`: carril reducido; solo estas herramientas (`EMBEDDED_TOOLS`, línea 14): `move`, `hand`, `lineart`, `eraser`, `text` y las formas y líneas. Si la herramienta activa no está en el conjunto, vuelve a `move`. Usa `ContextStrip` solo para texto y formas, y el selector de color y de tamaño del propio Designer.
- Los atajos solo actúan con el foco dentro del tablero y reciben el conjunto de herramientas permitidas (`designerKey(e, id, doc, EMBEDDED_TOOLS)`, `EmbeddedDesigner.tsx`); no incluye Shift+R (reglas).
- No monta `LayersPanel`: usa `EmbeddedLayers`. Más en [features/studio.md](features/studio.md).
- Prueba: `tests/studio-designer.test.ts`.

## Herramientas

Las 21 herramientas con todos sus ajustes, condiciones y `archivo:línea` están en [[inventario-herramientas-designer#3. Herramientas, una a una]]. Aquí solo el mapa y a quién pertenece cada comportamiento. Cada subsección enlaza al apartado de la guía de usuario.

### Edit y Pan

`move` (V) y `hand` (H). Edit actúa sobre objetos o capas (`Object`/`Layer`), con Auto-select, Snap, Align y Transform. Pan no tiene ajustes. Inventario: [[inventario-herramientas-designer#3.1 Edit (`move`, tecla V)]] y [[inventario-herramientas-designer#3.2 Pan (`hand`, tecla H)]]. Guía: [[designer-guia-usuario#Edit (mover y editar)]], [[designer-guia-usuario#Pan (mover la vista)]]. Código clave: `StageEditMarquee.ts`, `objectOps.ts`, `transform.ts`, `snap*.ts`, `AlignControls.tsx`.

### Selección de píxeles

`select` (M): rectángulo, lazo y varita mágica. Inventario: [[inventario-herramientas-designer#3.3 Select pixels (`select`, tecla M)]]. Guía: [[designer-guia-usuario#Select pixels (selección)]]. Código clave: `pixelSelection.ts`, `pixelMove.ts`, `ToolSettings.tsx:165-188`.

### Cuentagotas, cubo y degradado

`eyedropper` (I), `fill` (G) y `gradient` (U). Inventario: [[inventario-herramientas-designer#3.4 Eyedropper (`eyedropper`, tecla I)]], [[inventario-herramientas-designer#3.5 Fill (`fill`, tecla G)]], [[inventario-herramientas-designer#3.6 Gradient (`gradient`, tecla U)]]. Guía: [[designer-guia-usuario#Eyedropper (cuentagotas)]], [[designer-guia-usuario#Fill (cubo)]], [[designer-guia-usuario#Gradient (degradado)]]. Código: `fill.ts`, `gradient.ts`.

### Pincel y borrador

`brush` (B) y `eraser` (E) comparten `BrushSettings`. Inventario: [[inventario-herramientas-designer#3.7 Brush (`brush`, tecla B) y 3.8 Eraser (`eraser`, tecla E)]]. Guía: [[designer-guia-usuario#Brush (pincel)]], [[designer-guia-usuario#Eraser (borrador)]]. Código: `brushEngine.ts`, `brushStroke.ts`, `StagePaintCommit.ts`, `paintMode.ts`, `drawingChoice.ts`.

### Lineart y Ruler

`lineart` (P) dibuja trazos vectoriales con presión; `ruler` (K) coloca una guía que el pincel puede seguir. Inventario: [[inventario-herramientas-designer#3.9 Lineart (`lineart`, tecla P)]], [[inventario-herramientas-designer#3.10 Ruler (`ruler`, tecla K)]]. Guía: [[designer-guia-usuario#Lineart (línea artística)]], [[designer-guia-usuario#Ruler (regla de trazos)]]. Código: `strokes.ts`, `strokeRuler.ts`, `StrokeRulerOverlay.tsx`.

### Text

`text` (T). Inventario: [[inventario-herramientas-designer#3.11 Text (`text`, tecla T)]]. Guía: [[designer-guia-usuario#Text (texto)]]. Código: `TextEditor.tsx`, `textLayout.ts`, `TextStyleFields` en `ToolSettings.tsx:197-209`.

### Formas y líneas

Diez herramientas con `ui.shape` común: Rectangle (R), Ellipse (O), Polygon, Star, Sector, Arc, Chord, Line (L), Curve, Arrow. Inventario: [[inventario-herramientas-designer#3.12 Formas y líneas]]. Guía: [[designer-guia-usuario#Formas y líneas]]. Edición de una forma ya creada: [[inventario-herramientas-designer-2#4.3 Forma elegida (CS:80-106)]]. Código: `shapeTools.ts`, `shapeDraw.ts`, `primitives.ts`, `ShapeKnots.tsx`, `PathNodes.tsx`.

Atajos de todas las herramientas: [[inventario-herramientas-designer-2#6. Atajos de teclado]]. Guía: [[designer-guia-usuario#Atajos de teclado]].

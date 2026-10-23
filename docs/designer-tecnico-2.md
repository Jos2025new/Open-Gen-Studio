# Designer: documento técnico, parte 2

Continuación de [[designer-tecnico]], que tiene el índice, la arquitectura, el motor, la persistencia y el mapa de herramientas. Esta parte cubre las superficies de la interfaz, los hallazgos, el trabajo pendiente y las pruebas. Mismas abreviaturas: `UI/` es `src/components/designer/` y `ENG/` es `src/engine/design/`. Fuente de los ajustes: [[inventario-herramientas-designer]] y [[inventario-herramientas-designer-2]]. Para usuarios: [[designer-guia-usuario]].

## Superficies de la interfaz

### Barra superior

`TopbarActions` en `DesignerWorkspace.tsx:84-120`, de izquierda a derecha: `New document` (menú de presets, `DOC_PRESETS`), `Undo`, `Redo` (con el texto "History trimmed" si el historial perdió pasos), `Import image`, `Transform` (versión `turnOnly` de `EditOps`), `Show or hide right panel`, el chip `Selection` (si hay selección de píxeles y otra herramienta activa), `Canvas size` (`CanvasSize.tsx:10`), `Save to gallery` (con confirmación) y `Export` (menú PNG, JPG, SVG, PDF). Guía: [[designer-guia-usuario#La barra superior]].

### Selector de documentos

`DocumentPicker.tsx`: una píldora con el nombre del documento que despliega miniaturas de 144×96 de todos los diseños de la sesión; queda abierta hasta cerrarla (preferencia `ogs:canvas-picker-open`). Sin documento, `DesignerWorkspace` muestra "Start a design" con los seis presets (`DesignerWorkspace.tsx`, rama final). Guía: [[designer-guia-usuario#Crear y abrir un documento]].

### Carril y dock de herramientas

`ToolRail.tsx`: familias en `RAIL` (línea 30): Edit (`move`, `hand`), Select (`select`), Paint (`brush`, `eraser`, `lineart`, grupo Fill and gradient), Shapes and text (grupo Shapes and lines, `text`), Guides and color (`ruler`, `eyedropper`). Los grupos abren un menú de variantes (`ToolGroup`, línea 57 en adelante). Cada botón muestra su atajo entre paréntesis; los bloqueos de `toolBlockReason` aparecen como consejo del botón. `tests/designer-inventory.test.ts` falla si una herramienta no tiene sitio en el carril.

Dónde se dibuja: `ui.designerDock` (`'tools'` por defecto o `'prompt'`) decide si la parte baja del Designer muestra el carril o la caja de prompt. En `tools` el carril lo monta el compositor (`Composer.tsx:444`); `ToolPalette.tsx` solo lo dibuja cuando el dock no es `tools` (`ToolPalette.tsx:8,23`) y siempre dibuja los controles de vista (zoom, Fit canvas, reglas, ayuda). Enviar un prompt desde el Designer cambia el dock a `prompt` (`Composer.tsx:285`, `engine/actions.ts:662`).

### Barra contextual

`ContextStrip.tsx:42`. Etiqueta "<Herramienta> → <capa>" más el contenido según un orden fijo de decisión (varios caminos, texto, forma elegida, ajustes compactos). Orden y controles en [[inventario-herramientas-designer-2#4. Controles que dependen de la selección]]. Con Pan no se muestra nada (`ContextStrip.tsx:59`). Guía: [[designer-guia-usuario#Ajustes de una herramienta]].

### Panel derecho

`LayersPanel.tsx:85`, ancho redimensionable de 200 a 520 px (`MIN_W`, `MAX_W`, líneas 31-32; doble clic en el borde restaura 260). Tres pestañas: `Properties` (capa seleccionada), `Tool` (ajustes completos de la herramienta) y `Layers` (solo la lista). La pestaña recordada es `ogs:layers-tab` (defecto `props`). Encima de la lista, `Layer appearance` con `Opacity` y `Blend`. La lista inferior se redimensiona con el separador (doble clic: 240 px). Acciones y menús: [[inventario-herramientas-designer-2#5. Acciones de objeto y de capa]]. Capas FX: `FxPanel.tsx`. Guía: [[designer-guia-usuario#Capas]].

### Popovers

Todos usan `Popover` y `usePopover` de `src/components/ui/Popover.tsx`: presets de documento, formato de exportación, confirmación de "Save to gallery" (`confirm-pop`; no se usa el `confirm()` nativo, regla de AGENTS.md), `Canvas size` (ancho, alto, "Keep ratio", cuadrícula `Anchor`, `Trim to content`, `Apply`; límite 8192), `Snap`, selector de color (260 px), relleno y trazo de formas, y el panel Shape. Detalle de Snap, Align, límite de trazos y selector de color: [[inventario-herramientas-designer-2#7. Controles fuera de ToolSettings]]. Guía: [[designer-guia-usuario#Tamaño del lienzo]].

### Pregunta de Dibujo o Diseño

`DrawingChoice.tsx` y `ENG/drawingChoice.ts`: pintar en Drawing sobre una capa con trazos editables rechaza el trazo y pregunta una de tres acciones (`flatten`, `design`, `newLayer`); "Don't show again" guarda la elección (`drawingPreference`, `drawingChoice.ts:19`). Cerrar la pregunta no hace nada. Ajustes la reinicia. Guía: [[designer-guia-usuario#Drawing y Design]].

### Atajos

Dos fuentes: la lista que ve Ajustes → Shortcuts (`src/engine/shortcuts.ts`, `DESIGN_TOOL_KEYS` en la línea 4) y el manejador `designerKey` (`designerKeys.ts:31`). Hay un test que las compara con el README (`tests/readme-shortcuts.test.ts`, contrato `shortcuts` de [map-contracts.md](map-contracts.md)). Tabla completa en [[inventario-herramientas-designer-2#6. Atajos de teclado]]. Se ignoran con foco en un campo de texto o con un popover abierto. Guía: [[designer-guia-usuario#Atajos de teclado]].

## Hallazgos conocidos

Copiados del apartado 8 de [[inventario-herramientas-designer-2#8. Hallazgos]], con el estado de verificación. Ninguno se comprobó ejecutando la app.

1. **Compacto frente a completo**: Brush y Eraser pierden casi todo en la barra contextual; Fill, Gradient, Text, Select y las formas también pierden campos. Cierto por lectura (`ToolSettings.tsx`, `BrushSettings.tsx`).
2. **Sin lugar de edición**: `Line` y `Spacing` de un texto ya creado. Además `Weight` en Properties va de 300 a 900 y en Text de 100 a 900.
3. **Barra de forma elegida**: sustituye a los ajustes de Edit, así que `Edit` (Object/Layer) y `Auto-select` solo quedan en la pestaña Tool.
4. **Sin guardar**: `Grow / shrink`, `Advanced settings` de Brush y el paso `Start`/`End` del degradado se pierden al cambiar de herramienta o de selección.
5. **`Influence`** de Lineart aparece en Edit aunque no haya curvas; la edición de una curva elegida solo sale en la pestaña Tool (`ContextStrip` pasa `selectedCurve={null}`).
6. **Ramas inalcanzables en `designerKeys.ts:78-97`** (lectura confirmada en esta revisión): el bloque de `Delete`/`Backspace` para borrar capas (líneas 87-92) y el de cambiar de herramienta con una tecla (líneas 93-96) quedan dentro de la rama que exige una flecha (`ARROW_STEP[e.key]`, línea 78), así que por lectura no se alcanzan. `tests/studio-designer.test.ts:163-175` solo comprueba que `b` no cambia de herramienta en el Designer incrustado, algo que se cumpliría igual. Pendiente de una prueba antes de decidir (cambia atajos de teclado: contrato `shortcuts`).
7. **Límites distintos**: `Sides` llega a 12 al crear y a 24 al editar.
8. **Siete herramientas sin tecla**: Polygon, Star, Sector, Arc, Chord, Curve, Arrow.
9. **Arrow sin ajustes propios**: las puntas solo se cambian en el popover `Stroke` de una forma ya elegida.

Si se corrige alguno, cambia también la guía ([[designer-guia-usuario]]) y el inventario en el mismo commit.

## Trabajo de diseño pendiente

- **Toolbox como dock con barra contextual**: [[propuesta-toolbox-dock]] (2026-10-23, sin implementar). Principios: una sola zona de control, tres profundidades (familia, tira de variantes, panel completo), barra contextual única, píldora "Modo · Herramienta" y huecos "Pronto" deshabilitados. Plan en seis pasos; empieza por la píldora y Deshacer/Rehacer en iconos. Decisiones pendientes del usuario al final de la propuesta.
- **Maqueta**: [toolbox-dock.html](mockups/toolbox-dock.html), con variantes de icono arriba, ajustes en medio y once iconos abajo. Sus ajustes todavía hay que corregirlos con el inventario: [[inventario-herramientas-designer]] es la fuente de verdad, no la maqueta.
- **Identidad visual**: cualquier cambio de tarjetas o temas exige aprobación explícita (regla 6 de AGENTS.md; [propuesta-temas.md](propuesta-temas.md)). La propuesta adopta el comportamiento de la prueba de concepto, no su estética.
- **Los hallazgos de arriba** (sobre todo el 6) son candidatos a trabajo; el hallazgo 6 necesita primero una prueba que lo demuestre.

## Pruebas

Mapa por área; las listas completas, por contrato, están en [map-contracts.md](map-contracts.md) y [map-contracts-2.md](map-contracts-2.md). Los nombres son de `tests/` (Vitest) y `tests-e2e/` (Playwright). Regla 4 de AGENTS.md: tras cada cambio `npm run test:related`; al entregar `npm test`.

| Área | Pruebas |
|---|---|
| Documento y capas | `engine.test.ts`, `layer-groups.test.ts`, `layer-drag.test.ts`, `layer-range.test.ts`, `layer-click-replaces.test.ts`, `prune-picks.test.ts`, `designer-layer-fixes.test.ts`, `designer-audit-d23-d28.test.ts` |
| Reglas y carril | `designer-inventory.test.ts`, `edit-mode-toggle.test.ts`, `designer-context-menu.test.ts` |
| Ráster: píxeles, trazos, límite | `raster-strokes.test.ts`, `raster-stroke-mask.test.ts`, `raster-surface.test.ts`, `raster-pixel-box.test.ts`, `raster-commit-box.test.ts`, `raster-limit.test.ts`, `raster-history-tiles.test.ts`, `raster-unreadable.test.ts`, `raster-idle-save.test.ts`, `paint-resize.test.ts` |
| Pincel y presión | `brush-engine.test.ts`, `brush-control.test.ts`, `brush-pressure.test.ts`, `simulated-pressure-rate.test.ts`, `keep-opacity-lock.test.ts`, `cursor-preview.test.ts`, `stroke-ruler.test.ts` |
| Dibujo o Diseño | `paint-mode.test.ts`, `paint-mode-history.test.ts`, `paint-mode-pin.test.ts`, `paint-mode-default.test.ts`, `drawing-choice.test.ts`, `drawing-choice-position.test.ts` |
| Trazos de Lineart | `strokes.test.ts`, `stroke-matrix.test.ts`, `stroke-transform.test.ts` |
| Formas y caminos | `primitives.test.ts`, `shape-tools.test.ts`, `shape-look.test.ts`, `shape-paint.test.ts`, `shape-handles.test.ts`, `shape-opacity.test.ts`, `gradients.test.ts`, `markers.test.ts`, `path-nodes.test.ts`, `path-nodes-mount.test.ts`, `path-node-snap.test.ts`, `multi-path-edit.test.ts`, `multi-layer-rect-rounding.test.ts`, `primKnots.test.ts` |
| Selección y objetos | `marquee.test.ts`, `auto-select.test.ts`, `object-hit.test.ts`, `object-ops.test.ts`, `hit-alpha.test.ts`, `pixel-selection.test.ts`, `pixel-move.test.ts`, `layer-transform.test.ts`, `affine.test.ts`, `nudge-layers.test.ts`, `symmetry-note.test.ts` |
| Imán y guías | `snap.test.ts`, `snap-mode.test.ts`, `snap-session.test.ts`, `snap-spacing.test.ts`, `snap-nodes.test.ts`, `snap-tolerance.test.ts`, `snap-indicator.test.ts`, `snap-idle-bridge.test.ts`, `snap-speed.test.ts`, `snap-watchdog.test.ts`, `guides.test.ts` |
| Render, FX y cachés | `fx-render.test.ts`, `fx-svg.test.ts`, `fx-commands.test.ts`, `fx-agent.test.ts`, `below-fx-cache.test.ts`, `cache-budget.test.ts`, `draw-revision.test.ts`, `retained-page-plan.test.ts`, `retained-page-planner.test.ts`, `retained-page-dirty.test.ts`, `retained-page-margins.test.ts`, `view-coordinates.test.ts` |
| Historial | `history-bytes.test.ts`, `turn-invariants.test.ts` |
| Importar, exportar, tamaño | `design-export.test.ts`, `svg-import.test.ts`, `svg-import-resvg.test.ts`, `import-images.test.ts`, `import-accepts.test.ts`, `chat-to-designer.test.ts`, `canvas-size.test.ts`, `trim-content-bounds.test.ts` |
| Color y fuentes | `color-picker-render.test.ts`, `swatches.test.ts`, `fonts.test.ts`, `theme-tokens.test.ts`, `ui-single-slider.test.ts` |
| Studio incrustado | `studio-designer.test.ts` |
| Guardado de píxeles | `raster-persist.test.ts`, `writer-lock-raster.test.ts`, `save-now.test.ts` (zona protegida: [persistencia-protegida.md](persistencia-protegida.md)) |
| Rendimiento | `designer-bench.test.ts`, `designer-bench-professional.test.ts` |
| De extremo a extremo (navegador) | `tests-e2e/designer-flows.spec.ts`, `designer-tools.spec.ts`, `designer-monkey.spec.ts`, `brush-visual.spec.ts`, `fx-visual.spec.ts`, `lineart-scale.spec.ts`, `edit-marquee.spec.ts`, `multi-select.spec.ts`, `node-selection.spec.ts`, `path-nodes.spec.ts`, `path-nodes-ux.spec.ts`, `shape-knots.spec.ts`, `snapping.spec.ts`, `raster-performance.spec.ts` |

### Dónde falta cobertura

[map.md](map.md) lista los módulos que ningún test importa, ni siquiera de forma indirecta. Del Designer: `CanvasSize.tsx` (el motor `canvasSize.ts` sí está cubierto por `canvas-size.test.ts` y `trim-content-bounds.test.ts`; falta el popover, el bloqueo de proporción y el aviso de error), `DesignerWorkspace.tsx`, `DrawingChoice.tsx` (el motor `drawingChoice.ts` sí tiene prueba), `FxPanel.tsx` (los comandos `runFx` sí), `LayerGeometry.tsx`, `LayerUnreadable.tsx`, `LayersPanel.tsx`, `RasterLimitControls.tsx` (el motor `rasterLimit.ts` sí) y `ToolPalette.tsx`. Otros archivos de `UI/` no los importa ningún test por su nombre (aunque algunos se alcanzan de forma transitiva): `ContextStrip.tsx`, `BrushSettings.tsx`, `AlignControls.tsx`, `SnapControl.tsx`, `StrokeStyleFields.tsx`, `ShapeLookFields.tsx`, `PrimFields.tsx`, `TextEditor.tsx`, `InlineControls.tsx`. Las pruebas de extremo a extremo cubren parte de esa interfaz, pero no corren en `npm test` y no entran en el mapa. Los hallazgos del apartado anterior (6 en particular) tampoco tienen prueba que los demuestre.

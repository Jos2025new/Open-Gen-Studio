---
type: inventario
title: Huecos de las maquetas y decisiones abiertas
description: Controles que las maquetas de ajustes pierden o no dibujan, controles nuevos que introduce la propuesta y decisiones sin cerrar.
tags: [designer, propuesta, huecos, decisiones]
updated: 2026-10-28
related: [README, hallazgos, pincel-avanzado, alinear-editar, capas, navegacion-zoom, toolbox-dock]
---
# Huecos de las maquetas y decisiones abiertas

La propuesta es la reagrupación de las maquetas de [ajustes](../mockups/designer-ajustes/index.html) tal como se revisó con el usuario: A1 (bloque principal del pincel), A2 (acciones de capa), A4 (Modo de selección), A5 (Add de FX arriba), B6-B7 (iconos), C9 (Advanced del pincel), C10 (guías), C11 (alinear), C13 («To» pasa a «End»), D14 (navegador), F (controles rápidos en la fila de variantes) y G (muestra de color fija). B8 (quitar el botón del panel derecho del dock) quedó DESCARTADA y no se aplica. El criterio por defecto es **conservar**; ningún control se elimina salvo el interruptor «Advanced settings» del panel del pincel (lo sustituye el bloque plegable Advanced, misma función). Las columnas de propuesta de cada nota salen de esta lectura; este documento reúne lo que no encaja en una fila.

## 1. Controles que las maquetas pierden

Estos controles existen hoy y la maqueta correspondiente los **omite o reduce**. La propuesta revisada los conserva todos:

| Maqueta | Qué pierde | Qué hay que hacer |
| --- | --- | --- |
| [C11 alinear](../mockups/designer-ajustes/c11-alinear.html) | Las 4 acciones borde a ancla (`Align left edge to anchor’s right edge`, `Align right edge to anchor’s left edge`, `Align top edge to anchor’s bottom edge`, `Align bottom edge to anchor’s top edge`), con su aviso «Choose an anchor from at least two selected objects or layers.» | Conservarlas: dónde (segunda línea de «Align» o grupo propio) queda por decidir (decisión 5). Hoy son 10 acciones de alineación (5 + 5), la maqueta dibuja 6 |
| [C11 alinear](../mockups/designer-ajustes/c11-alinear.html) | 4 de las 6 referencias del select «Relative to»: `First selected`, `Last selected`, `Biggest`, `Smallest` (solo dibuja `Page` y `Selection`) | Conservar las 6; sin ellas las 4 acciones de ancla no sirven |
| [A1 pincel](../mockups/designer-ajustes/a1-brush-orden.html) y [C9](../mockups/designer-ajustes/c9-brush-avanzado.html) | 6 de los 14 presets de tamaño: hoy 2, 5, 8, 12, 16, 24, 32, 40, 48, 64, 80, 96, 128, 200; la maqueta deja 2, 5, 12, 24, 40, 64, 96, 200 (se pierden 8, 16, 32, 48, 80, 128) | Reducción NO aprobada: se mantienen los 14 (decisión 2) |
| [A1](../mockups/designer-ajustes/a1-brush-orden.html) y [C9](../mockups/designer-ajustes/c9-brush-avanzado.html) | Sin dibujar en el panel del pincel: `Drawing / Design`, `Hardness`, el widget de punta con `Angle` y `Roundness`, `Follow stroke`, `Mirror`, `Simulate pressure`, `Speed influence`, la lectura de presión, `Pressure → size`, `Min size`, `Pressure → density`, `Min density` y `Keep opacity` | Colocarlos explícitamente (columna Estado de [[pincel-avanzado]]); la colocación dentro de Advanced es mía y está sin confirmar (decisión 4) |
| [C9](../mockups/designer-ajustes/c9-brush-avanzado.html) | El widget de forma de punta está citado («no se muestra»), no dibujado | Va con Tip dentro de Advanced |
| [A1](../mockups/designer-ajustes/a1-brush-orden.html) y [C9](../mockups/designer-ajustes/c9-brush-avanzado.html) | Solo cubren la rama del panel (`BrushSettings` sin tarjeta). La **tarjeta del dock** con pestañas Tip / Stroke / Pressure / Blend, y la tira compacta, no están dibujadas | Se conservan sin cambio (decisión 10) |
| [A2 capas](../mockups/designer-ajustes/a2-capas-acciones.html) | Las cabeceras de carpeta (ojo y candado), `Opacity` y `Blend`, el campo `Name`, el arrastre, los avisos y controles del límite de trazos | No cambian; solo la carpeta pide decidir el ojo a la izquierda (decisión 11) |
| [A4 selección](../mockups/designer-ajustes/a4-seleccion-modo.html) | Solo dibuja la rama de la varita. Faltan `All`, `Invert`, `Deselect`, `Grow / shrink`, `Grow`, `Shrink`, `Delete`, `Fill`, `To layer` y las ramas Rectangular y Lasso | No cambian |
| [A5 FX](../mockups/designer-ajustes/a5-fx-add-arriba.html) | Las filas de operación (interruptor, nombre, subir, bajar, quitar con confirmación), `Applies to`, `Edit as filter layer` | No cambian |
| [C10 guías](../mockups/designer-ajustes/c10-guias.html) | Estados deshabilitados (`Clear all guides` sin guías) y los gestos de regla y arrastre | No cambian |
| [C13 gradiente](../mockups/designer-ajustes/c13-gradiente-end.html) | Las opciones de «End» (`Second color` y `Transparent`) y `Opacity` | Solo cambia la etiqueta |
| [D14 navegador](../mockups/designer-ajustes/d14-navegador.html) | El campo de porcentaje editable y `Fit canvas`; dibuja un slider en % y un botón `100 %` | Conservar campo y Fit canvas (decisión 6) |
| [F variantes](../mockups/designer-ajustes/f-variantes.html) | F1 solo Size, Opacity, Hardness; F2 solo Font y Size (faltan Weight, Color, Align, Line, Spacing); F3 solo color y tamaño | Los demás ajustes siguen en la tarjeta |

## 2. Controles NUEVOS de la propuesta

Ninguno está en la matriz de estado actual (no existen hoy). Todos los de la fila de variantes y del dock escriben el mismo estado que las tarjetas completas; si no, serían estados duplicados.

| Control | Dónde | Estado que escribe | Maqueta | Nota |
| --- | --- | --- | --- | --- |
| Navegador (miniatura con rectángulo de vista) | Arriba del panel derecho, plegable | Ninguno (lee zoom y encuadre del `Stage`) | [D14](../mockups/designer-ajustes/d14-navegador.html) | El rectángulo de vista es nuevo |
| Fila Zoom: slider en %, botón `100 %` | Navegador | El mismo zoom (`ogs:designer-zoom`) | [D14](../mockups/designer-ajustes/d14-navegador.html) | Duplica zoom in / out / porcentaje de la barra vertical |
| Fila Angle: slider en °, girar izquierda, girar derecha, `0°` | Navegador | **Lógica nueva**: hoy no hay rotación ni volteo de la vista del lienzo | [D14](../mockups/designer-ajustes/d14-navegador.html) | Sin estado ni motor hoy; aprobar o descartar (decisión 7) |
| Size, Opacity, Hardness en la fila de variantes de Eraser | Dock, fila de variantes | `ui.brush.size`, `ui.brush.opacity`, `ui.brush.hardness` | [F1](../mockups/designer-ajustes/f-variantes.html) | Mismo estado que la tarjeta |
| Font y Size en la fila de variantes de Text | Dock, fila de variantes | `ui.text.fontFamily` y `ui.text.fontSize` | [F2](../mockups/designer-ajustes/f-variantes.html) | Con un texto seleccionado la tira (solo con Edit abierto: «no alcanzable por lectura — requiere prueba en sandbox») edita ESA capa, no «el siguiente texto»: la fila debe decir cuál (decisión 8) |
| Chip de color y chip de tamaño en las variantes de pincel | Dock, fila de variantes (Brush, Pencil, Airbrush, Fill, Gradient) | Color y tamaño de la herramienta activa | [F3](../mockups/designer-ajustes/f-variantes.html) | Precedente: `useToolPaint` del Designer embebido ([[estudio-embebido]]) |
| Muestra de color fija al final del dock | Dock, tras Settings | Ver decisión 9 | [G](../mockups/designer-ajustes/g-swatch-dock.html) | Un color secundario global (G-B) sería **estado nuevo**; opcional |
| Bloque plegable Advanced | Panel del pincel | Preferencia de «abierto» (como `propertiesOpen`) | [C9](../mockups/designer-ajustes/c9-brush-avanzado.html) | Sustituye al interruptor «Advanced settings» |
| Vista previa del pincel plegable (P1) o flotante (P2) | Panel del pincel | Ninguno | [A1](../mockups/designer-ajustes/a1-brush-orden.html) | Sin decidir |
| Títulos de fila «Align», «Distribute», «Page» y «Add guide» | Alinear y tarjeta Guides | Ninguno (solo etiquetas) | [C11](../mockups/designer-ajustes/c11-alinear.html), [C10](../mockups/designer-ajustes/c10-guias.html) | Etiquetas nuevas |
| Etiqueta visible «Texture» con su valor | Panel del pincel | Ninguno (hoy el select solo muestra icono) | [A1](../mockups/designer-ajustes/a1-brush-orden.html) | Cambio de presentación |

## 3. Ya decidido

- **Presets de tamaño**: se mantienen los 14; la reducción a 8 de la maqueta no está aprobada y `SizePresets` no tiene prop de subconjunto que la justifique.

## 4. Decisiones pendientes

1. **Vista previa del pincel**: P1 (arriba, bloque plegable abierto por defecto) o P2 (popover flotante mientras se ajusta). Sin decidir.
2. **Icono de Guides**: `Grid2X2Plus` (elegido en la maqueta) o `LayoutGrid`. Sin decidir.
3. **Dónde van dentro de Advanced** `Hardness`, el widget de punta (`Angle`, `Roundness`), `Follow stroke`, `Mirror`, el subgrupo Pressure y `Keep opacity`. La maqueta C9 solo fija Tip, Blend, Taper start + end, Stabilize y Smoothing; el resto es propuesta mía, sin confirmar. Alternativa: dejar `Hardness` en el bloque principal.
4. **Las 4 acciones borde a ancla** de C11: segunda línea del grupo «Align» o grupo propio «Edge to anchor». Además, la maqueta avisa de que la regla `.align-action-row` (`designer.css:134`) puede estar pensada para tres columnas (comprobación abajo).
5. **Zoom**: los botones in / out / porcentaje / Fit canvas de la barra vertical se conservan; si el navegador los repite o los sustituye queda por decidir.
6. **Fila Angle** del navegador: es lógica nueva (rotación de vista); aprobar o dejarla fuera.
7. **Controles rápidos de Text**: cómo distinguir «siguiente texto» de «capa de texto seleccionada». La tira ya lo distingue con «New text» frente a «<nombre> (selected)», pero esa rama es «no alcanzable por lectura — requiere prueba en sandbox» (la tira solo se monta con la variante Edit); no sirve como precedente hasta probarlo.
8. **Muestra de color fija**: qué representa por herramienta. Hoy hay cuatro estados distintos: `ui.brush.color` (Brush, Pencil, Airbrush, Fill, Gradient, Eyedropper), `ui.lineart.color`, `ui.shape.fill` (y `ui.shape.stroke`) y `ui.text.color`; Eraser no tiene color. Un color secundario global sería estado nuevo (con una tecla X para intercambiar, también nueva).
9. **Rama tarjeta del pincel**: reagrupar de forma análoga o dejarla.
10. **Ojo en la cabecera de carpeta**: llevarlo también a la izquierda por coherencia con A2 (propuesta mía).
11. **A4**: la maqueta marca «pendiente de confirmar» la interpretación de «Modo primero» (Mode justo tras Shape).
12. **Icono de capa de filtro**: la tabla B solo cambia la capa de efecto (`Flame`); el filtro conserva `Contrast`.

## 5. Comprobaciones y descripciones (no son decisiones)

- Regla `.align-action-row` (`designer.css:134`): confirmar si está pensada para tres columnas antes de añadir las 4 acciones borde a ancla de C11.
- Textos del estado vacío de FX («add one below» → «above»): revisar las cadenas (`FxPanel.tsx:92`).
- Hoy hay cuatro estados de color distintos (descripción del punto «Muestra de color fija»): `ui.brush.color`, `ui.lineart.color`, `ui.shape.fill`/`stroke` y `ui.text.color`; Eraser no tiene color.

## 6. Sin confirmar en la matriz de estado actual

- Criterio exacto con que `AgentGlow` ilumina el lienzo ([[lienzo-gestos]]).
- Las filas de [[lienzo-gestos]] tomadas de `TOOL_HELP` sin leer toda la rama del puntero (marcadas en cada fila).
- Detalles de `Auto-select` más allá de su tooltip ([[alinear-editar]]).
- Nada de esto se comprobó ejecutando la app: todo es lectura de código.

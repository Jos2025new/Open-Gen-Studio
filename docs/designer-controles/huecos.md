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

## Qué queda abierto

- **Bugs y decisiones del sandbox del 2026-10-29** (S1, S3, S6, S10 extra, Guides recortada, ayudas con «strip»/«Sides»/«From and To», Select/Lasso/Wand en Brush): tabla y evidencia visual en [hallazgos](hallazgos.md#sandbox-y-decisiones-del-2026-10-29-todo-abierto-nada-corregido) y [revisión de ubicación](revision-ubicacion.md#visto-en-sandbox). Siguen abiertos; hallazgos no registra arreglos ni pruebas automatizadas posteriores.

Estados usados abajo: «respondido por lectura» (no es arreglado ni prueba pasada), «respondido parcialmente», «requiere prueba», «requiere decisión». Fuente: [rastreo del Designer](../rastreo/designer.md), secciones 4 y 5.

- **Pruebas visuales aún pendientes** (puerto 5183, sin datos reales): encaje de las 4 acciones borde a ancla en `.align-action-row`; visibilidad de `AgentGlow`; Delete layer con varias capas y el paso de deshacer; qué haría la rama de texto de la tira si se conectara; rama `compact` de formas al cambiar R/O/L/M con variante Edit abierta. Weight 100–900 frente a 300–900 ya se vio en sandbox; Size 1–500 frente a 4–1000 sigue confirmado solo por lectura ([revisión](revision-ubicacion.md#visto-en-sandbox), [rastreo 3.7](../rastreo/designer.md)). `rasterizeLayer` sigue sin test propio (respondido parcialmente por rastreo 1.1); no se afirma que sus efectos estén probados en pantalla.
- **Decisiones del usuario** (sin decisión encontrada en `docs/history`): vista previa del pincel P1/P2; icono de Guides; ubicación de los controles dentro de Advanced; fila Angle (rotación de vista, [propuesta-gui-pintura](../propuesta-gui-pintura.md):42,57); muestra de color fija; A4 «Modo primero»; qué hacer con la rama de texto de la tira (quitar o conectar); icono de Sculpt (hoy sin icono propio); atajos de zoom (hoy solo botones, campo, Ctrl+rueda y paradas de rueda); Ctrl+E y Ctrl+Y fuera de la lista de atajos; Clear all guides y clic derecho en regla ejecutan al instante, deshacer sin confirmar; además las decisiones 5, 9, 10 y 12 de la sección 4 (zoom repetido en el navegador, tarjeta del pincel, ojo de carpeta, icono de capa de filtro). Weight desigual y falta de Line/Spacing en Properties son bugs declarados por el usuario (S3), no decisiones.
- **Textos a corregir** (no es decisión de producto): la ayuda de Polygon dice «Sides» y el control se llama Corners (`ToolHelp.tsx:24`); la de Star dice «Sides, Inner and Round» (`ToolHelp.tsx:25`) y la de Sector, Arc y Chord «From and To» (`ToolHelp.tsx:26`), cuando los controles son Corners, Spoke ratio, Rounded, Start y End.
- **Preguntas a proveedor**: ninguna de este área.

## 1. Controles que las maquetas pierden

Estos controles existen hoy y la maqueta correspondiente los **omite o reduce**. La propuesta revisada los conserva todos:

| Maqueta | Qué pierde | Qué hay que hacer |
| --- | --- | --- |
| [C11 alinear](../mockups/designer-ajustes/c11-alinear.html) | Las 4 acciones borde a ancla (`Align left edge to anchor’s right edge`, `Align right edge to anchor’s left edge`, `Align top edge to anchor’s bottom edge`, `Align bottom edge to anchor’s top edge`), con su aviso «Choose an anchor from at least two selected objects or layers.» | Conservarlas: dónde (segunda línea de «Align» o grupo propio) queda por decidir (decisión 4). Hoy son 10 acciones de alineación (5 + 5), la maqueta dibuja 6 |
| [C11 alinear](../mockups/designer-ajustes/c11-alinear.html) | 4 de las 6 referencias del select «Relative to»: `First selected`, `Last selected`, `Biggest`, `Smallest` (solo dibuja `Page` y `Selection`) | Conservar las 6; sin ellas las 4 acciones de ancla no sirven |
| [A1 pincel](../mockups/designer-ajustes/a1-brush-orden.html) y [C9](../mockups/designer-ajustes/c9-brush-avanzado.html) | 6 de los 14 presets de tamaño: hoy 2, 5, 8, 12, 16, 24, 32, 40, 48, 64, 80, 96, 128, 200; la maqueta deja 2, 5, 12, 24, 40, 64, 96, 200 (se pierden 8, 16, 32, 48, 80, 128) | Reducción NO aprobada: se mantienen los 14 (sección 3) |
| [A1](../mockups/designer-ajustes/a1-brush-orden.html) y [C9](../mockups/designer-ajustes/c9-brush-avanzado.html) | Sin dibujar en el panel del pincel: `Drawing / Design`, `Hardness`, el widget de punta con `Angle` y `Roundness`, `Follow stroke`, `Mirror`, `Simulate pressure`, `Speed influence`, la lectura de presión, `Pressure → size`, `Min size`, `Pressure → density`, `Min density` y `Keep opacity` | Colocarlos explícitamente (columna Estado de [[pincel-avanzado]]); la colocación dentro de Advanced es mía y está sin confirmar (decisión 3) |
| [C9](../mockups/designer-ajustes/c9-brush-avanzado.html) | El widget de forma de punta está citado («no se muestra»), no dibujado | Va con Tip dentro de Advanced |
| [A1](../mockups/designer-ajustes/a1-brush-orden.html) y [C9](../mockups/designer-ajustes/c9-brush-avanzado.html) | Solo cubren la rama del panel (`BrushSettings` sin tarjeta). La **tarjeta del dock** con pestañas Tip / Stroke / Pressure / Blend, y la tira compacta, no están dibujadas | Se conservan todas sus funciones; si la tarjeta se reagrupa como el panel sigue pendiente (decisión 9) |
| [A2 capas](../mockups/designer-ajustes/a2-capas-acciones.html) | Las cabeceras de carpeta (ojo y candado), `Opacity` y `Blend`, el campo `Name`, el arrastre, los avisos y controles del límite de trazos | No cambian; solo la carpeta pide decidir el ojo a la izquierda (decisión 10) |
| [A4 selección](../mockups/designer-ajustes/a4-seleccion-modo.html) | Solo dibuja la rama de la varita. Faltan `All`, `Invert`, `Deselect`, `Grow / shrink`, `Grow`, `Shrink`, `Delete`, `Fill`, `To layer` y las ramas Rectangular y Lasso | No cambian |
| [A5 FX](../mockups/designer-ajustes/a5-fx-add-arriba.html) | Las filas de operación (interruptor, nombre, subir, bajar, quitar con confirmación), `Applies to`, `Edit as filter layer` | No cambian |
| [C10 guías](../mockups/designer-ajustes/c10-guias.html) | Estados deshabilitados (`Clear all guides` sin guías) y los gestos de regla y arrastre | No cambian |
| [C13 gradiente](../mockups/designer-ajustes/c13-gradiente-end.html) | Las opciones de «End» (`Second color` y `Transparent`) y `Opacity` | Solo cambia la etiqueta |
| [D14 navegador](../mockups/designer-ajustes/d14-navegador.html) | El campo de porcentaje editable y `Fit canvas`; dibuja un slider en % y un botón `100 %` | Conservar campo y Fit canvas (decisión 5) |
| [F variantes](../mockups/designer-ajustes/f-variantes.html) | F1 solo Size, Opacity, Hardness; F2 solo Font y Size (faltan Weight, Color, Align, Line, Spacing); F3 solo color y tamaño | Los demás ajustes siguen en la tarjeta |

## 2. Controles NUEVOS de la propuesta

Ninguno está en la matriz de estado actual (no existen hoy). Todos los de la fila de variantes y del dock escriben el mismo estado que las tarjetas completas; si no, serían estados duplicados.

| Control | Dónde | Estado que escribe | Maqueta | Nota |
| --- | --- | --- | --- | --- |
| Navegador (miniatura con rectángulo de vista) | Arriba del panel derecho, plegable | Ninguno (lee zoom y encuadre del `Stage`) | [D14](../mockups/designer-ajustes/d14-navegador.html) | El rectángulo de vista es nuevo |
| Fila Zoom: slider en %, botón `100 %` | Navegador | El mismo zoom (`ogs:designer-zoom`) | [D14](../mockups/designer-ajustes/d14-navegador.html) | Duplica zoom in / out / porcentaje de la barra vertical |
| Fila Angle: slider en °, girar izquierda, girar derecha, `0°` | Navegador | **Lógica nueva**: hoy no hay rotación ni volteo de la vista del lienzo | [D14](../mockups/designer-ajustes/d14-navegador.html) | Sin estado ni motor hoy; aprobar o descartar (decisión 6) |
| Size, Opacity, Hardness en la fila de variantes de Eraser | Dock, fila de variantes | `ui.brush.size`, `ui.brush.opacity`, `ui.brush.hardness` | [F1](../mockups/designer-ajustes/f-variantes.html) | Mismo estado que la tarjeta |
| Font y Size en la fila de variantes de Text | Dock, fila de variantes | `ui.text.fontFamily` y `ui.text.fontSize` | [F2](../mockups/designer-ajustes/f-variantes.html) | La fila debe dejar claro si edita «el siguiente texto» o la capa de texto seleccionada (decisión 7). Hoy no hay precedente disponible: la rama de la tira que haría esa distinción no se alcanza (código muerto por lectura, `f11a0dd`; [rastreo 2.6](../rastreo/designer.md)) |
| Chip de color y chip de tamaño en las variantes de pincel | Dock, fila de variantes (Brush, Pencil, Airbrush, Fill, Gradient) | Color y tamaño de la herramienta activa | [F3](../mockups/designer-ajustes/f-variantes.html) | Precedente: `useToolPaint` del Designer embebido ([[estudio-embebido]]) |
| Muestra de color fija al final del dock | Dock, tras Settings | Ver decisión 8 | [G](../mockups/designer-ajustes/g-swatch-dock.html) | Un color secundario global (G-B) sería **estado nuevo**; opcional |
| Bloque plegable Advanced | Panel del pincel | Preferencia de «abierto» (como `propertiesOpen`) | [C9](../mockups/designer-ajustes/c9-brush-avanzado.html) | Sustituye al interruptor «Advanced settings» |
| Vista previa del pincel plegable (P1) o flotante (P2) | Panel del pincel | Ninguno | [A1](../mockups/designer-ajustes/a1-brush-orden.html) | Sin decidir |
| Títulos de fila «Align», «Distribute», «Page» y «Add guide» | Alinear y tarjeta Guides | Ninguno (solo etiquetas) | [C11](../mockups/designer-ajustes/c11-alinear.html), [C10](../mockups/designer-ajustes/c10-guias.html) | Etiquetas nuevas |
| Etiqueta visible «Texture» con su valor | Panel del pincel | Ninguno (hoy el select solo muestra icono) | [A1](../mockups/designer-ajustes/a1-brush-orden.html) | Cambio de presentación |

## 3. Ya decidido

- **Presets de tamaño** [respondido por lectura: los 14 se confirmaron en código y en `4f37e64`]: se mantienen los 14; la reducción a 8 de la maqueta no está aprobada y `SizePresets` no tiene prop de subconjunto que la justifique.
- **Controles básicos siempre visibles** (decisión del usuario, 2026-10-29): Size, Opacity y Color sin atajos, en ese orden; Texture junto a Color o dentro. Vale para toda herramienta con bordes y rellenos: raster (Brush, Eraser y similares) y vector (Stroke y Fill). En vector, Fill puede ser textura o degradado de varios tipos (lineal/axial, radial, rejilla o similares).
- **Ajustes del objeto elegido en la toolbox** (decisión del usuario, 2026-10-29): Join, Cap, Dashes y Stroke behind fill no deben quedar solo en Properties; lo que hagan otras apps es referencia de familiaridad, no techo ([investigación](investigacion-disposicion-interfaz.md)). Una barra contextual junto al objeto, al estilo de la Contextual Task Bar de Photoshop, es una idea que el usuario ya tenía.
- **Bugs declarados por el usuario** (2026-10-29): la tarjeta de ajustes que no sigue a la tecla de herramienta (S1), y los rangos distintos entre superficies y la falta de Line/Spacing en Properties (S3). Ambos se vieron en sandbox y siguen abiertos según [hallazgos](hallazgos.md#sandbox-y-decisiones-del-2026-10-29-todo-abierto-nada-corregido). **S10 extra** también se observó en sandbox y hallazgos lo clasifica como bug abierto; no encontré evidencia de que el usuario lo declarara explícitamente, así que queda como hallazgo, sin atribución al usuario.

## 4. Decisiones pendientes

1. **Vista previa del pincel** [requiere decisión; sin decisión encontrada]: P1 (arriba, bloque plegable abierto por defecto) o P2 (popover flotante mientras se ajusta). Sin decidir.
2. **Icono de Guides** [requiere decisión; sin decisión encontrada]: `Grid2X2Plus` (elegido en la maqueta) o `LayoutGrid`. Sin decidir.
3. **Dónde van dentro de Advanced** [requiere decisión; sin decisión encontrada] `Hardness`, el widget de punta (`Angle`, `Roundness`), `Follow stroke`, `Mirror`, el subgrupo Pressure y `Keep opacity`. La maqueta C9 solo fija Tip, Blend, Taper start + end, Stabilize y Smoothing; el resto es propuesta mía, sin confirmar. Alternativa: dejar `Hardness` en el bloque principal.
4. **Las 4 acciones borde a ancla** [respondido parcialmente] de C11: segunda línea del grupo «Align» o grupo propio «Edge to anchor». Además, la maqueta avisa de que la regla `.align-action-row` (`designer.css:134`) puede estar pensada para tres columnas (comprobación abajo). **Estado:** respondido por lectura: es una rejilla de 5 columnas (`designer.css:134`, borde divisorio en el hijo 4), dato confirmado ([rastreo 4](../rastreo/designer.md)); que las 4 acciones de ancla encajen en una segunda fila de 5 **requiere prueba visual** y la ubicación **requiere decisión**.
5. **Zoom**: los botones in / out / porcentaje / Fit canvas de la barra vertical se conservan; si el navegador los repite o los sustituye queda por decidir [requiere decisión; sin decisión encontrada].
6. **Fila Angle** del navegador [requiere decisión; sin decisión encontrada; la propuesta de pintura la pide con prioridad «medio»]: es lógica nueva (rotación de vista); aprobar o dejarla fuera.
7. **Controles rápidos de Text**: cómo distinguir «siguiente texto» de «capa de texto seleccionada». El código contiene una rama de la tira con «new text» frente a «<nombre> (selected)», pero no se alcanza: la tira solo se monta con la variante Edit y la rama exige `tool === 'text'`, así que hoy esa distinción no está disponible para el usuario. **Estado:** respondido por lectura (la rama es código muerto: `tool === 'text'` frente a un montaje solo con la variante Edit, `f11a0dd`, [rastreo 2.6](../rastreo/designer.md)); requiere decisión (quitar o conectar) y prueba en sandbox.
8. **Muestra de color fija** [requiere decisión; sin decisión encontrada]: qué representa por herramienta. Hoy hay cuatro estados distintos: `ui.brush.color` (Brush, Pencil, Airbrush, Fill, Gradient, Eyedropper), `ui.lineart.color`, `ui.shape.fill` (y `ui.shape.stroke`) y `ui.text.color`; Eraser no tiene color. Un color secundario global sería estado nuevo (con una tecla X para intercambiar, también nueva).
9. **Rama tarjeta del pincel** [requiere decisión; sin decisión encontrada]: reagrupar de forma análoga o dejarla.
10. **Ojo en la cabecera de carpeta**: llevarlo también a la izquierda por coherencia con A2 (propuesta mía) [requiere decisión; sin decisión encontrada].
11. **A4** [requiere decisión; sin decisión encontrada]: la maqueta marca «pendiente de confirmar» la interpretación de «Modo primero» (Mode justo tras Shape).
12. **Icono de capa de filtro**: la tabla B solo cambia la capa de efecto (`Flame`); el filtro conserva `Contrast` [requiere decisión; sin decisión encontrada].

## 5. Comprobaciones y descripciones (no son decisiones)

- Regla `.align-action-row` (`designer.css:134`): **respondido por lectura**: son 5 columnas, no tres (dato). El encaje visual de las 4 acciones de ancla **requiere prueba visual**.
- Textos del estado vacío de FX («add one below» → «above»): **respondido por lectura**: hoy el texto es correcto (la lista va arriba y «Add» debajo, `FxPanel.tsx:90-94`); solo cambiaría si se adopta A5, que **requiere decisión** de aplicarse junto con el texto.
- Hoy hay cuatro estados de color distintos (descripción del punto «Muestra de color fija»): `ui.brush.color`, `ui.lineart.color`, `ui.shape.fill`/`stroke` y `ui.text.color`; Eraser no tiene color.

## 6. Sin confirmar en la matriz de estado actual

- Criterio exacto con que `AgentGlow` ilumina el lienzo ([[lienzo-gestos]]): **respondido por lectura**: se ilumina cada capa cuyo objeto cambió entre el documento anterior y el posterior en la ruta del agente, 1,2 s (`agentGlow.ts`, `GLOW_MS`, `44311e3`), solo en memoria. Que se vea bien en pantalla **requiere prueba**.
- Las filas de [[lienzo-gestos]] tomadas de `TOOL_HELP` sin leer toda la rama del puntero (marcadas en cada fila).
- `Auto-select`: con una forma elegida no aparece en la tarjeta Edit; se vio en sandbox ([revisión P5/S10](revision-ubicacion.md#visto-en-sandbox)). Detalles de comportamiento más allá de su tooltip siguen sin confirmar ([[alinear-editar]]).
- Pendiente de decisión además: Sculpt aparece como «soon» sin icono propio (`toolboxModel.ts:28`); respondido por lectura, requiere decisión sobre el icono. La ayuda de Polygon («Sides») es un texto a corregir, no una decisión.
- **Prueba visual pendiente:** el criterio de `AgentGlow` en pantalla, los detalles de `Auto-select` más allá del tooltip y las filas de `TOOL_HELP` cuyo recorrido del puntero no se siguió. La revisión de ubicación sí ejecutó la app y documentó otros casos visuales; eso no confirma estos puntos. El resto de esta sección queda respondido por lectura, con Sculpt aún pendiente de decisión.

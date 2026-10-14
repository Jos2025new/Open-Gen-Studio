# Formas al estilo de Inkscape: fuentes verificadas

Investigación del 2026-10-11 para tiradores de esquina, estilo de trazo y desenfoque ([ficha](features/designer.md), código en `src/engine/design/shapeLook.ts`). Fuente: Inkscape `master` en el commit [21f4270](https://gitlab.com/inkscape/inkscape/-/commit/21f427000de1e19f5a262e75cfa83c3f82564f8b) (2026-10-10). Haiku 5.5 leyó primero resúmenes web; después leyó el código descargado con curl, y Claude cerró lo que faltaba leyendo el fuente directamente. Cada fila cita la línea real, no un resumen. No se copia código de Inkscape (GPL): solo fórmulas.

| Qué | Inkscape | Línea | Nuestro código |
| --- | --- | --- | --- |
| Tirador Rx | En (x + w − rx, y). Arrastre: rx = clamp(x + w − px, 0, w/2); Ctrl: rx = ry = clamp(…, 0, min(w,h)/2) | [knotholders 265–294](https://gitlab.com/inkscape/inkscape/-/blob/21f427000de1e19f5a262e75cfa83c3f82564f8b/src/ui/shape-editor-knotholders.cpp#L265-294) | `cornerKnots`, `dragRx` |
| Tirador Ry | En (x + w, y + ry). Ctrl: rx = ry con límite min(w,h)/2; sin rx (o 0): límite min(w,h)/2; si no, ry ≤ h/2 y rx no cambia | [313–351](https://gitlab.com/inkscape/inkscape/-/blob/21f427000de1e19f5a262e75cfa83c3f82564f8b/src/ui/shape-editor-knotholders.cpp#L313-351) | `dragRy` |
| Clic en tirador | Shift: quita rx y ry (quedan sin definir, no a 0, para que un arrastre posterior redondee de nuevo). Ctrl: copia el radio de ese tirador al otro | [297–310, 354–367](https://gitlab.com/inkscape/inkscape/-/blob/21f427000de1e19f5a262e75cfa83c3f82564f8b/src/ui/shape-editor-knotholders.cpp#L297-367) | `clickKnot` |
| Un solo radio | El que falta copia al otro; cada uno con límite de la mitad de su lado | [sp-rect.cpp 266–281](https://gitlab.com/inkscape/inkscape/-/blob/21f427000de1e19f5a262e75cfa83c3f82564f8b/src/object/sp-rect.cpp#L266-281) | `cornerRadii` |
| Escalar | Con un solo radio, r = max(rx, ry), y cada eje con su escala; con los dos, cada uno con la suya | [sp-rect.cpp 512–540](https://gitlab.com/inkscape/inkscape/-/blob/21f427000de1e19f5a262e75cfa83c3f82564f8b/src/object/sp-rect.cpp#L512-540) | `scaleLook` |
| Curva de esquina | Bézier con C1 = 0.554; usamos 0.5523 (círculo exacto, el mismo de affine.ts) | [sp-rect.cpp 249](https://gitlab.com/inkscape/inkscape/-/blob/21f427000de1e19f5a262e75cfa83c3f82564f8b/src/object/sp-rect.cpp#L249) | `traceRoundRect` |
| Blur % → radio | radio = (b/100)² · (w + h) / 4, BLUR_MULTIPLIER = 4 | [filter-chemistry.cpp 633–648](https://gitlab.com/inkscape/inkscape/-/blob/21f427000de1e19f5a262e75cfa83c3f82564f8b/src/filter-chemistry.cpp#L633-648) | `blurSigma`, `blurPercent` |
| Radio → σ | stdDeviation = radio / descrim (escala media, √\|det\|); en nuestra página vale 1 | [345–348](https://gitlab.com/inkscape/inkscape/-/blob/21f427000de1e19f5a262e75cfa83c3f82564f8b/src/filter-chemistry.cpp#L345-348) | σ guardado en `blur`; escala con √(sx·sy) |
| Margen del filtro | La región crece 2,4·σ por lado («opacity at 2.4 · radius is about 3e-3»). En SVG la región va en unidades de página e incluye el alcance del trazo (mitad del ancho; inglete o punta cuadrada, más), para que no desaparezcan líneas sin alto ni se recorten trazos gruesos | [gaussian-blur.cpp 87–99](https://gitlab.com/inkscape/inkscape/-/blob/21f427000de1e19f5a262e75cfa83c3f82564f8b/src/object/filters/gaussian-blur.cpp#L87-99) | `BLUR_MARGIN`, `blurFilterSvg` |
| Guiones | Escalados por el ancho del trazo (preferencia por defecto) | [stroke-style.cpp 99–106](https://gitlab.com/inkscape/inkscape/-/blob/21f427000de1e19f5a262e75cfa83c3f82564f8b/src/ui/widget/stroke-style.cpp#L99-106) | `dash` en anchos de trazo |
| Límite de inglete | 4 por defecto; solo con unión en inglete | [stroke-style.cpp 427](https://gitlab.com/inkscape/inkscape/-/blob/21f427000de1e19f5a262e75cfa83c3f82564f8b/src/ui/widget/stroke-style.cpp#L427) | `MITER_DEFAULT` |
| Orden de pintado | CSS `paint-order` | [stroke-style.cpp 449–453](https://gitlab.com/inkscape/inkscape/-/blob/21f427000de1e19f5a262e75cfa83c3f82564f8b/src/ui/widget/stroke-style.cpp#L449-453) | `paintOrder: 'stroke'` |

| Giro e inclinación | Un `<rect>` o `<ellipse>` girado sigue siéndolo: escala y posición van a x/y/ancho/alto y a cada radio por su eje; giro e inclinación quedan en `transform`. Los tiradores trabajan en las coordenadas propias de la forma. Solo «Objeto a trayecto» convierte. | [sp-rect.cpp 385–442](https://gitlab.com/inkscape/inkscape/-/blob/21f427000de1e19f5a262e75cfa83c3f82564f8b/src/object/sp-rect.cpp#L385-442), [sp-ellipse.cpp 494–530](https://gitlab.com/inkscape/inkscape/-/blob/21f427000de1e19f5a262e75cfa83c3f82564f8b/src/object/sp-ellipse.cpp#L494-530) | `shapeTransform.ts` (`rot`, `composeShape`, `toLocal`/`toPage`) |

## Diferencias deliberadas

- Un `radius` antiguo (anterior a rx/ry) conserva su esquina circular con límite min(w,h)/2 y se sigue dibujando con `roundRect` nativo: idéntico píxel a píxel a como se veía. No sigue la regla de Inkscape, para no cambiar documentos ya guardados.
- Blur sobre relleno y trazo: se componen primero y se desenfoca el resultado una vez, igual que SVG e Inkscape. Lienzo y SVG coinciden píxel a píxel (prueba e2e).
- Unión y punta por defecto: `round`, como antes. Inkscape usa miter/butt; cambiarlo alteraría formas existentes.
- Un tirador con radio 0 se dibuja 10 px de pantalla al lado de la esquina para no tapar el tirador de escala. El arrastre es relativo, así que el valor no salta.
- Tiradores de blur: solo aparecen con blur > 0, y siempre a 20 px de pantalla o más del borde, para no tapar los tiradores de escala de los lados. El arrastre es relativo.
- Sin Ctrl, arrastrar un tirador mueve solo ese radio: el otro conserva el valor que muestra (en Inkscape, un radio sin definir copia al otro y se mueve con él). Excepción: sin redondeo previo, el primer arrastre redondea los dos, porque Rx con Ry 0 dibuja esquinas rectas. Pedido por el usuario. «Lock radii» en la barra hace lo mismo que Ctrl.
- Un rectángulo con guiones empieza y cierra su trazado en el centro del borde superior, nunca en una esquina: ahí Chromium e Inkscape unían distinto el último guion (revisión de 4ef6270: 223/255 → 60/255, solo antialiasing de las puntas). Sin guiones se sigue exportando como `<rect>`.
- Rx o Ry a 0 escritos en la barra no impiden que el primer arrastre redondee: el radio no arrastrado queda sin definir.
- «Rotate 90°» intercambia Rx y Ry junto con el ancho y el alto.
- Los tiradores Rx/Ry se apartan del rectángulo (Rx hacia arriba, Ry a la derecha) hasta quedar a 18 px de pantalla de cualquier tirador de escala o giro: en formas pequeñas no los tapan.
- Un rectángulo de ancho o alto 0 se exporta como trazado (SVG no dibuja `<rect>` vacíos; el lienzo sí traza la línea).
- Rendimiento: con solo relleno o solo trazo el blur se aplica directamente, como antes; con ambos se componen en un lienzo auxiliar que solo crece. Medido (Chromium sin GPU, 10 formas, zoom): solo relleno, igual que antes; relleno y trazo, unas dos veces más rápido que antes (un blur en vez de dos).

## Revisión

GPT revisó 523dd35 y 0f8ad16 y encontró siete fallos, ya corregidos con tests: líneas con blur que desaparecían del SVG, trazos gruesos recortados, blur de relleno y trazo distinto entre lienzo y SVG, Ry con Rx sin definir, tirador de blur sobre el de escala, Rotate 90° con las esquinas sin girar, y una diferencia de 3/255 en formas antiguas. En la segunda revisión: Rx tapaba la escala en formas pequeñas, el rectángulo de ancho 0 desaparecía del SVG y el zoom era más lento (21,7 → 28,4 ms); los tres, corregidos. Queda aparte la opacidad y fusión de capa con formas superpuestas, que ya diferían entre lienzo y SVG antes de este trabajo. Rondas siguientes (giro, nodos, Convert to path): cada hallazgo y su corrección, por commit, en el [historial 024](history/024-2026-10-W41.md).
- Sin marcadores en esta pasada.

## Nodos y arrastre de segmentos (2026-10-13)

Fuente: Inkscape `master` en el commit 21f4270, leído con curl. Código nuestro: `src/engine/design/nodeTypes.ts`, `src/engine/design/segmentDrag.ts`, `src/components/designer/PathNodes.tsx`.

| Qué | Inkscape | Línea | Nuestro código |
| --- | --- | --- | --- |
| Arrastrar un segmento | Peso de la curva por t: 0 hasta t = 1/6, sube a 1/2 en t = 1/2, 1 desde t = 5/6 | [curve-drag-point.cpp 99–104](https://gitlab.com/inkscape/inkscape/-/blob/21f427000de1e19f5a262e75cfa83c3f82564f8b/src/ui/tool/curve-drag-point.cpp#L99-104) | `dragWeight` |
| Reparto entre los dos tiradores | Tiradores de entrada y de salida: (1−w)/(3t(1−t)²) y w/(3t²(1−t)) del desplazamiento; su suma da el desplazamiento entero | [curve-drag-point.cpp 109–110](https://gitlab.com/inkscape/inkscape/-/blob/21f427000de1e19f5a262e75cfa83c3f82564f8b/src/ui/tool/curve-drag-point.cpp#L109-110) | `dragSegment` |
| Segmento recto | Sus tiradores se colocan al tercio al empezar el arrastre | [curve-drag-point.cpp 54–64](https://gitlab.com/inkscape/inkscape/-/blob/21f427000de1e19f5a262e75cfa83c3f82564f8b/src/ui/tool/curve-drag-point.cpp#L54-64) | `dragSegment`, `pullHandle` |

Comprobación: tras arrastrar, la curva en el parámetro t pasa por el punto arrastrado (exacto, porque los dos pesos suman 1); los nodos de los extremos no se mueven. Tests en `tests/node-drag.test.ts`.

Tipos de nodo: esquina deja los tiradores independientes; suave alinea los dos por la tangente (la perpendicular a la bisectriz de sus direcciones) conservando cada longitud; simétrico, alineado y con la misma longitud. Un tirador de longitud cero, al convertir, toma un tercio del segmento vecino y después se alinea. Atajos: Shift+C, Shift+S, Shift+Y (ya existían). Automático (Shift+A): no implementado.

Tiradores: el nodo seleccionado y sus vecinos muestran siempre sus dos tiradores, aunque sean de longitud cero. Shift-arrastre desde un nodo saca el tirador de ese lado; en un segmento recto lo convierte en curva. Los extremos de un trazado abierto solo tienen el tirador interior.

Doble clic en un segmento inserta un nodo en su punto sin cambiar la forma (partición de De Casteljau; test por muestreo). Un trazo invisible de 10 px sobre el contorno recoge el clic y cambia el cursor.

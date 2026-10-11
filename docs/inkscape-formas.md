# Formas al estilo de Inkscape: fuentes verificadas

Investigación del 2026-10-11 para tiradores de esquina, estilo de trazo y desenfoque ([ficha](features/designer.md), código en `src/engine/design/shapeLook.ts`). Fuente: Inkscape `master` en el commit [21f4270](https://gitlab.com/inkscape/inkscape/-/commit/21f427000de1e19f5a262e75cfa83c3f82564f8b) (2026-10-10). Haiku 5.5 leyó primero resúmenes web; después leyó el código descargado con curl, y Claude cerró lo que faltaba leyendo el fuente directamente. Cada fila cita la línea real, no un resumen. No se copia código de Inkscape (GPL): solo fórmulas.

| Qué | Inkscape | Línea | Nuestro código |
| --- | --- | --- | --- |
| Tirador Rx | En (x + w − rx, y). Arrastre: rx = clamp(x + w − px, 0, w/2); Ctrl: rx = ry = clamp(…, 0, min(w,h)/2) | [knotholders 265–294](https://gitlab.com/inkscape/inkscape/-/blob/21f427000de1e19f5a262e75cfa83c3f82564f8b/src/ui/shape-editor-knotholders.cpp#L265-294) | `cornerKnots`, `dragRx` |
| Tirador Ry | En (x + w, y + ry). Ctrl: rx = ry con límite min(w,h)/2; sin rx (o 0): límite min(w,h)/2; si no, ry ≤ h/2 y rx no cambia | [313–351](https://gitlab.com/inkscape/inkscape/-/blob/21f427000de1e19f5a262e75cfa83c3f82564f8b/src/ui/shape-editor-knotholders.cpp#L313-351) | `dragRy` |
| Clic en tirador | Shift: quita rx y ry. Ctrl: copia el radio de ese tirador al otro | [297–310, 354–367](https://gitlab.com/inkscape/inkscape/-/blob/21f427000de1e19f5a262e75cfa83c3f82564f8b/src/ui/shape-editor-knotholders.cpp#L297-367) | `clickKnot` |
| Un solo radio | El que falta copia al otro; cada uno con límite de la mitad de su lado | [sp-rect.cpp 266–281](https://gitlab.com/inkscape/inkscape/-/blob/21f427000de1e19f5a262e75cfa83c3f82564f8b/src/object/sp-rect.cpp#L266-281) | `cornerRadii` |
| Escalar | Con un solo radio, r = max(rx, ry), y cada eje con su escala; con los dos, cada uno con la suya | [sp-rect.cpp 512–540](https://gitlab.com/inkscape/inkscape/-/blob/21f427000de1e19f5a262e75cfa83c3f82564f8b/src/object/sp-rect.cpp#L512-540) | `scaleLook` |
| Curva de esquina | Bézier con C1 = 0.554; usamos 0.5523 (círculo exacto, el mismo de affine.ts) | [sp-rect.cpp 249](https://gitlab.com/inkscape/inkscape/-/blob/21f427000de1e19f5a262e75cfa83c3f82564f8b/src/object/sp-rect.cpp#L249) | `traceRoundRect` |
| Blur % → radio | radio = (b/100)² · (w + h) / 4, BLUR_MULTIPLIER = 4 | [filter-chemistry.cpp 633–648](https://gitlab.com/inkscape/inkscape/-/blob/21f427000de1e19f5a262e75cfa83c3f82564f8b/src/filter-chemistry.cpp#L633-648) | `blurSigma`, `blurPercent` |
| Radio → σ | stdDeviation = radio / descrim (escala media, √\|det\|); en nuestra página vale 1 | [345–348](https://gitlab.com/inkscape/inkscape/-/blob/21f427000de1e19f5a262e75cfa83c3f82564f8b/src/filter-chemistry.cpp#L345-348) | σ guardado en `blur`; escala con √(sx·sy) |
| Margen del filtro | La región crece 2,4·σ por lado («opacity at 2.4 · radius is about 3e-3») | [gaussian-blur.cpp 87–99](https://gitlab.com/inkscape/inkscape/-/blob/21f427000de1e19f5a262e75cfa83c3f82564f8b/src/object/filters/gaussian-blur.cpp#L87-99) | `BLUR_MARGIN`, `blurFilterSvg` |
| Guiones | Escalados por el ancho del trazo (preferencia por defecto) | [stroke-style.cpp 99–106](https://gitlab.com/inkscape/inkscape/-/blob/21f427000de1e19f5a262e75cfa83c3f82564f8b/src/ui/widget/stroke-style.cpp#L99-106) | `dash` en anchos de trazo |
| Límite de inglete | 4 por defecto; solo con unión en inglete | [stroke-style.cpp 427](https://gitlab.com/inkscape/inkscape/-/blob/21f427000de1e19f5a262e75cfa83c3f82564f8b/src/ui/widget/stroke-style.cpp#L427) | `MITER_DEFAULT` |
| Orden de pintado | CSS `paint-order` | [stroke-style.cpp 449–453](https://gitlab.com/inkscape/inkscape/-/blob/21f427000de1e19f5a262e75cfa83c3f82564f8b/src/ui/widget/stroke-style.cpp#L449-453) | `paintOrder: 'stroke'` |

## Diferencias deliberadas

- Un `radius` antiguo (anterior a rx/ry) conserva su esquina circular con límite min(w,h)/2, como se dibujaba antes. No sigue la regla de Inkscape, para no cambiar documentos ya guardados.
- Unión y punta por defecto: `round`, como antes. Inkscape usa miter/butt; cambiarlo alteraría formas existentes.
- Un tirador con radio 0 se dibuja 10 px de pantalla al lado de la esquina para no tapar el tirador de escala. El arrastre es relativo, así que el valor no salta.
- Tiradores de blur: solo aparecen con blur > 0. A 0 coincidirían con los tiradores de escala de los lados.
- Sin marcadores en esta pasada.

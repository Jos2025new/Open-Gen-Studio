# Diagnóstico: trazos de lineart que se deforman al encoger (2026-10-13)

Investigación de solo lectura; no hay cambios de código. Síntoma del usuario: en Edit → Object, con dos trazos de una capa de lineart, encogerlos varias veces con los tiradores deforma el trazo, pierde su orientación y, en tamaños pequeños, lo rompe, lo borra o lo simplifica de más. En una captura, un trazo fino se vuelve una mancha blanca con forma de semicírculo.

## Causa más probable

**El taper no escala con el trazo.** `transformStroke` (`src/engine/design/affine.ts:52-54`) multiplica `size` por la escala, pero no toca `taperStart` ni `taperEnd`. Un trazo de 4 px con taper de 6 px, tras cinco reducciones a 0,7, mide 0,67 px de grosor y conserva un taper de 6 px: el taper ocupa todo el trazo y el contorno se convierte en una mancha. La función `scaleStroke` (`src/engine/design/strokes.ts:133-142`) sí escala los tapers con la media de escala, y los dos caminos han divergido.

Segunda causa, de fondo: el contorno lo calcula `perfect-freehand` con umbrales en unidades absolutas (ver H3). El resultado no es una función equivariante de la geometría escalada, así que cada reducción cambia un poco más el contorno.

## Hipótesis y veredicto

| # | Hipótesis | Veredicto | Evidencia |
| --- | --- | --- | --- |
| 1 | Redondeo que se acumula al hornear | **Descartada** en la transformación. | `transformStroke` no redondea: `affine.ts:52-54`. Cinco pasos de 0,7 frente a uno de 0,7⁵: deriva de los puntos 4·10⁻¹⁵ px. El único redondeo es `strokes.ts:58` (`r`, 2 decimales), que solo afecta a las cadenas SVG de `strokes.ts:67,71,199`, no a la geometría. |
| 2 | El grosor no escala | **Parcialmente confirmada.** El grosor sí escala; los tapers no. | Medido: `size` = 4·0,7⁵ = 0,6723 tras cinco pasos y tras uno. Pero el taper queda en 6 px (`affine.ts:53`). |
| 3 | Re-suavizado o re-simplificación al confirmar | **Descartada como paso repetido; confirmada la simplificación por umbral absoluto.** | No hay simplificación al confirmar: la búsqueda de `simplif`/`decimate` en `src/engine/design/` no da nada, y el contorno se cachea por objeto de puntos inmutables (`strokes.ts:33-44`, `WeakMap`). Pero `perfect-freehand` descarta puntos a menos de 3 unidades del final (`node_modules/perfect-freehand/dist/esm/index.mjs`, en `P`: `if(!x&&F-b<3)continue`) y fija el radio mínimo en 0,01 (`Math.max(.01,…)`). Esos umbrales no escalan con el trazo. |
| 4 | Escala no uniforme o volteo que cambia la orientación | **Descartada como causa de la deformación.** | `lengthScale` usa |det| (`matrix.ts:61-63`): el signo no cambia la orientación, porque los puntos se mapean con `apply`. El grosor usa la media geométrica, igual que la `descrim` de Inkscape (ver abajo). No se midió un caso con volteo. |
| 5 | Tapers o presión que no escalan con la geometría | **Confirmada.** | `affine.ts:52-54` deja `taperStart`/`taperEnd` fijos; `strokes.ts:139-140` sí los escala. Presión: `strokeOptions` (`strokes.ts:23-33`) toma la presión de cada punto, que no cambia; correcto. |

## Experimentos (scratchpad, tests temporales borrados; sin commit)

1. **Cinco pasos de 0,7 frente a uno de 0,7⁵** (trazo de 11 puntos, 100 px, tamaño 4, con y sin taper 6):
   - deriva máxima de los puntos: 4·10⁻¹⁵ px en ambos casos;
   - grosor: 0,6723 px en ambos casos;
   - contorno: 17,48 px de extensión sin taper; 16,81 px con taper de 6 px (igual en los dos caminos, porque ambos conservan el taper).
2. **Taper escalado con el grosor** (corrección propuesta, medida sobre el contorno): la distancia de Hausdorff entre el contorno escalado y k·(contorno original) pasa de 1,68 px a 1,68 px: **sin mejora medible en ese caso**. Esto indica que, además del taper, hay otra fuente de no equivariancia (H3), que el taper escalado por sí solo no corrige.
3. **Equivariancia sin taper**, a 100 px y a 1000 px de longitud (grosor 4 → 0,672): distancia de Hausdorff de 1,38 px y 2,48 px. No baja con la longitud, así que el umbral de 3 px del final no es la única causa; queda sin aislar.

Conclusión de los experimentos: el contorno de un trazo escalado no coincide con el contorno escalado de ese trazo, aunque la geometría de entrada sea exacta. El taper agrava el efecto (mancha); la librería introduce la diferencia.

## Cómo lo resuelve Inkscape

- **Geometría:** Inkscape escribe la transformación en las coordenadas del objeto, en punto flotante (el `transform` se hornea en la ruta con la precisión del número de dígitos de salida). No hay umbrales de puntos que dependan del tamaño, porque la ruta es un conjunto de curvas de Bézier, no un muestreo con reglas de distancia. No se leyó el código que hace esa escritura.
- **Grosor:** `SPItem::adjust_stroke` multiplica `stroke_width.computed` por `ex` (`src/object/sp-item.cpp`, líneas 1476–1490, commit 21f4270). `ex` es `1/descrim` de la transformación relativa (líneas 1683–1693 y 1751), es decir, la raíz de |det|, igual que `lengthScale` aquí. Si la preferencia «escalar el grosor» está desactivada, la compensación usa el mismo factor inverso. Con expansiones extremas (fuera de 10⁻⁹…10⁹) Inkscape congela el grosor.
- **Tapers:** Inkscape no tiene tapers por punto como los de `perfect-freehand`; su grosor es uniforme por trazo, así que el problema de taper no existe allí.

## Arreglo propuesto

1. **Inmediato (pequeño, bajo riesgo):** en `transformStroke` escalar `taperStart` y `taperEnd` por `lengthScale(m)`, como hace `scaleStroke`. Unificar también el mínimo de `size`: `scaleStroke` usa `Math.max(0.5, …)` (`strokes.ts:137`) y `transformStroke` no. Test propuesto: contorno de `transformStroke(s, k)` ≈ k·contorno(s) para tapers escalados; ahora mismo no se cumple (ver experimento 2).
2. **Estructural (el que cierra la deriva):** no hornear el contorno en cada gesto. Guardar el trazo en su marco de creación con una matriz acumulada por trazo (como el `transform` de Inkscape), calcular el contorno en ese marco, con los umbrales de `perfect-freehand` en unidades originales, y transformar el resultado. Coste: cambia el modelo `Stroke` (campo de matriz), la exportación SVG y la prueba de acierto (`nearStroke`, `strokes.ts:118`).
3. **Pruebas que faltan:** un test de equivariancia (contorno escalado ≈ k·contorno original) para trazos de 100 y 1000 px, con taper y sin él; y un e2e del gesto de encoger dos trazos cinco veces (la app usa `transformLayer` con la capa de inicio del gesto: `affine.ts:110-116`).

## Lo no verificado

- No se midió un caso con escala no uniforme ni con volteo (H4 se descarta por razonamiento sobre `lengthScale`).
- No quedó aislada la causa exacta de la distancia de 1,4–2,5 px sin taper; el umbral de 3 px del final no explica por sí solo que no baje con la longitud.
- No se leyó el código de escritura de rutas de Inkscape (redondeo de salida); solo `sp-item.cpp`.
- No se probó en el navegador: el diagnóstico es de código y de pruebas unitarias.

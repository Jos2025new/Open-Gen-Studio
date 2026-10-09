# 0013 — Un solo tipo de campo para los ajustes, y la brocha de PaintTool SAI

## Estado

Propuesto

## Fecha

2026-10-09

## Contexto

El usuario pidió (2026-10-09) llevar a nuestra brocha las funciones del panel de PaintTool SAI y mejorar la legibilidad de los ajustes. Puso como referencia un panel en el que toda la fila es el control: el nombre a la izquierda, el valor a la derecha y un relleno hasta el valor. Pidió una sola fuente de verdad para los elementos gráficos: nada de un tirador distinto en una esquina.

Antes de este cambio:
- `InlineSlider` mostraba el nombre y el valor encima de una barra fina, en dos filas.
- La opacidad de capa y los parámetros FX dibujaban su propio deslizador y su propio `input` de color.
- La brocha solo tenía tamaño, color, opacidad, suavizado y estabilización. Ignoraba la presión del lápiz.

## Decisión

1. **Un campo por ajuste** (`src/components/designer/InlineControls.tsx`):
   - `InlineSlider`: toda la fila es la pista. Se arrastra desde cualquier punto, admite flechas y rueda, y se pulsa el valor para escribirlo. Un rango corto (12 pasos o menos) muestra sus pasos como puntos.
   - `InlineToggle`: nombre a la izquierda e interruptor a la derecha.
   - `InlineChoice`: varias opciones dibujadas en una misma fila.
   - `InlineColor` e `InlineSelect` se alinean con ellos: 36 px de alto, el mismo fondo y el mismo radio, y el valor siempre a la derecha.
   
   La opacidad de capa y los parámetros FX pasan a usarlos. Un test (`tests/ui-single-slider.test.ts`) impide que un componente del Designer vuelva a dibujar su propio deslizador o `input` de color.
2. **Motor de la punta** (`src/engine/design/brushEngine.ts`), basado en SAI:
   - dureza con cuatro perfiles (duro, firme, suave, aerógrafo), cuyos iconos dibuja la misma curva del motor;
   - presión sobre el tamaño (tamaño mínimo) y sobre la densidad (densidad mínima);
   - textura (papel, lienzo, grano) con intensidad;
   - modo de fusión del trazo y Keep Opacity;
   - tamaños rápidos y una vista previa del trazo que dibuja el propio motor.
   
   El trazo se acumula en una máscara que guarda la cobertura más fuerte de cada píxel (máximo, nunca suma) y se compone una vez.
3. **Un solo camino de dibujo.** El trazo en vivo, el trazo guardado al reconstruirse y la vista previa usan el mismo motor. Todo trazo nuevo guarda su punta (`RasterStroke.tip`), incluso la dura. Los trazos guardados antes no tienen punta y siguen con el renderizador de líneas de siempre, así que los documentos existentes no cambian.

## Alternativas

- **Solo restilizar la brocha.** Descartada: contradice la petición de una sola fuente y dejaría dos estilos de deslizador.
- **Seguir con las líneas del canvas para la punta dura.** Descartada: medido en el navegador, ese renderizador no reconstruye fiel a lo pintado (132 píxeles con más de 4 niveles de alfa de diferencia, máximo 72). El motor nuevo reconstruye dentro de un nivel.
- **Mezcla húmeda de SAI** (Blending, Dilution, Persistence): aplazada. Necesita leer el color del lienzo bajo la brocha en cada paso, y conviene medirla primero con el protocolo de [depuracion.md](../depuracion.md).

## Consecuencias

- El cambio visual alcanza a todas las herramientas del Designer, a la opacidad de capa y al editor FX. Los deslizadores de la galería, el boceto, el visor 3D y la tarjeta de ajustes no se han tocado (pendiente).
- `RasterStroke` gana el campo opcional `tip`. Una versión anterior de la app dibujaría los trazos nuevos con líneas duras: perdería dureza, textura, fusión y presión, aunque no el trazo.
- Con un ratón, la presión es siempre total, así que el tamaño y la densidad mínimos solo actúan con lápiz. Eso está cubierto por tests unitarios; no se ha probado con un lápiz real.
- El coste por movimiento es proporcional al área del segmento: a 240 px son unos 60.000 píxeles. No se ha medido con el registro de rendimiento.

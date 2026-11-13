# Pendientes del Designer, formas, brocha y render

Detalle de las filas D del [índice](pendientes.md). Prioridad, **origen** y evidencia como en [pendientes-agente](pendientes-agente.md). Los pendientes de rendimiento y guardado del render tienen una sola fuente, [render-estado](render-estado.md), sección «Pendiente (fuente única)»: no se duplican aquí (D14).

## Bugs hallados por tests adversariales (2026-11-12)

Estado 2026-11-12: se prepararon correcciones para D62–D70 y sus reproducciones pasan como tests normales; quedan pendientes la revisión del agente, `npm test` y la prueba en sandbox. Las descripciones siguientes registran los fallos originales. D69 añade límites tanto en el recorrido editable como antes de rasterizar; su cobertura no demuestra seguridad frente a todos los SVG posibles.

- **D62 · alto · 2026-11-12 · Ctrl+Alt+clic salta a formas que no están bajo el cursor:** `src/engine/design/objectBelow.ts:24` prueba las partes vectoriales por su caja, no por `vectorObjectHit`. Test: `tests/adv-seleccion.test.ts:30`.
- **D63 · medio · 2026-11-12 · Distribuir solapa objetos:** `objectOps.ts:207` (`distributeBoxes`) usa el último por x, no el borde derecho máximo. Test: `tests/adv-seleccion.test.ts:132`.
- **D64 · medio · 2026-11-12 · Paso de deshacer vacío:** `objectOps.ts:283` (`withoutObjects`) devuelve una capa nueva aunque no quite nada. Test: `tests/adv-seleccion.test.ts:95`.
- **D65 · medio · 2026-11-12 · Objetos ráster:** una capa ráster con solo trazos de borrado no tiene objetos (`tests/adv-seleccion.test.ts:83`); `turnObjects` ráster (`objectOps.ts:115`) gira en píxeles de buffer y deforma con kx≠ky (`:154`); `translateObjects` (`objectOps.ts:101`) admite Infinity y deja coordenadas no finitas (`:108`).
- **D66 · medio · 2026-11-12 · Orden de apilado con grupo partido:** `stackOrder.ts:32` (`restackShapes`), en un archivo no normalizado, altera el orden de las formas no movidas. Test: `tests/adv-grupos.test.ts:183`.
- **D67 · alto · 2026-11-12 · Importar SVG con números no finitos:** `svgImport/structure.ts:72` (`width="1e400"` da NaN en el documento) y `svgImport/transforms.ts:8` (`parseLength` sin guarda: NaN/Infinity en las formas y en el SVG exportado, `export.ts`). Tests: `tests/adv-svg.test.ts:55`, `:60`, `:189`.
- **D68 · medio · 2026-11-12 · Importar SVG pierde contenido sin aviso:** `MAX_DEPTH` 64 (`structure.ts:46,185`) descarta el contenido; una `<image>` sin tamaño (`structure.ts:275`) se descarta; una capa vectorial vacía no sobrevive la ida y vuelta. Tests: `tests/adv-svg.test.ts:107`, `:152`, `:195`.
- **D69 · medio · 2026-11-12 · `<use>` sin presupuesto de expansión** (`structure.ts:244`): riesgo de denegación de servicio con `<use>` anidados; no se ejecutó, sin test.
- **D70 · medio · 2026-11-12 · PDF (`pdfLook.ts`):** los `<defs>` dentro de un grupo se borran al cerrarlo (un degradado usado fuera pierde su definición, `:163`, test `tests/adv-pdf.test.ts:31`); el atributo `opacity` gana a `style="opacity:"` (`:42`, test `:45`); `opacity="50%"` se lee como 50 (`:42`, test `:51`); un degradado en `style="fill:url()"` sale opaco y se quita `stop-opacity` del original (`:59`, test `:82`).

## Probar y medir

- **D1 · medio · 2026-10-09 · Probar en el navegador** (usuario y `npm run brush:check`): brocha sin lectura del canvas, zoom pixelado a 3200 %, modos de fusión nuevos, fusionar, rasterizar, Grow/Shrink y espejo. Fusionar sí tiene tests (`tests/designer-layer-fixes.test.ts:31,42`, 2026-10-23); rasterizar y Grow/Shrink no tienen test propio (`flattenLayers` en `actions.ts`; `pixel-selection.test.ts` cubre la selección). Estado revisado 2026-10-28 ([rastreo 1.1](rastreo/designer.md)). Detalle: [022](history/022-2026-10-W41.md), «Pendiente al cierre de la segunda parte». Ya hechos y en [cerrados](pendientes-cerrados.md): niveles y curvas, reglas de trazo, margen del ajuste a pantalla.
- **D4 · medio · 2026-10-09 · Presión con un lápiz real.** Tamaño y densidad mínimos solo se probaron con tests y con ratón (presión total). Lo prueba el usuario.
- **D9 · medio · 2026-10-09 · Clics nativos en el menú FX.** En la auditoría del sandbox, algunos clics cerraron el menú sin añadir la capa; el comando compartido sí la añadió. Reproducir desde un perfil aislado y registrar eventos, selección y estado del menú antes de corregir (Astra, causa sin confirmar).
- **D60 · medio · 2026-11-11 · Contrastar el intercambio con archivos reales** ([intercambio SVG](intercambio-svg.md)): las muestras de Illustrator, Figma y Canva de `tests/fixtures/` están escritas a mano, falta compararlas con exportaciones reales; la capa de Illustrator cuyo nombre coincide con su `id` (sin `data-name`) entraría como grupo; ver qué hacen Inkscape e Illustrator con nuestro `mix-blend-mode`.
- **D61 · medio · 2026-11-11 · Probar en el sandbox** el modelo de objetos, la ida y vuelta por SVG y el PDF con transparencia (la imagen del desenfoque y de los FX la hace el canvas real; en los tests la hace resvg). Abrir un PDF en Acrobat, Chrome y Firefox.
- **D10 · medio · 2026-10-11 · Prueba permanente con Inkscape** (propuesta del usuario): exportar un SVG con todos los casos de forma, rasterizarlo con el CLI de Inkscape y comparar píxeles y atributos; saltarse con aviso si no hay Inkscape. Hoy solo hay comprobaciones puntuales (GPT y Claude, 2026-10-11); los e2e mencionan Inkscape como fuente, no lo ejecutan.
- **D11 · bajo · 2026-10-11 · Nodos coincidentes y selección a zoom bajo:** corregido en `2949201` sin test propio (dos nodos a 0,45 px a 5 %; puntas de la flecha). Revisión de GPT pendiente sobre ese commit.
- **D12 · bajo · 2026-10-09 · Renderizador de líneas de trazos raster anteriores al motor de punta:** reconstruye 132 píxeles con más de 4 niveles de alfa de diferencia, máximo 72 (`npm run brush:check`). Solo afecta a trazos antiguos al reconstruirse; los nuevos coinciden.
- **D13 · medio · 2026-10-13 · Importar SVG de Inkscape con un archivo real del usuario** y revisar qué elementos siguen rasterizados (`6278ed4` solo se probó con un SVG construido a mano). [inkscape-importacion](inkscape-importacion.md).
- **D14 · alto · 2026-10-13 · Render y rendimiento del Designer:** 18 pendientes en [render-estado](render-estado.md) (digests de paridad, A/B final, PNG en worker, contradicción del oráculo de 200 operaciones, memoria de 2048² con CPU por encima del tope, cajas en memoria…) más 9 de «Lo que sigue abierto» (Shift+A, paradas de degradado, booleanas, snapping…). Alto porque el usuario ordena la velocidad antes que las funciones. Sigue sin existir la **sonda del guardado** (el dominio `raster` solo cubre restaurar y programar).
- **D15 · bajo · 2026-09-24 · Memoria del historial del Designer** (40 entradas, ~16 MB por copia de 2048×2048). Parcial desde el 2026-10-13: mosaicos de 64² en memoria (`79bf595`); falta medir el gesto (render-estado).
- **D16 · medio · 2026-10-08 · Capas FX (ADR 0011):** plan de pruebas completo en [fx-pruebas](fx-pruebas.md); `task/fx` ya está dentro de la línea principal.
- **D18 · medio · 2026-10-13 · Lineart que se deforma al encoger:** el usuario lo aprobó con reservas (90/100) y estima una deformación residual del 10 %; pedirle un caso concreto. [diagnostico-escala-lineart](diagnostico-escala-lineart.md).
- **D31 · medio · 2026-10-24 · Compatibilidad completa con Inkscape** (pedido del usuario, para después; quizá como opción de exportación). Hoy (`4a882c3`) el SVG lleva `sodipodi:`/`inkscape:` en sector, arco, cuerda, polígono y estrella. Faltan: redondeo de polígono/estrella al estilo Inkscape (curvas por los vértices, `sp-star.cpp:346-410`; hoy sale como trazo sin atributos), sector completo sin la línea al centro, `<circle>` cuando rx = ry, Randomized (semilla por forma, parámetros nuevos), «mantener abertura» y Mayús-clic en los tiradores, y la prueba real abriendo el SVG en Inkscape (ver D10). Fuente de Inkscape: `~/Descargas/inkscape-src` (clon parcial).

## Trabajo propuesto (orden de Astra, 2026-10-09)

El usuario dijo que máscaras, ajustes, PSD y color son el próximo trabajo del Designer; el orden de ejecución es **propuesta** de Astra. Cada incorporación cierra vista, undo, guardado y entrega antes de añadir otra. Hecho de este plan: pasos 1 y 1b (en cerrados).

- **D5 · medio · 2026-10-09 · Paso 2: caché de FX con presupuesto de memoria.** Primer paso hecho (capas con FX «layer»; «Everything below» comparte presupuesto desde el 2026-10-13, `cacheBudget.ts`). Falta medir con el banco (`FX_BENCH=50 npm run fx:check -- -g bench` y `npm run trace:report`, antes y después, mismo documento y carga) y liberar al cerrar documentos. Clave por contenido, parámetros, alcance y resolución; separar vista y exportación. Cierre en [render-estado](render-estado.md).
- **D6 · medio · 2026-10-09 · Paso 3: recorrido completo de máscara** (crear, pintar, mover con y sin vínculo, desactivar, undo/redo, guardar, recargar, exportar). Antes se cierran dos contratos:
  - *Orden máscara/efectos:* máscara del contenido antes de los FX de la capa (como `drawMaskedVector`); especificar alfa parcial, halo y «Everything below» con píxeles esperados.
  - *Vida de los buffers:* identidad y propiedad de cada máscara en guardado, restauración y undo/redo; que borrar o deshacer no libere un buffer referenciado; sin segundo sistema de persistencia (`raster.ts`, historial, máscaras vectoriales).
- **D7 · medio · 2026-10-09 · Paso 4: ajustes, grupos que componen y color.** Contratos previos:
  - *Carpetas y grupos:* las carpetas actuales son organización sin aislamiento; un grupo que componga será explícito, con versión y alcance de FX definido, sin cambiar archivos guardados en silencio.
  - *Espacio de color explícito:* sRGB de 8 bits, alfa documentada y dónde ocurren mezcla y ajustes; conversión o rechazo visible fuera del contrato; ICC y gamut amplio quedan fuera.
- **D8 · medio · 2026-10-09 · Paso 5: PSD.** Subconjunto acordado, archivos externos y ida y vuelta; avisar de lo no representable. *Promesa PSD:* capas raster y máscaras alfa editables; texto, vectores, ajustes, FX y perfiles solo se anuncian como editables tras demostrarlo; no prometer un PSD idéntico. Compatibilidad con Photoshop/GIMP **sin verificar**.

## Funciones propuestas

- **D2 · medio · 2026-10-09 · Brocha, lo que falta de SAI** ([ADR 0013](decisions/0013-campos-y-brocha.md)): mezcla húmeda (Blending, Dilution, Persistence), calidad y multiplicador de tamaño. Medir antes el coste por movimiento con el [protocolo](depuracion.md#protocolo).
- **D3 · bajo · 2026-10-09 · Mismo campo fuera del Designer:** sliders de la galería, boceto, visor 3D y tarjeta de ajustes con estilo propio. Cambia la interfaz de otros espacios: preguntar antes.
- **D17 · medio · 2026-10-10 · Interfaz del Designer al estilo ibisPaint y Photoshop** ([propuesta](propuesta-gui-pintura.md)): lo que se toca cada segundo siempre visible, herramientas con nombre, capas con efectos dentro, girar el lienzo e histograma. Secuencia vigente de 8 pasos; el primero es el inventario con un test de alcance. Pedido por el usuario, sin decidir el orden.

## Límites y huecos de la tanda 2026-11-01

Límites conocidos de los cambios de la [caja de herramientas](designer-controles/toolbox-dock.md) y los trazos Lineart ([nodos-modos](designer-controles/nodos-modos.md)). Los huecos D34, D35, D37 y D38 van en el orden de impacto que dio el usuario (el primero, el de más impacto). D36 (constructor de formas y booleanas) se cerró el 2026-11-01 y sus restos son D39 a D41, que son propuesta; D42 y D43 vienen de Fix overlaps y de la reconstrucción exacta del mismo día. La prioridad es propuesta de Astra.

- **D32 · bajo · 2026-11-01 · Slider de tamaño del trazo Lineart:** cada tick registra un paso de deshacer, igual que los campos de forma hoy. Agrupar el arrastre en un solo paso si el usuario lo nota.
- **D33 · bajo · 2026-11-01 · Borrar un trazo entero y deshacer:** el deshacer devuelve el trazo, pero no lo deja elegido (`strokeEdit.ts`, `replace`).
- **D34 · medio · 2026-11-01 · Edición de nodos dentro de Pen** (hueco de figcraft, el de más impacto).
- **D35 · medio · 2026-11-01 · Bote de pintura por región** (hueco de figcraft).
- **D37 · bajo · 2026-11-01 · Herramienta Width** (hueco de figcraft).
- **D38 · bajo · 2026-11-01 · Espaciado de párrafo en el texto:** hoy solo hay interlineado (Line) y espaciado entre letras (Spacing); ver [texto](designer-controles/texto.md).
- **D39 · bajo · 2026-11-01 · Trim, Merge y Crop del pathfinder** (propuesta). Las booleanas actuales son Union, Subtract, Intersect, Exclude y Divide ([booleanas](designer-controles/booleanas.md)); faltan esas tres operaciones de recorte.
- **D40 · medio · 2026-11-01 · Booleanas entre capas** (propuesta). Hoy solo actúan sobre formas de una misma capa vectorial (`shapeBuilder.ts:18`).
- **D41 · bajo · 2026-11-01 · Arrastrar las manijas de Bend** (propuesta). En Bend solo responden los nodos y los segmentos; las manijas no se mueven con el arrastre (`PathNodes.tsx:104`). Ver [nodos-modos](designer-controles/nodos-modos.md).
- **D42 · medio · 2026-11-01 · Caras de un trazado que se cruza a sí mismo** (propuesta). La selección Face de los nodos solo reconoce subtrazados cerrados; las regiones de solape de un trazado que se cruza no son caras (`selectMode.ts`, `facesOf`). Propuesta: tratarlas como caras al elegir, con su relleno. Ver [nodos-modos](designer-controles/nodos-modos.md) y [booleanas](designer-controles/booleanas.md).
- **D43 · medio · 2026-11-01 · Reconstrucción exacta de curvas (Z tags)** (**corregido** en código y tests, `tests/fix-overlaps.test.ts`; falta prueba visual del usuario). Casos cubiertos en `exactRebuild.ts`: cúbico que se cierra sobre sí mismo, T-junctions, orientación y guarda de trazados grandes. Ver [booleanas](designer-controles/booleanas.md).
- **D44 · medio · 2026-11-01 · Calibrar los presets de lápiz para que sean físicamente exactos.** Los 8 presets y los de dabs gustaron en el sandbox, pero el usuario los probará a fondo antes. Ver [057](history/057-2026-11-W44.md), [0027](decisions/0027-motor-pincel-dabs.md).
- **D45 · bajo · 2026-11-01 · Desviaciones de los dabs frente a MyPaint:** el espaciado no se mide en el marco elíptico, Tooth escala el sello en vez de restar, no hay linealización de la opacidad y el plano es la caja del trazo + 48 px (`brushDabs.ts`).
- **D46 · medio · 2026-11-01 · `raster.ts` en el límite (29 997 bytes de 30 000):** el próximo cambio ahí debe ir a otro archivo (`check-docs` y la regla de archivos ≤ 30 KB).
- **D47 · medio · 2026-11-01 · Rediseño del panel Edit/Move** (propuesta, a la espera de aprobación del usuario). Antes de implementar, comprobar qué hace «Settings…».
- **D48 · bajo · 2026-11-01 · Prueba visual de la disposición de la tarjeta Brush:** el aviso de presión ya no la ensancha y las filas se apilan desde arriba (`tool-dock.css`); solo se comprobó por tests.

## Auditoría del Designer (2026-10-22)

De la [auditoría del Designer](../../ogs-designer-audit-2026-10-22.md) (HEAD `64fd215`), comprobados en el código y ordenados por lo que sufre el usuario. Ninguno pide tarjetas ni paradas: se arreglan por debajo, con una prueba que reproduzca cada caso. Son 11 hallazgos en 10 entradas: D26 agrupa los dos pasos de deshacer vacíos.

- **D19 · cerrado 2026-10-23** · [050](history/050-2026-10-W43.md).
- **D20 · cerrado 2026-10-23** · [050](history/050-2026-10-W43.md).
- **D21 · cerrado 2026-10-23** · [050](history/050-2026-10-W43.md).
- **D22 · cerrado 2026-10-23** · [050](history/050-2026-10-W43.md).
- **D23 · cerrado 2026-10-23** · [050](history/050-2026-10-W43.md).
- **D24 · cerrado 2026-10-23** · [050](history/050-2026-10-W43.md).
- **D25 · cerrado 2026-10-23** · [050](history/050-2026-10-W43.md).
- **D26 · cerrado 2026-10-23** · [050](history/050-2026-10-W43.md).
- **D27 · cerrado 2026-10-23** · [050](history/050-2026-10-W43.md).
- **D28 · cerrado 2026-10-23** · [050](history/050-2026-10-W43.md).
- **D29 · bajo · 2026-10-23 · Los PNG de capas borradas o fusionadas se quedan en el disco.** D19 ya las saca de memoria; borrar sus archivos es un borrado de datos y necesita aprobación explícita antes de tocar `deleteBuffers` (zona protegida).
- **D49 · medio · 2026-11-04 · Objetivo de rendimiento al arrastrar un grupo: ~12 ms entre fotogramas (ahora ~22 ms).** Siguiente paso: separar `render.frame` entre grupo y resto; luego cachear las capas quietas como bitmap y repintar solo el grupo (hipótesis, sin medir). Ver [057](history/057-2026-11-W44.md).
- **D50 · medio · 2026-11-04 · Revisión visual del usuario pendiente:** ajustes rápidos por herramienta, umbral de plegado de 560 px, pastilla del ojo al ocultar, marquee y golpe de trazos. Además, el atajo de traza Ctrl+Alt+P no funcionó (la URL `?trace=<etiqueta>` sí); sin investigar. Calibración de presets en D44; panel Edit/Move en D47.
- **D51 · alto · 2026-11-05 · Franja junto a la tarjeta del pincel que no pinta y círculo del pincel que desaparece a veces.** Sin investigar. Siguiente paso: reproducir en el sandbox de `ogs-preset-keep` y revisar el desplegable de la tarjeta. [058](history/058-2026-11-W45.md).
- **D52 · alto · 2026-11-05 · El usuario no ha visto** la recalibración del frotado (`11fc968e`), los presets propios (`47efe1ef`) ni la tecla repetida (`9df5ffb0`). Siguiente paso: sandbox desde `ogs-preset-keep`.
- **D53 · medio · 2026-11-05 · Con presets `lead`, Hardness, Texture, Tooth, Edge y la forma de la punta no actúan** y siguen visibles. Ocultarlos o deshabilitarlos; decidir con el usuario.
- **D54 · medio · 2026-11-05 · Una pasada muy clara en 2H casi no se ve** (línea a 90 % de presión) y el grano del modelo es más grueso que el de la lámina. Que el usuario juzgue; ajustar `FIRST` o la curva por grado.
- **D55 · medio · 2026-11-05 · Propuestas de interfaz en espera de visto bueno:** Size con rangos ×1 (1–100) y ×10 (10–1000), lineal, aprobado el 2026-11-06 (vista previa a menor resolución sobre ~240 px, sin construir), panel derecho siempre flotante con toolbox y lienzo centrados, y tres botones de capa (Raster, Vector, Text). Medir el pincel a 1000 px antes.
- **D56 · bajo · 2026-11-05 · Código de GIMP sin leer.** Hace falta la ruta del usuario; lectura corta con un subagente.
- **D57 · alto · 2026-11-05 · Guardado sin capas a las 17:11:13 sin explicar** y deshacer solo en memoria (incidente del [058](history/058-2026-11-W45.md#incidente-de-borrado-del-2026-11-05)). Zona de persistencia protegida: autorización explícita antes de tocar; reproducir con datos de prueba.
- **D58 · medio · 2026-11-05 · ADR [0028](decisions/0028-lapiz-grafito.md) en «Propuesto»:** aceptar o rechazar tras el juicio del usuario (después de D52).
- **D59 · bajo · 2026-11-05 · Latencia:** `getPredictedEvents` y canvas `desynchronized` sin probar; sonda en sandbox sin tocar el motor.

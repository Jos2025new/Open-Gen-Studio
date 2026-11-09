# Propuesta: objetos completos y profundidad (Z)

Fecha: 2026-11-09. Estado: propuesta, sin implementar. Rama de partida: `task/export` (commit `34b26ea4`).

Origen: conversación con el usuario tras cerrar la selección tipo Inkscape, los grupos de objetos y el endurecimiento del export (2026-11-08/09). El usuario quiere que la app cumpla lo que espera un profesional y prevé funciones 2.5D/semi‑3D.

## Índice

1. [Diagnóstico de lo que falta](#1-diagnóstico-de-lo-que-falta)
2. [Profundidad: decisiones](#2-profundidad-decisiones)
3. [Datos por nodo: investigación](#3-datos-por-nodo-investigación)
4. [Propuesta por fases](#4-propuesta-por-fases)
5. [Intercambio con el usuario](#5-intercambio-con-el-usuario)
6. [Referencias](#6-referencias)

## 1. Diagnóstico de lo que falta

Código revisado el 2026-11-09; solo lectura.

1. **Imagen y texto como objeto en modo Objeto.** Una capa sin partes (imagen, texto, pintura sin trazos) no tiene objetos: `layerObjects` devuelve `[]` (`src/engine/design/objectOps.ts:27`). En modo Objeto el clic toma el camino de «capa entera» (`Stage.tsx`, rama de `pixelTarget`/`pickLayer`); los tiradores salen por el respaldo de la capa activa (`Stage.tsx:257`). Se ve igual, pero se elige la capa: el panel resalta la capa, su lista de objetos queda vacía y el área de export «Selected objects» da «No picked objects…». Propuesta: en modo Objeto ese contenido es un objeto con `id = layer.id`; revisar `pickedTargets` (`stageObjMove.ts:81`), mover, borrar, `objectsArea` (`exportJob.ts`) y `LayerObjects.tsx`. Modo Capa sin cambios.
2. **Resaltar el tirador bajo el ratón.** El hover existe pero solo cambia el cursor (`Stage.tsx`, `onPointerMove`, estado `hoverHandle`). Guardar el tirador y pasarlo a `drawTransformOverlay` (`stageSprites.ts`) para pintarlo con el acento del tema, sin cambiar su forma.
3. **Entrar a un grupo en el lienzo.** Un clic elige el grupo entero (`clickPick`, `objectGroupTree.ts`). El doble clic ya edita curva de lineart, forma (`editShape`) o texto (`Stage.tsx`, `onDoubleClick`); Ctrl añade a la selección. Propuesta: doble clic sobre un miembro = entrar al grupo (solo ese miembro); otro doble clic = editar la forma. Cambia un gesto existente: decidir con el usuario.
4. **Panel: ordenar, renombrar, ocultar y bloquear objetos.** No hay operaciones de orden de objetos dentro de una capa. `ShapeSpec` (`src/engine/shapeSpec.ts`) no tiene nombre, visible ni bloqueado; los nombres del panel se generan en `LayerObjects.tsx`. Requiere campos opcionales, respetarlos en render, hit test, selección y export, y un reordenado que mantenga juntos los miembros de cada grupo. `types.ts` supera 30 KB y no puede crecer (`check-sizes`): ahorrar en otra parte o mover tipos.
5. **PDF sin capas ni grupos.** `svgToPdf` (`export.ts`) usa jsPDF + svg2pdf.js; svg2pdf ignora `inkscape:groupmode` y jsPDF no expone capas (Optional Content Groups). Investigar: OCG a mano, otra librería o PDF plano documentado.
6. **Agrupar lineart y pinceladas.** Los trazos de lineart están en `VectorLayer.strokes` y se dibujan siempre sobre las formas; las pinceladas están volcadas en píxeles. El árbol de grupos abarca solo formas (`groupShapes` filtra). Unificar el orden de formas y trazos cambia render y export: diseñar aparte.

Orden recomendado: 1 y 2; 3 tras decidir el gesto; 4 (con las bases de Z de la sección 4); después investigar 5 y 6.

## 2. Profundidad: decisiones

Comprobado: ni `LayerBase` ni las formas tienen Z; el apilado es el orden de la lista (de abajo arriba). SVG tampoco tiene Z: pinta en orden de documento; el `z-index` de SVG 2 no se implementó en navegadores, y las transformaciones 3D son de CSS para HTML. Al exportar, la profundidad se aplana a orden y posiciones proyectadas.

Decisiones propuestas:

- **Dos conceptos separados.** Orden de apilado (quién tapa a quién) ≠ profundidad geométrica (perspectiva, paralaje, extrusión). Como en Blender Grease Pencil, cuyo «Stroke Depth Order» elige entre *2D Layers* (manda el orden) y *3D Location* (manda la profundidad) — dato de memoria, por confirmar en su documentación.
- **Z vive en el objeto**, junto a `x` e `y`, no en un registro aparte (id → z): viaja sola al copiar, duplicar, deshacer, guardar o mover entre capas; un registro aparte se desincroniza (al duplicar una capa los ids cambian, como pasó con los grupos el 2026-11-09).
- **La proyección es una función aparte**, aplicada al dibujar y exportar; no cambia los datos. `z = 0` por defecto: todo se ve como hoy.
- **Modo de orden por capa o grupo**: *Lista* (actual; Z solo proyecta), *Profundidad* (ordena por Z dentro) y *Mixto* (lista entre capas/grupos, Z dentro de cada uno).
- **Profundidad real simulada**, por niveles: (1) ordenar por una Z representativa del objeto (media o más cercana): barato, basta para paralaje; (2) partir objetos en trozos y ordenar los trozos (pintor con subdivisión): resuelve casi todos los cruces y sigue siendo vectorial; (3) profundidad por píxel en la vista, exacta en pantalla, con el export vectorial cayendo al nivel 2 o a imagen. Empezar por 1, dejar preparado 2.
- **Z por punto, configurable**: profundidad del punto = Z del objeto + Z del nodo; la selección por aristas y segmentos permitiría «empujar» nodos en Z. Llega con un modelo de nodos propio (sección 3), no sobre el texto `d`.

## 3. Datos por nodo: investigación

Pregunta (2026-11-09): ¿cómo guardan las herramientas profesionales datos por nodo (Z, presión, tipo) sin que se desincronicen al editar? Investigación delegada a un agente Sonnet; lo marcado «verificado» viene de páginas consultadas, lo demás es inferencia.

- **Inkscape** (verificado): `sodipodi:nodetypes` es un texto paralelo a los nodos de `d`, una pista y no la verdad. Fallo conocido: «Invertir» no invertía los tipos (bug 179866, arreglado en 2009); otros reportes de tipo erróneo (610817) y de edición XML sin efecto (inbox 3489). Inferido: el editor la regenera desde sus objetos de nodo; ediciones externas o booleanas la dejan obsoleta y se re‑adivina.
- **Blender Grease Pencil v3 / Curves** (verificado): `CurvesGeometry` guarda atributos por punto y por curva, con la topología como offsets. Las operaciones que cambian puntos calculan nuevos offsets, copian los atributos de lo no tocado y interpolan los de lo nuevo.
- **Figma** (verificado): cada `VectorVertex` lleva sus datos (x, y, cap, join, radio de esquina, espejo de tiradores); los segmentos referencian vértices por índice, así que borrar exige renumerar.
- **Paper.js** (verificado en resumen de página): `Segment.data` va en el segmento; en SVG se guarda por índice y se descarta si los índices no cuadran.
- **No comprobado**: Skia/PathKit (verbos y puntos sin datos por nodo), Lottie (arrays paralelos de vértices y tangentes, frágiles).

Qué suele romper una lista paralela: invertir, partir, insertar, borrar, booleanas, simplificar y cambiar el inicio de un trazo cerrado; los extremos duplicados de un cerrado cambian la cuenta; un editor externo reescribe `d` y deja atrás los datos.

Regla común para nodos nuevos: copiar del nodo de origen si existe; interpolar en el tramo al insertar; en cruces de booleanas, interpolar entre los dos nodos del borde o tomar el más cercano (inferido, sin fuente pública); si no, un valor por defecto documentado. Al cargar, validar la cuenta y reconstruir si no cuadra.

Conclusión: «enlazar» bien es que cada nodo lleve sus datos (Figma) o un sistema de atributos con reglas de interpolación (Blender), no una lista paralela al texto `d`.

## 4. Propuesta por fases

- **Ahora (punto 4 del diagnóstico)**: `z` opcional por objeto (formas, imágenes, textos; 0 por defecto); la proyección como función única en un solo sitio (identidad hoy); hueco para el modo de orden por capa o grupo (solo *Lista* implementado); hueco para que la transformación del objeto crezca a 3D. Junto con nombre, oculto, bloqueado y reordenado de objetos.
- **Después**: modelo de nodos propio (nodos como objetos o atributos por punto con interpolación), migrando desde `d`; con él, Z por nodo y empujar aristas/segmentos en Z.
- **2.5D**: proyección real (cámara, paralaje), modos *Profundidad* y *Mixto*, simulación de profundidad nivel 1 y luego 2.
- **Export**: SVG/PDF reciben orden final y posiciones proyectadas.

Esto no es «pan para hoy»: Z por objeto y proyección aparte son las bases que el modelo de nodos solo amplía, sin migrar dibujos. Sí lo sería poner Z por punto en una lista paralela sobre `d`.

## 5. Intercambio con el usuario

Resumen, 2026-11-09:

- Pidió diagnosticar lo que un profesional echaría en falta → sección 1.
- Preguntó por «Exportar objetos seleccionados»: se aclaró que una imagen elegida cuenta como capa y el área «Selected objects» queda vacía.
- Planteó prever x, y, z como dimensión real para 2.5D; GPT ya había señalado que no existe Z. Se acordó Z en el objeto y proyección aparte.
- Preguntó cómo lo hace Blender → modos de orden de Grease Pencil y Z por punto.
- Propuso Z por punto configurable, empujar aristas/segmentos, y que convivan Z y orden estándar → modos Lista/Profundidad/Mixto y Z por nodo.
- Preguntó si enlazar los datos por nodo es sencillo y pidió referencias (vía Sonnet) → sección 3.
- Preguntó si posponer la Z por punto era «pan para hoy y hambre para mañana» o «dejar las cabillas para la próxima viga» → lo segundo, si el punto 4 deja las bases.
- Propuso una «profundidad real» simulada propia → niveles 1–3.

## 6. Referencias

- Inkscape, Reverse no invierte nodetypes: https://bugs.launchpad.net/bugs/179866
- Inkscape, tipo de nodo erróneo: https://bugs.launchpad.net/bugs/610817
- Inkscape, editar nodetypes en XML sin efecto: https://gitlab.com/inkscape/inbox/-/issues/3489
- Blender, Curves (atributos y operadores): https://developer.blender.org/docs/features/objects/curves/
- Figma, VectorNetwork: https://developers.figma.com/docs/plugins/api/VectorNetwork/
- Figma, vector networks: https://www.figma.com/blog/introducing-vector-networks/
- Paper.js, Segment: http://paperjs.org/reference/segment/

---
type: inventario
title: Booleanas de formas, Shape Builder y arreglo de solapes
description: Union, Subtract, Intersect, Exclude y Divide sobre formas con relleno de una capa vectorial, el Shape Builder (Shift+M), la reconstrucción exacta de curvas y Fix overlaps (Fill o Cut); qué hace cada uno, qué estado toca y dónde está en el código. Cambio del 2026-11-01.
tags: [designer, booleanas, formas, shape-builder, pathfinder, solapes]
updated: 2026-11-01
related: [tira-contextual, nodos-modos, toolbox-dock, formas, atajos, ../decisions/0026-motor-booleano]
---
# Booleanas de formas, Shape Builder y arreglo de solapes

Desde 2026-11-01 las formas de una capa vectorial se combinan con operaciones booleanas, y un trazado que se cruza a sí mismo se arregla con Fix overlaps. Los controles son **nuevos**: no son filas de las matrices de [README](README.md), que describen el estado anterior a este cambio. Motor y biblioteca: [ADR 0026](../decisions/0026-motor-booleano.md).

## Cuándo aparecen

- Con la herramienta Edit y **dos o más formas elegidas** en la misma capa vectorial, visible y desbloqueada (`pickedShapes`, `shapeBuilder.ts:18`). Con una sola forma, o con formas de dos capas, no aparecen.
- El grupo de botones está en la tira de selección (`ContextStrip.tsx:113`) y en la tarjeta de Edit (`EditCard.tsx:41`), ambas solo si hay más de una forma.

## Controles

| Control | Dónde está | Qué hace | Atajo |
| --- | --- | --- | --- |
| Union | Grupo booleano (`BooleanOps.tsx`) | Une las formas en una | Ctrl+Alt+U |
| Subtract | Grupo booleano | Resta las formas de delante de la de atrás | Ctrl+Alt+S |
| Intersect | Grupo booleano | Deja solo donde se solapan todas | Ctrl+Alt+I |
| Exclude | Grupo booleano | Deja todo menos donde se solapan | Ctrl+Alt+E |
| Divide | Menú del chevron «More: Divide, Shape Builder» (`BooleanOps.tsx`) | Cada región de solape pasa a ser una forma | sin atajo |
| Shape Builder | Menú del chevron | Activa la herramienta de abajo | Shift+M |

Los atajos de booleanas son Ctrl+Alt+letra (`designerKeys.ts:47`). Los tips de cada botón dan el orden: en Subtract, «la de atrás» es la de más abajo en la pila de la capa; la de delante es la que va encima.

## Reglas de cada operación (`shapeBoolean.ts`)

- **Solo formas con relleno.** Un trazo abierto sin relleno no entra: se ignora y se cuenta. Con menos de dos formas con relleno no hace nada y dice por qué.
- **Estilo del resultado:** el de la forma de atrás (`restyle(fill[0])`). Divide da a cada región el estilo de la forma que tiene más arriba entre las que la forman.
- **Divide:** los trazos abiertos sin relleno de la selección sirven de cuchillo (se aplanan y cortan las regiones).
- **Sin resultado**, la app no cambia nada y muestra el motivo: «These shapes do not overlap.» (Intersect sin solape), «Nothing is left of the result.», «Nothing to divide.» o «These shapes are too complex to divide.».
- **Lugar en la pila:** el resultado ocupa el sitio de la forma más alta de las elegidas; el resto de la capa no cambia. Queda elegido.
- **Un paso de deshacer** por operación.

## Reconstrucción exacta de curvas (`exactRebuild.ts`)

Union, Subtract, Intersect y Exclude (`booleanOp`, `pathBoolean.ts`) y Fix overlaps no devuelven curvas aproximadas: las curvas que no se tocan siguen siendo las mismas curvas.

- Cada punto del polígono aplanado lleva en su valor Z **el tramo de origen y su `t`**. Un nodo es el final de un tramo y el principio del siguiente (`Tagger`).
- Clipper avisa de cada cruce que crea, con las etiquetas de los dos tramos que se cruzan.
- Al terminar, cada contorno de salida se recorre: los puntos consecutivos del mismo tramo son **un único subtramo** de la curva original (de Casteljau entre `t0` y `t1`; una recta sigue siendo recta).
- Los **únicos nodos nuevos son los cruces**, afinados con Newton hasta el punto exacto donde se encuentran las dos curvas.
- Lo que no se puede asignar (un punto sin etiqueta) se reajusta desde su polilínea con el ajuste de Schneider, así que el resultado nunca falla.
- Cuchillo y borrado por área (`knifeArea`, `eraseArea`) **no** usan esta vía: siguen con el reajuste aproximado de [ADR 0026](../decisions/0026-motor-booleano.md).

Pruebas: `tests/fix-overlaps.test.ts` («curved segments stay the original curves…», «booleanOp cuts a curve exactly…», «booleanOp keeps untouched curves exactly…») y `tests/path-boolean.test.ts`.

**Corregido** tras revisión independiente: un único cúbico que se cierra sobre sí mismo (t por arista), T-junctions y solapes colineales, orientación leída en una cara propia (la que contiene otro contorno del trazado, si no la mayor; no en un vértice) y guarda de trazados grandes (más de 8000 puntos aplanados, no aristas originales: Fill pasa a Cut). Test: `tests/fix-overlaps.test.ts`. Ver [pendientes-designer](../pendientes-designer.md), D43.

## Shape Builder (`ShapeBuilder.tsx`, `shapeBuilder.ts`)

Herramienta de Shift+M con dos o más formas elegidas. Ocupa el lienzo mientras está activa, así que el escenario no recibe sus punteros (la rueda pasa al lienzo).

- **Al pasar el puntero** se resaltan las regiones que forman las formas (con trama); las regiones se calculan una vez por conjunto de formas.
- **Clic o arrastre** sobre regiones: las tocadas se unen en una sola forma.
- **Alt** (mantenido): en vez de unir, borra las regiones tocadas. Soltar Alt vuelve a unir.
- **Esc** cancela el arrastre en curso.
- **Límites:** con más de 64 áreas, o con demasiados vértices o regiones, no dibuja regiones y la barra dice «These shapes are too complex for the Shape Builder. Pick fewer or simpler shapes.» (`pathBoolean.ts:30-32`, `:328-351`).
- Sin dos formas elegidas, la barra dice que hay que elegirlas con Edit y Shift-clic.

## Fix overlaps: arreglar un trazado que se cruza

Un trazado con relleno que se cruza a sí mismo (un segmento arrastrado de vuelta sobre su propio contorno) pliega una parte. Esa parte gira al revés, y con la regla nonzero el solape aparece como un agujero. Fix overlaps lo arregla en un paso de deshacer.

Es el equivalente en 2D de **Recalculate normals** de Blender: en 2D, el sentido de recorrido del contorno es la «normal», y una parte con el sentido contrario se cancela. Arreglarla hace que todas las partes apunten al mismo lado.

- **Dónde:** en el menú Más de la edición de nodos (`NodeEditBar.tsx`, `NodeMoreMenu`) y en el Más de la tira de selección (`ShapeMoreMenu.tsx`). Ambos usan `FixOverlapsRow.tsx`.
- **Cuándo se activa:** un path con relleno (`fixOverlapsState`, `fixOverlaps.ts`). Un rectángulo, una elipse o un polígono no pueden cruzarse; su entrada aparece deshabilitada con el motivo.
- **Fill** (por defecto): las partes plegadas se enderezan y **suman**; se rellena todo lo que encierra el contorno.
- **Cut:** las partes plegadas se rellenan, pero donde el pliegue se solapa con el original (+1 y −1 se cancelan) el solape **queda vacío**, como un agujero.
- En ambos modos, un anillo dibujado con dos contornos de sentido opuesto **sigue siendo anillo**.
- **Recordado:** el modo se guarda en `ui.fixMode` (`store.ts`, `persistUi.ts`); por defecto, Fill.
- **Conserva** el id y el estilo de la forma; el relleno vuelve a nonzero. Las curvas siguen siendo las originales: los únicos nodos nuevos son los cruces (ver la sección de reconstrucción exacta).
- **Sin cruces**, la forma no cambia y no deja paso de deshacer (`fixShapeOverlaps` devuelve `false`).

Pruebas: `tests/fix-overlaps.test.ts` (id y estilo, un paso de deshacer, sin cruces, las dos entradas de More, pliegue, Fill frente a Cut, anillo, curvas exactas) y `tests/path-boolean.test.ts` (`fixOverlaps`: pliegue, lazo, anillo). Sin prueba visual: la hace el usuario en el sandbox.

**Pendiente** (D42): la selección Face de [nodos-modos](nodos-modos.md) no reconoce como caras las regiones de solape de un trazado que se cruza; hoy solo cuentan los subtrazados cerrados.

## Límites conocidos

- Solo una capa vectorial a la vez; no hay booleanas entre capas (pendiente en [pendientes-designer](../pendientes-designer.md), D40).
- No hay Trim, Merge ni Crop del pathfinder (pendiente D39).
- Las operaciones se aplican a formas, no a trazos Lineart (esos tienen sus herramientas en [nodos-modos](nodos-modos.md)).
- Reconstrucción exacta: corregida (D43); falta prueba visual. Cuchillo y borrado por área siguen aproximados.

## Evidencia

- Código: commits `d2ba3496` (grupo, atajos, Shape Builder, `shapeBoolean.ts`, `shapeBuilder.ts`) y `5778b426` (motor Clipper2 que usan). Desde `157985f1` (2026-11-01): Fix overlaps con Fill y Cut, `fixOverlaps.ts`, `FixOverlapsRow.tsx`, y reconstrucción exacta con etiquetas Z en `exactRebuild.ts`, usada también por Union, Subtract, Intersect y Exclude.
- Tests: `tests/shape-boolean.test.ts` (operaciones, orden de pila, estilo, mensajes, Divide con trazos), `tests/fix-overlaps.test.ts`, `tests/path-boolean.test.ts`.
- Prueba visual del grupo, del Shape Builder (regiones, Alt, Esc) y de Fix overlaps: **no hecha**. La hace el usuario en el sandbox.

## Enlaces

- [[tira-contextual]] · [tira-contextual.md](tira-contextual.md)
- [[nodos-modos]] · [nodos-modos.md](nodos-modos.md)
- [[formas]] · [formas.md](formas.md)
- [[atajos]] · [atajos.md](atajos.md)
- [ADR 0026 — motor de booleanas](../decisions/0026-motor-booleano.md)
- [Índice de controles](README.md)

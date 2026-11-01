---
type: inventario
title: Booleanas de formas y Shape Builder
description: Union, Subtract, Intersect, Exclude y Divide sobre formas con relleno de una capa vectorial, y el Shape Builder (Shift+M); qué hace cada uno, qué estado toca y dónde está en el código. Cambio del 2026-11-01.
tags: [designer, booleanas, formas, shape-builder, pathfinder]
updated: 2026-11-01
related: [tira-contextual, nodos-modos, toolbox-dock, formas, atajos, ../decisions/0026-motor-booleano]
---
# Booleanas de formas y Shape Builder

Desde 2026-11-01 las formas de una capa vectorial se combinan con operaciones booleanas. Los controles son **nuevos**: no son filas de las matrices de [README](README.md), que describen el estado anterior a este cambio. Motor y biblioteca: [ADR 0026](../decisions/0026-motor-booleano.md).

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

## Shape Builder (`ShapeBuilder.tsx`, `shapeBuilder.ts`)

Herramienta de Shift+M con dos o más formas elegidas. Ocupa el lienzo mientras está activa, así que el escenario no recibe sus punteros (la rueda pasa al lienzo).

- **Al pasar el puntero** se resaltan las regiones que forman las formas (con trama); las regiones se calculan una vez por conjunto de formas.
- **Clic o arrastre** sobre regiones: las tocadas se unen en una sola forma.
- **Alt** (mantenido): en vez de unir, borra las regiones tocadas. Soltar Alt vuelve a unir.
- **Esc** cancela el arrastre en curso.
- **Límites:** con más de 64 áreas, o con demasiados vértices o regiones, no dibuja regiones y la barra dice «These shapes are too complex for the Shape Builder. Pick fewer or simpler shapes.» (`pathBoolean.ts:30-32`, `:328-351`).
- Sin dos formas elegidas, la barra dice que hay que elegirlas con Edit y Shift-clic.

## Límites conocidos

- Solo una capa vectorial a la vez; no hay booleanas entre capas (pendiente en [pendientes-designer](../pendientes-designer.md), D40).
- No hay Trim, Merge ni Crop del pathfinder (pendiente D39).
- Las operaciones se aplican a formas, no a trazos Lineart (esos tienen sus herramientas en [nodos-modos](nodos-modos.md)).

## Evidencia

- Código: commits `d2ba3496` (grupo, atajos, Shape Builder, `shapeBoolean.ts`, `shapeBuilder.ts`) y `5778b426` (motor Clipper2 que usan).
- Tests: `tests/shape-boolean.test.ts` (operaciones, orden de pila, estilo, mensajes, Divide con trazos).
- Prueba visual del grupo y del Shape Builder (regiones, Alt, Esc): **no hecha**. La hace el usuario en el sandbox.

## Enlaces

- [[tira-contextual]] · [tira-contextual.md](tira-contextual.md)
- [[nodos-modos]] · [nodos-modos.md](nodos-modos.md)
- [[formas]] · [formas.md](formas.md)
- [[atajos]] · [atajos.md](atajos.md)
- [ADR 0026 — motor de booleanas](../decisions/0026-motor-booleano.md)
- [Índice de controles](README.md)

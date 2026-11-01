---
type: inventario
title: Tira contextual (ContextStrip)
description: La tira de la Edit card y de las tarjetas: qué rama muestra según herramienta y selección, y cada control de esas ramas.
tags: [designer, contextstrip, nodos, formas]
updated: 2026-11-01
related: [alinear-editar, formas, texto, curva, toolbox-dock, capas, propiedades, nodos-modos, booleanas]
---
# Tira contextual (ContextStrip)

`ContextStrip` (`ContextStrip.tsx:42`) se monta solo dentro de `EditCard` (`EditCard.tsx:37`); con la herramienta `hand` no pinta nada (`ContextStrip.tsx:59`). Siempre empieza con la etiqueta «Tool → destino» (`ContextStrip.tsx:68`) y termina con «Settings…». En medio muestra UNA rama, por este orden de prioridad: varios paths, texto seleccionado, forma seleccionada (editando o no), o los ajustes de la herramienta en modo `compact`. Las ramas `compact` de pincel y borrador están en [[pincel]] y [[borrador]]. **Alcance (corregido tras auditoría):** `ContextStrip` solo está montado en `EditCard`, y el dock monta `EditCard` solo cuando la variante elegida es Edit (`ToolDock.tsx:133`). Por lectura se alcanzan con seguridad las ramas con Tool = move (varios paths, forma seleccionada o en edición, Rounding) y, dentro de la familia Edit, las del selector de la propia tira. Las ramas de texto seleccionado, Follow stroke ruler y `compact` de ToolSettings para Brush, Eraser, Fill, Gradient, Curve, Lineart y Ruler pertenecen a otra familia: al cambiar de familia el reductor pone `variantId` a null y el dock monta `ToolSettings` con `card` (`ToolDock.tsx:64-67`). Quedan marcadas «código muerto por lectura (`f11a0dd`; [rastreo 2.6](../rastreo/designer.md)) — requiere decisión y prueba en sandbox». Excepción sin confirmar: Rectangle, Ellipse, Line, Polygon y Select están en la familia Edit; R, O, L o M con la variante Edit abierta no re-despachan (`ToolDock.tsx:60`), así que su rama `compact` requiere prueba en sandbox.

| Control | Dónde está hoy | Qué estado modifica | Cuándo aparece | Notas | Dónde quedaría en la propuesta | Estado | Mockup |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Etiqueta «Tool → destino» | Tira (`ContextStrip.tsx:68`) | Ninguno; el destino sale de `editTarget` (`ContextStrip.tsx:31`) | Siempre salvo hand | Destino: capa activa, «new layer» o «new text» | Igual que hoy | se conserva | no dibujado |
| Estado «N paths selected» / «Editing nodes · N paths» | Tira, rama varios paths (`ContextStrip.tsx:72`) | Ninguno | Tool = move y ≥2 paths como destino | Texto informativo | Igual que hoy | se conserva | no dibujado |
| Edit nodes (varios paths) | Tira, rama varios paths (`ContextStrip.tsx:76`) | `setShapeEdit` con la lista de paths | Hay ≥2 paths y aún no se editan | — | Igual que hoy | se conserva | no dibujado |
| Done (varios paths) | Tira, rama varios paths (`ContextStrip.tsx:75`) | `setShapeEdit(doc.id, null)` | Editando nodos de varios paths | — | Igual que hoy | se conserva | no dibujado |
| Ayuda de nodos (texto) | Tira, rama varios paths (`ContextStrip.tsx:77`) | Ninguno | Rama varios paths | Los cambios de topología siguen siendo por path | Igual que hoy | se conserva | no dibujado |
| Campos de texto seleccionado | Tira, rama texto (`ContextStrip.tsx:78`) | `patchLayer` sobre la capa de texto (si no está bloqueada) | Tool = text y la capa activa es texto — Solo en la tira: «código muerto por lectura (`f11a0dd`; [rastreo 2.6](../rastreo/designer.md)) — requiere decisión y prueba en sandbox» | `TextStyleFields` compact: mismos campos que [[texto]] | Igual que hoy | se conserva | no dibujado |
| Editing shape / Editing nodes (etiqueta) | Tira, rama forma en edición (`ContextStrip.tsx:83`) | Ninguno | Forma seleccionada con Edit shape activo | — | Igual que hoy | se conserva | no dibujado |
| W / H de la forma | Tira, rama edición (`ContextStrip.tsx:84`) | La forma seleccionada (`patchShape`) | Editando forma | Sliders con valor manual sin tope (`ShapeLookFields.tsx:66`) | Igual que hoy | se conserva | no dibujado |
| Shape (botón + popover de parámetros) | Tira, ramas edición y selección (`ShapePaint.tsx:100`) | Abre `PrimFields`; cambia `shape.prim`/radios | Forma con `prim` o elipse | Campos: Type, Rx, Ry, Start, End, Shape, Corners, Spoke ratio, Rounded (`PrimFields.tsx:30`) | Igual que hoy | se conserva | no dibujado |
| Rx / Ry (esquinas) | Tira, rama edición (`ShapeLookFields.tsx:29`) | `shape.rx` / `shape.ry` | Editando un rect | En varias capas lo hace `MultiRectangleRadii` | Igual que hoy | se conserva | no dibujado |
| Sharp corners | Tira, rama edición (`ShapeLookFields.tsx:31`) | Radios a cero | Editando un rect con radios | — | Igual que hoy | se conserva | no dibujado |
| Blur (slider %) | Tira, ramas edición y selección (`ShapeLookFields.tsx:33`) | `shape.blur` | Forma seleccionada | Tooltip con la fórmula de Inkscape | Igual que hoy | se conserva | no dibujado |
| Join / Miter limit / Cap / Dashes / Dash offset / Stroke behind fill | NO están en la tira: `ShapeLookFields` recibe `compact`, que los oculta (`ShapeLookFields.tsx:34`); sí están en la tarjeta de formas ([[formas]]) | `shape.join`, `miter`, `cap`, `dash`, `dashOffset`, `paintOrder` | Solo con `compact` falso | Hueco a vigilar al reagrupar: la forma seleccionada no los ofrece en la tira | Igual que hoy | se conserva | no dibujado |
| Lock radii (interruptor) | Tira, rama edición (`ContextStrip.tsx:87`) | `ui.shapeLockRadii` | Editando un rect | Con candado, Rx y Ry se mueven juntos | Igual que hoy | se conserva | no dibujado |
| Node (cusp / smooth / symmetric) | Tira, rama edición (`ContextStrip.tsx:88`) | `setPathNodeType` | Editando un path con un nodo elegido | Atajos Shift+C, Shift+S, Shift+Y | Igual que hoy | se conserva | no dibujado |
| Break | Tira, rama edición (`ContextStrip.tsx:89`) | `setBreakNodes` | Path con ≥1 nodo elegido | Shift+B | Igual que hoy | se conserva | no dibujado |
| Join | Tira, rama edición (`ContextStrip.tsx:91`) | `setJoinEnds('merge')` | Path con ≥2 nodos elegidos | Shift+J | Igual que hoy | se conserva | no dibujado |
| Join with segment | Tira, rama edición (`ContextStrip.tsx:92`) | `setJoinEnds('segment')` | ≥2 nodos | Alt+J | Igual que hoy | se conserva | no dibujado |
| Delete segment | Tira, rama edición (`ContextStrip.tsx:93`) | `setDeleteSegments` | ≥2 nodos | — | Igual que hoy | se conserva | no dibujado |
| Make line | Tira, rama edición (`ContextStrip.tsx:94`) | `setSegmentsTo('line')` | ≥2 nodos | Shift+L | Igual que hoy | se conserva | no dibujado |
| Make curve | Tira, rama edición (`ContextStrip.tsx:95`) | `setSegmentsTo('curve')` | ≥2 nodos | Shift+U | Igual que hoy | se conserva | no dibujado |
| Delete node | Tira, rama edición (`ContextStrip.tsx:97`) | `deletePickedNode` | Path con un nodo activo | Delete; Ctrl+Delete une los vecinos en recta | Igual que hoy | se conserva | no dibujado |
| Convert to path | Tira, rama edición (`ContextStrip.tsx:98`) | `convertToPath` (la forma pasa a path) | Forma que no es path, o path con `prim` | Ctrl+Z lo deshace | Igual que hoy | se conserva | no dibujado |
| Done (forma) | Tira, rama edición (`ContextStrip.tsx:99`) | `setShapeEdit(doc.id, null)` | Editando forma | Esc también sale | Igual que hoy | se conserva | no dibujado |
| Fill (muestra de color) | Tira, rama selección (`ContextStrip.tsx:102`) | El relleno de la forma seleccionada (`PaintSwatch`: plano, degradado lineal/radial, tipo y paradas, alfa) | Forma seleccionada sin editar | El mismo `PaintSwatch` que en [[formas]] | Igual que hoy | se conserva | no dibujado |
| Stroke (muestra de color) | Tira, rama selección (`ContextStrip.tsx:103`) | El trazo de la forma (`PaintSwatch`) | Forma seleccionada sin editar | — | Igual que hoy | se conserva | no dibujado |
| Edit shape / Edit nodes (botón) | Tira, rama selección (`ContextStrip.tsx:105`) | `editShape` (entra en edición) | Rect, elipse o path seleccionado | También doble clic en la forma | Igual que hoy | se conserva | no dibujado |
| Rounding · N rectangles (grupo: Rx, Ry, Sharp corners, Convert to paths) | Tira, tras la rama (`ContextStrip.tsx:108`) | Radios de todos los rects elegidos (`MultiRectangleRadii`) | Tool = move y ≥2 rects visibles y desbloqueados | Fieldset propio con 4 controles (`MultiRectangleRadii.tsx:34`) | Igual que hoy | se conserva | no dibujado |
| Follow stroke ruler (interruptor) | Tira (`ContextStrip.tsx:109`) | `ui.strokeRuler.on` (`setRuler`) | Brush o Eraser y hay una guía en este documento — Solo en la tira: «código muerto por lectura (`f11a0dd`; [rastreo 2.6](../rastreo/designer.md)) — requiere decisión y prueba en sandbox» | DUPLICADO con «Snap brush to ruler» ([[regla]]) | Igual que hoy | se conserva | no dibujado |
| Settings… (botón) | Tira (`ContextStrip.tsx:110`) | Solo evento `ogs:designer-panel`: «props» con texto o forma seleccionados, «tool» en el resto | Siempre salvo hand | Abre el panel derecho, no cambia ajustes | Igual que hoy | se conserva | no dibujado |
| Rama compact de ToolSettings | Tira (`ContextStrip.tsx:107` compact}) | Según herramienta ([[toolbox-dock]]) | Ninguna de las tres ramas anteriores — Solo en la tira: para Fill, Gradient, Brush, Eraser, Curve, Lineart y Ruler «código muerto por lectura (`f11a0dd`; [rastreo 2.6](../rastreo/designer.md)) — requiere decisión y prueba en sandbox»; para formas del grupo Edit (Rectangle, Ellipse, Line, Polygon) y Select «requiere prueba en sandbox: con la variante Edit abierta, las teclas R, O, L o M cambian la herramienta dentro de la familia Edit sin cambiar de variante (`ToolDock.tsx:60,64-67`), así que `EditCard` puede seguir montado; sin confirmar en ejecución» | Por lectura, solo podrían verla las formas del grupo Edit y Select (requiere prueba); las demás herramientas no llegan | Igual que hoy | se conserva | no dibujado |

## Cambios del 2026-11-01

- **Barra de modos y menú Más.** Con un path en edición, la tira monta `NodeModeButtons` (`ContextStrip.tsx:82`), `NodeMoreMenu` (`ContextStrip.tsx:88`) y `NodeDoneButton` (`ContextStrip.tsx:90`), definidos en `NodeEditBar.tsx` (`:19`, `:30`, `:53`). Las filas de nodo de la tabla (Node, Break, Join, Join with segment, Delete segment, Make line, Make curve, Delete node) ya están dentro del popover Más (`NodeEditBar.tsx:30`); sus líneas `ContextStrip.tsx:88` a `:97` son del estado anterior.
- **Modos.** Move, Bend, Cut, Erase y Lasso son activos (antes Cut, Erase y Lasso eran «Soon»). El slider del borrador aparece solo en Erase. Detalle y evidencia en [[nodos-modos]] · [nodos-modos.md](nodos-modos.md).
- **Aparición sola.** Con Edit y una selección real, la tira aparece sin la tarjeta (`ToolDock.tsx:151`); ver [[toolbox-dock]].
- **Trazos Lineart.** Con trazos Lineart elegidos (de una sola capa vector visible y desbloqueada), la tira muestra el nombre de la capa, Color, Size y Edit nodes (`StrokeEditBar.tsx`); en edición, la fila Move / Bend / Cut / Erase y Done (`StrokeTools.tsx`). Detalle y pruebas en [[nodos-modos]], sección «Lineart: trazos elegidos».
- **Forma elegida: More.** Junto a Fill y Stroke, el botón «More» (`ShapeMoreMenu.tsx`) abre Outline stroke y Flatten, cada una con un paso de deshacer. Outline stroke convierte el trazo en un relleno (la capa conserva el relleno como forma aparte; ver [[propiedades]]); está disponible solo con trazo centrado (Align = Center) y no con trazo Inside u Outside, que muestra el aviso «set Align to Center first». Flatten convierte la forma en trazado editable, salvo los trazados ya planos. Prueba: `tests/outline-stroke.test.ts`.
- **Grupo booleano.** Con dos o más formas elegidas en una capa vectorial, la tira (variante `strip`) muestra Union, Subtract, Intersect y Exclude (`BooleanOps.tsx`, montado en `ContextStrip.tsx:113`); la tarjeta de Edit lo monta también con más de una forma (`EditCard.tsx:41`). Divide y Shape Builder están en el chevron. Atajos Ctrl+Alt+U, S, I y E; Shift+M activa el Shape Builder. No aparece con varios paths en edición de nodos (`!multiNodeEdit`). Detalle, reglas y límites en [[booleanas]] · [booleanas.md](booleanas.md). Prueba: `tests/shape-boolean.test.ts`; sin prueba visual.

## Enlaces

- [[alinear-editar]] · [alinear-editar.md](alinear-editar.md)
- [[formas]] · [formas.md](formas.md)
- [[texto]] · [texto.md](texto.md)
- [[curva]] · [curva.md](curva.md)
- [[toolbox-dock]] · [toolbox-dock.md](toolbox-dock.md)
- [[capas]] · [capas.md](capas.md)
- [[propiedades]] · [propiedades.md](propiedades.md)
- [[booleanas]] · [booleanas.md](booleanas.md)
- [[README]] · [Índice](README.md)

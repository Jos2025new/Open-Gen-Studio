---
type: inventario
title: Tira contextual (ContextStrip)
description: La tira de la Edit card y de las tarjetas: qué rama muestra según herramienta y selección, y cada control de esas ramas.
tags: [designer, contextstrip, nodos, formas]
updated: 2026-10-28
related: [alinear-editar, formas, texto, curva, toolbox-dock, capas, propiedades]
---
# Tira contextual (ContextStrip)

`ContextStrip` (`ContextStrip.tsx:42`) se monta solo dentro de `EditCard` (`EditCard.tsx:37`); con la herramienta `hand` no pinta nada (`ContextStrip.tsx:59`). Siempre empieza con la etiqueta «Tool → destino» (`ContextStrip.tsx:68`) y termina con «Settings…». En medio muestra UNA rama, por este orden de prioridad: varios paths, texto seleccionado, forma seleccionada (editando o no), o los ajustes de la herramienta en modo `compact`. Las ramas `compact` de pincel y borrador están en [[pincel]] y [[borrador]].

| Control | Dónde está hoy | Qué estado modifica | Cuándo aparece | Notas | Dónde quedaría en la propuesta | Estado | Mockup |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Control | Dónde está hoy | Qué estado modifica | Cuándo aparece | Notas | Igual que hoy | se conserva | no dibujado |
| Etiqueta «Tool → destino» | Tira (`ContextStrip.tsx:68`) | Ninguno; el destino sale de `editTarget` (`ContextStrip.tsx:31`) | Siempre salvo hand | Destino: capa activa, «new layer» o «new text» | Igual que hoy | se conserva | no dibujado |
| Estado «N paths selected» / «Editing nodes · N paths» | Tira, rama varios paths (`ContextStrip.tsx:72`) | Ninguno | Tool = move y ≥2 paths como destino | Texto informativo | Igual que hoy | se conserva | no dibujado |
| Edit nodes (varios paths) | Tira, rama varios paths (`ContextStrip.tsx:76`) | `setShapeEdit` con la lista de paths | Hay ≥2 paths y aún no se editan | — | Igual que hoy | se conserva | no dibujado |
| Done (varios paths) | Tira, rama varios paths (`ContextStrip.tsx:75`) | `setShapeEdit(doc.id, null)` | Editando nodos de varios paths | — | Igual que hoy | se conserva | no dibujado |
| Ayuda de nodos (texto) | Tira, rama varios paths (`ContextStrip.tsx:77`) | Ninguno | Rama varios paths | Los cambios de topología siguen siendo por path | Igual que hoy | se conserva | no dibujado |
| Campos de texto seleccionado | Tira, rama texto (`ContextStrip.tsx:78`) | `patchLayer` sobre la capa de texto (si no está bloqueada) | Tool = text y la capa activa es texto | `TextStyleFields` compact: mismos campos que [[texto]] | Igual que hoy | se conserva | no dibujado |
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
| Follow stroke ruler (interruptor) | Tira (`ContextStrip.tsx:109`) | `ui.strokeRuler.on` (`setRuler`) | Brush o Eraser y hay una guía en este documento | DUPLICADO con «Snap brush to ruler» ([[regla]]) | Igual que hoy | se conserva | no dibujado |
| Settings… (botón) | Tira (`ContextStrip.tsx:110`) | Solo evento `ogs:designer-panel`: «props» con texto o forma seleccionados, «tool» en el resto | Siempre salvo hand | Abre el panel derecho, no cambia ajustes | Igual que hoy | se conserva | no dibujado |
| Rama compact de ToolSettings | Tira (`ContextStrip.tsx:107` compact}) | Según herramienta ([[toolbox-dock]]) | Ninguna de las tres ramas anteriores | Es lo que ven Brush, Eraser, Fill, etc. dentro de la Edit card | Igual que hoy | se conserva | no dibujado |

## Enlaces

- [[alinear-editar]] · [alinear-editar.md](alinear-editar.md)
- [[formas]] · [formas.md](formas.md)
- [[texto]] · [texto.md](texto.md)
- [[curva]] · [curva.md](curva.md)
- [[toolbox-dock]] · [toolbox-dock.md](toolbox-dock.md)
- [[capas]] · [capas.md](capas.md)
- [[propiedades]] · [propiedades.md](propiedades.md)
- [[README]] · [Índice](README.md)

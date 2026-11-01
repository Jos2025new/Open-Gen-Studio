---
type: inventario
title: Edición de nodos: modos Move, Bend, Cut, Erase y Lasso
description: La barra de modos de la edición de nodos de un path (con palabras), el menú Más y Done; qué hace cada modo, qué estado toca y dónde está en el código. Cambio del 2026-11-01.
tags: [designer, nodos, path, cortar, borrar, lazo, bend]
updated: 2026-11-01
related: [tira-contextual, toolbox-dock, lienzo-gestos, formas, atajos, booleanas]
---
# Edición de nodos: modos Move, Bend, Cut, Erase y Lasso

Al editar los nodos de un path (Edit con un path elegido, `ShapeKnots.tsx:56`), la tira contextual muestra la barra de modos (`ContextStrip.tsx:82`), el menú Más (`ContextStrip.tsx:88`) y Done (`ContextStrip.tsx:90`). Desde 2026-11-01 los cinco modos están activos, con su palabra visible. Antes, Cut, Erase y Lasso eran marcadores «Soon».

Fuente de verdad: el modo vive en `useNodeEditMode` (`nodeEditMode.ts:13`). No se guarda: vuelve a Move cada vez que empieza, termina o cambia la edición (`objectSelection.ts:34`, `nodeEditMode.ts:17`).

## Controles

| Control | Dónde está hoy | Qué estado modifica | Cuándo aparece | Notas |
| --- | --- | --- | --- | --- |
| Move (Hand) | Barra de modos (`NodeEditBar.tsx:19`), etiqueta en `NodeEditBar.tsx:12` | `setNodeEditMode('move')` (`nodeEditMode.ts:14`) | Path en edición | Modo por defecto: arrastrar nodos y manijas; arrastrar un segmento lo curva; doble clic añade un nodo |
| Bend (Spline) | Barra de modos (`NodeEditBar.tsx:19`), etiqueta en `NodeEditBar.tsx:13` | `setNodeEditMode('bend')`; al arrastrar un segmento, `bendSegment` (`PathNodes.tsx:97`); al arrastrar un nodo, `roundNode` (`bendNode.ts:14`); al hacer clic en un nodo, `sharpenNode` (`bendNode.ts:24`) | Path en edición | Arrastrar un segmento hace que la curva pase por el puntero; el segmento bajo el puntero se resalta (`bend-hl`). Arrastrar un nodo saca sus manijas: dos, simétricas (tipo symmetric); una sola, sale en el sentido del arrastre y el nodo sigue en esquina. Clic en un nodo con manijas lo vuelve esquina, en un paso de deshacer; si ya es esquina, no hace nada. Las manijas no se mueven por sí solas (`PathNodes.tsx:104`) |
| Cut (Scissors) | Barra de modos (`NodeEditBar.tsx:19`), etiqueta en `NodeEditBar.tsx:14` | Forma rellena y cerrada, arrastre: `knifeFilled` (`areaTools.ts:22`) → `knifeArea` (`pathBoolean.ts:287`). Contorno o trazo abierto: `cutShape` (`PathNodeTools.tsx:18`) → `replaceWithPieces` (`pathPieces.ts:16`) | Path en edición; la capa de overlay se monta en `PathNodes.tsx:208` | Clic a menos de 12 px de pantalla del contorno corta ahí (tijeras, `PathNodeTools.tsx:14`); arrastrar una línea corta en cada cruce (en relleno, la línea divide el área). Marca de vista previa bajo el puntero (`PathNodeTools.tsx:50`). Si no hay corte, no cambia nada y no deja paso de deshacer |
| Erase (Eraser) | Barra de modos (`NodeEditBar.tsx:19`), etiqueta en `NodeEditBar.tsx:15` | Forma rellena y cerrada: `eraseFilled` (`areaTools.ts:28`) → `eraseArea` (`pathBoolean.ts:262`), al soltar. Trazo abierto o sin relleno: `EraseSession` (`PathNodeTools.tsx:28`) → `erasePath` (`vectorErase.ts:35`) | Path en edición | En forma rellena, arrastrar pinta una banda redonda del radio real en vivo; el área se borra al soltar, en un paso de deshacer. En trazo abierto, arrastrar borra un círculo a lo largo del trazo. El cursor es un anillo de radio real |
| Tamaño del borrador (slider «Eraser», px) | Debajo de la barra, solo con Erase (`NodeEditBar.tsx:19`) | `setEraseRadius` (`nodeEditMode.ts:20`): `eraseRadius`, 1 a 200, por defecto 10 | Modo Erase | Radio en píxeles de pantalla; en unidades de página se divide entre el zoom (`PathNodeTools.tsx:50`) |
| Lasso (Lasso) | Barra de modos (`NodeEditBar.tsx:19`), etiqueta en `NodeEditBar.tsx:16` | `setShapeEdit` con `nodes` (`PathNodeTools.tsx:50`) | Path en edición | Lazo libre; selecciona los nodos dentro (`nodesInLasso`, `lassoNodes.ts:14`). Shift añade a la selección |
| Más (More) | Botón en `NodeEditBar.tsx:30`, popover de 240 px | Abre el menú; cada entrada usa las operaciones de abajo | Path en edición | Sin nodos elegidos muestra «Pick nodes to see their operations.» |
| Node: cusp / smooth / symmetric | Menú Más (`NodeEditBar.tsx:30`) | `setPathNodeType` | Un nodo elegido | Atajos Shift+C, Shift+S, Shift+Y (ver [[tira-contextual]]) |
| Break | Menú Más (`NodeEditBar.tsx:30`) | `setBreakNodes` | ≥1 nodo elegido | Shift+B |
| Join / Join with segment | Menú Más (`NodeEditBar.tsx:30`) | `setJoinEnds` (`merge` o `segment`) | ≥2 nodos elegidos | Shift+J; Alt+J |
| Delete segment | Menú Más (`NodeEditBar.tsx:30`) | `setDeleteSegments` | ≥2 nodos elegidos | — |
| Make line / Make curve | Menú Más (`NodeEditBar.tsx:30`) | `setSegmentsTo` | ≥2 nodos elegidos | Shift+L; Shift+U |
| Delete node | Menú Más (`NodeEditBar.tsx:30`) | `deletePickedNode` | Un nodo elegido | Delete; Ctrl+Delete une los vecinos en recta |
| Done | `NodeDoneButton` (`NodeEditBar.tsx:53`) | `setShapeEdit(docId, null)` | Path en edición | Esc también sale. Vuelve a Move |
| Pista de la barra de estado | `shapeEditHint` (`ShapeKnots.tsx:120`, líneas 124 a 129) | Ninguno | Según el modo | Un texto por modo: Bend, Cut, Erase, Lasso y Move (el de Move dice las teclas de nodos) |

## Formas con relleno: Cut y Erase por área

Una forma cerrada con relleno se trata por su área, como el cuchillo y el borrador de Inkscape o Illustrator (`isFilledArea`, `pathPieces.ts`). Los trazos abiertos y sin relleno siguen con las herramientas de borde de la tabla.

- **Cut arrastrando (cuchillo):** la línea divide el área en piezas cerradas. Cada pieza es una forma con relleno que se puede volver a cortar o borrar. Desde `7cf8a0c7`, los puntos del borde se pegan a la línea del cuchillo y cada extremo de corte queda en un solo nodo, sin costura.
- **Erase:** el área bajo el pincel desaparece al soltar; el resultado puede ser varias piezas. Un gesto, un paso de deshacer.
- **Un intento que no divide ni borra nada** no cambia la forma y no deja paso de deshacer (función `apply` de `areaTools.ts`).
- **Mientras se editan los nodos**, las piezas son subtrazados de la misma forma, así que se puede seguir cortando. **Al salir** (Done, Esc o cambio de herramienta) se separan por componente: cada contorno exterior con sus agujeros. Las piezas que no se tocaron conservan sus curvas; separar no repite la operación booleana.

## Algoritmos

- **Bend** (`bendSegment.ts:10`, `:20`): la curva pasa por el puntero en el parámetro `t`, con `t` acotado a 0,05–0,95. Un segmento recto pasa a curva; los demás no cambian.
- **Bend por nodo** (`bendNode.ts`): `roundNode` (`:14`) saca manijas simétricas o una sola; `sharpenNode` (`:24`) recoge las manijas que sobresalen.
- **Área** (`pathBoolean.ts`): `eraseArea` (`:262`) y `knifeArea` (`:287`) operan con Clipper2 sobre un aplanado de la forma; el resultado vuelve a curvas con `fitSubpaths` (`curveFit.ts:232`, Schneider 1990). Ver [ADR 0026](../decisions/0026-motor-booleano.md).
- **Cut** (`pathCut.ts`): `cutPathAt` (`:107`) corta en un punto; `cutPathAcross` (`:135`) corta donde una línea cruza el trazo; `nearestOnPath` (`:143`) busca el punto más cercano. Trabaja sobre contornos (`contoursOf`, `:47`) con `carve` (`:73`) y `assemble` (`:86`). Un contorno cerrado con corte se abre en el corte.
- **Erase** (`vectorErase.ts`): `insideRanges` (`:9`) halla los rangos de cada arista dentro del círculo; `erasePath` (`:35`) devuelve lo que queda fuera.
- **Lasso** (`lassoNodes.ts`): `pointInPolygon` (`:4`), par/impar; `nodesInLasso` (`:14`) toma los nodos (extremos de segmento) dentro del lazo.
- **Piezas** (`pathPieces.ts`): `usablePieces` (`:8`) descarta piezas de un solo punto. `replaceWithPieces` (`:16`) sustituye la forma por una por pieza. Cada pieza copia los atributos de la original (trazo, relleno); la primera conserva el id, y los tipos de nodo se borran. Una sola entrada de deshacer: `record: !this.moved` en Erase (`PathNodeTools.tsx:28`).

Procedencia: `bendSegment.ts`, `pathCut.ts` y `vectorErase.ts` siguen las operaciones de figcraft (MIT OR Apache-2.0): se portaron a este modelo de path, no se copiaron. `lassoNodes.ts` usa un algoritmo estándar de punto en polígono. El corte y el borrado por área usan Clipper2 y el ajuste de Schneider; la elección del motor está en [ADR 0026](../decisions/0026-motor-booleano.md).

## Estilos

- `path-tools.css` (12 líneas): la capa de Cut, Erase y Lasso va encima de los nodos (`z-index: 5`), con el cursor de cada modo, la marca de corte, el anillo y el halo de borrado, y el lazo.
- `designer-connected.css:321` a `:328`: la barra de modos (`.node-modes`, `.node-mode`, `.node-more`, `.node-done`).

## Evidencia

- Código: commits `59e77856` (barra con palabras, Bend, menú Más, Done), `025cacba` (Cut, Erase, Lasso y radio del borrador), ambos el 2026-11-01. Después, `cf7d47c6` y `de441d6e` (Bend visible, redondeo y esquina por nodo, Lineart: marca de corte, corte arrastrado y anillo de Bend), `f26a5ecd`, `015eb834` y `7cf8a0c7` (corte y borrado por área en formas con relleno; el último, puntos del cuchillo pegados y soldados).
- Tests: `tests/bend-cut-tools.test.ts` (Bend por nodo y gestos de Lineart) y `tests/path-area-tools.test.ts` (corte y borrado por área; los trazos abiertos siguen con sus pruebas de borde).
- Tests unitarios: `tests/node-edit-mode.test.ts` (modos, reset, pista, math de Bend), `tests/path-cut-erase-lasso.test.ts` (cortes, borrado, lazo) y `tests/path-node-tools.test.ts` (cinco modos, radio 10 px, un solo deshacer al borrar, lazo).
- E2E: `tests-e2e/path-nodes.spec.ts` abre el menú Más para las operaciones de nodos. No se ha ejecutado contra el sandbox en este cambio.
- Prueba visual del gesto (puntero, vista previa de corte, cursor de Erase): **no hecha**. Los tests no cubren el gesto real del puntero.

## Lineart: trazos elegidos

Con Edit y uno o más trazos Lineart elegidos (`pickedStrokes`, `strokeEdit.ts`: todos son trazos de una capa vector visible y desbloqueada), la tira muestra el nombre de la capa, Color (con alfa), Size y Edit nodes (`StrokeEditBar.tsx`). Size se muestra y se fija como se ve en la página: un trazo escalado por su matriz conserva esa escala. Edit nodes (`editStrokes`) deja los trazos elegidos y entra en edición sin las manijas de transformación. Un trazo elegido junto a una forma, o en una capa bloqueada u oculta, no cuenta: la edición de trazos se cierra sola.

La fila de edición tiene Move, Bend, Cut, Erase y Done (`STROKE_MODES`, `StrokeTools.tsx`). Lasso y Más son solo para paths.

| Control | Dónde está hoy | Qué estado modifica | Notas |
| --- | --- | --- | --- |
| Move | Fila de edición (`StrokeTools.tsx`) | Arrastrar un punto de cada trazo (los vecinos lo siguen, como Alt+arrastre) | Solo manijas de los puntos |
| Bend | Fila de edición | Arrastrar cerca de un trazo (`bendStroke`); la influencia viene de `lineartInfluence` (defecto 80) | Vista previa: anillo de influencia en el puntero y el punto que se va a mover. Un solo paso de deshacer por gesto |
| Cut | Fila de edición | Clic: corta el trazo elegido más cercano dentro del alcance (mitad del ancho más 12 px de pantalla); arrastrar una línea corta los trazos elegidos en cada cruce (`cutPickedStrokesAcross`). Vista previa: marca perpendicular al trazo en el punto más cercano | `cutPickedStrokes`; si falla, no cambia nada (sin paso de deshacer). Un arrastre corto que no cruza nada corta donde empezó, como un clic. Un corte en un extremo que dejaría una pieza de menos de 2 puntos se rechaza |
| Erase | Fila de edición; radio = slider «Eraser» de Erase | Arrastrar un círculo sobre el trazo (`erasePickedStrokes`) | Un gesto = un paso de deshacer (el primer cambio lo registra y el resto lo continúan); un gesto que no toca nada no registra nada |
| Done | Fila de edición (`NodeDoneButton`) | Sale de la edición; los trazos siguen elegidos | Esc hace lo mismo (fase de captura: no quita también la elección) |

Reglas de las piezas (`strokeCut.ts`):

- Cortar o borrar deja piezas con el mismo estilo; **las piezas siguen elegidas** después de cada corte o borrado, así que se puede seguir cortando sin volver a elegir.
- El afilado (taper) se conserva solo en los extremos que la pieza comparte con el trazo original; un extremo nuevo (corte o borrado) es romo.
- Un trazo que se corta o se borra cambia de id: la elección se traslada a las piezas.

Prueba: `tests/stroke-edit-strip.test.ts` (barra y fila), `tests/stroke-cut-erase.test.ts` (corte, borrado, fallos sin cambio, deshacer y extremos). Sin prueba visual: el usuario prueba el gesto en el sandbox. Límites conocidos: [pendientes](../pendientes-designer.md), D32 y D33.

## Enlaces

- [[tira-contextual]] · [tira-contextual.md](tira-contextual.md)
- [[toolbox-dock]] · [toolbox-dock.md](toolbox-dock.md)
- [[lienzo-gestos]] · [lienzo-gestos.md](lienzo-gestos.md)
- [[formas]] · [formas.md](formas.md)
- [[atajos]] · [atajos.md](atajos.md)
- [Plan de edición de formas](../plan-edicion-formas.md)
- [Índice de controles](README.md)

## Ajuste tras la prueba del 2026-11-01

La prueba en el sandbox encontró la barra apilada, el modo activo invisible, Bend sin efecto en una elipse y Cut confuso. Cambios:

- **Una sola tira sobre la barra.** Con Edit y una selección, la tira ocupa el sitio de la fila de variantes (pulsar la familia Edit vuelve a mostrar las variantes). Sin selección de nodos lleva solo acciones del objeto: nombre, Fill, Stroke, Edit nodes y alinear con varios; los ajustes de la herramienta (Auto-select, Influence, Settings…) siguen en la tarjeta de Edit. Editando nodos: nombre | Move Bend Cut Erase Lasso | More | Done, en una fila que se desplaza en horizontal; W, H y Blur quedan en Properties (`ContextStrip.tsx`, prop `variant`; `ToolDock.tsx`; `tool-dock.css`).
- **Modo activo y Done visibles:** fondo `--accent` con texto `--accent-ink`; Done es la acción principal al final de la fila (`NodeEditBar.tsx`).
- **Formas primitivas:** elegir Bend, Cut, Erase o Lasso en una elipse, rectángulo o polígono la convierte antes en trazado, en un solo paso de deshacer (`chooseNodeMode`).
- **Cut sigue con el mismo objetivo:** mientras se editan nodos, las piezas de un corte o borrado son subtrazados de la misma forma, así que se puede seguir cortando sin Done. Al salir (Done, Esc o cambio de herramienta) se separan en formas con los atributos originales, todas seleccionadas, en un paso de deshacer; un trazado compuesto que no se cortó, o un corte deshecho antes de salir, no se separa (`pathPieces.ts`, `split.before` en `nodeEditMode.ts`).
- Evidencia: `tests/node-edit-strip.test.ts`, `tests/path-node-tools.test.ts`; `tests-e2e/path-nodes.spec.ts` busca «Done» en vez de «Editing nodes» (no ejecutado). Sin prueba visual tras el ajuste.
- Queda: el doble clic en un nudo ya no enfoca Rx/Ry/Blur en la tira (están en Properties).

---
type: inventario
title: Gestos y modificadores del lienzo (Stage)
description: Qué hace cada herramienta al pulsar o arrastrar sobre el lienzo, con sus modificadores, avisos, cursores y asas.
tags: [designer, stage, gestos, modificadores]
updated: 2026-10-28
related: [atajos, alinear-editar, navegacion-zoom, guias, tira-contextual]
---
# Gestos y modificadores del lienzo (Stage)

Todo lo de aquí vive en `Stage` (`Stage.tsx:588`) y no tiene botón. La lista sigue el orden del código; las filas marcadas «sin confirmar» se tomaron del texto de ayuda (`TOOL_HELP`, `ToolHelp.tsx:12`) y no se leyó la rama completa del puntero.

| Control | Dónde está hoy | Qué estado modifica | Cuándo aparece | Notas | Dónde quedaría en la propuesta | Estado | Mockup |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Pan: herramienta Pan, Espacio o botón central | Lienzo (`Stage.tsx:594`) | Vista del Stage | Cualquier herramienta con Espacio o botón 1 | Detalle en [[navegacion-zoom]] | Igual que hoy | se conserva | no dibujado |
| Gradient: arrastrar una línea | Lienzo (`Stage.tsx:603`) | Capa nueva con el degradado; dentro de la selección si existe | Tool = gradient | Shift fija la línea a pasos de 45° (`Stage.tsx:1090`) | Igual que hoy | se conserva | no dibujado |
| Select pixels: arrastrar rectángulo, lazo o clic de varita | Lienzo (`Stage.tsx:609`) | Selección de píxeles (`setSelection`) | Tool = select | Shift añade, Alt resta; la varita tiene su modo propio (New / Add / Subtract) | Igual que hoy | se conserva | no dibujado |
| Eyedropper: clic | Lienzo (`Stage.tsx:626`) | `ui.brush.color` | Tool = eyedropper, o Alt+clic con Brush o Fill | Ver [[cuentagotas]] | Igual que hoy | se conserva | no dibujado |
| Fill: clic | Lienzo (`Stage.tsx:634`) | Capa nueva con el relleno | Tool = fill | Ver [[relleno]] | Igual que hoy | se conserva | no dibujado |
| Edit: arrastrar una guía | Lienzo (`Stage.tsx:641`) | `doc.guides`; soltarla sobre su regla la quita | Tool = move, guías visibles y no bloqueadas | Ver [[guias]] | Igual que hoy | se conserva | no dibujado |
| Edit: clic elige, Shift/Ctrl-clic alterna | Lienzo (`Stage.tsx:685`) | Selección de objetos o capas | Tool = move | Ctrl actúa como modificador de selección (como Shift) | Igual que hoy | se conserva | no dibujado |
| Edit: arrastrar en vacío (marquesina) | Lienzo (`Stage.tsx:21`) | Selección de objetos o capas | Tool = move | Shift añade, Alt quita; Auto-select cambia qué capa se toma ([[alinear-editar]]) | Igual que hoy | se conserva | no dibujado |
| Edit: arrastrar lo elegido | Lienzo (`Stage.tsx:1029`) | Posición de los objetos o capas | Tool = move | Imán activo salvo que se mantenga Alt; Ctrl o Meta pulsado durante el arrastre apaga el imán y muestra las distancias a los vecinos más cercanos (`Stage.tsx:1028-1036`, `neighbourGaps.ts`, `moveMode`; [rastreo 5.4](../rastreo/designer.md)) | Igual que hoy | se conserva | no dibujado |
| Edit: arrastrar dentro de una selección de píxeles | Lienzo (`Stage.tsx:50`) | Corta la selección a una capa movible | Tool = move y hay selección de píxeles | Aviso «Drag inside the pixel selection…» (`Stage.tsx:1349`) | Igual que hoy | se conserva | no dibujado |
| Edit: asas cuadradas (escalar) | Lienzo (`Stage.tsx:920`) | Escala la caja de lo elegido | Hay selección y el modo de asas es escala | Ctrl o Shift mantienen la proporción | Igual que hoy | se conserva | no dibujado |
| Edit: asas redondas (rotar y sesgar) | Lienzo (misma función) | Rota por una esquina, sesga por un lado | Segundo clic sobre la selección cambia a modo rotar | Ctrl o Shift: pasos de 15°; el centro se puede mover (pivote) | Igual que hoy | se conserva | no dibujado |
| Edit: doble clic | Lienzo (`Stage.tsx:1261`) | Edita los puntos de un trazo Lineart, entra en edición de forma (rect, elipse, path) o edita un texto | Tool = move | En modo Layer solo mueve capas enteras | Igual que hoy | se conserva | no dibujado |
| Edit: asas redondas de forma (esquinas y blur) | Lienzo (`Stage.tsx:1320`) | `shape.rx/ry`, `shape.blur` | Tool = move con una forma en edición | Doble clic en una asa pide su valor; Ctrl arrastra ambos radios | Igual que hoy | se conserva | no dibujado |
| Edit: asas del degradado de una forma | Lienzo (`ShapeHandles.tsx:62`) | `fillGradient` / `strokeGradient` de la forma | Tool = move, Objects, forma con degradado | Etiquetadas «Gradient handles»; tooltips por asa | Igual que hoy | se conserva | no dibujado |
| Edit: nodos de un path | Lienzo (`PathNodes.tsx:22`) | Nodos y asas de curva del path | Path en edición | Clic elige; Shift alterna; arrastrar en vacío selecciona; atajos en [[atajos]] | Igual que hoy | se conserva | no dibujado |
| Brush / Eraser: arrastrar | Lienzo (`Stage.tsx:801`) | Píxeles de la capa raster activa | Tool = brush o eraser | Si no hay capa raster: aviso «Select a raster layer to erase.» (Eraser) | Igual que hoy | se conserva | no dibujado |
| Lineart: arrastrar / Alt + arrastrar | Lienzo (`Stage.tsx:833`) | Traza un trazo editable; con Alt curva uno existente | Tool = lineart | En modo Edit mueve puntos; aviso «Select a stroke · Drag its points…» (`Stage.tsx:1349`) | Igual que hoy | se conserva | no dibujado |
| Formas (Rectangle … Arrow): arrastrar | Lienzo (`Stage.tsx:877`) | Forma nueva en capa vectorial | Tool de forma | Shift: cuadrado/círculo, o 45° en Line, Curve y Arrow (`Stage.tsx:1110`) | Igual que hoy | se conserva | no dibujado |
| Text: clic en la página / clic en un texto | Lienzo (`Stage.tsx:882`) | Crea texto o edita el existente (`TextEditor`) | Tool = text | Ver [[texto]] | Igual que hoy | se conserva | no dibujado |
| Ruler: arrastrar | Lienzo ([[regla]]) | `ui.strokeRuler` | Tool = ruler | Ver [[regla]] | Igual que hoy | se conserva | no dibujado |
| Arrastrar desde una regla | Reglas (`Stage.tsx:1330`) | Nueva guía | Reglas visibles | Ver [[guias]] | Igual que hoy | se conserva | no dibujado |
| Cursor del pincel (anillo con el tamaño) | Lienzo (`Stage.tsx:1318`) | Ninguno | Brush, Eraser y Lineart | Indicador de tamaño real | Igual que hoy | se conserva | no dibujado |
| Líneas de snap y medidas | Lienzo (`Stage.tsx:1322`) | Ninguno | Arrastrando con imán | Muestra alineaciones y medidas | Igual que hoy | se conserva | no dibujado |
| Brillo del agente (AgentGlow) | Lienzo (`Stage.tsx:1323`) | Ninguno | Cuando el agente toca el documento (sin confirmar el criterio exacto) | Solo informa | Igual que hoy | se conserva | no dibujado |
| Cursor según el gesto | Lienzo (`Stage.tsx:1284`) | Ninguno | Siempre | Cambia al pasar por una asa o guía (hover-only) | Igual que hoy | se conserva | no dibujado |
| Aviso «Hold … / Drag selects…» (StageHint) | Lienzo (`StageEditHint.tsx:20`) | Guarda en `localStorage` los avisos cerrados (`ogs.designer.hintsClosed`) | Edit y Lineart Edit | Se cierra con una X («Close this tip») | Igual que hoy | se conserva | no dibujado |
| Pista de herramienta bloqueada | Lienzo (`Stage.tsx:1353`) | Ninguno | Brush o Eraser sin capa válida | Texto del motivo (`toolBlockReason`) | Igual que hoy | se conserva | no dibujado |
| Soltar un activo de la galería | Lienzo (`Stage.tsx:1294`) | `placeAsset` | Sobre el lienzo | Ver [[documentos]] | Igual que hoy | se conserva | no dibujado |

## Enlaces

- [[atajos]] · [atajos.md](atajos.md)
- [[alinear-editar]] · [alinear-editar.md](alinear-editar.md)
- [[navegacion-zoom]] · [navegacion-zoom.md](navegacion-zoom.md)
- [[guias]] · [guias.md](guias.md)
- [[tira-contextual]] · [tira-contextual.md](tira-contextual.md)
- [[README]] · [Índice](README.md)

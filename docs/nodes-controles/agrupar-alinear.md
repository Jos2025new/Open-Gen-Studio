---
type: inventario
title: Agrupar, alinear, portapapeles de nodos y colocación automática
description: Barra Operations de selección múltiple (agrupar, alinear, copiar, cortar, borrar), marcos de grupo, desacoplar resultados, portapapeles interno y Auto layout.
tags: [nodes, grupos, alinear, portapapeles, layout]
updated: 2026-10-28
related: [lienzo, tarjeta-nodo, atajos-gestos, deshacer-bloqueos]
---
# Agrupar, alinear, portapapeles de nodos y colocación automática

La barra **Operations** (`Operations.tsx:27`) se monta dentro de `ReactFlow` solo en el lienzo completo (`NodeWorkspace.tsx:470`) y solo se dibuja con 2 o más nodos seleccionados (`Operations.tsx:31`); es una `NodeToolbar` sobre la selección. Empieza cerrada («Operations · N») y se abre con un clic.

| Control | Dónde aparece | Cuándo aparece | De qué depende | Qué modifica | Influye en | Notas |
| --- | --- | --- | --- | --- | --- | --- |
| Operations · N | `Operations.tsx:38` | 2+ nodos seleccionados, lienzo completo | `ids` | Abre la barra (estado local) | Siguientes filas | Al cambiar la selección sigue abierta si el componente no se desmonta (sin confirmar) |
| Group | `Operations.tsx:48` | Barra abierta, selección que no es un grupo completo | `wholeGroup` | `groupNodes`: crea «Group n» con esos nodos; salen de su grupo anterior (`arrange.ts:74`) | Marco visible detrás | Atajo Ctrl/⌘+G (con 2+ nodos); no agrupa nodos de un conjunto desacoplado (toast «Reattach these outputs before changing their group.») |
| Ungroup / Reattach outputs | `Operations.tsx:44` | Barra abierta, la selección es exactamente un grupo | `wholeGroup` | `ungroup`: quita el grupo (si es de resultados desacoplados, reacopla) (`arrange.ts:85`) | Marco | Atajo Ctrl/⌘+Mayús+G |
| Align › (8 modos) | `Operations.tsx:53` | Barra abierta; el submenú se abre al pasar el puntero o con clic | `to` | Cada modo llama a `alignNodes` (`arrange.ts:60`) | Posición de los nodos | Modos: Left edges, Centers, Right edges, Top edges, Middles, Bottom edges, Distribute horizontally, Distribute vertically (`Operations.tsx:12`). Las dos distribuciones se desactivan con menos de 3 nodos (`Operations.tsx:58`) |
| Relative to: Selection / First selected | `Operations.tsx:66` | Submenú Align | `to` (estado local, no persiste) | Qué referencia usa la alineación | Siguiente alineación | `aria-pressed` marca el activo |
| Copy | `Operations.tsx:74` | Barra abierta | `ids` | `copyNodes`: guarda en el portapapeles interno los nodos y los enlaces que **entran** a ellos (`arrange.ts:132`); toast «Copied N nodes · Ctrl+V to paste» | Pegar | Portapapeles de módulo: se pierde al recargar y no usa el del sistema |
| Cut | `Operations.tsx:77` | Barra abierta | `ids` | `cutNodes`: copia y borra (`arrange.ts:140`) | Grafo | El borrado no pide confirmación; sí deja aviso con Undo en el hilo |
| Delete | `Operations.tsx:80` | Barra abierta | `ids` | `deleteNodes` | Grafo | Sin confirmación (a diferencia del cubo de un nodo) |
| Close | `Operations.tsx:84` | Barra abierta | — | Cierra la barra | — | |
| Marco de grupo | `Operations.tsx:103` | Grupo con 2+ nodos (o un conjunto desacoplado con 1) | `graph.groups`, tamaños medidos | Se dibuja detrás de sus nodos (`groupBounds`, `arrange.ts:101`); arrastrarlo mueve todo; seleccionarlo selecciona sus nodos; Supr lo deshace | Nodos | Un nodo pertenece a un solo grupo. Al borrar nodos, un grupo con menos de 2 desaparece (`flow/actions.ts:88`) |
| Título del grupo (doble clic) | `Operations.tsx:123` | Marco | `group.title` | `renameGroup`: recorta a 80 caracteres y no admite vacío (`arrange.ts:92`) | Etiqueta | Intro confirma, Esc cancela; consejo al pasar el puntero «Drag the group to move everything in it · double-click to rename» |
| Punto «Background color» y paleta | `Operations.tsx:128` | Marco | `group.color` | `setGroupColor`: 7 casillas (ninguno, #d8ff3a, #5ec8ff, #b892ff, #ff7ab6, #ffc25e, #86e3a5, `Operations.tsx:94`) | Color del marco | Opcional |
| Reattach outputs (botón en el marco) | `Operations.tsx:127` | Marco de resultados desacoplados | — | `ungroup` → `reattachOutputs` (`arrange.ts:230`) | Grafo | Restaura el nodo original, sus enlaces y su grupo; descarta con aviso las conexiones nuevas incompatibles (`arrange.ts:271`) |
| Detach outputs | `nodes.tsx:302` | Barra del nodo con 2+ resultados | | `detachOutputs`: una tarjeta por resultado, entradas copiadas | Grafo | La definición completa está en [tarjeta-nodo](tarjeta-nodo.md) y en `docs/features/nodes.md` |
| Ctrl/⌘+C, Ctrl/⌘+X | `NodeWorkspace.tsx:371` | Foco dentro del lienzo, nodos seleccionados, sin texto seleccionado, fuera de campos de texto | `selected` | Copia o corta; copiar da toast «Copied N node(s)» | Portapapeles | Detalle en [atajos-gestos](atajos-gestos.md) |
| Ctrl/⌘+V | `NodeWorkspace.tsx:353` | Hay nodos copiados y el portapapeles del sistema no trae imágenes | — | `pasteNodes`: ids nuevos, desplazados 60 px, sin resultado ni sketch; enlaces entre pegados y desde nodos aún presentes (`arrange.ts:157`) | Grafo | |
| Ctrl/⌘+G, Ctrl/⌘+Mayús+G | `NodeWorkspace.tsx:373` | Igual | | Agrupar (2+) / desagrupar | | |
| Alinear con las dimensiones medidas | `NodeWorkspace.tsx:470` | Barra Operations | Tamaños medidos por ReactFlow | Usa 260 px de ancho y 120 de alto si aún no se midió (`NodeWorkspace.tsx:150`) | | Solo afecta a la caja de selección |

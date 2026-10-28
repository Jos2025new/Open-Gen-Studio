---
type: inventario
title: Atajos de teclado del Designer
description: Todas las teclas que el Designer escucha, con dónde se definen y cuáles aparecen en Settings > Shortcuts.
tags: [designer, atajos, teclado]
updated: 2026-10-28
related: [navegacion-zoom, tira-contextual, capas, lienzo-gestos, toolbox-dock]
---
# Atajos de teclado del Designer

El manejador es `designerKey` (`designerKeys.ts:31`), registrado en la ventana por `DesignerWorkspace` (`DesignerWorkspace.tsx:64`); ignora las teclas dentro de campos de texto y cuando hay un popover o lightbox abierto (`designerKeys.ts:33`). Las teclas de herramienta salen de `DESIGN_TOOL_KEYS` (`shortcuts.ts:4`). La lista de Settings → Shortcuts es `shortcutGroups` (`shortcuts.ts:49`); la columna Notas dice si falta ahí.

| Control | Dónde está hoy | Qué estado modifica | Cuándo aparece | Notas | Dónde quedaría en la propuesta | Estado | Mockup |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Control | Dónde está hoy | Qué estado modifica | Cuándo aparece | Notas | Igual que hoy | se conserva | no dibujado |
| V: Edit | Tecla (`shortcuts.ts:4`) | `ui.tool = move` | Si `toolBlockReason` no la bloquea | Aparece en Settings → Shortcuts | Igual que hoy | se conserva | no dibujado |
| H: Pan | Tecla (`shortcuts.ts:4`) | `ui.tool = hand` | Igual | Listada | Igual que hoy | se conserva | no dibujado |
| M: Select pixels | Tecla (`shortcuts.ts:4`) | `ui.tool = select` | Igual | Listada | Igual que hoy | se conserva | no dibujado |
| I: Eyedropper | Tecla (`shortcuts.ts:4`) | `ui.tool = eyedropper` | Igual | Listada | Igual que hoy | se conserva | no dibujado |
| B: Brush | Tecla (`shortcuts.ts:4`) | `ui.tool = brush` | Igual | Listada | Igual que hoy | se conserva | no dibujado |
| G: Fill | Tecla (`shortcuts.ts:4`) | `ui.tool = fill` | Igual | Listada | Igual que hoy | se conserva | no dibujado |
| U: Gradient | Tecla (`shortcuts.ts:4`) | `ui.tool = gradient` | Igual | Listada | Igual que hoy | se conserva | no dibujado |
| P: Lineart | Tecla (`shortcuts.ts:4`) | `ui.tool = lineart` | Igual | Listada | Igual que hoy | se conserva | no dibujado |
| E: Eraser | Tecla (`shortcuts.ts:4`) | `ui.tool = eraser` | Igual | Listada | Igual que hoy | se conserva | no dibujado |
| R: Rectangle | Tecla (`shortcuts.ts:4`) | `ui.tool = rect` | Igual | Listada; sin tecla propia: Polygon, Star, Sector, Arc, Chord, Curve, Arrow | Igual que hoy | se conserva | no dibujado |
| O: Ellipse | Tecla (`shortcuts.ts:4`) | `ui.tool = ellipse` | Igual | Listada | Igual que hoy | se conserva | no dibujado |
| L: Line | Tecla (`shortcuts.ts:4`) | `ui.tool = line` | Igual | Listada | Igual que hoy | se conserva | no dibujado |
| T: Text | Tecla (`shortcuts.ts:4`) | `ui.tool = text` | Igual | Listada | Igual que hoy | se conserva | no dibujado |
| K: Ruler | Tecla (`shortcuts.ts:4`) | `ui.tool = ruler` | Igual | Listada | Igual que hoy | se conserva | no dibujado |
| Ctrl+S | Tecla (`designerKeys.ts:32`) | `saveNow` | Siempre, incluso dentro de campos | Listada («Mod + S») | Igual que hoy | se conserva | no dibujado |
| Ctrl+Z | Tecla (`designerKeys.ts:38`) | `undoDoc` | Hay documento | Listada | Igual que hoy | se conserva | no dibujado |
| Ctrl+Shift+Z / Ctrl+Y | Tecla (misma rama) | `redoDoc` | Hay documento | Ctrl+Y no aparece en la lista del Designer (sí en la de Nodes) | Igual que hoy | se conserva | no dibujado |
| Shift+R | Tecla (`designerKeys.ts:43`) | `ui.rulers` | Solo en el Designer completo (no en Studio) | Listada | Igual que hoy | se conserva | no dibujado |
| Ctrl+G | Tecla (`designerKeys.ts:45`) | `groupLayers` | Con ≥2 capas elegidas; si no, aviso | Listada | Igual que hoy | se conserva | no dibujado |
| Ctrl+E | Tecla (`designerKeys.ts:51`) | `mergeDown` | Hay capa activa | NO aparece en Settings → Shortcuts (sí en el menú More de capas) | Igual que hoy | se conserva | no dibujado |
| Ctrl+A | Tecla (`designerKeys.ts:55`) | `selectAll` | Hay documento | Listada | Igual que hoy | se conserva | no dibujado |
| Ctrl+D | Tecla (misma rama) | `setSelection(doc.id, null)` | Hay documento | Listada | Igual que hoy | se conserva | no dibujado |
| Ctrl+Shift+I | Tecla (misma rama) | `invertSelection` | Hay documento | Listada | Igual que hoy | se conserva | no dibujado |
| Ctrl+J | Tecla (misma rama) | `selectionToLayer` | Con selección de píxeles | Listada | Igual que hoy | se conserva | no dibujado |
| Delete / Backspace con un nodo elegido | Tecla (`designerKeys.ts:63`) | `deletePickedNode` (Ctrl: une en recta) | Editando un path | Listada («Delete / Ctrl+Delete (nodes)») | Igual que hoy | se conserva | no dibujado |
| Delete con selección de píxeles | Tecla (`designerKeys.ts:67`) | `clearSelected` (borra los píxeles) | Hay selección | Listada | Igual que hoy | se conserva | no dibujado |
| Delete / Backspace / Ctrl+X con objetos elegidos | Tecla (`designerKeys.ts:73`) | `deletePickedObjects` | Objetos elegidos en la capa | Ctrl+X solo borra si el portapapeles ya copió (ver [[documentos]]) | Igual que hoy | se conserva | no dibujado |
| Delete / Backspace sin más | Tecla (`designerKeys.ts:88`) | `deleteLayers` (las bloqueadas se quedan) | Hay capa activa | Listada («Delete») | Igual que hoy | se conserva | no dibujado |
| Flechas con objetos elegidos | Tecla (`designerKeys.ts:79`) | `nudgeObjects` 1 px, Shift 10 px | Objetos elegidos, sin edición de nodos | Sin objetos, las flechas desplazan la vista | Igual que hoy | se conserva | no dibujado |
| Espacio (mantener) | Lienzo (`Stage.tsx:566`) | Vista (pan) | Fuera de campos | Listada | Igual que hoy | se conserva | no dibujado |
| Alt + clic (Brush, Fill) | Lienzo (`Stage.tsx:626`) | `ui.brush.color` | Brush o Fill | Listada | Igual que hoy | se conserva | no dibujado |
| Alt mientras se arrastra (snap) | Lienzo (`Stage.tsx:1029`) | Mueve sin imán | Tool = move | Listada | Igual que hoy | se conserva | no dibujado |
| Alt + arrastrar (Lineart) | Lienzo (`Stage.tsx:862`) | Curva el trazo | Lineart modo Draw | Listada | Igual que hoy | se conserva | no dibujado |
| Doble clic (Edit) | Lienzo (`Stage.tsx:1261`) | Edita puntos de un trazo, nodos/asas de una forma, o el texto | Tool = move | Listada | Igual que hoy | se conserva | no dibujado |
| Shift+C / Shift+S / Shift+Y (nodos) | Edición de nodos (`PathNodes.tsx:72`) | Tipo de nodo | Editando un path | Listada; detalle en [[tira-contextual]] | Igual que hoy | se conserva | no dibujado |
| Shift+L / Shift+U (nodos) | Edición de nodos (`PathNodes.tsx:70`) | Segmentos a recta / curva | Editando un path | Listada | Igual que hoy | se conserva | no dibujado |
| Shift+J / Alt+J (nodos) | Edición de nodos (`PathNodes.tsx:64`; Shift+J en `PathNodes.tsx:66`) | Unir / unir con segmento | Editando un path | Listada | Igual que hoy | se conserva | no dibujado |
| Shift+B (nodos) | Edición de nodos (`PathNodes.tsx:68`) | Romper el path | Editando un path | Listada | Igual que hoy | se conserva | no dibujado |
| Flechas, Ctrl+A y Esc en edición de nodos | Edición de nodos (`PathNodes.tsx:56`) | Mueven nodos 2 px (Shift 20, Alt 1 px de pantalla); selecciona todos; Esc limpia y luego sale | Editando un path | Listadas | Igual que hoy | se conserva | no dibujado |
| Ctrl + arrastrar un asa de esquina | Lienzo (asas de forma) | Los dos radios a la vez | Editando un rect | Listada; el candado «Lock radii» hace lo mismo ([[tira-contextual]]) | Igual que hoy | se conserva | no dibujado |
| Mod + Alt + P | Atajo de pruebas de la app (`shortcuts.ts:21`) | Inicia/para una traza de rendimiento | Global | No es del Designer; solo aparece en el grupo «Testing» | Igual que hoy | se conserva | no dibujado |

## Enlaces

- [[navegacion-zoom]] · [navegacion-zoom.md](navegacion-zoom.md)
- [[tira-contextual]] · [tira-contextual.md](tira-contextual.md)
- [[capas]] · [capas.md](capas.md)
- [[lienzo-gestos]] · [lienzo-gestos.md](lienzo-gestos.md)
- [[toolbox-dock]] · [toolbox-dock.md](toolbox-dock.md)
- [[README]] · [Índice](README.md)

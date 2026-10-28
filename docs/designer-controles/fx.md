---
type: inventario
title: FX: filtros y efectos
description: El menú FX de la barra de capas, el editor de una capa FX (simple o apilada) y los 13 tipos con sus parámetros.
tags: [designer, fx, filtros, efectos]
updated: 2026-10-28
related: [capas, propiedades, lienzo-gestos]
---
# FX: filtros y efectos

FX no destructivo (ADR 0011, `FxPanel.tsx:14`). Una capa FX tiene `group` (filter o effect), `scope` (Layer below o Everything below), `simple` y una lista `ops`. El menú FX (`FxPanel.tsx:30`) está en la barra de acciones de [[capas]]; el editor (`FxPanel.tsx:76`) aparece en la pestaña Properties al elegir una capa FX y en un popover al hacer doble clic en su fila.

| Control | Dónde está hoy | Qué estado modifica | Cuándo aparece | Notas | Dónde quedaría en la propuesta | Estado | Mockup |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Control | Dónde está hoy | Qué estado modifica | Cuándo aparece | Notas | Igual que hoy | se conserva | no dibujado |
| Filters and effects (botón + menú) | Barra de acciones de capas (`FxPanel.tsx:35`) | Abre el menú | Siempre; deshabilitado si la capa activa está bloqueada | Icono Sparkles, compartido con Operations | Barra de acciones encima de la lista de capas (A2); icono Zap en lugar de Sparkles (B6) | se mueve | [a2-capas-acciones](../mockups/designer-ajustes/a2-capas-acciones.html), [b-iconos](../mockups/designer-ajustes/b-iconos.html) |
| New filter layer | Menú FX (`FxPanel.tsx:38`) | Añade una capa FX `filter`, `scope` below | Menú abierto | Encima de la capa activa | Igual que hoy | se conserva | no dibujado |
| New effect layer | Menú FX (`FxPanel.tsx:39`) | Añade una capa FX `effect`, `scope` below | Menú abierto | — | Igual que hoy | se conserva | no dibujado |
| Filter on <capa> › 10 filtros | Menú FX (`FxPanel.tsx:43`) | Añade una capa FX con una sola operación (`simple`) | Menú abierto | Brightness, Contrast, Saturation, Hue, Grayscale, Sepia, Invert, Levels, Curves, Blur (`defs.ts:35`) | Igual que hoy | se conserva | no dibujado |
| Effect on <capa> › 3 efectos | Menú FX (misma línea) | Idem | Menú abierto | Glow, Drop shadow, Lens flare (`defs.ts:38`) | Igual que hoy | se conserva | no dibujado |
| Applies to: Layer below / Everything below | Editor FX (`FxPanel.tsx:83`) | `layer.scope` (`set`) | Capa FX seleccionada | Pista: dice qué capa queda afectada | Igual que hoy | se conserva | no dibujado |
| Parámetros de la operación única | Editor FX modo simple (`FxPanel.tsx:81`) | `set_op` con el parámetro | Capa FX `simple` con 1 operación | Lista abajo | Igual que hoy | se conserva | no dibujado |
| Edit as filter/effect layer (botón) | Editor FX modo simple (`FxPanel.tsx:88` layer}) | `layer.simple = false` | Capa FX simple | Pasa a la pila editable | Igual que hoy | se conserva | no dibujado |
| Turn on/off <fx> (interruptor) | Fila de operación (`FxPanel.tsx:61`) | `op.enabled` | Editor en modo pila | — | Igual que hoy | se conserva | no dibujado |
| Nombre de operación (desplegar) | Fila de operación (`FxPanel.tsx:62`) | Estado local `open` | Modo pila | Se abre la última por defecto | Igual que hoy | se conserva | no dibujado |
| Move <fx> up (applied later) | Fila de operación (`FxPanel.tsx:66`) | `move_op` | Modo pila | Orden: la última aplicada arriba | Igual que hoy | se conserva | no dibujado |
| Move <fx> down (applied earlier) | Fila de operación (`FxPanel.tsx:67`) | `move_op` | Modo pila | — | Igual que hoy | se conserva | no dibujado |
| Remove <fx> (+ Remove / Cancel) | Fila de operación (`FxPanel.tsx:68`) | `remove_op` tras confirmación en línea | Modo pila | Confirmación «Remove?» dentro de la fila | Igual que hoy | se conserva | no dibujado |
| Parámetros de la operación | Fila desplegada (`FxPanel.tsx:71`) | `set_op` | Operación abierta | Sliders; Drop shadow y Lens flare incluyen un color | Igual que hoy | se conserva | no dibujado |
| Add filter / Add effect (select) | Final de la pila (`FxPanel.tsx:95`) | `add_op` | Modo pila | Se añade al final, pero la lista se muestra invertida: la nueva aparece ARRIBA | Al principio del editor, antes de la lista de operaciones; el texto del estado vacío pasa de «below» a «above» | se mueve | [a5-fx-add-arriba](../mockups/designer-ajustes/a5-fx-add-arriba.html) |
| Editor en popover (doble clic) | Fila FX de la lista (`FxPanel.tsx:105`) | Mismo editor | Doble clic en una fila FX | Sin botón visible | Igual que hoy | se conserva | no dibujado |

## Enlaces

- [[capas]] · [capas.md](capas.md)
- [[propiedades]] · [propiedades.md](propiedades.md)
- [[lienzo-gestos]] · [lienzo-gestos.md](lienzo-gestos.md)
- [[README]] · [Índice](README.md)

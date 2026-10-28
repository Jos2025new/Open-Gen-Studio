---
type: inventario
title: Guías y reglas de página (Layout › Guides)
description: La tarjeta Guides, las reglas del lienzo y los gestos para crear, mover y quitar guías.
tags: [designer, guias, rulers]
updated: 2026-10-28
related: [toolbox-dock, regla, alinear-editar, lienzo-gestos, atajos, menus-contextuales]
---
# Guías y reglas de página (Layout › Guides)

Las guías pertenecen al documento (`doc.guides` {x, y}); lo que se ve y se bloquea es de la interfaz (`ui.rulers`, `ui.showGuides`, `ui.lockGuides`, persistentes, `store.ts:153`). La tarjeta se abre con la variante Guides de Layout (`ToolDock.tsx:136`).

| Control | Dónde está hoy | Qué estado modifica | Cuándo aparece | Notas | Dónde quedaría en la propuesta | Estado | Mockup |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Control | Dónde está hoy | Qué estado modifica | Cuándo aparece | Notas | Igual que hoy | se conserva | no dibujado |
| Show rulers (interruptor) | Dock › tarjeta Guides (`GuidesCard.tsx:29`) | `ui.rulers` | Variante Guides abierta | Atajo Shift+R; en Studio no hay atajo (`tools` definido) | Tarjeta Guides: columna propia de cuatro interruptores | se conserva | [c10-guias](../mockups/designer-ajustes/c10-guias.html) |
| Show guides (interruptor) | Dock › tarjeta Guides (`GuidesCard.tsx:30`) | `ui.showGuides` (defecto true) | Variante Guides abierta | — | Tarjeta Guides: columna propia de cuatro interruptores | se conserva | [c10-guias](../mockups/designer-ajustes/c10-guias.html) |
| Lock guides (interruptor) | Dock › tarjeta Guides (`GuidesCard.tsx:31`) | `ui.lockGuides` | Variante Guides abierta | Edit no puede mover ni quitar guías bloqueadas | Tarjeta Guides: columna propia de cuatro interruptores | se conserva | [c10-guias](../mockups/designer-ajustes/c10-guias.html) |
| Snap to guides (interruptor) | Dock › tarjeta Guides (`GuidesCard.tsx:32`) | `ui.snapByMode[modo].guides` y, al encender, también `on` (`GuidesCard.tsx:26`) | Variante Guides abierta | Es la misma opción «Guides» del menú Snap de Edit ([[alinear-editar]]) | Tarjeta Guides: columna propia de cuatro interruptores | se conserva | [c10-guias](../mockups/designer-ajustes/c10-guias.html) |
| Orientation (Vertical / Horizontal) | Dock › tarjeta Guides (`GuidesCard.tsx:35`) | Estado local `axis` | Variante Guides abierta | No persiste | Tarjeta Guides: subgrupo con título «Add guide» (Orientation, Position, Unit y Add juntos) | se mueve | [c10-guias](../mockups/designer-ajustes/c10-guias.html) |
| Position (campo numérico) | Dock › tarjeta Guides (`GuidesCard.tsx:37`) | Estado local `pos` | Variante Guides abierta | En la unidad elegida | Tarjeta Guides: subgrupo con título «Add guide» (Orientation, Position, Unit y Add juntos) | se mueve | [c10-guias](../mockups/designer-ajustes/c10-guias.html) |
| Unit (px / %) | Dock › tarjeta Guides (`GuidesCard.tsx:38`) | Estado local `unit` | Variante Guides abierta | % es relativo al ancho/alto de la página | Tarjeta Guides: subgrupo con título «Add guide» (Orientation, Position, Unit y Add juntos) | se mueve | [c10-guias](../mockups/designer-ajustes/c10-guias.html) |
| Add (botón) | Dock › tarjeta Guides (`GuidesCard.tsx:41`) | `doc.guides` vía `placeGuide` (`GuidesCard.tsx:21`) | Variante Guides abierta | — | Tarjeta Guides: subgrupo con título «Add guide» (Orientation, Position, Unit y Add juntos) | se mueve | [c10-guias](../mockups/designer-ajustes/c10-guias.html) |
| Guides around page (botón) | Dock › tarjeta Guides (`GuidesCard.tsx:42`) | `doc.guides` vía `guidesAroundPage` | Variante Guides abierta | — | Tarjeta Guides: pie | se conserva | [c10-guias](../mockups/designer-ajustes/c10-guias.html) |
| Clear all guides (botón) | Dock › tarjeta Guides (`GuidesCard.tsx:43`) | `doc.guides` vacío vía `clearGuides` | Hay guías (deshabilitado si no) | Sin confirmación; el clic derecho sobre una regla hace lo mismo | Tarjeta Guides: pie | se conserva | [c10-guias](../mockups/designer-ajustes/c10-guias.html) |
| Reglas superior e izquierda (canvas) | Lienzo (`Stage.tsx:108`; montadas en `Stage.tsx:1324`) | Ninguno | `ui.rulers` encendido | Medida en unidades del documento | Igual que hoy | se conserva | no dibujado |
| Arrastrar desde una regla (nueva guía) | Lienzo (`Stage.tsx:1330`) | `doc.guides` (`placeGuide` al soltar) | Reglas visibles | Regla superior = guía horizontal; izquierda = vertical | Igual que hoy | se conserva | no dibujado |
| Clic derecho en una regla | Lienzo (`Stage.tsx:1336`) | `clearGuides`; aviso «Guides cleared» | Reglas visibles y hay guías | ÚNICO menú contextual propio del Designer; evita el menú nativo y borra todo sin confirmar | Igual que hoy | se conserva | no dibujado |
| Arrastrar una guía existente (Edit) | Lienzo (`Stage.tsx:640`) | `doc.guides` (mover; soltar sobre la regla la quita) | Tool = move, guías visibles y no bloqueadas | El cursor cambia a col-resize / row-resize al pasar por una guía (solo hover) | Igual que hoy | se conserva | no dibujado |

## Enlaces

- [[toolbox-dock]] · [toolbox-dock.md](toolbox-dock.md)
- [[regla]] · [regla.md](regla.md)
- [[alinear-editar]] · [alinear-editar.md](alinear-editar.md)
- [[lienzo-gestos]] · [lienzo-gestos.md](lienzo-gestos.md)
- [[atajos]] · [atajos.md](atajos.md)
- [[menus-contextuales]] · [menus-contextuales.md](menus-contextuales.md)
- [[README]] · [Índice](README.md)

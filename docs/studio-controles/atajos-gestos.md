---
type: inventario
title: Atajos y gestos en Studio
description: Teclas, arrastres y gestos que actúan en Studio (chat, compositor, tablero, visor), con el alcance de foco de cada uno.
tags: [studio, atajos, gestos]
updated: 2026-10-28
related: [composer, tablero, chat-estudio, tarjeta-preguntas]
---
# Atajos y gestos en Studio

La lista oficial que muestra Ajustes › Shortcuts sale de `shortcutGroups()` (`shortcuts.ts:16-88`), con los grupos Testing, Prompt and chat, Viewer, Nodes, Designer y Sketch. Esta nota recoge lo que **realmente** ocurre en Studio según el código; lo que ese listado no dice va en [hallazgos](hallazgos.md). Las teclas de Nodes y Designer solo actúan con el foco dentro del tablero (`useBoardFocus.ts:6-21`). Las teclas del Designer embebido están en [estudio-embebido](../designer-controles/estudio-embebido.md) y [atajos del Designer](../designer-controles/atajos.md).

Columnas: Tecla o gesto | Dónde | Cuándo | Qué hace | Notas.

| Tecla o gesto | Dónde | Cuándo | Qué hace | Notas |
| --- | --- | --- | --- | --- |
| Intro | Prompt del compositor (`Composer.tsx:497-503`) | No hay composición IME ni menú de menciones que consuma la tecla | Envía al agente o, en un modo directo, comprueba y genera (`submit`, `Composer.tsx:389-405`) | Agent: solo si hay texto o adjuntos y el agente no está ocupado. Directo: puede pedir confirmación de coste |
| Mayús+Intro | Prompt (`Composer.tsx:499`) | Siempre | Salto de línea | — |
| @ en el prompt | Prompt (`Composer.tsx:346`, `ReferenceMentions.tsx:82`) | Escribiendo | Menú de referencias; flechas arriba/abajo, Intro y Esc dentro del menú | Elegir una referencia que no está adjunta la adjunta (`attach: true`) |
| Pegar imágenes | Prompt (`Composer.tsx:504-510`) | Portapapeles con imágenes | Las adjunta si el modelo las acepta | — |
| Soltar archivos o activos | Compositor (`Composer.tsx:448-468`) | Arrastre con `Files` o `application/x-ogs-asset` | Adjunta | Resalta el compositor (`is-drop`) |
| Esc | Cualquier popover (`Popover.tsx:112-119`) | Solo el popover superior de la pila | Cierra y devuelve el foco al ancla | Atraviesa todos los popovers de Studio (chips, Regenerate, Models…) |
| Clic fuera | Popover (`Popover.tsx:102-111`) | Popover abierto | Cierra | — |
| Intro / Esc | Editor de mensaje (`FeedList.tsx:87-93`) | Editando | Intro envía, Esc cancela | Mayús+Intro no envía |
| Intro / Esc | «Edit» de una línea del plan (`PlanParts.tsx:95`) | Campo abierto | Envía el comentario / cierra | — |
| Esc | Suggest changes (`PlanParts.tsx:124`) | Textarea abierta | Cierra | Intro NO envía aquí: es un textarea; se envía con el botón Send |
| Intro | Campo «Escribe tu respuesta…» de una pregunta (`QuestionsCard.tsx:156-158`) | Hay respuesta | Pasa a la siguiente / termina | — |
| Intro | Campo numérico de duración o imágenes (`SettingsCard.tsx:261`) | Escribiendo | Aplica el valor (pierde el foco) | Ajusta al valor válido más cercano |
| ← / → | Divisor del tablero (`StudioBoard.tsx:44`) | Divisor enfocado | Ancho −16 / +16 px | Izquierda ensancha el tablero |
| Arrastre del divisor | `StudioBoard.tsx:18-43` | Puntero capturado | Redimensiona; el chat y el compositor siguen el puntero por fotograma | Se guarda al soltar |
| ← / → / Esc | Visor (`Lightbox.tsx:20-31`) | Visor abierto, sin popover, y el foco no está en un campo | Resultado anterior/siguiente; Esc cierra (vuelve al visor previo si hay `back`) | Los botones « » del visor hacen lo mismo |
| Ctrl/⌘+C, X | Nodes embebido (`NodeWorkspace.tsx:365-377`) | Foco en el tablero y nodos seleccionados | Copia / corta nodos | — |
| Ctrl/⌘+G, +Mayús+G | Nodes embebido (`NodeWorkspace.tsx:373-374`) | Igual; agrupar necesita más de un nodo | Agrupa / desagrupa | — |
| Ctrl/⌘+V | Nodes embebido (`NodeWorkspace.tsx:345-362`) | Foco en el tablero | Pega nodos copiados o imágenes (las sube y crea nodos) | — |
| Supr / Retroceso | Nodes embebido (`NodeWorkspace.tsx:459`) | Foco en el tablero | Borra la selección | Con el foco fuera es `null` |
| Ctrl/⌘+Z, Y | Nodes (`shortcuts.ts:39-40`) | Según el listado | Deshacer / rehacer | La lectura del manejador de deshacer de nodos no se hizo; ver [huecos](huecos.md) |
| Ctrl/⌘+Alt+P | Global (`TraceControl.tsx:13,37-47`) | Siempre | Inicia o termina una traza de rendimiento; pide una etiqueta | Escribe en `logs/`, no gasta. También pasa el guardián de Home (`homeGuard.ts:24`) |
| Esc en Home | `TopBar.tsx:67-79` | Home abierto, sin campos ni paneles | Vuelve al espacio anterior | No es de Studio, pero se alcanza desde él |
| Guardián de Home | `homeGuard.ts:10-29` | Home o un Space cubren el espacio de trabajo | Frena el teclado del espacio cubierto (incluido Studio) | Las teclas de Home, popovers, visor y panel lateral siguen pasando |
| Pasar el puntero sobre un mensaje | `chat.css:112-115` | Mensaje del usuario | Muestra Copy, Edit, Delete | En pantallas sin hover siempre visibles |
| Pasar el puntero sobre una tarjeta respondida | `chat.css:150-153` | Tarjeta de preguntas o ajustes respondida | Muestra Edit | Igual |
| Pasar el puntero sobre una línea del plan | `chat-cards.css:93-94` | Plan esperando | Muestra Edit | Igual, sin la regla `hover: none` en la hoja leída |
| Clic o Intro/Espacio en un texto cortado | `PlanParts.tsx:19-26` | Resumen del plan cortado a dos líneas | Despliega | Solo existe como botón cuando el texto está realmente cortado |
| Pasar el puntero sobre la miniatura de origen | `GenerationCard.tsx:185` | Tarjeta completa con entradas | Abre el riel de entradas; clic lo fija; salir espera 250 ms | Tras cerrar con clic no reabre hasta salir y volver (`GenerationCard.tsx:104-110`) |

## Enlaces

- [[composer]] · [composer.md](composer.md)
- [[tablero]] · [tablero.md](tablero.md)
- [[hallazgos]] · [hallazgos.md](hallazgos.md)
- [[README]] · [Índice](README.md)

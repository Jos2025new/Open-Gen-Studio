---
type: inventario
title: Tablero de Studio
description: Columna derecha de Studio con sus tres vistas (Generations, Nodes, Designer), el divisor, el botón de mostrar/ocultar y la apertura automática.
tags: [studio, tablero, generations]
updated: 2026-10-28
related: [chat-estudio, resultados, estado-compartido, dependencias]
---
# Tablero de Studio

Studio es el espacio de trabajo `chat` (`App.tsx:75`): el chat ocupa el centro y el tablero la columna derecha (`App.tsx:77`, solo si `workspace === 'chat'`). El tablero solo **ve** un lienzo; el agente sigue trabajando en el lienzo de chat (`studioBoard.ts:42-46`, `conversation.ts:33`). Las preferencias (abierto, ancho, vista) viven en `localStorage` bajo `ogs:studio-board` (`studioBoard.ts:11,30-34`), no en el store ni en `data/`.

Columnas: Control | Dónde (archivo:línea) | Cuándo | De qué depende | Qué modifica | Influye en | Notas.

## Marco, divisor y pestañas

| Control | Dónde | Cuándo | Depende de | Modifica | Influye en | Notas |
| --- | --- | --- | --- | --- | --- | --- |
| Studio board (columna) | `StudioBoard.tsx:41` | `open` verdadero (`StudioBoard.tsx:16`) y `workspace === 'chat'` (`App.tsx:77`) | `useStudioBoard()` (`studioBoard.ts:38`) | Nada | Ancho de la columna `--studio-w` (`App.tsx:74`) que mueve el chat y el compositor | Ancho entre `BOARD_MIN`=300 y `boardMax()`=máx(640, 60 % de la ventana) (`studioBoard.ts:7-10`) |
| Resize board (divisor, separator) | `StudioBoard.tsx:42` | Tablero abierto | `width` (`aria-valuenow`) | Arrastre: escribe `style.width` y `--studio-w` por fotograma sin pasar por React (`StudioBoard.tsx:18-30`); al soltar `setStudioBoard({ width })` (`StudioBoard.tsx:39`) | Chat y [compositor](composer.md) (padding por `--studio-w`) | Teclado: Flecha izquierda +16 px, derecha −16 px (`StudioBoard.tsx:44`); tabulable (`tabIndex=0`). Si se redimensiona la ventana, el ancho guardado se reajusta (`studioBoard.ts:24-27`) |
| Pestaña Generations | `StudioBoard.tsx:47` (`VIEWS`, línea 9) | Tablero abierto | `view` | `setStudioBoard({ view: 'assets' })` | Muestra [Generations](#generations-spaceboard-modo-studio) | Vista por defecto; cualquier valor desconocido guardado cae a `assets` (`studioBoard.ts:17`) |
| Pestaña Nodes | `StudioBoard.tsx:47` | Tablero abierto | `view` | `setStudioBoard({ view: 'nodes' })` | Muestra el lienzo de nodos embebido | Ver [más abajo](#nodes-embebido) |
| Pestaña Designer | `StudioBoard.tsx:47` | Tablero abierto | `view` | `setStudioBoard({ view: 'designer' })` | Muestra el Designer reducido | Detalle en [estudio-embebido](../designer-controles/estudio-embebido.md) (no se repite) |
| Close board (X) | `StudioBoard.tsx:48` | Tablero abierto | — | `setStudioBoard({ open: false })` | Reabre [Show generations](#botones-fuera-del-tablero) | Cerrarlo no detiene nada que esté corriendo |

## Botones fuera del tablero

| Control | Dónde | Cuándo | Depende de | Modifica | Influye en | Notas |
| --- | --- | --- | --- | --- | --- | --- |
| Show generations / Hide generations | `StudioReopen.tsx:6-9` (se dibuja desde el compositor) | Studio | `useStudioBoard().open` | `setStudioBoard({ open: !open })` | Tablero | La etiqueta cambia con el estado; lleva `aria-pressed`. Se monta en el compositor, solo con `workspace === 'chat'` (`Composer.tsx:536`) |
| Apertura automática | `lib/studioBoard.ts:51-64` (instalador `installBoardAutoOpen`) | La primera generación `queued`/`running` de una sesión en `workspace === 'chat'` | `s.generations`, `s.activeSessionId`, set `autoOpened` en memoria (`studioBoard.ts:49`) | `setStudioBoard({ open: true, view: 'assets' })` solo si estaba cerrado (`studioBoard.ts:62`) | Tablero | Una vez por sesión y ejecución: tras recargar puede volver a abrirse. Si el tablero ya estaba abierto en Nodes/Designer no cambia la vista. Se instala una vez al arrancar (`main.tsx:37`) |
| El agente cambia la vista (`open_board`) | `agentCanvas.ts:41-76` | Solo en Studio (`ui.workspace === 'chat'`; en otro espacio responde que no vale, `agentCanvas.ts:71-72`) | `view`: assets, nodes, designer o closed | `setStudioBoard(view === 'closed' ? { open: false } : { open: true, view })` (`agentCanvas.ts:73-74`) | Lienzo sobre el que trabaja el agente ese turno | Abre/cierra el tablero sin que el usuario lo pida; sigue siendo preferencia de navegador. No gasta |
| `continue_in_canvas` / `continue_in_designer` / `continue_in_chat` | `agentCanvas.ts:55-60`, `canvasCalls.ts:136-170` | Petición del usuario de continuar en otro lienzo (`context.ts:76-77`) | Estado del tablero | En Studio, abren el tablero en Nodes o Designer (o lo devuelven a Generations) sin cambiar `ui.workspace` (según el texto de la herramienta `agentCanvas.ts:57-58` y `studio.md`); el cuerpo de `canvasCalls.ts` no se leyó línea a línea | Vista del tablero | Detalle de esas ramas: sin confirmar (ver [huecos](huecos.md)) |
| Pantallazo a Ongoing (miniatura pendiente del chat) | `StudioGeneration.tsx:22-25,73` | Generación del chat en curso | — | Abre el tablero en `assets` y desplaza a `.space-ongoing` tras 50 ms | Tablero | Un `setStudioBoard` activado por el usuario, sin riesgo de gasto |
| Foco del tablero (`useBoardFocus`) | `useBoardFocus.ts:6-21` | Siempre que hay un lienzo embebido | `pointerdown` (captura) y `focusin` en el documento | Marca si el último foco/clic fue dentro del tablero | Atajos de teclado y portapapeles de Nodes y Designer embebidos | Una tecla escrita en el compositor no llega al tablero |

## Generations (SpaceBoard modo Studio)

`SpaceBoard studio` se monta en `StudioBoard.tsx:50` con el vacío «Nothing generated yet. Ask for something in the chat.». En modo Studio no hay sección «Actions suggested» ni botón X propio (`SpaceBoard.tsx:95,154`).

| Control | Dónde | Cuándo | Depende de | Modifica | Influye en | Notas |
| --- | --- | --- | --- | --- | --- | --- |
| Reset view (↻) | `SpaceBoard.tsx:85` | Siempre | — | Restablece tipo, ámbito («This session» en Studio), orden, tamaño de miniatura (`ui.tileSize`), disposición, favoritos, fallidas y selección (`SpaceBoard.tsx:60`) | Todo el tablero | Único control que escribe `ui.tileSize` además del control de tamaño |
| Filter (popover) › Show: All sessions / This session | `SpaceBoard.tsx:98-102` | Popover abierto | `scope` (por defecto `session` en Studio, `SpaceBoard.tsx:32`) | `setScope` | Qué generaciones se listan (`splitBoard`, `boardModel.ts:23-24`) | El botón se marca activo si el ámbito difiere del por defecto (`SpaceBoard.tsx:61`) |
| Filter (popover) › Type | `SpaceBoard.tsx:103-108` | Popover abierto | `KINDS` (`generationsView.ts:11-18`) | `setKind` | Lista | Opciones: All, Images, Videos, Audio, 3D, Text |
| Sort › Newest / Oldest / Cost | `SpaceBoard.tsx:111-114` | Popover abierto | `sort` | `setSort` | Orden de Done | — |
| View › Layout Grid / List | `SpaceBoard.tsx:118-120` | Popover abierto | `layout` | `setLayout` | Done y Ongoing | La disposición no se guarda (estado local) |
| View › Tile size (slider) | `SpaceBoard.tsx:121` | Layout Grid | `ui.tileSize`, `TILE_MIN/MAX` | `setUi({ tileSize })` | Tamaño de miniaturas | Persistente en `ui` (`persistUi`) |
| Favorites only (★) | `SpaceBoard.tsx:92` | Siempre | `starred` | Filtra solo activos favoritos (`boardModel.ts:33,36`) | Done | Los textos no aparecen con este filtro (`boardModel.ts:33`) |
| Select | `SpaceBoard.tsx:93` | Siempre | `selecting` | Alterna modo selección y vacía `selected` | Clic en miniatura marca en vez de abrir el visor | En Studio la selección no alimenta ninguna acción: el bloque que la usa está desactivado con `studio` (`SpaceBoard.tsx:154`). Ver [hallazgos](hallazgos.md) |
| Show failed | `SpaceBoard.tsx:94` | Siempre | `showFailed` | Muestra la fila «Failed» (`SpaceBoard.tsx:144-147`) | Lista | Cada fallida lleva el error en `title`; sin botón de reintento aquí |
| Done N (cabecera plegable) | `SpaceBoard.tsx:127-129` | Hay hechas o en curso | `doneMode` (`boardModel.ts:62-65`), `userDone` | `setUserDone` | Cuántas se ven | Mientras algo corre, Done muestra solo lo terminado en el lote («batch») y el resto queda tras «Show all N» (`SpaceBoard.tsx:141`); el reajuste a automático ocurre cuando cambia `running` (`SpaceBoard.tsx:77`) |
| Miniatura Done (imagen/vídeo/3D/audio) | `SpaceBoard.tsx:131` | Hay hechas | `assets`, `selecting` | Clic: abre el visor con la lista de Done (`SpaceBoard.tsx:134`); con Select marca | Visor (`ui.lightbox`) | — |
| Casilla «Add to the agent context» | `AgentAttachToggle.tsx:15-32`, usado en `SpaceBoard.tsx:138,214,218` | El activo es imagen/vídeo/audio/3D (`AGENT_ATTACHABLE`) | `composer.attachments` | `toggleAgentAttachment(assetId)` (`actions`) | Adjuntos del [compositor](composer.md) y lo que el agente ve | Solo nombra un activo; no importa ni envía nada (comentario `AgentAttachToggle.tsx:4-8`) |
| Tile de texto | `SpaceBoard.tsx:131` (`TextTile`) | Generación de texto hecha | — | No leído | — | Sin confirmar (`TextTile.tsx` no leído) |
| Ongoing | `SpaceBoard.tsx:149-153` | Hay generaciones en curso (en Studio la sección desaparece si no hay) | `rows.ongoing` | — | — | Los huecos pendientes muestran un brillo discreto y `PendingStatus` (`SpaceBoard.tsx:191-199`): fase, N/M, ETA y barra; fase y spinner tienen mayor jerarquía visual |
| Resultado ya llegado en Ongoing | `SpaceBoard.tsx:206-212` | Una salida de una generación en curso | — | Clic: abre el visor con las salidas de esa generación, o marca con Select | Visor | — |
| Selección de Done tras un lote | `SpaceBoard.tsx:63-74` | Termina un lote | Temporizador de 2 s de «quietud» | Pasa `running` a falso | Done vuelve a mostrar todo | Un plan que inicia su siguiente paso dentro de 2 s no cierra el lote |

## Nodes (embebido)

`EmbeddedNodeCanvas` (`NodeWorkspace.tsx:572-579`) monta `Canvas embedded` dentro de un `ReactFlowProvider` con clave de sesión. Sin añadir nodo, Operations, importar desde el chat, barra superior, menú contextual ni teclado de subida (`NodeWorkspace.tsx:91,339,425,440-441,447,470,531`).

| Control | Dónde | Cuándo | Depende de | Modifica | Influye en | Notas |
| --- | --- | --- | --- | --- | --- | --- |
| Zoom out / Zoom in / Fit view | `EmbeddedControls.tsx:9-11` | Vista Nodes | `useReactFlow()` | Zoom del lienzo (150 ms) | Solo el visor | Los únicos controles propios del tablero de nodos |
| «No nodes yet. Ask the agent to build a flow.» | `NodeWorkspace.tsx:541` | Grafo vacío | `graph.nodes` | — | — | Aviso, no control |
| Ctrl/Cmd+C, Ctrl/Cmd+X | `NodeWorkspace.tsx:365-380` | Foco dentro del tablero (`insideRef`), nodos seleccionados, fuera de campos de texto | `selected` | Copia o corta nodos; copiar muestra toast «Copied N node(s)» | Portapapeles de nodos | Mismo código que el Nodes completo |
| Ctrl/Cmd+G, Ctrl/Cmd+Shift+G | `NodeWorkspace.tsx:373-374` | Igual; agrupar necesita más de un nodo | `selected` | `groupNodes` / `ungroup` | Grafo | — |
| Pegar (Ctrl+V) | `NodeWorkspace.tsx:345-362` | Foco dentro del tablero | Portapapeles | Imágenes: `importImages` (sube y crea nodos); nodos copiados: `pasteNodes` | Grafo y biblioteca | Subir imágenes escribe activos |
| Suprimir (Backspace/Delete) | `NodeWorkspace.tsx:459` | `insideRef.current` verdadero | Foco | Borra nodos seleccionados (React Flow) | Grafo | Con el foco fuera del tablero `deleteKeyCode` es `null` |
| Conectar arrastrando asas | `NodeWorkspace.tsx:443` | Siempre | — | `tryConnect` | Grafo | Soltar un enlace en vacío no abre menú aquí (`NodeWorkspace.tsx:447`) |
| Controles dentro de cada nodo (ejecutar, modelo, prompt…) | `nodes.tsx` | Con nodos | — | — | — | No inventariados: ver [huecos](huecos.md) |

## Designer (embebido)

Pestaña Designer: `EmbeddedDesigner` (`StudioBoard.tsx:50`). Todos sus controles están en [estudio-embebido](../designer-controles/estudio-embebido.md) y su estado en [estado-compartido](estado-compartido.md#designer).

## Enlaces

- [[chat-estudio]] · [chat-estudio.md](chat-estudio.md)
- [[resultados]] · [resultados.md](resultados.md)
- [[composer]] · [composer.md](composer.md)
- [[estado-compartido]] · [estado-compartido.md](estado-compartido.md)
- [[README]] · [Índice](README.md)

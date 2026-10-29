---
type: inventario
title: Resultados de generación en Studio
description: Cómo se ven y qué hacen los resultados en el chat de Studio (fila compacta y tarjeta completa), sus acciones de coste, avisos de entrega y fallos.
tags: [studio, resultados, generacion, precio]
updated: 2026-10-29
related: [chat-estudio, tablero, tarjeta-plan, dependencias, hallazgos]
---
# Resultados de generación en Studio

En Studio cada elemento `generation` del feed se dibuja con `StudioGeneration` (`FeedList.tsx:176`, y agrupados `FeedList.tsx:239`). `StudioGeneration` solo se encarga de imágenes y vídeos en estado `done`, `running` o `queued` (`StudioGeneration.tsx:45`); **fallos, cancelados, texto, audio y 3D usan la tarjeta completa** `GenerationCard` como `fallback` (`FeedList.tsx:176`, `StudioGeneration.tsx:45`). Los mismos resultados aparecen en el [tablero](tablero.md#generations-spaceboard-modo-studio).

Columnas: Control | Dónde | Cuándo | De qué depende | Qué modifica | Influye en | Notas.

## Fila compacta (imagen y vídeo)

| Control | Dónde | Cuándo | Depende de | Modifica | Influye en | Notas |
| --- | --- | --- | --- | --- | --- | --- |
| Marcador «Ongoing» (miniatura con fondo suave) | `StudioGeneration.tsx:73-75` | `g.status` distinto de `done` | `g.kind` | Clic o Intro: `showOngoing()` abre el tablero en Generations y desplaza a Ongoing (`StudioGeneration.tsx:22-25`) | Tablero | Sin spinner ni cifras en el chat; el estado detallado vive en el tablero (comentario `SpaceBoard.tsx:180`; ver `SpaceBoard.tsx:191-199`) |
| Created N file(s) (cabecera plegable) | `StudioGeneration.tsx:76-79` | Hecha y no agrupada (`grouped`) | `outputs.length` | Pliega las miniaturas | — | Agrupadas, la plegadura es de la fila entera ([chat-estudio](chat-estudio.md#filas-de-resultados-en-el-chat)) |
| Miniatura (Open image / Open video) | `StudioGeneration.tsx:81-85` | Hecha | `g.assetIds`, `chatResults(sessionId)` | Abre el visor con todos los resultados del chat de la sesión, a partir de esa (`StudioGeneration.tsx:67-71`; `chatResults` excluye los de nodos y Designer, `GenerationCard.tsx:42-50`); en modo selección marca/desmarca | `ui.lightbox` | Vídeo muestra un icono de reproducir |
| Casilla «Add to the agent context» | `StudioGeneration.tsx:85`, `AgentAttachToggle.tsx` | Fuera de modo selección | `composer.attachments` | `toggleAgentAttachment` | Adjuntos del compositor | — |
| Casillas de selección numeradas | `StudioGeneration.tsx:85` | Modo selección | `picked` | Marca por orden | Acción pendiente | — |
| Copy prompt | `StudioGeneration.tsx:90` | `g.prompt` | `g.prompt`, `g.variants` | Un resultado: `copyText(g.prompt)`; varios: modo selección y confirma «Copy» (copia prompt + variante de la elegida, `StudioGeneration.tsx:56`) | Portapapeles | — |
| Reuse (prompt, inputs, model and settings in the composer) | `StudioGeneration.tsx:91` | Hecha y no operación (`!g.op`) | `g.id` | `editInComposer(g.id)` | Rellena el compositor: texto, entradas, modelo y ajustes; chip «Reusing» | **Cambia el modelo del compositor al de esa generación**; es acción del usuario. Con varios resultados pide elegir uno (`StudioGeneration.tsx:91`) |
| Regenerate (popover «Regenerate with a new seed» / «Run X again») | `StudioGeneration.tsx:92,101-103` | Hecha | `regenerateEstimate(g.id) ?? g.estimate` | `regenerate(g.id)` tras `SpendConfirm` («Regenerate · $X») | **Gasta** | Muestra precio y presupuesto restante. Si supera el límite o el precio es desconocido con límite activo, `SpendConfirm` ofrece «Continue once» y «Don’t ask again» para la sesión de la generación; el control global está en Settings > Budget. El texto de la interfaz nueva no se ha vuelto a verificar en pantalla. |
| Favorite / Download | `StudioGeneration.tsx:93-95`, `AssetActions.tsx:290-301` | Un resultado: botones; varios: modo selección con «Favorite N» / «Download N» | `assets[id].favorite` | `toggleFavorite`, `downloadAsset` | Favoritos (filtro del tablero), disco | Con selección, favorito marca o desmarca según haya alguno sin marcar (`StudioGeneration.tsx:54`) |
| Mejorar esta toma (popover) | `StudioGeneration.tsx:96`, `ImproveShotButton.tsx:10-36` | Hecha y `improvePlan(g)` no nulo (borrador de vídeo) | `improvePlan`, `improveEstimate` | `improveShot(g.id)` tras `SpendConfirm` («Mejorar · $X»): mismo prompt y semilla a mayor resolución, o el reescalador | **Gasta** | Texto en español; sin precio disponible: «Sin precio disponible» (`ImproveShotButton.tsx:17`) |
| Details (Info) | `StudioGeneration.tsx:97,105-108` | Siempre | `GenerationInfo` | Popover con detalles de la generación | — | Con varios resultados pide elegir uno primero |
| Check status | `StudioGeneration.tsx:98` | `status === 'running'` y `g.remoteJob` | `g.remoteJob.provider` | `checkStatusNow(g.id)` | Pregunta al proveedor | No cobra de nuevo |
| Dejar de seguir (popover) | `StudioGeneration.tsx:99,104`, `StopFollowing.tsx:8-32` | En curso con trabajo remoto | `g.remoteJob`, `g.estimate.usd` | «Dejar de seguir» → `cancelGeneration(g.id)`; «Keep following» cierra | La generación deja de seguirse aquí | El texto dice: «{proveedor} keeps generating this and will charge the estimate (…). Stopping only stops following it here; Check status can pick it up again.» Rastreo ([R11](../rastreo/studio-2.md)): el cobro tras dejar de seguir lo afirma la propia app; que el proveedor lo cobre de verdad requiere pregunta al proveedor. |
| Stop | `StudioGeneration.tsx:99` | En curso sin trabajo remoto | — | `cancelGeneration(g.id)` | Cancela la generación | — |
| Avisos de entrega («What came back differs from what was asked») | `GenerationNotices.tsx:5-19` | `status === 'done'` y `g.delivery` | `g.delivery[]` | — | — | Informativo. Segunda línea tenue «What the app did about this request on its own» con `g.notes` |

## Tarjeta completa (fallos, texto, audio, 3D, y fuera de Studio)

| Control | Dónde | Cuándo | Depende de | Modifica | Influye en | Notas |
| --- | --- | --- | --- | --- | --- | --- |
| Fuente / entradas (miniatura + riel) | `GenerationCard.tsx:182-188,168-180` | La generación tuvo entradas aún existentes | `generationInputs(g)` | Clic fija el riel; pasar el puntero lo abre; miniaturas abren el visor | `ui.lightbox` | Etiquetas: Source, Start frame, End frame, Reference N, Input N (`GenerationCard.tsx:352-358`) |
| Prompt (clic para ampliar) y Copy prompt | `GenerationCard.tsx:192-210` | Siempre | `generationTitle(g)` | Expande el texto; `copyText` | — | — |
| Línea de meta (modelo · aspecto · resolución · duración · ×N) y etiqueta de coste | `GenerationCard.tsx:212-216` | Siempre | `g.actualUsd` (si existe, exacto) o `g.estimate` | — | — | Etiqueta «Nodes» si viene de nodos |
| «est $X · charged $Y» | `GenerationCard.tsx:217-221,347-349` | El proveedor cobró algo distinto de la estimación (más de 1 % o 0,0005 USD) | `g.estimate.usd`, `g.actualUsd` | — | — | Informa de la diferencia real |
| Error / Canceled + recuperación | `GenerationCard.tsx:224-229`, `RecoveryActions.tsx:48-75` | `error`, o cancelada sin salidas | `g.error` | — | — | «Check status» (si el trabajo tiene id), «Retry · $X» o «Continue once · $X»; si es paso de un plan, la recuperación es la del plan ([tarjeta-plan](tarjeta-plan.md)). Check status del trabajo ya enviado no se bloquea por el límite; los reintentos sí lo comprueban (`RecoveryActions.tsx:48-76`). |
| Texto resultado | `GenerationCard.tsx:230-231` (`TextResult`) | `kind === 'text'` hecho | — | No leído | — | Sin confirmar (`TextResult.tsx` no leído) |
| Mosaicos de salida | `GenerationCard.tsx:233-272` | Hay salidas o huecos pendientes | `outputs`, `pendingSlots` | Clic: selecciona (varios) o abre el visor (uno); doble clic o Intro abre el visor; botón Open | `ui.lightbox` | Hueco pendiente con «Queued/Working», tiempo, ETA, barra y «Check status» (`GenerationCard.tsx:59-93`) |
| Barra de herramientas del resultado elegido (Tools ▾) | `GenerationCard.tsx:261-266`, `AssetActions.tsx:102` | La generación está hecha y es el resultado elegido | `OPS`, `asset.kind` | Menú de operaciones (reencuadre, escalar…) | **Puede lanzar operaciones con coste** | Cada operación pasa por su formulario y `SpendConfirm`; su contenido no se inventaría aquí ([huecos](huecos.md)) |
| Reuse / Regenerate / Mejorar esta toma / Details | `GenerationCard.tsx:277-280` | Como en la fila compacta | — | Igual | — | Pie del componente |
| Attach to prompt / Send to / Favorite / Download | `GenerationCard.tsx:282-289`, `AssetActions.tsx:181-301` | Resultado elegido y hecha | — | `useAsReference`; menú «Send to» (Open in Designer, Use as reference, Save to library, Guardar como estilo, Add to Node canvas) | Compositor, Designer, biblioteca, nodos | «Open in Designer» y «Add to Node canvas» **cambian de espacio** |
| Dejar de seguir / Stop / Delete | `GenerationCard.tsx:291-298` | Remoto en curso / en curso / terminada | — | Popover de borrado: «Delete this generation and its N file(s)?»; `deleteGeneration` | Borra la generación y sus archivos | Único borrado real de esta superficie; confirmación contextual con Cancel |

## Enlaces

- [[chat-estudio]] · [chat-estudio.md](chat-estudio.md)
- [[tablero]] · [tablero.md](tablero.md)
- [[tarjeta-plan]] · [tarjeta-plan.md](tarjeta-plan.md)
- [[dependencias]] · [dependencias.md](dependencias.md)
- [[README]] · [Índice](README.md)

---
type: inventario
title: Compositor en Studio
description: Controles del compositor que se ven en Studio (modo Agent y modos de creación directa), selector de modelos, adjuntos, envío, parada y avisos de crédito.
tags: [studio, compositor, modelos, precio]
updated: 2026-10-28
related: [chat-estudio, tablero, tarjeta-plan, dependencias, hallazgos]
---
# Compositor en Studio

En Chat, Nodes y Designer, el prompt empieza en una sola línea con «+» y enviar/parar o Generate dentro y crece al escribir; debajo están el selector de espacio y los controles del modo activo. En Chat también está el tablero. En Designer, cuando el dock muestra herramientas, se conserva la toolbox y la fila inferior incluye el selector de espacio. Un fondo del color del lienzo protege el dock y la fila inferior en Nodes y Designer.

`Composer` (`Composer.tsx:237`) se monta debajo del área de trabajo para todos los espacios (`App.tsx:76`) y recibe el espacio como `dock-chat` en Studio (`Composer.tsx:442`). En Studio no dibuja `ThreadPeek` (solo `workspace !== 'chat'`, `Composer.tsx:443`) ni la paleta de herramientas del Designer (`toolsDock`, `Composer.tsx:437`, solo en `designer`). El texto del compositor es `composer.text`; el modo, `composer.mode` (`agent`, `image`, `video`, `audio`, `model3d`; `ModeMenu.tsx:7-13`). El estilo del agente por defecto es `auto` (`store.ts:263`).

Columnas: Control | Dónde (archivo:línea) | Cuándo | De qué depende | Qué modifica | Influye en | Notas.

## Entrada, adjuntos y modos

| Control | Dónde | Cuándo | Depende de | Modifica | Influye en | Notas |
| --- | --- | --- | --- | --- | --- | --- |
| Prompt (textarea) | `Composer.tsx:487-512` | Siempre salvo la paleta del Designer | `composer.text`, `composer.mode`, `workspace` | `setComposer({ text })`; menciones `@` | Envío, adjuntos por mención (`useAsReference`) | Marcador: «Describe what you want to create…» (Agent en Studio, `Composer.tsx:122`) o el del modo. Altura automática hasta 180 px (`Composer.tsx:300-305`) |
| Enter / Mayús+Enter | `Composer.tsx:497-503` | En el prompt, sin composición IME ni menú de menciones abierto | — | Enter: `submit()`; Mayús+Enter: salto de línea | Envío | En modo Agent llama a `sendAgentMessage(text)` solo si `canSendAgent` (`Composer.tsx:387-391`); en directo, a `checkDirect` y `generateDirect` |
| Pegar imagen | `Composer.tsx:504-510` | Pegar archivos de imagen | Modelo que acepta imágenes | `attachFiles` | Adjuntos | Si el modelo no acepta imágenes, toast «The selected model does not take input images.» (`Composer.tsx:424-427`) |
| Soltar archivo o activo en el compositor | `Composer.tsx:448-468` | Arrastre con `Files` o `application/x-ogs-asset` | `takesImages` | Un activo: `addAssets`; archivos: `onFiles` | Adjuntos | Rechaza vídeos o audios que el modelo no admite con toast (`Composer.tsx:407-418`) |
| «+» (Add files, switch mode or open Design) | `ComposerOptions.tsx:26-28` | Siempre | `composer.mode`, `ui.workspace` | Abre el menú | Adjuntar, modo, Design | Enfoca el primer botón al abrir (`ComposerOptions.tsx:15-21`) |
| «+» › Attach images / Attach references / Start frame / Attach audio / This model takes no input files | `ComposerOptions.tsx:30-32`, etiqueta `Composer.tsx:438` | Menú abierto; deshabilitado si el modelo no admite entradas (`Composer.tsx:439`) | `takesImages`, `takesAudio` | Abre el selector de archivos (`fileRef`, `Composer.tsx:470-480`) | Adjuntos | Con Agent siempre admite imágenes y audio (`Composer.tsx:250,262`) |
| «+» › Agent | `ComposerOptions.tsx:37-39` | Menú abierto | — | `setComposer({ mode: 'agent' })` | Todo el compositor | — |
| «+» › Create › Create Image / Video / Audio / 3D | `ComposerOptions.tsx:40-50` | Menú abierto | `workspace` (en Designer se deshabilitan vídeo, audio y 3D) | `setComposer({ mode })` | Cambia a generación directa (sin agente) | **Cambia el modo a uno que gasta al pulsar Generate**; ver [Generate](#modos-directos-generación-sin-agente) |
| «+» › Design | `ComposerOptions.tsx:52-54` | Menú abierto | — | `setUi({ workspace: 'designer', designerDock: 'tools' })` | **Sale de Studio al Designer completo** | — |
| «+» › Skills / Workflows (chips) | `ComposerOptions.tsx:55`, `AgentControls.tsx:104-111` | Solo modo Agent | `composer.skillId`, `composer.workflowId`, `workspace` | Elegir/quitar `skillId` o `workflowId` | Cómo escribe el agente (los workflows de otro espacio salen deshabilitados con «Available in …», `AgentControls.tsx:89-97`) | Los chips activos también se ven fuera del menú (`AgentControls.tsx:131`). Un workflow que no vale en el espacio actual muestra «Not for {workspace}» y se ignora (`AgentControls.tsx:132-136`) |
| Agent mode (Auto / Guided / Direct) | `AgentControls.tsx:120-130` | Modo Agent | `composer.agentStyle` (por defecto `auto`) | `setComposer({ agentStyle })` | Si hay tarjeta de preguntas y de ajustes, y cuánta decisión toma el agente | Auto: «asks one card only when something that changes the result is missing, and stops to confirm the cost»; Guided: preguntas hasta `settings.guidedRounds`; Direct: sin preguntas ni tarjeta de ajustes, usa los modelos del compositor (`AgentControls.tsx:9-13`). Ver [dependencias](dependencias.md#estilo-del-agente) |
| Reusing ✕ (chip «Reusing») | `Composer.tsx:522-530` | `composer.editing` activo (tras «Reuse» en un resultado) | `composer.editing` | `setComposer({ editing: null })` | Deja de reutilizar | — |
| Adjuntos (tira) | `Composer.tsx:27-45` | Hay adjuntos vivos | `composer.attachments`, `assets` | Vista previa: abre el visor; ✕ «Remove attachment» los quita | Lo que el agente ve; referencias del paso | Las casillas «Add to the agent context» de los resultados escriben aquí ([resultados](resultados.md)) |
| Adjunto › tiempo (Keyframe / Clip trim) | `Composer.tsx:48-118` | Modelo con `keyframes` (vídeo) o `clips` | `composer.times`, `composer.trims`, `video.settings.duration` | `setComposer({ times \| trims })` | Posición/recorte de cada adjunto en el vídeo | Solo modos directos (con Agent no hay esquema, `Composer.tsx:50`) |
| Cambio automático de variante al adjuntar | `Composer.tsx:347-379` | Modo image/video y cambia el número de imágenes adjuntas | `lineRoutes(currentRef)`, `imageCount` | `pickComposerModel(mode, want, false)` y toast «Switched to {modelo} for the attached image(s) / text only.» (`Composer.tsx:374-375`) | Modelo del compositor (misma línea de modelos) | **Cambio automático de modelo con aviso**, no de proveedor. `pickComposerModel` también marca `composer.userPicked[kind] = true` (`catalog.ts:235`); ver [hallazgos](hallazgos.md) |
| Cambio de modo del Designer | `Composer.tsx:293-298` | `workspace === 'designer'` y modo vídeo/audio/3D | — | `setComposer({ mode: 'image' })` + toast | — | No ocurre en Studio (solo `designer`) |

## Modo Agent: controles de modelos y envío

| Control | Dónde | Cuándo | Depende de | Modifica | Influye en | Notas |
| --- | --- | --- | --- | --- | --- | --- |
| Models · N (chip) | `AgentModelControls.tsx:153-156` | Modo Agent | Número de elecciones manuales: Director fijado + tipos con `userPicked` o rutas guardadas (`AgentModelControls.tsx:114-120`) | Abre el popover «Models» | Resumen de modelos del agente | «Models» sin cifra = todo en Auto |
| Models › fila Director | `AgentModelControls.tsx:122,170-177` | Popover abierto | `settings.agent.model`, `modelPinned`, `provider` | Abre la lista de Director | — | Con `provider === 'offline'` solo dice «The local planner is active…» (`AgentModelControls.tsx:50`) |
| Director › Auto / modelo concreto | `AgentModelControls.tsx:71-80,57-60` | Lista abierta | `catalog.llm[provider]`, filtros | Auto: `resetAgentModel()` (`catalog.ts:109`); modelo: `settings.agent = { model, modelPinned: true }` | El modelo del agente en todos los turnos | Búsqueda, filtros de capacidad, orden, fabricante y familias plegables (`AgentModelControls.tsx:68-98`) |
| Models › filas Image / Video / Music / 3D | `AgentModelControls.tsx:123,170-177` | Popover abierto | `composer[kind].modelRef`, `userPicked` | Abre `ModelList` con «Auto: Connected default (…)» | Modelo del compositor y rutas de edición/vídeo | Elegir libera primero los overrides (`releaseOverrides`: `ops.edit`, `videoRoutes`, `ops.videoEdit`, `AgentModelControls.tsx:126-132`) y llama a `pickComposerModel` (recuerda también como modelo de la sesión, `catalog.ts:244-258`) o `resetComposerModel` |
| «Set as default» (por fila Image/Video) | `AgentModelControls.tsx:173-176` | El modelo recordado por la sesión difiere del del compositor | `session.agent.settings[kind]` | `setSessionModelAsDefault` (`sessionModel.ts:20-24`) → `pickComposerModel(..., false)` | Convierte la elección de la sesión en el modelo por defecto del compositor | El único camino explícito de sesión → compositor (además del ajuste «updateComposerDefaults», ver abajo) |
| Reset all to Auto | `AgentModelControls.tsx:143-149,179-181` | Hay elecciones manuales | — | `resetAgentModel`, `releaseOverrides` y `resetComposerModel` por tipo | Todos los modelos del agente vuelven a Auto | — |
| Show generations / Hide generations | `Composer.tsx:536` | `workspace === 'chat'` | — | `setStudioBoard` | [Tablero](tablero.md#botones-fuera-del-tablero) | — |
| Send (↑) | `Composer.tsx:544-546` | Modo Agent, agente libre | `canSendAgent` = no ocupado y hay texto o adjuntos | `sendAgentMessage(text)` (`conversation.ts:29`) | Inicia un turno del agente | **Cada turno es una llamada de LLM con coste de agente**. Si hay tarjeta de preguntas abierta, el texto se envía como nota de la respuesta (`conversation.ts:51-54`); si hay tarjeta de ajustes abierta, se cierra «skipped» sin confirmar (`conversation.ts:56-67`); si hay un plan esperando, el agente lo revisa (`conversation.ts:71-92`) |
| Stop (■) | `Composer.tsx:540` | Modo Agent y agente ocupado | `agent.busy` | `stopAgent()` (`conversation.ts:258`): aborta el turno | Termina el turno actual | No cancela generaciones ya lanzadas |

## Modos directos: generación sin agente

En Studio el «+» › Create permite pasar a Image, Video, Audio o 3D. Entonces el compositor dibuja `MediaControls` (`Composer.tsx:532`) y `SendDirect` (`Composer.tsx:549`).

| Control | Dónde | Cuándo | Depende de | Modifica | Influye en | Notas |
| --- | --- | --- | --- | --- | --- | --- |
| Generate · precio | `Composer.tsx:183-235` | Modos Image/Video/Audio/3D | `checkDirect(kind)` (`actions.ts:210`), presupuesto, cotizaciones Atlas | `generateDirect(kind)` si el precio es conocido y no supera el límite; si `usd == null` o supera el límite, abre antes el popover «Confirm cost» (`Composer.tsx:198-206`) | **Gasta** al lanzar | Con precio conocido y dentro del límite **no hay segundo paso**: el botón ya muestra el precio (`costLabel`, `primitives.tsx:68`). Bloqueado (`is-blocked`) con el motivo en el tooltip; clic bloqueado → toast con el motivo. Enter hace lo mismo (`Composer.tsx:394-404`) |
| Confirm cost (popover «Generate») | `Composer.tsx:221-232` | Precio no publicado o por encima del límite | `SpendConfirm` | `launch()` | Gasto | Mismo patrón que Regenerate y Mejorar |
| Model (chip + lista) | `MediaControls.tsx:27-51` | Cualquier modo directo | `composer[kind].modelRef`, `catalog` | `pickComposerModel(kind, ref)` | Modelo del compositor y, para imagen/vídeo, el de la sesión | Tooltip con precio (`priceHint`). Lista con búsqueda, proveedor, función, orden y pie «Browse all models (N)» / «Manage providers» / «Connect OpenRouter, fal.ai, NanoGPT or Atlas Cloud» (`ModelList.tsx:206-350`) |
| Format (aspecto, resolución, imágenes/duración) | `MediaControls.tsx:66-178` | Si el modelo tiene alguno de esos parámetros | `catalog.schemas`, `composer[kind].settings` | `setComposerMedia(kind, { settings })` | Precio del botón Generate | Imágenes 1 a 4; para más que el límite por petición, tooltip que dice que el resto va en peticiones aparte (`MediaControls.tsx:155`) |
| Estilo de captura (cámara, tono, luz, textura) | `CaptureChip.tsx:9-85` | Image y Video | `settings.capture`, `settings.realism`, `library` (estilos propios) | Estilo, tono, directivas de cámara (solo vídeo) e imperfecciones | Prompt enviado | Textos en español dentro de una interfaz inglesa (hallazgo menor) |
| Lyrics | `MediaControls.tsx:531-585` | Audio y 3D | `lyricsParam` | `setExtra` | Letra enviada | Un `textarea` de 12 filas |
| Audio / Silent | `MediaControls.tsx:180-200` | Vídeo cuyo modelo tiene parámetro de audio | `settings.audio` | Alterna audio | Precio (el tooltip avisa «usually costs more») | — |
| Subjects | `MediaControls.tsx:382-460` | Vídeo | `library` | Insertar `@Nombre`, guardar sujeto, borrar sujeto, ID de voz, «From audio» | Prompt y referencias | «From audio» pide confirmación con SpendConfirm («fal bills the voice when it is created», precio `null`) y llama a `createSubjectVoice` |
| Shots | `MediaControls.tsx:465-525` | Vídeo | `settings.shots` | Añadir/quitar tomas y su prompt | Duración y precio | — |
| Advanced | `MediaControls.tsx:295-375` | El esquema tiene parámetros `other`, semilla o negativo | `schema.params` | Semilla (dado «Pick a random seed»), «What to avoid», campos dinámicos, Reset | Parámetros del modelo | Muestra «N changed» o «Defaults» |
| Style fields (paletas, IDs de estilo, nombre de estilo nuevo) | `StyleFields.tsx:21-141` | Modelos con parámetros de estilo | `ParamDef` | `setExtra` | Parámetros del modelo | Dinámico por modelo; no se enumera campo a campo (ver [huecos](huecos.md)) |
| Target layer (chip) | `Composer.tsx:132-181` | Solo `designer` | — | — | — | No aparece en Studio |

## Avisos y ajustes que el compositor refleja

| Control | Dónde | Cuándo | Depende de | Modifica | Influye en | Notas |
| --- | --- | --- | --- | --- | --- | --- |
| Alertas sobre el prompt | `ComposerAlerts.tsx:5-29` | Hay alertas (`useAlerts`, máximo 3, sin repetir texto, `alerts.ts:25-26`) | `pushAlert` desde `credit.ts`, `keepResult.ts:17`, `runtimeShared.ts:63` | ✕ «Close» (`dismissAlert`); botones de acción de cada alerta | Ver [dependencias](dependencias.md#sin-crédito-cambio-de-proveedor) | No se guardan |
| Alerta «{proveedor} has no credit: {modelo} switched to the same model at {otro}…» | `credit.ts:157` | Una generación falla por falta de crédito y existe el mismo modelo en otro proveedor conectado, con crédito y mismo precio o menos | `jobPrice`, saldos | **Cambia el proveedor de la generación y la lanza otra vez antes de avisar** (`credit.ts:151-159`) | Generación | Excepción documentada (ADR 0025 regla C, `history/049-2026-10-W43.md:13`); ver [dependencias](dependencias.md#sin-crédito-cambio-de-proveedor) |
| Alerta de crédito con opciones | `credit.ts:162-166` | Hay modelos alternativos que no son «lo mismo a igual o menor precio» | — | Botón por opción: cambia la generación a ese modelo y la repite | Generación | Aquí sí decide el usuario. Las opciones marcan «pricier» si cuestan más |
| Alerta de crédito del agente | `credit.ts:189-233` | El proveedor del Director falla por crédito | `settings.keys`, saldos | Mismo modelo en otro proveedor ≤ precio: cambia `settings.agent` solo **con `modelPinned: true`** (`credit.ts:210-212,213-217`); si no, ofrece hasta 3 | Modelo del agente | Ver [hallazgos](hallazgos.md) Rastreo ([R2, R3](../rastreo/studio-2.md)): respondido por lectura; el cambio por crédito de generación fue deliberado (`4cf18aa`, ADR 0025 C; para el agente, sin confirmar), pero `modelPinned: true` y el «same price or less» con precios desconocidos (`credit.ts:199,206`) requieren decisión. |
| Ajuste «updateComposerDefaults» | `SettingsPanel.tsx:421-422`, `sessionModel.ts:16` | Ajustes del agente | `settings.agent.updateComposerDefaults` (sin marcar por defecto) | Si está marcado, cada elección explícita de modelo en una tarjeta aplica `pickComposerModel` al compositor | Modelo del compositor | Es el segundo camino sesión → compositor |

## Enlaces

- [[tarjeta-plan]] · [tarjeta-plan.md](tarjeta-plan.md)
- [[tablero]] · [tablero.md](tablero.md)
- [[dependencias]] · [dependencias.md](dependencias.md)
- [[hallazgos]] · [hallazgos.md](hallazgos.md)
- [[README]] · [Índice](README.md)

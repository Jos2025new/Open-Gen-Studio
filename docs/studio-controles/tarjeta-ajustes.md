---
type: inventario
title: Tarjeta de ajustes (confirm settings)
description: La tarjeta que confirma modelo y valores antes de que el agente escriba prompts, sus variantes Keep/Change y de seguimiento, y el bloque de chips que comparte con la tarjeta de plan.
tags: [studio, ajustes, modelo, borrador]
updated: 2026-10-28
related: [tarjeta-plan, tarjeta-preguntas, composer, dependencias, hallazgos]
---
# Tarjeta de ajustes

`SettingsCard` (`SettingsCard.tsx:28`) se despacha desde `FeedItemView` (`FeedList.tsx:171-172`) y **no se dibuja** si el elemento es `inline` (`FeedList.tsx:172`). Eso es lo que ocurre en el estilo Auto: el agente llama a `confirm_settings` y la app responde sola con `autoAnswer` (`llmTurn.ts:276`, `autoSettings.ts:56` crea el elemento `inline: true`); los chips viven entonces en la [tarjeta de plan](tarjeta-plan.md#chips-de-auto-plansettings). En Guided el agente muestra la tarjeta y espera (`llmTurn.ts:277-288`); en Direct no hay tarjeta (el agente usa los modelos del compositor, `AgentControls.tsx:12`). Cuatro formas según el estado: confirmada o saltada (resumen), pendiente normal, **Keep / Change** (`switchFrom`) y **seguimiento** (`switchFrom` + `followUp`).

Columnas: Control | Dónde | Cuándo | De qué depende | Qué modifica | Influye en | Notas.

## Resumen tras confirmar o saltar

| Control | Dónde | Cuándo | Depende de | Modifica | Influye en | Notas |
| --- | --- | --- | --- | --- | --- | --- |
| «Settings» / «Settings skipped» + chips (modelo, ×N, resolución, N s, aspecto) | `SettingsCard.tsx:35-58` | `item.status !== 'pending'` | `item.sections[].chosen ?? recommended` | — | — | «Settings skipped» aparece también cuando el usuario escribe en el compositor en vez de confirmar: la tarjeta se cierra `skipped` sin confirmar nada (`conversation.ts:56-58`) |
| Edit (tras confirmar) | `SettingsCard.tsx:56`, `EditAnswerButton.tsx:9-19` | `canReopenCard`: el agente no está ocupado y se conoce la llamada de herramienta que responde (`messageEdit.ts:76-95`) | `agent.busy`, historial | `reopenCard` (`messageEdit.ts:102-129`): borra del chat y del contexto del agente todo lo posterior, deja la tarjeta pendiente con las elecciones de antes y limpia los ajustes confirmados de esos tipos | Chat, plan que estuviera esperando (sus nodos borrador) | Texto de ayuda: «Edit — everything after this card is discarded». Solo al pasar el puntero (`chat.css:150-153`). Los resultados ya hechos se quedan en Assets |

## Tarjeta pendiente «Confirm settings»

| Control | Dónde | Cuándo | Depende de | Modifica | Influye en | Notas |
| --- | --- | --- | --- | --- | --- | --- |
| Resumen del agente (ClampedText, «Show more/Show less») | `SettingsCard.tsx:65`, `ClampedText.tsx:4-17` | Hay `item.summary` | — | Despliega | — | El botón solo existe si el texto está cortado a 3 líneas |
| Pregunta de borrador (Borrador / Alta calidad / «Otra cosa…») | `SettingsCard.tsx:66,84-113` | `item.draft` presente (tarjetas con vídeo) | `item.draft` | `selectDraft` (`draftActions.ts:28-37`): fija el modo y aplica a la resolución del vídeo (Borrador la bloquea a la más baja); lo recuerda en `agent.draftMode` | Candado y chip Resolution; resolución → precio | Obligatoria en cada tarjeta de vídeo (`DRAFT_RULE`, `draftFirst.ts:16`). El campo libre solo existe aquí; la tarjeta de plan sólo tiene Borrador/Alta calidad |
| Títulos de sección «Images · N» / «Video · N clips» (+ modelo si hay dos del mismo tipo) | `SettingsCard.tsx:67-72` | Más de una sección (`titled`) | `sectionsOf(item)` | — | — | Comparación A/B de dos modelos del mismo tipo |
| Continue → | `SettingsCard.tsx:73-78` | Siempre; deshabilitado con «Otra cosa…» sin texto (`SettingsCard.tsx:75`) | Selecciones de cada sección (`chosen ?? recommended`) | `confirmSettings` (`conversation.ts:224-240`): marca `confirmed`, guarda lo elegido como ajuste de sesión (`rememberSessionModel`, `conversation.ts:235`), responde al agente con los valores y la guía del modelo y relanza el turno | El agente escribe los prompts; modelo de la sesión | **Confirma modelo y valores, no el precio**: «The exact cost is shown with the plan, once the prompts are written.» (`SettingsCard.tsx:74`) |

## Bloque de chips compartido

`SettingsSectionBlock` (`SettingsCard.tsx:116-225`) lo usan la tarjeta pendiente y la de plan. Estado local `choice` (`SettingsCard.tsx:119`); al cambiar llama a `onPick` (plan) o a `selectSettings` (tarjeta, guarda la selección en el elemento sin confirmar, `conversation.ts:218-221`).

| Control | Dónde | Cuándo | Depende de | Modifica | Influye en | Notas |
| --- | --- | --- | --- | --- | --- | --- |
| Chip Model | `SettingsCard.tsx:170-179`, `ModelField.tsx:15-64` | Siempre | `item.recommended`, `item.alternatives`, esquemas | `update(choice)` | Aspecto/resolución/duración se conservan donde el nuevo modelo los admite (`ModelField.tsx:33`) | Lista: el recomendado con etiqueta («recommended», más «edit/image/reference» si hay imagen de entrada, `SettingsCard.tsx:175`) y «Show N other models» (alternativas ordenadas por precio ascendente, `ModelField.tsx:60`). Cada fila muestra proveedor y «from $X» o «price unknown» (`ModelField.tsx:35-38`). Se abre ya desplegada si el modelo elegido no es el recomendado (`SettingsCard.tsx:177`) |
| Chip Aspect ratio + «Like the image» | `SettingsCard.tsx:181-192` | El modelo tiene aspectos o tamaños en píxeles (Seedream: nivel + proporción) | `settingsOptions`, `px` | `update({ aspect })` | Precio | «Like the image» solo con imagen de entrada y pone `aspect` en `undefined` |
| Chip Resolution + candado | `SettingsCard.tsx:194-206` | `opts.resolutions.length` o niveles de tamaño | `draft.locked`, `draft.unlocked` | `update({ resolution })`; el candado llama a `unlockDraft` (`draftActions.ts:40-46`) | Precio | Con candado cerrado el valor está forzado a la resolución más baja: un `useEffect` lo reescribe si difiere (`SettingsCard.tsx:137-141`). «Bloqueada por el borrador: pulsa para cambiarla» |
| Chip Images per step | `SettingsCard.tsx:208-213`, `StepSlider` `SettingsCard.tsx:231-268` | `kind === 'image'` | `IMAGE_COUNTS` [1,2,3,4] | `update({ count })` | Número de imágenes y precio | Deslizador de pasos + campo numérico: flechas ±1 saltan al siguiente valor válido; un número a medias se ajusta al más cercano al perder el foco o con Intro (`SettingsCard.tsx:253-261`) |
| Chip Duration | `SettingsCard.tsx:215-220` | Vídeo con duraciones (`durationChoices`) | Esquema | `update({ duration })` | Precio | Etiqueta «per clip» con varios clips |

## Variantes de una pregunta

| Control | Dónde | Cuándo | Depende de | Modifica | Influye en | Notas |
| --- | --- | --- | --- | --- | --- | --- |
| Keep / Change («Found model …» o «… is also on {proveedor}») | `SettingsCard.tsx:276-292`, `switchModel.ts:13-37`, `llmTurn.ts:280` | El usuario nombra **en la petición actual** otro modelo, o solo otro proveedor del mismo modelo, con un tipo ya confirmado y una sola parte (`switchSection`) | `agent.settings`, `catalog.models`, precio «from $X» (`choiceEstimate`) | **Keep**: `confirmSettings(..., [keep])` mantiene el modelo confirmado. **Change**: `confirmSettings(..., [next])` lo cambia | Modelo de la sesión para el tipo (`switchedTo`, `confirmedState`, `switchModel.ts:68-77`) | **Único punto donde un modelo ya confirmado cambia a petición del agente.** Cambiar solo ocurre con el botón Change. Si no hay petición del usuario, una tarjeta normal recomienda el modelo confirmado y deja el del agente como alternativa (`keepConfirmed`, `switchModel.ts:49-62`) |
| Seguimiento «Next {kind}:» (Continue / Back / «Another model») | `SettingsCard.tsx:295-332` | `switchFrom` y `followUp` | `switchedTo` | `confirmSettings` con el modelo elegido | Modelo de la sesión | **No se genera ya en tarjetas nuevas**: el único `switchSection` recibe `follow = undefined` (`llmTurn.ts:280`) y la documentación dice que se retiró en Auto el 2026-10-24 (`features/agente.md:53`). Solo se dibujaría con elementos antiguos guardados; ver [hallazgos](hallazgos.md) |

## Enlaces

- [[tarjeta-plan]] · [tarjeta-plan.md](tarjeta-plan.md)
- [[tarjeta-preguntas]] · [tarjeta-preguntas.md](tarjeta-preguntas.md)
- [[dependencias]] · [dependencias.md](dependencias.md)
- [[README]] · [Índice](README.md)

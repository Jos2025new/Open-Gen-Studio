---
type: inventario
title: Tarjeta de plan
description: Cada control, aviso y comportamiento automático de la tarjeta de plan (esperando, en curso, terminada), sus chips de Auto y su recuperación tras fallos.
tags: [studio, plan, precio, aprobacion]
updated: 2026-10-29
related: [tarjeta-ajustes, tarjeta-preguntas, resultados, dependencias, hallazgos]
---
# Tarjeta de plan

`PlanCard` (`PlanCard.tsx:130`) se dibuja desde `FeedItemView` (`FeedList.tsx:174`). Tiene tres formas según `item.status`: **awaiting** (esperando aprobación, `PlanCard.tsx:146`), **running** (`PlanCard.tsx:184`) y **final** (`done`, `partial`, `error`, `canceled`, `review`; `PlanCard.tsx:357-367`). Los chips de modelo y valores solo existen con el estilo Auto (`planSections`, `planSettings.ts:51-66`: devuelve vacío si `plan.style !== 'auto'`, si es una ejecución de nodos o si el plan es del lienzo de nodos). Columnas: Control | Dónde | Cuándo | De qué depende | Qué modifica | Influye en | Notas.

Los números de coste los calcula `estimateSteps` (`executor.ts:56`) sobre los pasos marcados (`PlanCard.tsx:162`), no el `item.estimate` guardado, mientras el plan espera. Se vuelve a calcular al aprobar (`planRun.ts:63`).

## Cabecera

| Control | Dónde | Cuándo | Depende de | Modifica | Influye en | Notas |
| --- | --- | --- | --- | --- | --- | --- |
| Título del plan | `PlanCard.tsx:198` | Siempre | `plan.title` | — | — | — |
| «Adapting the prompt…» | `PlanCard.tsx:199` | Hay una reescritura de prompts en curso (`usePlanRewrite.busy[item.id]`) | `planSettings.ts:29-30` | — | Desactiva Approve | — |
| «Revising…» / «Revised» | `PlanCard.tsx:199` | `agent.revising === item.id` / `item.revised` | `agent.revising` | — | Desactiva Approve mientras revisa (`PlanCard.tsx:341`) | La revisión la hace el agente tras un comentario del usuario |
| N of M (contador de resultados) | `PlanCard.tsx:200` | `running` | `resultRows` (`PlanCard.tsx:383-405`) | — | — | Cuenta resultados, no pasos: una imagen con `count: 4` son 4 filas |
| Resumen del plan | `PlanCard.tsx:202` (`ClampText`, `PlanParts.tsx:9-27`) | Existe `plan.summary` | — | Clic o Intro/Espacio despliega, solo si el texto está realmente cortado a dos líneas | — | — |
| «… (como antes)» + botón Cambiar | `PlanCard.tsx:203-208` | `reused` (`draftFirst.reusedDraft`) y sin secciones Auto | Feed de la sesión | Cambiar: `sendAgentMessage('Quiero cambiar la elección de borrador/calidad')` (`PlanCard.tsx:206`) | Hace una nueva llamada al agente | Texto en español en una interfaz inglesa; el botón solo aparece mientras `awaiting` |

## Chips de Auto (PlanSettings)

`PlanSettings` (`PlanSettings.tsx:9-46`) reutiliza `SettingsSectionBlock` de la [tarjeta de ajustes](tarjeta-ajustes.md#bloque-de-chips-compartido). Aquí `onPick` y `onUnlock` apuntan al plan (`PlanSettings.tsx:29-30`). Se dibuja si `sections.length` (`PlanCard.tsx:211`). Con más de una sección (varios tipos o modelos en comparación) cada una lleva un título «Images · modelo» / «Video · modelo» (`PlanSettings.tsx:21-22`).

| Control | Dónde | Cuándo | Depende de | Modifica | Influye en | Notas |
| --- | --- | --- | --- | --- | --- | --- |
| Chip Model (lista de modelos) | `PlanSettings.tsx:23-30` vía `ModelField` (`ModelField.tsx:52`) | Plan Auto esperando | `catalog.models`, `catalog.schemas`; precio «from $X» por modelo (`ModelField.tsx:35-38`) | `changePlanChoice` (`planSettings.ts:89-108`): reescribe `modelRef`, aspecto, resolución y `count`/`duration` de los pasos del mismo tipo y modelo; lo recuerda como modelo de la sesión (`remember`, `planSettings.ts:80-86`) salvo que sea una comparación | Precio de la tarjeta (se recalcula), Approve (se desactiva durante la reescritura), prompts (si Ajustar prompt está activo) | Lo elige el usuario: el modelo no cambia solo. Si el paso lleva imágenes, se sustituye por la variante de edición/imagen-a-vídeo del mismo modelo (`stepModel`, `planSettings.ts:72`). El precio de la lista es «indicativo»: una imagen/clip con los valores actuales (`ModelField.tsx:34`) |
| Chip Aspect ratio | `SettingsCard.tsx:181-192` (dentro del bloque) | El modelo tiene aspectos o tamaños en píxeles | `settingsOptions` | `changePlanChoice` | Precio, prompts | Con imagen de entrada ofrece «Like the image» |
| Chip Resolution | `SettingsCard.tsx:194-206` | El esquema tiene resoluciones o niveles de tamaño | Borrador bloqueado | `changePlanChoice` | Precio | Con borrador bloqueado, el valor se fuerza a la resolución más baja del modelo (`SettingsCard.tsx:137-141`) y el candado la sostiene |
| Candado de resolución | `SettingsCard.tsx:197-198` | Vídeo con borrador bloqueado/desbloqueado | `draft.locked`, `draft.unlocked` | `changePlanDraft(..., unlock=true)` (`planSettings.ts:111-129`) | Resolución del vídeo | «Bloqueada por el borrador: pulsa para cambiarla» |
| Chip Images per step | `SettingsCard.tsx:208-213` | Tipo imagen | `IMAGE_COUNTS` = [1,2,3,4] (`settingsCard.ts:66`) | `changePlanChoice` (`count`) | Precio (multiplica) y número de miniaturas | — |
| Chip Duration | `SettingsCard.tsx:215-220` | Vídeo con duraciones | `durationChoices` | `changePlanChoice` (`duration`) | Precio, prompts | — |
| Borrador / Alta calidad (interruptor compacto) | `SettingsCard.tsx:86-91` vía `PlanSettings.tsx:32` | Sección de vídeo | `agent.draftMode` | `changePlanDraft` (`planSettings.ts:111`): fija la resolución del vídeo (el borrador la bloquea) y lo recuerda en la sesión | Resolución → precio | En la tarjeta de plan no existe «Otra cosa…» (sí en la de ajustes, ver [hallazgos](hallazgos.md)) |
| Ajustar prompt (interruptor) | `PlanSettings.tsx:33-39` (solo en la primera sección, `i === 0`) | Plan Auto esperando | `agent.enhance !== false` (`planSettings.ts:142`) | `setPromptWriter` (`planSettings.ts:145`): guarda `agent.enhance`; si se enciende, llama a `rewritePrompts` para todos los tipos | Reescritura de prompts tras un cambio de modelo, duración o aspecto | **Gasta tokens del modelo de agente** en cada reescritura (`planSettings.ts:188`, `addSpend` categoría `agent`) sin mostrar su precio antes; ver [dependencias](dependencias.md#reescritura-de-prompt). Deshabilitado durante una reescritura (`PlanSettings.tsx:35`). Desactivado: «the prompt is sent as written, whatever you change» Rastreo ([R10](../rastreo/studio-2.md)): respondido por lectura, el cobro previo sin precio es real; requiere decisión sobre mostrar el precio. |
| Aviso de reescritura fallida + Retry | `PlanCard.tsx:324`, `PlanSettings.tsx:49-56` | `awaiting` y fallo guardado | `usePlanRewrite.failed[item.id]` | Retry: `rewritePrompts` para cada sección | Desactiva Approve hasta que haya éxito (`PlanCard.tsx:341,346`) | El plan conserva el prompt viejo mientras tanto (comentario `PlanSettings.tsx:48`) |

## Pasos del plan (esperando y final)

| Control | Dónde | Cuándo | Depende de | Modifica | Influye en | Notas |
| --- | --- | --- | --- | --- | --- | --- |
| Casilla «Run {id} · {título}» | `PlanCard.tsx:241-243` | `awaiting`, sin `nodeRun`, más de un paso (`selectable`, `PlanCard.tsx:159`) | `item.skipped` | `toggleStep` guarda `skipped` en el feed | Precio total, Approve | Desmarcar un paso corta también sus dependientes y los `join` (`pruneJoins`, `planRun.ts:58`). Con todos desmarcados Approve queda deshabilitado (`none`, `PlanCard.tsx:163,341`) |
| Miniatura de referencia (REF) | `PlanCard.tsx:244-245`, `PlanParts.tsx:134-141` | El paso usa un activo como referencia | `refAssets` | — | — | Solo se muestra la primera referencia; las demás solo cuentan en «N ref» |
| Miniaturas del paso (StepThumb) | `PlanCard.tsx:246-247`, `StepThumb.tsx:11-33` | Pasos de imagen, vídeo, audio, 3D y operaciones | `generations[genId].assetIds` | Clic en una miniatura: abre el visor con las salidas de ese paso | `ui.lightbox` | Máximo 3 + «+N» (`StepThumb.tsx:4`). Mientras no hay resultado muestra un hueco pendiente |
| Icono de tipo | `PlanCard.tsx:249` | Pasos de texto y capa | — | — | — | — |
| Línea de detalle «modelo · aspecto · N ref» | `PlanCard.tsx:236,257`, `stepDetail` `PlanCard.tsx:57-81` | Siempre; se oculta si hay Auto y un solo paso | `catalog.models`, `settings` | — | — | Muestra la forma del aspecto dibujada a su proporción. Para operaciones remotas: «Model pending» y «Provisional until source exists» si no hay origen aún (`PlanCard.tsx:71-74`) |
| Coste por paso | `PlanCard.tsx:254` | Más de un paso, precio > 0 | `perStep` | — | — | `costLabel(..., short)` (`primitives.tsx:68`): `≥` mínimo, `≈` estimado, `Free`, `n/a` |
| Icono de estado | `PlanCard.tsx:255`, `PlanCard.tsx:92-99` | No `awaiting` | `item.stepStates` | — | — | running, done, review, error, skipped |
| Etiqueta «Prompt» / «Prompt · adaptado a {modelo}» | `PlanCard.tsx:280` | El paso envía un prompt | Con Auto añade «adaptado a» | — | — | Texto mixto español/inglés. El prompt mostrado es el que se envía realmente (`stepSentPrompt`, `PlanCard.tsx:235`) |
| Prompt plegable (Collapsible) | `PlanCard.tsx:281`, `PlanParts.tsx:34-61` | Hay prompt | — | El chevrón despliega, solo si está cortado | — | — |
| Variaciones («Prompts · base + variation») | `PlanCard.tsx:258-277` | Paso de imagen con `variations` | — | Despliega cada variación | — | La parte común se muestra aparte de la parte variable (subrayada) |
| Edit (por línea) | `PlanCard.tsx:191,265,281,308`, `PlanParts.tsx:67-101` | `awaiting` solamente (`editable`, `PlanCard.tsx:191`); visible solo al pasar el puntero o enfocar (`chat-cards.css:93-94`) | `stepReferenceChoices` para las menciones @ | Campo corto «What should change here?»; Intro envía `sendAgentMessage('{etiqueta}: {texto}')` (`PlanParts.tsx:75`), Esc cierra | El agente revisa el plan; Approve se desactiva mientras revisa | Es una llamada de LLM (coste de agente), no gasta generación. Admite menciones de referencias |
| Continuar / Cancelar paso | `PlanCard.tsx:284-290` | `stepStates[id] === 'review'` y plan no cancelado y existe la revisión | `item.stepCostReviews[id].message` | `resolveStepCostReview(..., 'continue' \| 'cancel')` (`planRun.ts:298-333`) | Continuar: reautoriza el paso con el precio nuevo y lo pone en cola. Cancelar: pasa el paso a `skipped` | **Es la compuerta de precio**: el paso se detuvo porque costaría más que lo aprobado más el margen (`priceAuthorization.ts:46-58`). Los textos del mensaje y los botones están en español |
| Nota de variante (sin botones) | `PlanCard.tsx:291` | `item.stepVariantNotes[id]` | `checkStepAuthorization` (`priceAuthorization.ts:60-75`) | — | — | Dice que el paso usó otro modelo/variante o que costó más sin freno de precio. Solo informa |
| Sujetos «@nombre ← …» | `PlanCard.tsx:298-304` | No `running` y `plan.subjects` | `plan.subjects[].from` | — | — | Dice si se guardará en la biblioteca («your image (saved to your library when you run it)»). Informa de la conservación; no es un control |
| Estilo | `PlanCard.tsx:305-310` | No `running` y `plan.style` | — | Edit (como en los pasos) | — | — |
| Adjustments: avisos no plegables | `PlanCard.tsx:312-314` | `plan.adjustments` que mencionan «your … model», «short of» o «video total:» (`PlanCard.tsx:49-52`) | Texto del ajuste | — | — | Nunca se pliegan; son los avisos de «cambié tu modelo / no llego a lo pedido» |
| N adjustment(s) to the plan (plegable) | `PlanCard.tsx:315-322` | No `running` y hay ajustes | `plan.adjustments` | `setShowAdj` | — | Lista el resto en texto |
| Error del plan | `PlanCard.tsx:323` | `item.error` | — | — | — | — |

## Pie con acciones

| Control | Dónde | Cuándo | Depende de | Modifica | Influye en | Notas |
| --- | --- | --- | --- | --- | --- | --- |
| Texto de presupuesto | `PlanCard.tsx:330-332` | `awaiting` | `total.usd`, `needsSpendCheck(total)` (`pricing.ts:120`), `remainingBudget()` (`budget.ts:13`) | — | — | «Price not published — billed at actual cost» / «Nothing to pay» / «No spending limit» / «Budget left $X» |
| Suggest changes | `PlanCard.tsx:333`, `PlanParts.tsx:104-110` | `awaiting` | — | Abre `SuggestBox` | — | — |
| Suggest box: What should change? / Send / Esc | `PlanCard.tsx:326`, `PlanParts.tsx:113-131` | Abierta | — | `sendAgentMessage(texto)` | El agente revisa el plan | «The agent revises the plan; nothing is spent» (`PlanParts.tsx:126`): cierto para la generación, pero cada revisión es un turno de LLM de agente; ver [dependencias](dependencias.md) Rastreo ([R9](../rastreo/studio-2.md)): respondido por lectura, la frase es falsa en dinero con un agente LLM (`llmTurn.ts:218`; con el motor local no se ha comprobado: sin confirmar); requiere decisión sobre el texto o el aviso de coste. |
| Cancel (esperando) | `PlanCard.tsx:334` | `awaiting` | — | `cancelPlan` (`planRun.ts:459-472`): estado `canceled`, borra los nodos borrador del plan y cierra la petición del agente | — | No gasta. Sin confirmación |
| Check the price again (↻) | `PlanCard.tsx:337` | `awaiting` y secciones Auto | — | `recheckPlanPrice` (`planSettings.ts:132-137`): vuelve a cargar esquemas y a pedir la cotización | Precio total | Deshabilitado durante una reescritura. No gasta generación |
| Approve · $X / Continue once · $X / Approve | `PlanCard.tsx:338-352` | `awaiting` | `over = overLimit(total, sessionId)` (`budget.ts:48`), `free`, `revising`, `rewriting`, `rewriteFailed`, `none`, `nodePreview.errors` | `withOncePass(sessionId, ...)` si `over`; al lado, «Don’t ask again» llama a `dontAskAgain(sessionId)` | **Lanza las generaciones y su gasto** | Con precio desconocido o precio por encima del saldo aparece la confirmación de exceso. «Continue once» liga el pase a la acción aprobada; «Don’t ask again» se guarda en la sesión. El interruptor global está en Settings > Budget. `approvePlan` vuelve a estimar y presenta una nota si el límite todavía aplica (`planRun.ts:49-69`). Pruebas de código (`tests/over-limit-choices.test.ts`, `tests/once-pass.test.ts` y `tests/spend-confirm-run.test.ts`); no se ha vuelto a probar esta UI en pantalla. La evidencia previa de sandbox mostraba el control anterior «Continue anyway» ([auditoría](../audits/repro-2026-10-29.md)). |
| Barra de progreso + «N of M · spent $X» | `PlanCard.tsx:353-354`, `planSpent.ts:8-24` | `running` | `plannedSpend` (suma `actualUsd` conocidos) | — | — | Con costes aún desconocidos muestra «spent ≥$X» o nada (`planSpent.ts:21-24`) |
| Cancel (en curso) | `PlanCard.tsx:189,355` | `running` | `item.stepGenerations` | `stopPlanRun(plan.id)` y `cancelGeneration` de cada generación en curso o en cola (`jobs.ts:808-812`) | Detiene lo que aún no empezó (`planStop.ts:5-9`) | Sin confirmación ni aviso de cobro, a diferencia de «Dejar de seguir» de un resultado suelto; ver [hallazgos](hallazgos.md) Rastreo ([R11](../rastreo/studio-2.md)): respondido parcialmente: la app queda leída (aborta en local y conserva `remoteJob`, `jobs.ts:666-668`); cobro real del proveedor sin verificar: requiere prueba o pregunta al proveedor. |
| Estado final | `PlanCard.tsx:359-361` | Ni `awaiting` ni `running` | `item.status` | — | — | «Necesita revisión» / «Done» / «Finished with errors» / «Canceled» / «Failed» |
| Open in {Chat/Node/Designer} → | `PlanCard.tsx:362-366` | `done` o `partial`, `plan.workspace !== workspace` y `plan.workspace !== 'chat'` | `ui.workspace` | `setUi({ workspace: plan.workspace })` | **Sale de Studio** al espacio completo de Nodes o Designer | En Studio `workspace` es `chat`, de modo que un plan de nodos o de Designer ofrece salir aunque el tablero tenga esas vistas. `WS_NAMES` incluye `Chat` pero nunca se muestra |
| Check status / Retry failed · $X (recuperación) | `PlanCard.tsx:325`, `RecoveryActions.tsx:18-45` | Estado `error` o `partial` y `planRecovery(item)` no es nulo (`planRun.ts:367-379`: no en planes de nodos y debe haber pasos reintentables) | `canRecheck`, `planRetryEstimate`, `overLimit` | Check status consulta al proveedor; si esa continuación lanza pasos nuevos, se compara el coste de esos pasos. Retry failed vuelve a cobrar por los pasos ejecutados | Reanuda el plan en la misma tarjeta | Si los pasos nuevos exceden el límite, el botón dice «Check once»; el reintento muestra «Continue once» y «Don’t ask again». Corregido en `1de23c1`: consultar trabajo ya enviado no se bloquea por el límite. Hay prueba automatizada (`tests/repro-cards-recovery.test.ts`); falta verlo en pantalla ([hallazgos](hallazgos.md), [R12](../rastreo/studio-2.md)). |

## Estado local de la tarjeta

- `item.skipped`, `item.status`, `stepStates`, `stepGenerations`, `stepAuthorizations`, `stepCostReviews`, `stepVariantNotes`, `comparisonKinds`, `nodeRun` viven en el elemento `plan` del feed (`updateFeedItem`).
- `showAdj`, `suggest` son estado de componente (`PlanCard.tsx:180-181`).
- Una ejecución de nodos (`item.nodeRun`) revalida su firma con `previewRun` y reescribe el plan y el precio si el grafo cambia (`PlanCard.tsx:152-156`), mostrando «Execution updated. Review before running.»

## Enlaces

- [[tarjeta-ajustes]] · [tarjeta-ajustes.md](tarjeta-ajustes.md)
- [[resultados]] · [resultados.md](resultados.md)
- [[dependencias]] · [dependencias.md](dependencias.md)
- [[hallazgos]] · [hallazgos.md](hallazgos.md)
- [[README]] · [Índice](README.md)

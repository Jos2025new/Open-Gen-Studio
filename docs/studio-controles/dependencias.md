---
type: mapa
title: Dependencias entre controles de Studio
description: Qué controles de Studio se influyen entre sí (modelo, proveedor, precio, aprobación, reescritura, continuidad, estilo, storyboard) y qué promesa toca cada cruce.
tags: [studio, dependencias, promesas]
updated: 2026-10-28
related: [composer, tarjeta-plan, tarjeta-ajustes, resultados, estado-compartido, hallazgos]
---
# Dependencias entre controles de Studio

Promesas del producto: **P1** el modelo o proveedor no cambia sin que el usuario pulse Cambiar; **P2** no se gasta por encima de lo mostrado; **P3** una alerta nunca afirma algo falso. La columna «Promesa tocada» dice cuál roza cada cruce y, con «cumple», «excepción documentada», «sin confirmar» o «hallazgo» (ver [hallazgos](hallazgos.md)), cómo queda. Todo sale de leer el código, no de ejecutarlo.

## Modelo del Composer, de la sesión y de la tarjeta

Tres capas: el Composer guarda el defecto global (`image/video/audio/model3d.modelRef`), la sesión recuerda la última elección explícita y la tarjeta de plan muestra el modelo de cada paso.

| Origen | Destino | Cómo se propaga | Promesa tocada |
| --- | --- | --- | --- |
| Popover de modelos del Composer ([composer](composer.md)) | Defecto del Composer y `userPicked[kind]` | `pickComposerModel` (`Composer.tsx:374`) | P1: elección explícita, cumple |
| Cambio automático de variante por adjuntos | `userPicked[kind]=true` | Reutiliza `pickComposerModel` | P1: hallazgo, queda marcado como elegido a mano sin que el usuario lo haya hecho |
| Modelo de la sesión (chips del plan o `applyComposerChoice`) | Sesión; opcionalmente el defecto del Composer | `rememberSessionModel`; solo empuja al Composer con `updateComposerDefaults` (defecto apagado, [barra-y-ajustes](barra-y-ajustes.md)) | P1: cumple con el defecto |
| Chips del plan ([tarjeta-plan](tarjeta-plan.md#chips-de-auto-plansettings)) | Pasos del plan y modelo de sesión | `ModelField`, `PlanSettings` | P1: cumple, es una acción explícita |
| Comparaciones | Nada | No cambian ni sesión ni defecto | P1: cumple |
| Director (Settings > Agent) | Todos los turnos del agente | Model/Tier; Tier limpia `modelPinned` | P1: cumple |

## Cambio de proveedor

| Origen | Destino | Cómo se propaga | Promesa tocada |
| --- | --- | --- | --- |
| Tarjeta Keep/Change (`switchSection`, `keepConfirmed`) | Modelo o proveedor del plan | Botón Cambiar | P1: cumple, es el único camino manual |
| «Proveedor que encaja» (`providerFit.betterProvider`, Auto) | Proveedor del paso | Cambio silencioso; no compara precio; la divulgación depende de la frase del agente (`features/agente-auto-tarjeta.md:34`) | P1: hallazgo, cambia sin pulsar Cambiar; P2: sin confirmar si el precio sube |
| Sin crédito de generación (`onGenerationCredit`) | Misma generación en otro proveedor | Reintento automático si el precio es menor o igual; avisa después | P1: excepción documentada (ADR 0025 regla C); P3: depende del texto del aviso, sin confirmar |
| Sin crédito del agente (`onAgentCredit`) | Director | Cambia el Director y fija `modelPinned: true` | P1: hallazgo, el comentario del campo dice «solo cuando el usuario fijó este modelo» (`store.ts:57`) |

### Sin crédito: cambio de proveedor

Orden observado en `credit.ts`: la generación fallida por crédito busca el mismo modelo en otro proveedor con precio menor o igual, lo relanza y avisa después; si no hay candidato, queda la alerta de crédito del Composer ([composer](composer.md)) o la fila de error ([resultados](resultados.md)). Para el agente el cambio es de Director. Rastreo ([4.1](../rastreo/studio-2.md)): en la generación el aviso coincide con el cambio por construcción (`credit.ts:126,155`); en el agente, con precios desconocidos dice «same price or less» sin saberlo (`credit.ts:199,206`): P3 respondido parcialmente, requiere prueba.

## Precio, crédito y presupuesto

| Origen | Destino | Cómo se propaga | Promesa tocada |
| --- | --- | --- | --- |
| Spending limit, Limit (USD) | `overLimit` | `budget.ts`; precios desconocidos no cuentan (`budget.ts:25-27`) | P2: hallazgo, el tooltip promete preguntar |
| Price margin | Revisión de paso (Continuar/Cancelar paso) | `priceAuthorization.ts` | P2: cumple con 5/25/50 %; con Off solo muestra la diferencia, por diseño |
| Aprobar por encima del límite | `Session.noAskOverLimit` (por sesión), `settings.budgetNoAsk` (app) y un pase de 4 s (`continueOnce`) | `continueOnce`, `dontAskAgain`, `askAgain` (`budget.ts`) | P2: H4 resuelto (2026-10-29): «Continue once» deja pasar solo esa acción; «Don’t ask again» vale para esa sesión; el interruptor de Settings > Budget lo hace global |
| Generar directo | `SpendConfirm` | `costLabel` | P2: cumple |
| Reescritura de prompt | `addSpend` categoría agente | Llamada LLM del agente | P2: hallazgo, el coste no se muestra antes |
| Cada revisión del plan (Edit, Suggest) | Turno LLM del agente | `llmTurn.ts` | P2/P3: el texto «nothing is spent» es cierto para generación, no para el turno LLM |
| Reset | `spentUsd=0`, `budgetAccepted=null`, `askAgain()` de la sesión activa | Settings > Budget | P2: cumple |

## Aprobación del plan

| Origen | Destino | Cómo se propaga | Promesa tocada |
| --- | --- | --- | --- |
| Approve | Ejecución del plan (`planRun.ts`) | Comprueba el límite de su sesión; si se pasa, la tarjeta ofrece «Continue once» / «Don’t ask again» | P2: ver arriba |
| Revisión de paso | Pausa del paso | Si el precio real supera el aprobado más el margen, espera Continuar o Cancelar paso | P2: cumple |
| Cancel en ejecución | `stopPlanRun` + `cancelGeneration` | Sin aviso | P2/P3: sin confirmar si el trabajo remoto sigue cobrando; «Dejar de seguir» sí avisa ([resultados](resultados.md)) |
| Check status (recuperación) | Reconsulta | Con el límite superado solo muestra un aviso (`RecoveryActions.tsx:23-30`) | Hallazgo: sin salida |

## Reescritura de prompt

«Ajustar prompt» (`planSettings.ts rewritePrompts`) reescribe los prompts de los pasos con el LLM del agente. Un modelo elegido durante la reescritura se aplica igualmente (gana la reescritura más nueva); solo el interruptor «Ajustar prompt» espera.

| Origen | Destino | Promesa tocada |
| --- | --- | --- |
| Interruptor Ajustar prompt | Prompts de cada paso | P2: la llamada se cobra como `agent` sin mostrar precio previo |
| Modelo cambiado durante la reescritura | Pasos | P1: cumple, es elección explícita |

## Estilo del agente

| Valor | Efecto en tarjetas | Promesa tocada |
| --- | --- | --- |
| Auto (defecto, `store.ts:263`) | `confirm_settings` se convierte en SettingsFeedItem en línea; los chips viven en la tarjeta de plan; `providerFit` activo | P1: ver proveedor |
| Guided | Rondas de preguntas hasta `guidedRounds` y tarjeta de ajustes | P1: cumple |
| Direct | Sin preguntas (`AgentControls.tsx:12`) | P2: el precio se muestra en el plan |

## Continuidad y estilo

`continuityErrors` (`planRun.ts:192-199`) detiene un paso cuyo sujeto o estilo no encaja con los anteriores; la tarjeta de plan muestra las líneas de sujetos y estilo ([tarjeta-plan](tarjeta-plan.md)). Qué parte fija el usuario y cuál el agente: respondido parcialmente en [huecos](huecos.md) (G3). Promesa tocada: P3, el texto del error de `continuityErrors` sin verificar; falso positivo conocido (A13), requiere prueba.

## Storyboard

El storyboard llega como tarjeta de preguntas del agente ([tarjeta-preguntas](tarjeta-preguntas.md)) según la documentación; no hay controles propios de storyboard leídos en el código de Studio. Promesa tocada: P2, cada plano generado cuenta como paso del plan con su precio.

## Estado tras el rastreo (2026-10-28)

Fuente: [rastreo de Studio](../rastreo/studio-2.md), contrastado con el código. «Respondido por lectura» no es arreglado ni prueba pasada; «sin decisión encontrada» no prueba que nunca se autorizara.

| Cruce | Estado | Nota | Fila |
| --- | --- | --- | --- |
| Cambio por crédito de generación y de agente | Respondido por lectura; requiere decisión (agente) | Deliberado en la generación (`4cf18aa`, ADR 0025 C); para el agente, sin confirmar; el del agente fija `modelPinned` y puede afirmar «same price or less» sin precio | R2, R3 |
| «Proveedor que encaja» (capacidad) | Respondido por lectura; requiere decisión | Sin decisión encontrada; no compara precio y puede subirlo; el proveedor nombrado en una petición anterior no se protege (`providerFit.ts:41-55`) | R1 |
| Cambio automático de variante por adjuntos | Respondido parcialmente; requiere decisión | Sigue marcando `userPicked` | R6 |
| Límite de gasto | Respondido por lectura; requiere decisión | Precios desconocidos ignorados (`budget.ts:25-27`); un presupuesto mostrado es estimación, no máximo | R7, R8 |
| Reescritura y revisiones del plan | Respondido por lectura; requiere decisión | Turnos LLM cobrados sin precio previo; «nothing is spent» falso en dinero con agente LLM | R9, R10 |
| Cancel con trabajo remoto | Respondido parcialmente; requiere prueba y pregunta al proveedor | Comportamiento de la app conocido; cobro real desconocido | R11 |
| Check status con límite superado | Respondido por lectura; requiere decisión | Sin vía de continuar | R12 |
| Reconfirmación de 0,50 USD en Auto | Respondido por lectura; requiere decisión | Quitada en `2120c71` (`procedure.ts:68-70`; texto al agente en `:93`); docs que la prometían se corrigen con una sección «Estado actual» | C1 |

## Enlaces

[README](README.md) · [composer](composer.md) · [tarjeta-plan](tarjeta-plan.md) · [tarjeta-ajustes](tarjeta-ajustes.md) · [resultados](resultados.md) · [estado-compartido](estado-compartido.md) · [hallazgos](hallazgos.md) · [huecos](huecos.md)

Wikilinks: [[composer]] · [[tarjeta-plan]] · [[tarjeta-ajustes]] · [[resultados]] · [[estado-compartido]] · [[hallazgos]] · [[huecos]]

---
type: inventario
title: Estado compartido de Studio
description: Campos del store, preferencias del tablero y estado local que tocan los controles de Studio, con línea, persistencia y defecto.
tags: [studio, estado, store]
updated: 2026-10-28
related: [dependencias, composer, tarjeta-plan, tablero]
---
# Estado compartido de Studio

`store.ts` es `src/store/store.ts`. Se muestra qué campo toca cada control y quién más lo lee. Persistencia: «store» es el estado persistido de la app, «localStorage» es solo del navegador, «local» se pierde al desmontar.

## Ajustes (`settings`)

| Campo | Línea | Defecto | Persistencia | Lo escriben | Lo leen |
| --- | --- | --- | --- | --- | --- |
| `agent.model`, `agent.provider`, `agent.tier` | `store.ts:57` | según motor | store | [barra-y-ajustes](barra-y-ajustes.md) (Engine, Tier, Model), `onAgentCredit` | Cada turno del Director |
| `agent.modelPinned` | `store.ts:57` | sin fijar | store | Elegir modelo (lo fija), Tier (lo limpia), `onAgentCredit` (lo fija) | Selección automática del Director; ver [hallazgos](hallazgos.md) Rastreo ([R2](../rastreo/studio-2.md)): `onAgentCredit` lo fija sin que el usuario elija; requiere decisión. |
| `agent.updateComposerDefaults` | Settings `:418-425` | apagado | store | Casilla de Settings | `rememberSessionModel` |
| `guidedRounds` | `store.ts:243` | 2 | store | Guided rounds | `roundsFor` ([tarjeta-preguntas](tarjeta-preguntas.md)) |
| `budgetOn` | `store.ts:245` | encendido | store | Spending limit | `overLimit`, [composer](composer.md), [tarjeta-plan](tarjeta-plan.md) |
| `budgetUsd` | `store.ts:244` | 25 | store | Limit (USD) | Igual |
| `budgetAccepted` (solo lectura, antiguo) · `budgetNoAsk` · `Session.noAskOverLimit` | `store.ts` / `types.ts` | `undefined` | store (ajustes y sesión) | `dontAskAgain` (sesión), interruptor de Settings (app), Reset; un `budgetAccepted` guardado vale como `budgetNoAsk` mientras `budgetUsd` no cambie | `overLimit` (`overLimitAccepted`) |
| `priceMargin` | `store.ts:65` | 25 % (`priceMargin()`) | store | Price margin | `priceAuthorization.ts` |

## Composer (`ComposerState`, `store.ts:74`)

| Campo | Línea | Defecto | Lo escriben | Lo leen |
| --- | --- | --- | --- | --- |
| `agentStyle` | `store.ts:76,263` | `auto` | Selector de estilo en [composer](composer.md) | Despacho de turnos, `roundsFor`, tarjetas |
| `mode` | `store.ts:75` | agente | Menú «+» | Qué controles dibuja el Composer |
| `text` | `store.ts:79` | vacío | Caja de prompt | Envío; con tarjeta abierta cambia el significado ([hallazgos](hallazgos.md)) |
| `image/video/audio/model3d.modelRef` + `settings` | `store.ts:80-85` | modelo por defecto | Popover de modelos, `pickComposerModel`, variante por adjuntos | Generación directa, el agente como defecto |
| `userPicked[kind]` | `store.ts:88` | sin marcar | `pickComposerModel` | `applyComposerChoice`; también lo marca el cambio automático de variante por adjuntos |
| `attachments`, `times` | `store.ts:86,92` | vacíos | Clip, arrastre, pegado | Envío, modelos de fotograma clave |
| `videoRoutes` | `store.ts:90` | sin ruta | Rutas por forma de entrada | Enrutado del vídeo del agente |

## Interfaz (`UiState`, `store.ts:120`)

| Campo | Defecto | Lo escriben | Lo leen |
| --- | --- | --- | --- |
| `workspace` | `chat` (Studio) | Switch workspace, `continue_in_*` | `App.tsx:75-77` |
| `home` | falso | Home, Esc, destinos | `homeGuard`, Back to |
| `settingsOpen`, `panel` | falso / ninguno | Settings, enlace Spending | Esc de Home |
| `spentUsd`, `spendLog`, `quotes` | `store.ts:187-191` | `addSpend` (incluye el agente y la reescritura de prompts) | Spent, `overLimit`, SpendingPanel |
| `homeDrafts` | vacío | Prompt de Home | Home |

## Estado del agente por sesión (`AgentState`, `engine/types.ts:903`)

`history`, `pending`, `settings`, `settingsParts`, `switchedTo`, `draftMode`, `enhance`, `questionRound`, `notes`, `busy`, `phase`, `waiting`, `revising`, `draft`, `canvas`, `parked`. Resumen de quién los usa:

| Campo | Qué guarda | Lo usan |
| --- | --- | --- |
| `pending` | Tarjeta pendiente (plan, ajustes o preguntas) | [tarjeta-plan](tarjeta-plan.md), [tarjeta-ajustes](tarjeta-ajustes.md), [tarjeta-preguntas](tarjeta-preguntas.md) |
| `settings` / `settingsParts` | Ajustes confirmados y sus partes | Chips del plan, tarjeta de ajustes |
| `switchedTo` | Modelo o proveedor al que se cambió | Tarjeta Keep/Change |
| `draftMode`, `enhance` | Borrador y mejora de prompt | PlanSettings, «Ajustar prompt» |
| `questionRound` | Ronda de preguntas en curso | `roundsFor` |
| `busy`, `phase`, `waiting`, `revising` | Estado del turno | Stop, Send, ActivityBlock, tarjeta de plan |
| `canvas`, `parked` | Lienzo del agente y trabajo aparcado | `open_board`, `continue_in_*` |

## Preferencias del tablero (`lib/studioBoard.ts`)

| Campo | Defecto | Persistencia | Notas |
| --- | --- | --- | --- |
| `open` | verdadero | localStorage `ogs:studio-board` | Cerrado solo si se guardó `false` |
| `width` | 400, entre 300 y 640 (hasta 60 % de la ventana) | Igual | Se recorta al cambiar el tamaño de la ventana |
| `view` | `assets` | Igual | `nodes` o `designer` si se guardaron |

## Alertas

`engine/alerts.ts` y `useAlerts`: máximo 3, sin duplicados (`pushAlert`, `:23`). Quién las genera está en [composer](composer.md) y [resultados](resultados.md).

## Designer

El Designer embebido comparte el estado de su propia matriz: ver [estado compartido del Designer](../designer-controles/estado-compartido.md) y [estudio embebido](../designer-controles/estudio-embebido.md).

## Enlaces

[README](README.md) · [dependencias](dependencias.md) · [hallazgos](hallazgos.md) · [huecos](huecos.md)

Wikilinks: [[dependencias]] · [[composer]] · [[tarjeta-plan]] · [[tablero]] · [[hallazgos]] · [[huecos]]

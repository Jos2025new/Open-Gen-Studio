---
type: inventario
title: Tarjeta de preguntas
description: Tarjeta de preguntas del agente, una pregunta a la vez, con opciones, respuesta propia, saltar, plan ya y edición posterior.
tags: [studio, preguntas, agente]
updated: 2026-10-28
related: [tarjeta-ajustes, tarjeta-plan, composer, dependencias]
---
# Tarjeta de preguntas

`QuestionsCard` (`QuestionsCard.tsx:17`) se despacha en `FeedList.tsx:169-170`. La crea el agente con `ask_questions` (`llmTurn.ts:290-323`). Cuántas rondas caben depende del estilo: `roundsFor(style, settings.guidedRounds)`; en Auto es una tarjeta «for what changes the result or cost» (`llmTurn.ts:293`); agotadas las rondas el agente recibe «Question rounds are used up» y debe proponer el plan (`llmTurn.ts:294-297`). En Direct no se hacen preguntas (`AgentControls.tsx:12`).

Columnas: Control | Dónde | Cuándo | De qué depende | Qué modifica | Influye en | Notas.

| Control | Dónde | Cuándo | Depende de | Modifica | Influye en | Notas |
| --- | --- | --- | --- | --- | --- | --- |
| Contador «n/N» y «Round r of R» | `QuestionsCard.tsx:99-104` | Más de una pregunta o más de una ronda | `item.questions`, `item.maxRounds` | — | — | Una pregunta por pantalla (nota del 2026-10-25, `QuestionsCard.tsx:38`) |
| Introducción | `QuestionsCard.tsx:105` | Solo en la primera pregunta y si hay `item.intro` | — | Se despliega con clic si está cortada (`ClampText`) | — | — |
| Opciones cortas (control segmentado) | `QuestionsCard.tsx:109-124` | Ninguna etiqueta supera 28 caracteres (`LONG_OPTION`, `QuestionsCard.tsx:15`) | `q.options`, `q.multi`, `q.default` | `toggle`: una opción (segunda pulsación la quita) o varias (`QuestionsCard.tsx:60-67`) | Respuesta | El valor por defecto del agente llega ya marcado (`QuestionsCard.tsx:25`); «Continue» acepta lo recomendado. Opciones con formato «etiqueta: detalle» enseñan el detalle como línea tenue (`optionParts`, `QuestionsCard.tsx:10-13`) |
| Opciones largas (filas con detalle) | `QuestionsCard.tsx:125-141` | Alguna etiqueta supera 28 caracteres | Igual | Igual | Respuesta | El tooltip trae la opción completa si tiene detalle |
| Otra respuesta… (enlace) → campo «Escribe tu respuesta…» | `QuestionsCard.tsx:143-160` | `q.allowCustom` (por defecto verdadero, `llmTurn.ts:316`) | `custom[q.id]` | `setCustom`; en preguntas de opción única, escribir borra la opción marcada (`QuestionsCard.tsx:154`). Intro avanza si hay respuesta | Respuesta | Textos en español en una tarjeta de textos en inglés (ver [hallazgos](hallazgos.md)) |
| ← «Previous question» | `QuestionsCard.tsx:163` | `step > 0` | — | Vuelve y des-salta la anterior (`QuestionsCard.tsx:95`) | — | — |
| Skip question | `QuestionsCard.tsx:164` | Más de una pregunta | — | Marca la pregunta como saltada y avanza o termina | Respuestas enviadas | «Leave this question out» |
| Plan now | `QuestionsCard.tsx:166-168` | Siempre | — | `skipQuestions` (`conversation.ts:199-215`): estado `skipped`, `questionRound = guidedRounds`, responde al agente «The user skipped the questions. Use sensible defaults and call propose_plan now.» y relanza el turno | El agente propone el plan con valores por defecto | Un turno de LLM de agente; no aprueba ni gasta en generación |
| Continue → | `QuestionsCard.tsx:169-171` | Deshabilitado sin respuesta en esa pregunta (`has`) | `answers`, `custom` | Avanza; en la última llama a `submitAnswers` o, si no queda ninguna respuesta, a `skipQuestions` (`QuestionsCard.tsx:85`) | `submitAnswers` (`conversation.ts:171-196`): estado `answered`, el agente recibe las respuestas y se relanza | Etiqueta siempre «Continue» (también en la última pregunta) |
| Resumen respondido (`Questions · round r of R · answered/skipped`) | `QuestionsCard.tsx:42-57` | `item.status !== 'pending'` | `item.answers` | — | — | Lista pregunta y respuesta, y «Note» si el usuario escribió en el compositor |
| Edit (tras responder) | `QuestionsCard.tsx:48`, `EditAnswerButton.tsx` | Igual que en [ajustes](tarjeta-ajustes.md#resumen-tras-confirmar-o-saltar) | — | `reopenCard` | Chat y contexto del agente | La tarjeta reabierta parte de las respuestas anteriores (`QuestionsCard.tsx:21-34`) |
| Escribir en el compositor con la tarjeta abierta | `conversation.ts:51-54` | `pending.kind === 'questions'` | — | `submitAnswers(..., { note: texto }, 'typed')` | Responde la tarjeta con la nota | La tarjeta queda respondida solo con `{ note }` (`conversation.ts:52`, `submitAnswers` guarda `answers: { note }`, `conversation.ts:176`): las opciones marcadas en pantalla, incluidas las recomendadas, no se envían (ver [hallazgos](hallazgos.md)) |

## Enlaces

- [[tarjeta-ajustes]] · [tarjeta-ajustes.md](tarjeta-ajustes.md)
- [[composer]] · [composer.md](composer.md)
- [[dependencias]] · [dependencias.md](dependencias.md)
- [[README]] · [Índice](README.md)

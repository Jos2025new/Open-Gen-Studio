---
type: hallazgos
title: Hallazgos del inventario de Studio
description: Inconsistencias, promesas en riesgo y código sin alcanzar encontrados al leer Studio; solo informe, sin cambios de código.
tags: [studio, hallazgos, promesas]
updated: 2026-10-28
related: [dependencias, huecos, composer, tarjeta-plan]
---
# Hallazgos del inventario de Studio

Solo informe. Todo viene de leer el código; nada se ejecutó. Gravedad según el criterio del proyecto: promesa rota, entregable equivocado o fricción de uso son críticos. P1, P2 y P3 son las promesas de [dependencias](dependencias.md).

## Promesas en riesgo

| N.º | Promesa | Hallazgo | Evidencia | Estado |
| --- | --- | --- | --- | --- |
| H1 | P1 | «Proveedor que encaja» cambia el proveedor del paso en Auto sin pulsar Cambiar y sin comparar precio; la divulgación depende de la frase del agente | `providerFit.betterProvider`; `features/agente-auto-tarjeta.md:34` | Crítico, documentado como diseño |
| H2 | P1 | El cambio automático de variante por adjuntos marca `userPicked[kind]=true` como si el usuario lo hubiera elegido | `Composer.tsx:374` | Crítico |
| H3 | P1 | `onAgentCredit` cambia el Director y fija `modelPinned: true`, pero el comentario del campo dice que solo lo fija el usuario | `credit.ts`; `store.ts:57` | Crítico |
| H4 | P2 | Aprobar por encima del límite llama a `acceptOverLimit` global: las siguientes ejecuciones dejan de preguntar hasta Reset o cambio de límite | `budget.ts`; nota en `SettingsPanel.tsx:516` | Crítico, la nota lo avisa |
| H5 | P2 | El tooltip del límite dice que una ejecución que lo pasa pregunta antes, pero `overLimit` ignora precios desconocidos | `budget.ts:24`; `SettingsPanel.tsx:460` | Crítico |
| H6 | P2 | «Ajustar prompt» llama al LLM del agente y suma gasto sin mostrar su precio antes | `planSettings.ts rewritePrompts` | Crítico |
| H7 | P3 | El texto «nothing is spent» de Suggest/Edit es cierto para generación, pero cada revisión es un turno LLM que cuesta | `PlanCard.tsx` (edición), `llmTurn.ts` | Crítico, aviso falso por omisión |
| H8 | P2 | Cancel en ejecución llama `stopPlanRun` y `cancelGeneration` sin aviso; un trabajo remoto puede seguir cobrando, mientras «Dejar de seguir» sí avisa | `PlanCard.tsx:189` | Sin confirmar el cargo del proveedor |
| H9 | Fricción | Con el límite superado, «Check status» solo muestra un toast con el texto del límite y no hay forma de continuar | `RecoveryActions.tsx:23-30`; `planRun.ts:388` | Crítico, callejón sin salida |

## Entregables equivocados o pérdida de entrada

| N.º | Hallazgo | Evidencia |
| --- | --- | --- |
| H10 | Escribir en el Composer con una tarjeta de preguntas abierta envía solo `{note}` y descarta las selecciones en pantalla, incluidos los valores recomendados | `conversation.ts:51-54` |
| H11 | Escribir con una tarjeta de ajustes abierta la cierra como «skipped» sin confirmar | `conversation.ts` |
| H12 | «Open in Node» y «Open in Designer» del plan salen de Studio aunque el tablero ya tiene esas vistas | `PlanCard.tsx:362` |
| H13 | «Otra cosa…» existe en la tarjeta de ajustes pero no en el interruptor de borrador del plan | `tarjeta-ajustes.md`, `tarjeta-plan.md` |

## Código sin alcanzar o desfasado

| N.º | Hallazgo | Evidencia |
| --- | --- | --- |
| H14 | `FollowUpCard` no se alcanza para tarjetas nuevas: el único `switchSection` pasa `follow=undefined`; la documentación dice que se retiró en Auto el 2026-10-24 | `llmTurn.ts:280` |
| H15 | El interruptor «Show the other canvases too» de FeedList nunca aparece en Studio: `studioCanvases` incluye los tres lienzos | `FeedList.tsx:202-206` |
| H16 | `ModeMenu` se exporta pero no se monta; solo se usa `MODES` | `ComposerOptions`, `SpacePanel` |
| H17 | El botón Select del SpaceBoard de Studio marca fichas, pero el bloque «Actions suggested» que las consume está desactivado con `studio` | `SpaceBoard.tsx:154` |
| H18 | `studio.md` dice «Large/Small funciona también en Studio», pero el código tiene un deslizador «Tile size» y no existen Large ni Small | `tablero.md`, `docs/features/studio.md` |

## Textos

| N.º | Hallazgo |
| --- | --- |
| H19 | Interfaz mezclada en español e inglés: Continuar, Cancelar paso, Necesita revisión, Ajustar prompt, Cambiar, Dejar de seguir, Mejorar esta toma, Borrador/Alta calidad, «Otra respuesta…», CaptureChip, frente al resto en inglés |

## Enlaces

[README](README.md) · [dependencias](dependencias.md) · [huecos](huecos.md) · [composer](composer.md) · [tarjeta-plan](tarjeta-plan.md)

Wikilinks: [[dependencias]] · [[huecos]] · [[composer]] · [[tarjeta-plan]]

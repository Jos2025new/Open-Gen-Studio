---
type: huecos
title: Huecos del inventario de Studio
description: Lo que no se pudo confirmar o no se leyó línea a línea al inventariar Studio, para cerrarlo en una pasada posterior.
tags: [studio, huecos]
updated: 2026-10-29
related: [hallazgos, dependencias, estado-compartido]
---
# Huecos del inventario de Studio

Inventario contrastado con el [rastreo de Studio](../rastreo/studio-2.md), hallazgos, commits y pruebas. La pasada anterior del 2026-10-29 quedó fijada a `task/workflow-ask-first` HEAD `a41bf38` y revisó `cc16a1b`, `80ca898`, `75dc572`, `df8bc05` y `1de23c1`; esa pasada no ejecutó pruebas ni la app. Esta revisión cotejó las notas con la sesión Claude `920d568f-fe5e-444c-b5b7-a63843d5989b`, sus subagentes indicados y [las reproducciones del 2026-10-29](../audits/repro-2026-10-29.md), además de leer el código actual. No ejecutó tests, app ni proveedor. «Prueba existente» no significa ejecutada en esta pasada; código, test automatizado, prueba visual y confirmación del proveedor son evidencias distintas. No encontrar una decisión no demuestra que nunca se diera.

## Qué queda abierto

**Límite: concurrencia por comprobar.** `withOncePass` identifica la sesión mientras una acción se prepara; otra comprobación solapada en esa sesión podría ver el mismo pase. `tests/once-pass.test.ts` cubre el pase de una sola acción, pero no acredita una prueba concurrente. La coincidencia por lectura no demuestra un gasto: reproducir con proveedor simulado antes de decidir el alcance del arreglo.

- **Pruebas visuales pendientes**: tarjeta única de Auto con el agente y su velocidad ([053](../history/053-2026-10-W43.md)); tarjeta de ajustes al escribir (H11; cerrar como `skipped` es el diseño, falta observar la interacción); «Check status» con el límite superado (H9: `1de23c1` y `tests/repro-cards-recovery.test.ts` cubren lógica, no pantalla); etiqueta tras cambio de proveedor por crédito (A2) y aviso «same price or less» con precios desconocidos (R3); textos del límite en pantalla (solo se vio `Price n/a`, explicación de coste real, `Budget left $0` y «Continue anyway · n/a» en una ejecución sin iniciar); selectores de nodo con `edit_region` y `remove_object` (ofrecidos según código/rastreo 5.8, no verificados visualmente). La tarjeta de preguntas al escribir sí se vio en sandbox: en la prueba local el texto exacto enviado no era visible; en otra prueba con agente real, el historial registró la opción recomendada y la nota. La opción pulsada tiene prueba automatizada; no consta su prueba en pantalla ([auditoría](../audits/repro-2026-10-29.md)).
- **Decisiones aún pendientes o no localizadas**: cambio de proveedor por capacidad (`providerFit.ts:41-55`, no se encontró decisión y puede subir el precio); `modelPinned` por crédito; precio previo de la reescritura y de las revisiones; «nothing is spent» (R9/H7, motor local sin confirmar); alcance del aviso al cancelar un plan en marcha (H8; el cobro del proveedor no se verificó). La reconfirmación de 0,50 USD fue retirada en `2120c71`, pero sigue pendiente decidir la discrepancia con el ADR 0009; el callejón de Check status se corrigió en `1de23c1` y falta verlo en pantalla.
- **Otras decisiones o revisiones sin cerrar**: la marca `userPicked` al cambiar variante por adjuntos (H2); escribir en el Composer y cerrar la tarjeta de ajustes como `skipped` (H11); aviso de crédito sin comparación fiable de unidades (R4); deuda de `FollowUpCard` y `switchedTo` (H14); aviso «same price or less» con precio desconocido (R3); enmiendas pendientes de ADR 0007 y 0009 y estado propuesto de ADR 0005, 0006, 0008 y 0009.
- **Preguntas al proveedor**: si cancelar con trabajo remoto en curso cobra la estimación (B1, G1).

## Sin confirmar

| N.º | Duda | Estado | Respuesta | Por qué importa |
| --- | --- | --- | --- | --- |
| G1 | Si cancelar un plan con un trabajo remoto en curso sigue cobrando en el proveedor | Respondido parcialmente; requiere prueba y pregunta al proveedor | La app aborta en local y conserva `remoteJob` (`jobs.ts:666-668`); su texto admite que el proveedor cobra la estimación (`StopFollowing.tsx:13`). El cobro real no consta ([rastreo 4.1](../rastreo/studio-2.md)) | Promesa P2 ([hallazgos](hallazgos.md), H8) |
| G2 | Si el texto de los avisos de crédito coincide con el cambio realizado | Respondido por lectura (generación); respondido parcialmente (agente); requiere prueba | Generación: coincide por construcción (`credit.ts:126,155`). Agente: con precios desconocidos dice «same price or less» sin saberlo (`credit.ts:199,206`, R3) ([rastreo 4.1](../rastreo/studio-2.md)) | Promesa P3 ([dependencias](dependencias.md#sin-crédito-cambio-de-proveedor)) |
| G3 | Qué parte del estilo y de la continuidad fija el usuario y cuál el agente | Respondido parcialmente | El agente escribe `style` una vez y la app lo añade (`continuity.ts:103`); el usuario fija lo que pide o adjunta; las líneas Keep ya no se muestran. Texto del error de `continuityErrors` sin verificar ([rastreo 4.1](../rastreo/studio-2.md)) | Cruce «continuidad y estilo» |
| G4 | Si `providerFit.betterProvider` sube alguna vez el precio mostrado | Respondido por lectura; requiere decisión | Sí puede: no compara precios (`providerFit.ts:41-55`); el usuario ve una tarjeta antes de aprobar, que es una estimación y no un máximo; el cambio ocurre antes de confirmar los ajustes (`autoSettings.ts:42-57`), pero que el precio de la tarjeta use el proveedor ya cambiado está sin confirmar ([rastreo R1](../rastreo/studio-2.md)) | H1 |

## Sin inventariar línea a línea

| Pieza | Qué falta |
| --- | --- |
| `TextTile` y `TextResult` | Leídos en código (`src/components/assets/TextTile.tsx`, `TextResult.tsx`): la baldosa abre `textView`, presenta el resultado compacto y ofrece Reuse; el resultado permite copiar, usar como prompt y, según modelo/operación, usar como letra. Sin prueba visual en esta pasada. |
| `nodes.tsx` | Controles propios de cada tipo de nodo |
| `AssetActions` | Formularios internos de cada operación |
| `MediaControls` y `StyleFields` | Campos dinámicos por modelo, no enumerados |
| `canvasCalls.ts` | Leído parcialmente: `recover_plan` busca el plan fallido/parcial, valida con `planRecoveryProblem` y lanza `resumePlan` en segundo plano; `run_nodes` bloquea errores y presenta revisión antes de correr. El cuerpo específico de `continue_in_*` sigue sin inventariar línea a línea (ver [tablero](tablero.md)). |
| Nodes | Manejador de deshacer y rehacer |
| Barra y paneles | `SessionSwitcher`, `SessionsPanel`, `GenerationsPanel`, `ProviderPool` y las pestañas Providers, Operations, Look, Keys y Data de Settings |
| Estudio embebido | Se enlaza a [estudio-embebido](../designer-controles/estudio-embebido.md), no se repite |
| `ThreadPeek` | No se muestra en Studio, solo en lienzos que no son chat |
| Storyboard y continuidad | Solo `planRun.ts:192-199`, las líneas de sujetos y estilo del plan y la tarjeta de preguntas según la documentación |

## Enlaces

[README](README.md) · [hallazgos](hallazgos.md) · [dependencias](dependencias.md) · [estado-compartido](estado-compartido.md)

Wikilinks: [[hallazgos]] · [[dependencias]] · [[estado-compartido]]

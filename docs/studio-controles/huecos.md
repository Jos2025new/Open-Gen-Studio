---
type: huecos
title: Huecos del inventario de Studio
description: Lo que no se pudo confirmar o no se leyó línea a línea al inventariar Studio, para cerrarlo en una pasada posterior.
tags: [studio, huecos]
updated: 2026-10-28
related: [hallazgos, dependencias, estado-compartido]
---
# Huecos del inventario de Studio

Lectura de código solamente: no se arrancó la app ni el sandbox. Respuestas del [rastreo de Studio](../rastreo/studio-2.md) (2026-10-28), verificadas contra el código. «Respondido por lectura» no es arreglado ni prueba pasada; no encontrar una decisión no demuestra que nunca se diera.

## Qué queda abierto

**Límite: concurrencia por comprobar.** `withOncePass` identifica la sesión mientras una acción se prepara; otra comprobación solapada en esa sesión podría ver el mismo pase. La coincidencia por lectura no demuestra un gasto: reproducir con proveedor simulado antes de decidir el alcance del arreglo.

- **Pruebas en sandbox** (sin gasto ni datos reales): la tarjeta única de Auto con el agente real y su velocidad ([053](../history/053-2026-10-W43.md)); texto escrito con una tarjeta abierta (H10, H11); «Check status» con el límite superado (H9); etiqueta de proveedor tras cambiar por crédito (A2); aviso «same price or less» con precios desconocidos (R3); textos del límite en pantalla; «Check status» con el límite superado en pantalla (R12); duplicar un nodo o soltar el cable en el fondo pierde `outputIndex` (corregido en 91ea576; visto en sandbox con gasto real, 0,15 USD); selectores de nodo que aún ofrecen `edit_region` y `remove_object` (rastreo 5.8); si el motor local de revisión gasta algo (R9, sin confirmar).
- **Decisiones del usuario**: cambio de proveedor por capacidad (`providerFit.ts:41-55`, sin decisión encontrada, puede subir el precio); `modelPinned` por crédito; límite con precios desconocidos (`budget.ts:25-27`); aceptar el límite como global; precio de la reescritura y de las revisiones; reconfirmación de 0,50 USD en Auto (quitada en `2120c71`); «nothing is spent»; callejón de Check status.
- **Decisiones adicionales**: el cambio de variante por adjuntos marca `userPicked` (R6, H2); escribir en el Composer cierra la tarjeta de ajustes como `skipped` (R13, H10, H11); alerta de crédito de generación sin tope ni marca «pricier» para unidades de precio distintas (R4); cancelar un plan en marcha sin aviso de cobro (R11, H8); deuda de `FollowUpCard` y `switchedTo` (R14, H14); «same price or less» con precios desconocidos (R3); enmienda a 0007 (9) «una vez por sesión» en Auto (`cd15ef0`) y «modelo confirmado solo en chat» (ADR 0009); estado «Propuesto» de los ADR 0005, 0006, 0008 y 0009.
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
| `TextTile` y `TextResult` | No se leyeron |
| `nodes.tsx` | Controles propios de cada tipo de nodo |
| `AssetActions` | Formularios internos de cada operación |
| `MediaControls` y `StyleFields` | Campos dinámicos por modelo, no enumerados |
| `canvasCalls.ts` | Cuerpo de `continue_in_*` sin leer por líneas |
| Nodes | Manejador de deshacer y rehacer |
| Barra y paneles | `SessionSwitcher`, `SessionsPanel`, `GenerationsPanel`, `ProviderPool` y las pestañas Providers, Operations, Look, Keys y Data de Settings |
| Estudio embebido | Se enlaza a [estudio-embebido](../designer-controles/estudio-embebido.md), no se repite |
| `ThreadPeek` | No se muestra en Studio, solo en lienzos que no son chat |
| Storyboard y continuidad | Solo `planRun.ts:192-199`, las líneas de sujetos y estilo del plan y la tarjeta de preguntas según la documentación |

## Enlaces

[README](README.md) · [hallazgos](hallazgos.md) · [dependencias](dependencias.md) · [estado-compartido](estado-compartido.md)

Wikilinks: [[hallazgos]] · [[dependencias]] · [[estado-compartido]]

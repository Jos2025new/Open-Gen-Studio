---
type: huecos
title: Huecos del inventario de Studio
description: Lo que no se pudo confirmar o no se leyó línea a línea al inventariar Studio, para cerrarlo en una pasada posterior.
tags: [studio, huecos]
updated: 2026-10-28
related: [hallazgos, dependencias, estado-compartido]
---
# Huecos del inventario de Studio

Lectura de código solamente: no se arrancó la app ni el sandbox. Lo que sigue queda sin confirmar o sin inventariar.

## Sin confirmar

| N.º | Duda | Por qué importa |
| --- | --- | --- |
| G1 | Si cancelar un plan con un trabajo remoto en curso sigue cobrando en el proveedor | Promesa P2 ([hallazgos](hallazgos.md), H8) |
| G2 | Si el texto de los avisos de crédito coincide con el cambio realizado | Promesa P3 ([dependencias](dependencias.md#sin-crédito-cambio-de-proveedor)) |
| G3 | Qué parte del estilo y de la continuidad fija el usuario y cuál el agente | Cruce «continuidad y estilo» |
| G4 | Si `providerFit.betterProvider` sube alguna vez el precio mostrado | H1 |

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

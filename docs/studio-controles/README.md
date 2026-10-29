---
type: index
title: Controles de Studio: matriz de estado actual
description: Índice de las notas que inventarían cada control de Studio leído del código, con archivo y línea, cuándo aparece, de qué depende y qué modifica.
tags: [studio, controles, indice]
updated: 2026-10-28
related: [dependencias, estado-compartido, hallazgos, huecos]
---
# Controles de Studio: estado actual

Studio es el lienzo `chat` (`App.tsx:75-77`): chat y agente en el centro, tablero a la derecha. Una nota por superficie, con el mismo modelo que [Controles del Designer](../designer-controles/README.md). Cada fila lleva: **Control/función**, **Dónde aparece** (`archivo:línea`), **Cuándo aparece**, **De qué depende**, **Qué modifica**, **Influye en** y **Notas**. Los nombres son los de la interfaz. Inventario de lectura de código: nada se ejecutó.

Promesas que se vigilan: el modelo o proveedor no cambia sin que el usuario pulse Cambiar; no se gasta por encima de lo mostrado; las alertas no afirman algo falso.

## Superficies y totales

| Superficie | Nota | Filas | Contenido |
| --- | --- | --- | --- |
| Tablero | [[tablero]] · [tablero.md](tablero.md) | 36 | Marco, divisor, pestañas, Generations, Nodes y Designer embebidos, apertura automática |
| Chat | [[chat-estudio]] · [chat-estudio.md](chat-estudio.md) | 24 | Estado vacío, lista, mensajes, actividad, avisos |
| Composer | [[composer]] · [composer.md](composer.md) | 42 | Prompt, adjuntos, menú «+», estilo del agente, modelos, envío, modos directos y alertas |
| Tarjeta de plan | [[tarjeta-plan]] · [tarjeta-plan.md](tarjeta-plan.md) | 44 | Chips de Auto, pasos, revisión de coste, Approve/Cancel, recuperación |
| Tarjeta de ajustes | [[tarjeta-ajustes]] · [tarjeta-ajustes.md](tarjeta-ajustes.md) | 13 | Confirm settings, Keep/Change, resumen |
| Tarjeta de preguntas | [[tarjeta-preguntas]] · [tarjeta-preguntas.md](tarjeta-preguntas.md) | 12 | Una pregunta por vez, respuesta propia, saltar |
| Resultados | [[resultados]] · [resultados.md](resultados.md) | 26 | Fila compacta, avisos, Mejorar, Regenerar, Dejar de seguir |
| Atajos y gestos | [[atajos-gestos]] · [atajos-gestos.md](atajos-gestos.md) | 28 | Teclado y gestos propios de Studio |
| Barra y ajustes | [[barra-y-ajustes]] · [barra-y-ajustes.md](barra-y-ajustes.md) | 23 | Barra superior y pestañas Agent y Budget |
| **Total** | | **248** | Nueve notas de superficie |

## Notas transversales

| Nota | Contenido |
| --- | --- |
| [[dependencias]] · [dependencias.md](dependencias.md) | Mapa de cruces (modelo, proveedor, precio, aprobación, reescritura, estilo, continuidad, storyboard) con la promesa tocada |
| [[estado-compartido]] · [estado-compartido.md](estado-compartido.md) | Campos del store, preferencias del tablero y estado del agente, con línea y defecto |
| [[hallazgos]] · [hallazgos.md](hallazgos.md) | 19 hallazgos: promesas en riesgo, entradas perdidas, código sin alcanzar y textos |
| [[huecos]] · [huecos.md](huecos.md) | Lo no confirmado y lo no inventariado línea a línea |

## Relacionado

[Estudio embebido del Designer](../designer-controles/estudio-embebido.md) · [Studio (feature)](../features/studio.md)

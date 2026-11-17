---
type: diagnostic
title: Diagnóstico — cada pieza de cada espacio como nodo tipado
description: Lectura de código (Sonnet, 2026-11-17, sin ejecutar) de qué piezas de la interfaz son ya nodos, cuáles son espejos y qué falta
tags: [nodes, diagnostico, todo-es-un-nodo]
updated: 2026-11-17
---

# Diagnóstico: piezas de cada espacio como nodos

Lectura de código hecha por un Sonnet el 2026-11-17, sin ejecutar nada, a petición del usuario. Objetivo: cada pieza de cada espacio puede ser un nodo tipado y agrupar es unirlas bajo un marco tipado, sin cambiar lo que se ve. Antes solo existía el inventario de comandos del 2026-11-12, no uno de piezas. Es evidencia de lectura, no de pantalla.

## Hallazgo clave

Los 9 nodos del sistema (`graphTypes.ts:9`) son **espejos**. `resolveSystemNodeLive` (`spec.ts:~255-433`) y `omniSpaceLive` (`omniLive.ts:17`) solo leen el store; solo escriben `setSpaceParam` (`omni.ts:~170`) y `attachModelToNode` (`system.ts:344`). El nodo agent o chat tiene `ref = sessionId`, así que es la sesión (`system.ts:78,85`). Solo los nodos de datos de Nodes son fuente de verdad.

## Tabla por espacio

| Espacio | Pieza | Dónde vive | Nodo hoy | Qué falta |
| --- | --- | --- | --- | --- |
| Studio | chat | `ChatWorkspace.tsx:17`, `session.feed` | chat, espejo | un nodo dueño del feed |
| Studio | agente | `AgentControls.tsx:104`, `settings.agent` global | agent/model/provider, espejo | que cada agente tenga su proveedor y su modelo |
| Studio | composer | `composer.text` (`store.ts:~201`) | ninguno | un nodo `prompt` |
| Studio | aspecto/estilo/cantidad | `AspectChoices`, `StyleFields`, `MediaControls`, `composer.*.settings` | ninguno | un nodo de ajustes de medio por tipo |
| Studio | space board | `SpaceBoard.tsx:27` | espejo | un nodo board |
| Studio | registro de generaciones | `GenerationsPanel.tsx:25` | ninguno | un nodo log |
| Studio | historial de prompts | `PromptHistory.tsx:40` (IndexedDB) | ninguno | – |
| Nodes | lienzo | `NodeWorkspace.tsx:547` | fuente de verdad | menús y paneles de selección sin nodo |
| Designer | doc | `designer.doc` | espejo | `layer` como nodo; paneles (Layers, FX, Export, Brush…) |
| Home y herramientas | home, tools | `HomeView.tsx:87`, `ToolsPanel.tsx:26` | toolset, espejo de OPS | – |
| Shell | barra lateral, sesiones, TopBar | – | session, espejo | el resto sin nodo |
| Ajustes | ajustes | `SettingsPanel.tsx:27`, `settings` | provider, espejo de `catalog.status`; no guarda claves | un nodo de ajustes generales |
| Galería | biblioteca | – | library, espejo | – |

## Varios agentes

`ChatMessageMeta` (`feedMeta.ts:11`) guarda agent, provider, model, usage, coste y runId, pero `agent` es la cadena fija 'Director' (`runtimeShared.ts:62-69`). Hoy no hay varios agentes por chat: `agentEngine()` lee el global (`runtimeShared.ts:104`), hay un solo `AgentState` por sesión (`types.ts:847`) y `attachModelToNode` toma el primer agente (`system.ts:359`).

Proveedor y agente están mezclados en `settings.agent` (`storeTypes.ts:12`); cambiar de proveedor reescribe el modelo (`AgentModelControls.tsx:58`).

No hay caja de texto independiente: el agente solo lee `composer.text` (`conversation.ts:30`) y nunca las aristas.

## Acoplamientos que más estorban

1. `settings.agent` global.
2. `composer` como objeto único.
3. Nodo = sesión, más el `switch` cerrado de 9 tipos (`spec.ts:~259`).

## Límite

No se recorrieron `settings/*` ni los paneles internos de Designer. Relación: [contratos de puertos](propuesta-contratos-puertos.md), [plan](propuesta-todo-es-un-nodo-plan.md).

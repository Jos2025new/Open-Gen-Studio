---
type: inventario
title: Estado compartido de Nodes
description: Campos del almacén, del módulo y de localStorage que leen o escriben los controles de Nodes, con su línea, si persisten y su valor por defecto.
tags: [nodes, estado, store]
updated: 2026-10-28
related: [dependencias, ejecucion, deshacer-bloqueos]
---
# Estado compartido de Nodes

«Persiste» = sobrevive a recargar la página. Lo que no se pudo confirmar va como «sin confirmar».

| Campo | Línea | Persiste | Defecto | Lo usan |
| --- | --- | --- | --- | --- |
| `sessions[id].graph` (nodos, enlaces, grupos, viewport) | `engine/types.ts:1040` | Parte de la sesión; el formato de guardado exacto no se leyó: sin confirmar | Vacío | Todos los controles; se escribe con `setGraph` (`store.ts:556`) |
| `graph.groups[].detachedOutputs` (copia para reacoplar) | `arrange.ts:215` | Con el grafo | — | Operations, tarjeta de nodo |
| `graph.viewport` | `engine/types.ts:776` | Campo existente, pero ningún archivo de Nodes lo escribe; solo se conserva al deshacer (`flow/history.ts:56`) | Sin valor | Nada: la vista no se recuerda |
| `generations[id]` (estado, error, assetIds, texto) | `store.ts:66` | Sí (almacén) | — | Vista previa, estado, historial, progreso |
| `assets[id]` | `store.ts:195` | Sí (almacén y blobs) | — | Nodos Asset, referencias, borrado de asset del historial |
| `selected` (nodos), `selectedEdges`, `measured`, `box`, `menu` | `NodeWorkspace.tsx:105` | No (estado local de `Canvas`) | Vacío | Selección, Operations, menús |
| `useNodeSelection.bySession` | `flow/selection.ts:10` | No | `{}` | Contexto del agente |
| `useNodeFocus` | `flow/selection.ts:24` | No | `tick: 0` | Encuadre tras el plan del agente |
| `tool` (select / pan) | `NodeWorkspace.tsx:108` | `localStorage` del navegador, clave `ogs.nodeTool.v2` | `pan` | Panel de navegación, caja de selección |
| Aviso «Import from Chat» cerrado | `ImportFromChat.tsx:34` | `localStorage` `ogs.fromChat.node.<sesión>` | 0 | Aviso del lienzo |
| `mapOpen`, popovers, `query`, `submitted` | `CanvasNavigation.tsx:32` | No | Cerrado | Panel de navegación |
| Historial de deshacer | `flow/history.ts:5` | No (memoria del módulo) | Vacío | Undo/Redo |
| Bloqueos de ejecución | `locks.ts:10` | No (memoria) | Vacío | Run, Undo, borrado |
| Portapapeles de nodos | `arrange.ts:126` | No | `null` | Pegar |
| `composer[kind]` (modelo y ajustes) | `flow/actions.ts:45` | Sí (Composer) | Ver Studio | Valores con que nace un nodo |
| `composer.attachments` | `engine/actions.ts:599` | Ver Studio | — | Casillas «agent context», «Attach to prompt» |
| `settings.budgetOn` / `budgetUsd` / `budgetNoAsk` / `budgetAccepted` (antiguo) / `spentUsd` | `store.ts` | Sí (ajustes) | Límite activado de 25 USD, sin aceptación | Revisión de gasto y «Continue once» / «Don’t ask again» |
| `settings.ops` (modelo por operación) | `engine/catalog.ts:469` | Sí (ajustes) | Ver Ajustes | Modelo de las herramientas |
| `ui.lightbox`, `ui.sketch`, `ui.panel` | `nodes.tsx:142` | No | `null` | Visor, editor Sketch, galería |
| `ui.threadOpen` | `ThreadPeek.tsx:8` | Sin confirmar | — | Hilo de Nodes |
| Feed `notice` con `undoNodes` / `undone` | `engine/types.ts:663` | Con el chat | — | Botón Undo del hilo, `restore_nodes` |

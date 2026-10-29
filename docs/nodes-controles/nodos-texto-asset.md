---
type: inventario
title: Nodos de texto y de asset
description: Los dos nodos sin panel de ajustes (texto y asset): cómo nacen, qué se puede editar y qué controles de la barra les corresponden.
tags: [nodes, texto, asset]
updated: 2026-10-28
related: [tarjeta-nodo, biblioteca-nodos, puertos-enlaces]
---
# Nodos de texto y de asset

Ninguno de los dos tiene panel inferior (`nodes.tsx:776`); comparten título, estado y barra flotante con el resto ([tarjeta-nodo](tarjeta-nodo.md)). No ejecutan nada (`runsGeneration` es falso para ellos, `flow/graph.ts:32`): no tienen botón Run ni historial.

| Control | Dónde aparece | Cuándo aparece | De qué depende | Qué modifica | Influye en | Notas |
| --- | --- | --- | --- | --- | --- | --- |
| Nodo de texto: cuadro «Prompt or copy…» | `nodes.tsx:803` | Todo nodo `text` (creado desde «Text», el estado vacío, el plan del agente o el Composer en Nodes) | `d.text` | `patchNodeData({ text })` por pulsación (`nodes.tsx:804`) | Prompt o letras de los nodos conectados | El texto va directo al paso (`flow/graph.ts:407`); cambiarlo deja desactualizados a sus destinos |
| Nodo de texto: altura | `flow/graph.ts:237` | — | — | Solo el cálculo de colocación automática | Auto layout | No es un control |
| Nodo de asset: vista previa | `nodes.tsx:232` | Todo nodo `asset` | `assetId`, `sketchAssetId` | — | Salida: el asset o su sketch | La pista «Drop an asset from the gallery» sale solo si el nodo no tiene asset; el menú «Add node» **no** crea nodos Asset vacíos (la entrada «Asset» abre la galería, `NodeWorkspace.tsx:55`), por lo que un nodo Asset vacío no es alcanzable por lectura desde la interfaz: requiere prueba en sandbox |
| Nodo de asset: orígenes | `flow/actions.ts:27` | Soltar un asset del chat o la galería, importar o pegar imágenes, «Add to Node canvas», Ref de un nodo, importar del chat | Asset | Crea el nodo (título «Asset», «Image» al importar, «Reference» desde Ref) | Grafo | Los modelos 3D con generación vuelven como nodo 3D (`flow/actions.ts:27`) |
| Nodo de asset: salidas y acciones | `nodes.tsx:297` | Nodo seleccionado con asset | `outputPort` = tipo del asset | Barra: Open, Sketch (imagen), Reset image, Attach to prompt, Download, acciones rápidas, More tools, Duplicate, Delete | Grafo | No tiene Detach outputs (un solo archivo) |
| Ejecutar un nodo de asset o de texto | — | Nunca | — | — | — | Run all los salta (`flow/actions.ts:213`). Si falta el asset, la revisión del nodo que lo usa lo señala: «“título” needs an available asset.» (`flow/actions.ts:267`) |

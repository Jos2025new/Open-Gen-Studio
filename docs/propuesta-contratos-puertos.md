---
type: proposal
title: Contratos de puertos de Nodes
description: Efecto exigible y prueba de cada puerto data/ref/control por tipo de nodo; integridad de referencias
tags: [nodes, contratos, referencias]
updated: 2026-11-17
---

# Contratos de puertos de Nodes

Origen: «Referencias que fallan en silencio» ([pendientes](pendientes.md), punto 8). Decisión del usuario (2026-11-17): todo puerto declarado en `SYSTEM_NODE_TYPES` (`src/engine/nodes/spec.ts`) debe funcionar; marcarlo no basta. Sin ejecutor nuevo: `flow/` y `executor.ts` existentes.

## Reglas generales

| Regla | Efecto | Prueba |
| --- | --- | --- |
| R1 Integridad | Una `ref` cuyo destino no existe queda **inválida y visible** (`LiveSystemSummary.invalid`); nunca se sustituye por el doc, sesión o modelo activo. | `tests/ref-integrity.test.ts` |
| R2 Borrado | `deleteDoc` marca los nodos que apuntaban al doc como inválidos (no los borra ni los repunta). | ídem |
| R3 Vigente o fijada | `RefNodeData.pinnedRevision` ausente = sigue la vigente; presente = fijada a esa revisión (`assetRevisions`). | ídem |
| R4 Obligatorias | Una entrada obligatoria ausente o sin resultado es error visible **antes** de llamar al proveedor; sin `if (a)` que la salte. | `tests/ref-required.test.ts` |
| R5 Freshness | `nodeIsCurrent` compara contenido/revisión del referido y entradas `ref`/`control`. | `tests/ref-freshness.test.ts` |

## Tabla por tipo × puerto

`E` = efecto exigible. `T` = verificación. «hoy» = estado conocido; «P2» = pendiente de implementar en la parte 2.

| Tipo | Puerto | Clase | E (efecto) | T (test) | Estado |
| --- | --- | --- | --- | --- | --- |
| chat | `in` | data | el texto entrante se añade al prompt del chat | enviar y leer `feed` | P2 |
| chat | `out` | data | emite el último texto del usuario como prompt de nodos destino | `nodeRequest` con origen chat → texto real | P2 |
| chat | `ref` / `context` | ref | referencia a sesión: válida si existe (R1) | R1 | P1 |
| chat | `session` | control | fija la sesión del chat; sesión borrada = inválido | R1 | P1 |
| chat | `agent` | control | enlace con agente (ya cableado en `system.ts`) | `system-nodes.test.ts` | hoy |
| agent | `model` | control | **cambia la configuración real** del agente (`session.agent.settings` por `mediaKind`) | tras enlazar, `settings.<kind>.modelRef` = ref | P2 |
| agent | `out` | data | plan/prompt como texto real | `nodeRequest` | P2 |
| agent | `in`, `tools`, `chat`, `control` | data/control | `in`: texto como instrucción; `tools`: toolset activo; resto marca relación | por puerto | P2 / pregunta Q2 |
| agent | `ref`/`target` | ref | docs/espacios sobre los que actúa: destino debe existir (R1) | R1 | P1 |
| model | `model` | control | el nodo modelo fija el modelo de quien lo recibe | agente cambia modelo | P2 |
| model | `provider` | control | proveedor debe existir en el catálogo | R1 | P1 |
| model | `in`/`out` | data | `in` texto → prompt; `out` resultado del modelo | pregunta Q1 | P2 |
| provider | `provider`/`ref` | control/ref | `ref` del proveedor desconocido = inválido | R1 | P1 |
| session | `session`/`context` | control/ref | sesión borrada = inválido, no la activa | R1 | P1 |
| space | `in` | data | imágenes entrantes aparecen como assets del Space | pregunta Q3 | P2 |
| space | `out` | data | emite el asset seleccionado | `nodeRequest` con origen space | P2 |
| designer.doc | `in` | data | imagen entrante = capa nueva del doc | `doc.layers` +1 | P2 |
| designer.doc | `out` | data | render del doc (asset real) | `nodeOutputAsset` | P2 |
| designer.doc | `ref` | ref | `d.ref` debe ser un doc vivo; doc borrado = inválido (R1, R2) | R1/R2 | P1 |
| library | `out` | data | imagen frontal del sujeto como asset | `nodeRequest` | P2 |
| library | `in` | data | guarda imagen como sujeto | `library.subject.save` | P2 |
| toolset | `tools`/`ref` | control/ref | catálogo de operaciones, siempre válido | – | hoy |
| creativos (gen/tool/asset) | `sys_ref`/`out_ref` | ref | referencia contextual; entrada obligatoria ausente = error (R4); cuenta en freshness (R5) | R4, R5 | P3/P4 |
| creativos | `model` | control | fija `modelRef` del nodo | gen.modelRef cambia | P2 |
| creativos | `control`/`out_control` | control | orden/relación; entra en freshness (R5) | R5 | P4 |

## Preguntas abiertas

- **Q1** `model.in/out` (data): ¿el nodo modelo ejecuta por sí mismo con el prompt entrante o solo configura? Hasta decidirlo se mantiene como solo configuración.
- **Q2** `agent.control` / `chat` (control): ¿qué significa «controlar» al agente más allá del enlace (pausar, enviar turno)? Sin definir no hay efecto verificable.
- **Q3** `space.in`: ¿«Assets in» crea assets en el espacio o solo los referencia?

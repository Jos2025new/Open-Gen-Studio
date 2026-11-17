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
| R3 Vigente o fijada | `ref: 'active'` = sigue la vigente (`tracking: 'following'`); un id concreto = fijada (`'pinned'`); revisión de asset: parte 4. | ídem |
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

## Decisiones del usuario (2026-11-17) sobre Q1–Q3

Principio: no se cambia lo que se ve; se separa en código lo que ya existe y se pasa de espejo a fuente de verdad.

- **Q1** El nodo modelo o proveedor solo configura. Va acoplado por defecto al agente y se cambia en el propio nodo; quien ejecuta es el nodo de generación.
- **Q2** El control es declarativo: conectar un agente a un chat. Un chat puede tener varios agentes (cada uno, un nodo conectado al chat) y cada mensaje lleva quién lo envió: id del nodo agente, su proveedor y su modelo. Pausar o enviar un turno son botones del nodo, no cables.
- **Q3** «Assets in» solo referencia, por id estable; copiar es una acción explícita.
- Una caja de texto independiente como nodo (`prompt`), conectable a varios agentes. Agrupar es unir nodos bajo un marco tipado.

## Errores conocidos que evitamos

Lecciones de otros sistemas de nodos (en parte de foros; no verificadas una a una). Cómo las cubre cada contrato:

| # | Error ajeno | Cómo lo cubre este contrato | Estado |
| --- | --- | --- | --- |
| 1 | Conversiones de tipo silenciosas (Blender #120648, #111482) | `portTypeCompatible` solo admite `any`, tipos iguales y `model3d→image`; cualquier otra conversión debe ser un nodo/paso explícito, nunca implícita en el enlace. | hoy; sin test propio de «no convierte» |
| 2 | Referencias por nombre o ruta; destino ausente sustituido (Maya; Houdini con HDA por nombre) | R1–R3: referencia por id estable; `'active'` = sigue la vigente, id concreto = fijada; destino ausente = `invalid` visible, reparable en el sitio. Excepción abierta: `RefNodeData.ref` de modelo se resuelve por ref del catálogo (no por nombre). | hecho (docs, sesiones); modelo: pendiente |
| 3 | Actualizar o borrar se lleva ediciones locales sin avisar (overrides de Blender) | `deleteDoc` deja los nodos inválidos en vez de repuntarlos, sin perder el nodo. Falta: aviso previo con el número de nodos/ediciones afectados y recuperación tras borrar. | parcial; aviso y recuperación pendientes |
| 4 | Dependencias ocultas o sin hash por contenido (Maya EG, caché de ComfyUI) | R5: la firma `nodeRequest` incluye enlaces `ref`/`control` y la revisión de contenido del asset referido (`assetRevisions`). Regla: toda dependencia es un puerto declarado. | hecho para ref/control y assets |
| 5 | Nodos con efectos tratados como puros (ComfyUI IS_CHANGED) | chat, agent y escritura en library se marcan no idempotentes; su firma de caché incluye modelo, prompt y versión del nodo. | pendiente (parte 2) |
| 6 | Esquema de puertos sin versión (Blender #116590) | `SYSTEM_NODE_TYPES` debe llevar versión y migración explícita al cambiar puertos; hoy no existe. | pendiente; decisión de diseño |

## Estado de la parte 2 (2026-11-17)

- Hecho: `model → agent` (control) cambia `session.agent.settings.<image|video>.modelRef` (`applyModelLinkToAgent`); `chat`/`agent` `out` (data) entrega el texto real a `prompt` (`flow/refText.ts`). Tests: `tests/ref-ports-effects.test.ts`.
- Sin hacer: `designer.doc.out` y `library.out` como imagen real (el render del doc es asíncrono y necesita su propio paso en `executor.ts`), `designer.doc.in`, `library.in`, `space.in/out`, `agent.in/tools`, `model.in/out` (Q1). Error conocido 5: los nodos con efectos (chat, agent, library.in) aún no se marcan no idempotentes; error 6: el esquema de puertos aún no lleva versión. Ambos quedan en `pendientes.md`.

## Nota de diseño: acoplamientos (2026-11-17)

Orden: (1) agente propio, (2) nodo `prompt` y ajustes de medio, (3) chat dueño de su feed y registro de tipos. Sin migración que pierda datos: todo campo nuevo es opcional y su ausencia significa «sigue el valor de hoy». No toca archivos de persistencia protegida (solo añade campos opcionales al grafo y a `meta`).

1. **Agente.** `RefNodeData.llm?: { provider, model }` en el nodo agente. Ausente = sigue `settings.agent` (el global, que pasa a ser el valor por defecto de un agente sin elección propia). `agentEngine(sessionId?)` lee el nodo agente de la sesión y, si tiene `llm`, usa ese; si no, el global. Los controles actuales siguen escribiendo el global, así que nada cambia en pantalla ni en datos viejos. `ChatMessageMeta` gana `agentNodeId` (id del nodo agente) **junto a** `agent`, que sigue siendo el rol visible ('Director'): sustituirlo cambiaría lo que se ve.
2. **Prompt.** Nodo `prompt` con `composer.text` como valor; el agente lee aristas `prompt→agent` y, sin aristas, `composer.text` como hoy.
3. **Chat.** Registro de tipos de nodo de sistema en `spec.ts` (un solo sitio para añadir un tipo); el nodo chat admite varios agentes conectados.

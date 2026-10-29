---
type: auditoria
title: Hallazgos de Nodes
description: Discrepancias y riesgos de Nodes leídos en el código, con gravedad, dónde se avisa al usuario y qué falta confirmar. Sin ejecutar nada.
tags: [nodes, hallazgos, auditoria]
updated: 2026-10-28
related: [dependencias, huecos, ejecucion, nodos-herramienta]
---
# Hallazgos de Nodes

Todo sale de leer el código; **nada se ejecutó** (ni app ni navegador). «Gravedad»:  promesa rota, entregable equivocado o fricción de uso son críticos; lo que solo exige una decisión del producto va como «decisión». Cada fila dice si el comportamiento se **divulga** al usuario y dónde. Las promesas P1/P2/P3 están en [dependencias](dependencias.md). «sin confirmar» = el código leído no permite afirmarlo.

| Id | Hallazgo | Evidencia | Se avisa al usuario | Gravedad | Estado |
| --- | --- | --- | --- | --- | --- |
| H1 | Capacidad sin guarda: `edit_node` aplica `model_ref` directamente con `setNodeModel`, sin tarjeta ni confirmación en el código de la herramienta (`nodeTools.ts:27`). La regla «nunca en silencio» (`changeRules.ts:2`) se escribió para `confirm_settings`, no para `edit_node`; ninguna regla escrita cubre esta herramienta (ver [rastreo de Nodes](../rastreo/nodes.md)) | `nodeTools.ts:27`, `changeRules.ts:2` | La respuesta del agente y Ctrl+Z; no hay barrera en la herramienta | Media-alta como capacidad (P1 depende de una instrucción de prompt); no hay prueba de que un agente lo haya hecho | comportamiento real pendiente de reproducir |
| H2 | Modelo y proveedor **ocultos** en los nodos de operaciones que no montan selector. Por operación: **con selector** (chip «modelo · proveedor», `nodes.tsx:669`, `VideoUpscaleControls.tsx:27`): `video_upscale`, `video_edit`, `video_extend`, `continue`. **Ocultos, modelo del nodo de origen o Ajustes › operaciones o predeterminado de imagen** (`edit` engine): `relight`, `angle`, `reframe`, `reference_sheet`, `variations`, `edit`, `replace_background`, `contact_sheet`. **Ocultos, Ajustes › operaciones, lista preferida, modelo etiquetado o el de edición con instrucción** (`upscale`, `remove_bg`). **Oculto, modelo del origen o Ajustes o predeterminado de vídeo**: `animate` (engine vídeo; no monta el selector aunque el motor admite `_modelRef`). **Ocultos, sin confirmar su ejecución**: `edit_region`, `remove_object`, `create_voice`, `transcribe`. Sin modelo: `extract_frame`, `grid_split`, `join_clips`, `fx`. La revisión de gasto no nombra modelo ni proveedor en ningún caso (solo precio) | `engine/catalog.ts:437`; los planes además estampan `params._modelRef` (`plan.ts:856-860`), que la ejecución en Nodes ignora en operaciones de imagen (`flow/actions.ts:228`) | El precio sí; el modelo solo en los 4 con selector | Media-alta para las operaciones de imagen (editar, reescalar, quitar fondo, relight…); requiere decisión del producto (la nota previa sobre ADR 0009 está sustituida) | decisión |
| H3 | «Delete asset» en el detalle de generación borra el archivo sin confirmar y no se puede deshacer; la tarjeta de generación sí confirma. `deleteAssets` solo se niega si un flujo en marcha usa el asset (`engine/actions.ts:549`) y no indica qué nodos guardados lo usan; una ejecución posterior puede rechazar el nodo por asset ausente (`flow/actions.ts:267`) | `nodes.tsx:149`, `engine/actions.ts:549`, `flow/actions.ts:267` | La etiqueta es explícita; no hay aviso de nodos afectados | Alta | confirmado por lectura |
| H4 | «Continue anyway» acepta el límite de forma global y las siguientes ejecuciones no preguntan | `SpendConfirm.tsx:68` | Sí, el texto lo dice | Excepción documentada | igual que Studio H4 |
| H5 | `setNodeOp` restablece parámetros, título y resultado y quita enlaces incompatibles sin avisar | `flow/actions.ts:197` | No; se puede deshacer | Media | confirmado por lectura |
| H6 | Cambiar de modelo o de operación quita enlaces salientes que ya no encajan sin mensaje | `flow/actions.ts:111` | No; se puede deshacer | Media | confirmado por lectura |
| H7 | Conectar a un puerto sencillo ocupado sustituye el enlace anterior sin aviso (también el agente) | `flow/graph.ts:142` | No | Baja-media | confirmado por lectura |
| H8 | Ajustes ocultos del Composer (realismo, captura, shot, negativo, avanzados, tomas) se copian a cada nodo nuevo y no tienen control en el nodo | `flow/actions.ts:48` | No en el nodo; sí en el Composer | Media-alta; efecto real en la ejecución del nodo | sin confirmar |
| H9 | Al cambiar de modelo en un nodo, `coerceSettings` ajusta aspecto, resolución o duración sin avisar (los avisos se descartan) | `nodes.tsx:624` | El precio del botón Run sí se actualiza | Baja-media | confirmado por lectura |
| H10 | Con una ejecución en curso, Undo/Redo queda desactivado sin decir por qué, y el atajo no da mensaje | `CanvasNavigation.tsx:71` | El borrado de nodos bloqueados sí avisa | Baja | confirmado por lectura |
| H11 | Nodos: no hay Stop ni «Comprobar estado» por nodo. Reintentar existe pulsando Run otra vez (nueva revisión con precio, nueva ejecución). Las tarjetas de plan del agente sí tienen Cancel. Borrar un nodo que genera está bloqueado con aviso (`locks.ts:30`). Recuperación desde otras superficies y tras recargar: sin leer | `flow/locks.ts:30`; [[ejecucion]] | El bloqueo de borrado avisa; Undo desactivado no explica | Media por lectura (falta Stop por nodo); resto pendiente de sandbox | sin confirmar |
| H12 | Las operaciones `edit_region`, `remove_object` (por sketch) y `create_voice` aparecen en los selectores de nodo aunque el comentario de `ops.ts` indica que no | ver [nodos-herramienta](nodos-herramienta.md) | No | Media; el comportamiento al ejecutar no se leyó | sin confirmar |
| H13 | Los campos `required` de una operación no se marcan ni se validan en la interfaz del nodo | ver [nodos-herramienta](nodos-herramienta.md) | Dependería del ejecutor, no leído | Baja-media | sin confirmar |
| H14 | El botón Run principal recalcula `previewRun` en cada cambio del almacén | ver [ejecucion](ejecucion.md) | — | Sin gravedad asignada: no medido; se necesita la sonda de docs/depuracion.md | sin confirmar |
| H15 | Los nodos no muestran si están desactualizados; solo el recuento de Run all lo delata | `flow/freshness.ts:56` | Parcial | Baja-media | confirmado por lectura |
| H16 | Auto layout mueve todos los nodos sin confirmar | ver [agrupar-alinear](agrupar-alinear.md) | Se puede deshacer | Baja | confirmado por lectura |
| H17 | Precios desconocidos no cuentan para el límite (`overLimit` los ignora) | `budget.ts:27` | La revisión dice que el proveedor factura el coste real | Igual que Studio H5 | documentado |

## Qué no es hallazgo

- «Results remain in the gallery» al borrar nodos es verdadero (`deleteNodes` solo toca el grafo).
- El estilo Auto del agente solo aprueba ejecuciones de coste exactamente 0; `run_nodes` siempre pide clic.
- La revisión de gasto se revalida por firma antes de ejecutar: si el grafo cambió, no se gasta.

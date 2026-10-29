---
type: mapa
title: Dependencias entre controles de Nodes
description: Qué controles de Nodes se influyen entre sí (modelo, ajustes, puertos, resultado, desactualización, gasto, historial, bloqueos, agente) y qué promesa del producto toca cada cruce.
tags: [nodes, dependencias, promesas]
updated: 2026-10-28
related: [ejecucion, nodos-generacion, nodos-herramienta, hallazgos, estado-compartido]
---
# Dependencias entre controles de Nodes

Promesas del producto (las mismas que en [Studio](../studio-controles/dependencias.md)): **P1** el modelo o proveedor no cambia sin que el usuario pulse Cambiar; **P2** no se gasta por encima de lo mostrado; **P3** una alerta nunca afirma algo falso. En Nodes no hay botón «Cambiar»: la elección explícita es el clic en una fila de la lista de modelos del nodo. La columna «Promesa tocada» dice cuál roza cada cruce y cómo queda: «cumple», «excepción documentada», «sin confirmar» o «hallazgo» (ver [hallazgos](hallazgos.md)). Todo sale de leer el código; no se ejecutó nada.

## Modelo y ajustes

| Origen | Destino | Cómo se propaga | Promesa tocada |
| --- | --- | --- | --- |
| Composer: modelo y ajustes de cada tipo | Todo nodo nuevo de imagen, vídeo, audio o 3D | `newNodeData` copia `modelRef` y `settings` sin la semilla (`flow/actions.ts:48`) | P1: cumple (el modelo es el que el usuario eligió en el Composer). Los ajustes **ocultos** que se copian (realismo, captura, shot, negativo, avanzados, tomas) no tienen control en el nodo: hallazgo H8 |
| Nodo origen → nodo creado con «+» o con un enlace soltado | Nodo nuevo del mismo tipo | `addConnected` copia modelo y ajustes del origen y adapta la proporción a la imagen de entrada (`addConnected.ts:21`, `addConnected.ts:30`) | P1: cumple (hereda, no cambia un modelo existente) |
| Lista de modelos del nodo | `setNodeModel` y ajustes del nodo | Al elegir una fila: `coerceSettings` adapta aspecto, resolución y duración al valor más cercano, vacía `advanced` y `audio`, y descarta los avisos de cambio (`nodes.tsx:624`) | P1: cumple (clic explícito). P2: el precio del botón Run se recalcula (es una estimación; no demuestra un máximo de cobro). Los ajustes cambiados no se anuncian (igual que en el Composer, `engine/catalog.ts:293`) |
| Cambio de modelo (si cambia el tipo de salida) | Enlaces que salen del nodo | Se quitan los que ya no encajan (`flow/actions.ts:111`) | P3: no hay alerta; los enlaces desaparecen sin mensaje (hallazgo H6) |
| Selector de operación | Parámetros, título, resultado y enlaces del nodo de herramienta | `setNodeOp` restablece parámetros y título, suelta `generationId` y quita enlaces incompatibles (`flow/actions.ts:197`) | P3: sin aviso (hallazgo H5) |
| Modelo del chip de las operaciones de vídeo (`_modelRef`) | Modelo y proveedor de ese paso | Se guarda en `params._modelRef` y lo lee `requestContext` (`flow/actions.ts:227`) | P1: cumple (elección explícita y visible en el panel) |
| Resto de operaciones (editar, reescalar, quitar fondo, relight…) | Modelo y proveedor de ese paso | `requestContext` elige: el modelo que hizo el asset de origen, o el de Ajustes › operaciones, o el predeterminado (`engine/catalog.ts:437`, `engine/catalog.ts:437`). El nodo lo muestra solo en `video_upscale`, `video_edit`, `video_extend` y `continue`; la revisión de gasto nunca | P1: sin confirmar si aplica (nadie lo «cambia» tras una elección, pero el usuario no puede verlo ni elegirlo en el nodo); hallazgo H2. P2: el precio mostrado es una estimación para ese modelo y puede ser desconocido; no demuestra un máximo de cobro del proveedor |
| `edit_node` del agente con `model_ref` | Modelo del nodo | `setNodeModel` sin tarjeta de confirmación (`nodeTools.ts:27`) | P1: hallazgo H1 (capacidad sin guarda; la regla del agente le pide no cambiar por su cuenta, `changeRules.ts`; comportamiento real pendiente de reproducir) |

## Puertos, resultados y estado «al día»

| Origen | Destino | Cómo se propaga | Promesa tocada |
| --- | --- | --- | --- |
| Conectar a un puerto sencillo ocupado | Enlace anterior | `connect` lo sustituye (`flow/graph.ts:142`); vale también para el agente | P3: sin alerta (hallazgo H7) |
| Prompt, texto, enlaces, referencias, modelo, ajustes o parámetros del nodo | Estado «al día» del nodo | `nodeIsCurrent` compara la petición con la guardada (`flow/freshness.ts:56`) | Alimenta Run all; no hay marca visible en el lienzo (hueco en [huecos](huecos.md)) |
| Resultado elegido (`outputIndex`) o puerto numerado | Qué asset recibe el nodo conectado | `refFor` lee el índice del enlace o el elegido (`flow/graph.ts:387`) | P3: los consejos «Use output n downstream» y «Result n…» son verdaderos |
| Sketch (copia pintada) | Resultado aguas abajo y Run del propio nodo | El sketch sustituye al resultado (`flow/graph.ts:328`); ejecutar un nodo con sketch sobre una base previa da el error «has a Sketch on its previous base…» (`flow/graph.ts:368`) | P3: verdadero |
| Pegar o duplicar un nodo | Resultado y sketch | Se copian sin `generationId` ni sketch (`arrange.ts:162`) | El nodo nuevo aparece como pendiente de ejecutar |
| «Delete asset» del historial | Cualquier nodo que lo use | `deleteAssets` borra el asset y el archivo; los nodos Asset que lo apuntaban dan «needs an available asset» al revisar (`flow/actions.ts:267`) | P3: sin aviso previo (hallazgo H3); efecto sobre nodos de generación que lo tenían como resultado: sin confirmar |

## Gasto y aprobación

| Origen | Destino | Cómo se propaga | Promesa tocada |
| --- | --- | --- | --- |
| Botón Run (barra, panel) o Run all | Revisión de gasto | `prepareNodeRun` carga los esquemas y `previewRun` calcula pasos, errores y total (`flow/actions.ts:303`) | P2: cumple, el precio se ve antes de cualquier gasto |
| Revisión mostrada | Ejecución | `runNodes` revalida la firma y no gasta si cambió (`flow/actions.ts:327`) | P2: cumple |
| Nodos de los que depende el nodo (sin resultado o desactualizados) | Lista y precio de la revisión | `graphToSteps` los añade al conjunto que se ejecuta (`flow/graph.ts:363`) y la revisión los enumera | P2: cumple (se ven y suman) |
| Run de un solo nodo con resultado vigente | Nuevo gasto | `force=true`: vuelve a ejecutarlo (`flow/actions.ts:243`) | P2: cumple (precio visible); la revisión no dice que el resultado ya estaba al día |
| Límite de gasto | Aviso, botón «Continue anyway» | `overLimit` (`budget.ts:19`) y `acceptOverLimit` global (`SpendConfirm.tsx:68`); el texto dice «Further runs will not ask again until you change the limit.» | P2: excepción documentada y divulgada en el propio aviso (hallazgo H4 de Studio, ver [hallazgos](../studio-controles/hallazgos.md)) |
| Precio desconocido | Aviso y límite | La revisión dice «The provider bills the actual cost; it is not published in advance.»; `overLimit` y `budgetProblem` ignoran los desconocidos (`budget.ts:27`) | P2: no se muestra una cifra; la advertencia es veraz. Mismo hueco que H5 de Studio |
| Composer directo en Nodes | Nodo + ejecución inmediata | El botón de envío es la aprobación; con precio desconocido o sobre el límite abre la revisión (`Composer.tsx:204`) | P2: cumple |
| Estilo Auto del agente | Ejecución de un plan de Nodes | Aprueba solo si el coste es exactamente 0 (`pricing.ts:120`) | P2: cumple |
| `run_nodes` del agente | Tarjeta «Run existing nodes» | Espera el clic del usuario también en Auto (`planRun.ts:91`) | P2: cumple |

## Historial, bloqueos y vistas

| Origen | Destino | Cómo se propaga | Promesa tocada |
| --- | --- | --- | --- |
| Ejecución en curso | Undo/Redo, borrado de nodos, «Delete asset» | `lockNodes`, `lockAssets`, `writingNodes` (`locks.ts:20`) | P3: el botón Undo queda desactivado sin motivo visible; el borrado sí avisa (hallazgo H10) |
| Borrado de nodos (cualquier vía) | Aviso del hilo con Undo | `deleteNodes` añade un aviso con copia de nodos y enlaces (`flow/actions.ts:90`) | P3: «Results remain in the gallery» es verdadero |
| Resultado nuevo (`generationId`) | Historial | No genera entrada (se ignora en la comparación, `flow/history.ts:18`) | Deshacer no pierde resultados |
| Selección del lienzo | Contexto del agente | `setNodeSelection` | Solo contexto |
| Resultados del chat que no están en el lienzo | Aviso «Add as nodes» | `chatWorkNotInNodes` (`flow/fromChat.ts:11`) | P2: «No calls, no cost» es verdadero (no se llama a ningún proveedor) |

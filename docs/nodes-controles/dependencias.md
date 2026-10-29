---
type: mapa
title: Dependencias entre controles de Nodes
description: Qué controles de Nodes se influyen entre sí (modelo, ajustes, puertos, resultado, desactualización, gasto, historial, bloqueos, agente) y qué promesa del producto toca cada cruce.
tags: [nodes, dependencias, promesas]
updated: 2026-10-28
related: [ejecucion, nodos-generacion, nodos-herramienta, hallazgos, estado-compartido]
---
# Dependencias entre controles de Nodes

Promesas del producto (las mismas que en [Studio](../studio-controles/dependencias.md)): **P1** el modelo o proveedor no cambia sin que el usuario pulse Cambiar; **P2** no se gasta por encima de lo mostrado; **P3** una alerta nunca afirma algo falso. En Nodes no hay botón «Cambiar»: la elección explícita es el clic en una fila de la lista de modelos del nodo. La columna «Promesa tocada» dice cuál roza cada cruce y cómo queda: «cumple» (para P2 solo significa que se mostró una estimación, no un máximo garantizado), «excepción documentada», «sin confirmar» o «hallazgo» (ver [hallazgos](hallazgos.md)). Todo sale de leer el código; no se ejecutó nada.

## Modelo y ajustes

| Origen | Destino | Cómo se propaga | Promesa tocada |
| --- | --- | --- | --- |
| Composer: modelo y ajustes de cada tipo | Todo nodo nuevo de imagen, vídeo, audio o 3D | `newNodeData` copia `modelRef` y `settings` sin la semilla (`flow/actions.ts:48`) | P1: sin incumplimiento visto por lectura (copia `modelRef` del Composer; que ese modelo lo eligiera el usuario requiere prueba). Los ajustes **ocultos** que se copian (realismo, captura, shot, negativo, avanzados, tomas) no tienen control en el nodo: hallazgo H8 (requiere prueba; sin respuesta en el [rastreo](../rastreo/nodes.md#4-respuestas-a-hallazgos-h1h17-y-huecos)) |
| Nodo origen → nodo creado con «+» o con un enlace soltado | Nodo nuevo del mismo tipo | `addConnected` copia modelo y ajustes del origen y adapta la proporción a la imagen de entrada (`addConnected.ts:21`, `addConnected.ts:30`) | P1: cumple (hereda, no cambia un modelo existente) |
| Lista de modelos del nodo | `setNodeModel` y ajustes del nodo | Al elegir una fila: `coerceSettings` adapta aspecto, resolución y duración al valor más cercano, vacía `advanced` y `audio`, y descarta los avisos de cambio (`nodes.tsx:624`) | P1: cumple (clic explícito). P2: el precio del botón Run se recalcula (es una estimación; no demuestra un máximo de cobro). Los ajustes cambiados no se anuncian (igual que en el Composer, `engine/catalog.ts:293`) |
| Cambio de modelo (si cambia el tipo de salida) | Enlaces que salen del nodo | Se quitan los que ya no encajan (`flow/actions.ts:113`) | P3: no hay alerta; los enlaces desaparecen sin mensaje (hallazgo H6: respondido por lectura, deliberado en el código; el aviso, sin decisión encontrada) |
| Selector de operación | Parámetros, título, resultado y enlaces del nodo de herramienta | `setNodeOp` restablece parámetros y título, suelta `generationId` y quita enlaces incompatibles (`flow/actions.ts:197`) | P3: sin aviso (hallazgo H5: respondido por lectura, deliberado en el código; el aviso, sin decisión encontrada) |
| Modelo del chip de las operaciones de vídeo (`_modelRef`) | Modelo y proveedor de ese paso | Se guarda en `params._modelRef` y lo lee `requestContext` (`flow/actions.ts:227`) | P1: cumple (elección explícita y visible en el panel) |
| Resto de operaciones (editar, reescalar, quitar fondo, relight…) | Modelo y proveedor de ese paso | `requestContext` elige: el modelo que hizo el asset de origen, o el de Ajustes › operaciones, o el predeterminado (`engine/catalog.ts:437`; los planes además estampan `params._modelRef` (`plan.ts:856-860`), que la ejecución en Nodes ignora en operaciones de imagen (`flow/actions.ts:228`)). El nodo lo muestra solo en `video_upscale`, `video_edit`, `video_extend` y `continue`; la revisión de gasto nunca | P1: posible incumplimiento (requiere prueba): un `_modelRef` confirmado en un plan de chat se usa en la estimación y se descarta al ejecutar operaciones `edit` en Nodes por el camino `nodeChoice`; el usuario tampoco puede verlo ni elegirlo en el nodo; hallazgo H2 (respondido por lectura; sin decisión encontrada, requiere decisión; la ejecución ignora `_modelRef` en operaciones de imagen: requiere prueba, [rastreo 3.1](../rastreo/nodes.md#3-regresiones-y-contradicciones-con-promesas)). P2: el precio mostrado es una estimación para ese modelo y puede ser desconocido; no demuestra un máximo de cobro del proveedor |
| `edit_node` del agente con `model_ref` | Modelo del nodo | `setNodeModel` sin tarjeta de confirmación (`nodeTools.ts:27`) | P1: hallazgo H1 (capacidad sin guarda; la regla de `changeRules.ts:2` («no cambiar por su cuenta») es de `confirm_settings` y no hay decisión escrita para `edit_node`: respondido parcialmente, requiere prueba y decisión, [rastreo 3.3](../rastreo/nodes.md#3-regresiones-y-contradicciones-con-promesas)) |

## Puertos, resultados y estado «al día»

| Origen | Destino | Cómo se propaga | Promesa tocada |
| --- | --- | --- | --- |
| Conectar a un puerto sencillo ocupado | Enlace anterior | `connect` lo sustituye (`flow/graph.ts:142`); vale también para el agente | P3: sin alerta (hallazgo H7: respondido por lectura, sustitución deliberada) |
| Prompt, texto, enlaces, referencias, modelo, ajustes o parámetros del nodo | Estado «al día» del nodo | `nodeIsCurrent` compara la petición con la guardada (`flow/freshness.ts:56`) | Alimenta Run all; no existe marca visible en el lienzo (respondido por lectura; sin decisión encontrada, requiere decisión; ver [huecos](huecos.md)) |
| Resultado elegido (`outputIndex`) o puerto numerado | Qué asset recibe el nodo conectado | `refFor` lee el índice del enlace o el elegido (`flow/graph.ts:387`) | P3: los consejos «Use output n downstream» y «Result n…» son verdaderos |
| Sketch (copia pintada) | Resultado aguas abajo y Run del propio nodo | El sketch sustituye al resultado (`flow/graph.ts:328`); ejecutar un nodo con sketch sobre una base previa da el error «has a Sketch on its previous base…» (`flow/graph.ts:368`) | P3: verdadero |
| Pegar o duplicar un nodo | Resultado y sketch | Se copian sin `generationId` ni sketch (`arrange.ts:162`) | El nodo nuevo aparece como pendiente de ejecutar. Las entradas se reconectan sin `sourceHandle` (duplicar: `flow/actions.ts:151-157`; pegar: `arrange.ts:172-177`, también sin `sourceHandle`): la copia usa el resultado elegido en el origen, no el del cable ([rastreo 3.5](../rastreo/nodes.md#3-regresiones-y-contradicciones-con-promesas); requiere prueba, no corregido) |
| «Delete asset» del historial | Cualquier nodo que lo use | `deleteAssets` borra el asset y el archivo; los nodos Asset que lo apuntaban dan «needs an available asset» al revisar (`flow/actions.ts:267`) | P3: sin aviso previo (hallazgo H3); efecto sobre nodos de generación: respondido por lectura, `deleteAssets` desplaza `outputIndex` y los cables apuntan a otro resultado ([rastreo 3.6](../rastreo/nodes.md#3-regresiones-y-contradicciones-con-promesas)); no corregido, requiere prueba |

## Gasto y aprobación

| Origen | Destino | Cómo se propaga | Promesa tocada |
| --- | --- | --- | --- |
| Botón Run (barra, panel) o Run all | Revisión de gasto | `prepareNodeRun` carga los esquemas y `previewRun` calcula pasos, errores y total (`flow/actions.ts:303`) | P2: se ve un precio estimado antes de gastar (no es un máximo garantizado de cobro) |
| Revisión mostrada | Ejecución | `runNodes` revalida la firma y no gasta si cambió (`flow/actions.ts:327`) | P2: se muestra una estimación; no garantiza un máximo de cobro |
| Nodos de los que depende el nodo (sin resultado o desactualizados) | Lista y precio de la revisión | `graphToSteps` los añade al conjunto que se ejecuta (`flow/graph.ts:363`) y la revisión los enumera | P2: los precios estimados se ven y suman (no son un máximo garantizado) |
| Run de un solo nodo con resultado vigente | Nuevo gasto | `force=true`: vuelve a ejecutarlo (`flow/actions.ts:243`) | P2: precio estimado visible (no es un máximo garantizado); la revisión no dice que el resultado ya estaba al día |
| Límite de gasto | Aviso, botones «Continue once» y «Don’t ask again» | `overLimit` y `continueOnce` / `dontAskAgain` (`budget.ts`, `SpendConfirm.tsx`); `overLimitText` describe las dos opciones | P2: resuelto 2026-10-29 (hallazgo H4 de Studio, ver [hallazgos](../studio-controles/hallazgos.md)) |
| Precio desconocido | Aviso y límite | La revisión dice «The provider bills the actual cost; it is not published in advance.»; con límite sin aceptar, `overLimit` y `budgetProblem` piden la confirmación de sobrepasar el límite también para un precio desconocido (`budget.ts`, 2026-10-29) | P2: no se muestra una cifra; la advertencia es veraz. H5 de Studio corregido |
| Composer directo en Nodes | Nodo + ejecución inmediata | El botón de envío es la aprobación; con precio desconocido o sobre el límite abre la revisión (`Composer.tsx:204`) | P2: se muestra una estimación; no garantiza un máximo de cobro |
| Estilo Auto del agente | Ejecución de un plan de Nodes | Aprueba solo si el coste es exactamente 0 (`pricing.ts:120`) | P2: se muestra una estimación; no garantiza un máximo de cobro |
| `run_nodes` del agente | Tarjeta «Run existing nodes» | Espera el clic del usuario también en Auto (`planRun.ts:91`) | P2: se muestra una estimación; no garantiza un máximo de cobro |

## Historial, bloqueos y vistas

| Origen | Destino | Cómo se propaga | Promesa tocada |
| --- | --- | --- | --- |
| Ejecución en curso | Undo/Redo, borrado de nodos, «Delete asset» | `lockNodes`, `lockAssets`, `writingNodes` (`locks.ts:20`); el Undo se bloquea en `CanvasNavigation.tsx:71` | P3: el botón Undo queda desactivado sin motivo visible; el borrado sí avisa (hallazgo H10: viene de la regla de `353628e`, sustituida por `b35a933` para editar; sigue existiendo y no consta si es intencional, requiere decisión) |
| Borrado de nodos (cualquier vía) | Aviso del hilo con Undo | `deleteNodes` añade un aviso con copia de nodos y enlaces (`flow/actions.ts:90`) | P3: «Results remain in the gallery» es verdadero |
| Resultado nuevo (`generationId`) | Historial | No genera entrada (se ignora en la comparación, `flow/history.ts:18`) | Deshacer no pierde resultados |
| Selección del lienzo | Contexto del agente | `setNodeSelection` | Solo contexto |
| Resultados del chat que no están en el lienzo | Aviso «Add as nodes» | `chatWorkNotInNodes` (`flow/fromChat.ts:11`) | P2: «No calls, no cost» es verdadero (no se llama a ningún proveedor) |

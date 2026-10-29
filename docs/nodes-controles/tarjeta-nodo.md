---
type: inventario
title: Tarjeta de nodo: título, resultado, historial y barra de acciones
description: Piezas comunes a todos los nodos (título, estado, vista previa, tira de resultados, historial de generaciones, barra flotante de acciones) con sus condiciones de montaje.
tags: [nodes, tarjeta, resultados]
updated: 2026-10-28
related: [nodos-generacion, nodos-herramienta, nodos-texto-asset, ejecucion, puertos-enlaces]
---
# Tarjeta de nodo

`StudioNode` (`nodes.tsx:761`) dibuja todos los nodos de tipo `studio` (`NodeWorkspace.tsx:38`): texto, imagen, vídeo, audio, 3D, herramienta y asset. La barra de acciones (arriba) y el panel de ajustes (abajo) son `NodeToolbar` y solo se ven con **un único nodo seleccionado** (`showTools = selected && solo`, `nodes.tsx:777`); con varios seleccionados sale en su lugar la barra Operations ([agrupar-alinear](agrupar-alinear.md)). Un clic en el fondo lo oculta. El panel de ajustes existe solo para imagen, vídeo, audio, 3D y herramienta (`nodes.tsx:776`): texto y asset no tienen panel. Los nodos de grupo (marcos) son otro tipo.

## Cuerpo de la tarjeta

| Control | Dónde aparece | Cuándo aparece | De qué depende | Qué modifica | Influye en | Notas |
| --- | --- | --- | --- | --- | --- | --- |
| Título (doble clic para renombrar) | `nodes.tsx:754` | Siempre en la cabecera de la tarjeta | `node.data.title`, extensión del resultado (`nodes.tsx:726`) | `renameNode`: nombre limpio, y el resultado toma el mismo nombre (`flow/actions.ts:165`) | Nombre de descarga, búsqueda del lienzo | Campo «Name»: Intro o salir del campo confirma, Esc cancela (`nodes.tsx:746`). La extensión se muestra aparte y no se edita |
| Contador de historial «n/m» | `nodes.tsx:166` | Cabecera, si el nodo tiene 2 o más generaciones (con resultado, texto o aún sin terminar, `nodes.tsx:163`) | `generations` de la sesión con `stepId` = nodo | Abre el popover «Generation history» | Entradas del historial | Las generaciones se ordenan por fecha; marca la actual |
| Historial: Generation n (miniaturas) | `nodes.tsx:136` | Popover del historial | `g.assetIds` | — | — | Si no hay archivos muestra el texto, error o estado de esa generación (`nodes.tsx:174`) |
| Historial: ver generación n, resultado k | `nodes.tsx:142` | Cada miniatura | `g.assetIds` | `setUi({ lightbox })` y cierra el popover | Visor | |
| Historial: casilla «Add to the agent context» | `nodes.tsx:143` | Solo al pasar el puntero o enfocar (o en táctil, `ui.css:115`) | `composer.attachments` | `toggleAgentAttachment` (`engine/actions.ts:599`) | Adjuntos del agente | No copia ni envía nada: nombra el asset |
| Historial: Details | `nodes.tsx:146` | Cada resultado | `GenerationInfo` | Abre «Generation details» | — | Contiene «Delete asset» |
| Historial: Delete asset | `nodes.tsx:152` | Dentro de «Generation details» | Asset | `deleteAssets([assetId])`: borra el asset y su archivo (`engine/actions.ts:560`) | Galería y cualquier nodo que lo use | **Sin confirmación** y sin deshacer; si un flujo lo usa lo rechaza con toast (`engine/actions.ts:549`). Ver [hallazgos](hallazgos.md) |
| Historial: Restore parameters | `nodes.tsx:147` | Cada resultado | `restoreNodeGeneration` | Pone en el nodo el modelo, ajustes y prompt de esa generación (herramienta: operación y parámetros) sin ejecutar ni elegir su resultado (`flow/actions.ts:415`) | Panel del nodo | Toast «Parameters restored. Run when ready.»; es una edición normal (se deshace) |
| Estado (círculo) | `nodes.tsx:112` | Cabecera, si hay un intento (en marcha, error o hecho) | `nodeAttempt` | — | — | En marcha muestra el texto de estado y en error el mensaje solo como consejo al pasar el puntero (`data-tip`) |
| Vista previa del resultado | `nodes.tsx:203` | Cuerpo de la tarjeta (no en nodos de texto) | `useNodeOutput`: generación, asset elegido, sketch | — | Salida hacia otros nodos | Estados: en marcha con resultados parciales y insignia «n/m» (`nodes.tsx:217`), en espera con brillo y texto de estado, error (texto del error a la vista, `nodes.tsx:228`), texto de transcripción (`nodes.tsx:230`), vacío con pista, medios |
| Insignia «Edited» (sketch) | `nodes.tsx:248` | Nodo con `sketchAssetId` | `sketchAssetId` | — | — | Consejo: «Sketched · Reset image restores the original» |
| Tira de resultados (miniaturas) | `nodes.tsx:252` | Resultado con 2 o más archivos, nodo no Asset, sin sketch | `all` | `patchNodeData(outputIndex)` (`nodes.tsx:254`) | Qué resultado sale por «+» y por los enlaces sin número; la miniatura de entrada de un nodo destino muestra el resultado que entrega su enlace (`edge.outputIndex`, `nodes.tsx:389`, 063b00d; lectura de código, sin prueba en pantalla: el informe de sandbox la vio mostrar la elegida del nodo antes del arreglo) | Consejo «Use output n downstream» |
| Casilla «Add to the agent context» (resultado) | `nodes.tsx:143` (segunda aparición) | Al pasar el puntero o enfocar sobre el medio | `assetId` | Adjuntos del agente | — | Mismo componente; varias apariciones en la tarjeta |
| Doble clic en el cuerpo: abrir | `nodes.tsx:810`) | Nodo con resultado | `assetId` | `setUi({ lightbox })` | Visor | Duplicado de «Open» de la barra |
| Progreso de generación | `GenerationProgress.tsx:8` | Mientras el intento está `queued` o `running` | `nodeAttempt`, `useEta` | — | — | «Queued» o «Generating» con porcentaje solo si el proveedor lo da, tiempo estimado, texto de estado y barra (barra barrida si no hay porcentaje) |

## Barra de acciones (arriba del nodo seleccionado)

| Control | Dónde aparece | Cuándo aparece | De qué depende | Qué modifica | Influye en | Notas |
| --- | --- | --- | --- | --- | --- | --- |
| Run (o `$` estimado en el panel) | `nodes.tsx:59` | Nodos que ejecutan (imagen, vídeo, audio, 3D, herramienta) | `previewRun` | Abre la revisión de gasto | [ejecucion](ejecucion.md) | La barra muestra solo «Run»; el botón grande del panel lleva el coste |
| Detach outputs / Reattach outputs | `nodes.tsx:302` | Nodo con generación terminada de 2+ resultados y sin sketch; «Reattach» si ya está desacoplado | `useNodeOutput`, grupos | `detachOutputs` / `reattachOutputs` (`arrange.ts:196`) | Grafo | Una tarjeta por resultado; el original conserva su id en el resultado elegido |
| Acción rápida (Relight, Change angle, Upscale, Remove background…) | `nodes.tsx:306` | Nodo con resultado; hasta 4 operaciones `quick` cuya entrada coincide con la salida del nodo | `OPS[id].quick` | `addConnected` con un nodo de herramienta | Grafo | Para imagen salen las 4 primeras (Relight, Change angle, Upscale, Remove background); «Animate» (también `quick`) queda en More tools por el corte `slice(0, 4)` (`nodes.tsx:297`) |
| More tools (…) | `nodes.tsx:276` | Nodo con resultado | Operaciones sin varias entradas con esa entrada y no mostradas arriba | `addConnected` | Grafo | Incluye «Panorama» (Reframe a 21:9) para imágenes (`nodes.tsx:281`) y también las operaciones de máscara y voz; ver [hallazgos](hallazgos.md) |
| Open | `nodes.tsx:315` | Nodo con resultado | `all`, `assetId` | `setUi({ lightbox })` | Visor | |
| Sketch | `nodes.tsx:7` | Nodo con resultado de tipo imagen | `assetId` | `setUi({ sketch: { assetId, nodeId } })` | Editor Sketch | Guardar deja una copia pintada que sustituye al resultado aguas abajo (`SketchEditor.tsx:192`) |
| Reset image | `nodes.tsx:247` | Nodo con sketch | `sketch` | `setSketch(undefined)`: descarta el sketch y borra su copia (`flow/actions.ts:125`) | Resultado aguas abajo | La copia pintada se elimina sin confirmar |
| Attach to prompt | `nodes.tsx:328` | Nodo con resultado | `assetId` | `useAsReference`: añade el asset a los adjuntos del Composer y le da foco (`engine/actions.ts:581`) | Composer | Un 3D entra como su imagen de vista; si aún no la tiene avisa |
| Download | `nodes.tsx:331` | Nodo con resultado | `assetId` | `downloadAsset` | Archivo local | |
| Duplicate | `nodes.tsx:336` | Siempre en la barra | Nodo | `duplicateNode` | Grafo | |
| Delete (papelera con confirmación) | `nodes.tsx:86` | Siempre en la barra | Nodo | Abre «Delete “título”? Its results stay in the gallery.»; Delete lo borra (`nodes.tsx:100`) | Grafo | Es la única vía de borrado de nodos con confirmación; el resto (Supr, panel, menú) no la pide |

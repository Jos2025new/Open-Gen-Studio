---
type: inventario
title: Nodos de generación: imagen, vídeo, audio y 3D
description: Panel de ajustes de los nodos de generación (referencias, prompt, letras, modelo, ajustes dinámicos, número de imágenes, coste) y la lista completa de parámetros del nodo con su origen, rango y si se ven.
tags: [nodes, generacion, modelo, ajustes]
updated: 2026-10-28
related: [tarjeta-nodo, ejecucion, puertos-enlaces, dependencias, hallazgos]
---
# Nodos de generación

`GenNodeBody` (`nodes.tsx:570`) es el panel que cuelga **debajo** del nodo cuando es el único seleccionado (`nodes.tsx:785`); se monta para los tipos `image`, `video`, `audio` y `model3d` (`nodes.tsx:232`). Al montarse pide el esquema del modelo (`nodes.tsx:578`); mientras no llega, el chip de ajustes no se dibuja. Estos nodos **no** usan `MediaControls` (solo importan su glifo de proporción, `nodes.tsx:20`), ni `StyleFields`, ni los formularios de `AssetActions` (solo importan los iconos de `OP_ICONS`): los ajustes del Composer (realismo, captura, shot, semilla, negativo, tomas) **no tienen control** en el nodo.

## Panel

| Control | Dónde aparece | Cuándo aparece | De qué depende | Qué modifica | Influye en | Notas |
| --- | --- | --- | --- | --- | --- | --- |
| Referencias (miniaturas) | `nodes.tsx:402` | Panel de imagen, vídeo y 3D (el audio no tiene puertos de imagen, `nodes.tsx:382`) | Enlaces del grafo a los puertos de imagen del nodo | — | Entradas que irán al proveedor | Cada miniatura tiene consejo con el nombre del puerto y «· edited» si hay sketch |
| Miniatura de referencia (clic) | `nodes.tsx:407` | Referencia con resultado | `assetId` del origen | `setUi({ sketch })` para pintar encima, o abre el visor si el origen es 3D (`nodes.tsx:407`) | Sketch del nodo origen | El sketch se guarda en el nodo de origen, no en el actual |
| X de la referencia (Disconnect) | `nodes.tsx:416` | Referencia enlazada | Enlace | `disconnectEdges` | Entradas | |
| Ref (+) | `nodes.tsx:426` | Hay un puerto de imagen libre (el primer puerto sencillo sin enlace, o uno múltiple, en el orden de puertos: First frame, Last frame, References, `nodes.tsx:390`) | `inputPorts` | Abre «Add reference» (consejo «Add <puerto> from the gallery») | Siguiente fila | El nombre del puerto elegido solo se ve en el consejo y en el título del popover |
| Add reference: miniaturas | `nodes.tsx:431` | Popover de Ref | Las 12 imágenes más recientes de **toda** la biblioteca (`nodes.tsx:394`) | Crea un nodo Asset «Reference» a la izquierda y lo conecta (`nodes.tsx:399`) | Grafo, entradas | Sin imágenes: «Generate or upload an image first.» |
| Prompt (cuadro de texto) | `nodes.tsx:593` | Siempre en el panel | `d.prompt` | `patchNodeData({ prompt })` por pulsación | Texto enviado, estado «desactualizado» | Pista según tipo («Describe the image…», «Describe the model…», música, plano y movimiento); con enlace al puerto prompt: «Extra prompt (added after the connected text)». Sin límite de longitud en el código |
| Lyrics (cuadro de letras) | `nodes.tsx:608` | Audio con un parámetro de letras multilínea (`audio.ts:10`) y sin enlace al puerto `lyrics` | `settings.extras[clave]` | `normalizeStructured` → `settings.extras` | Texto enviado | Pista «Lyrics (or connect a text or lyrics node)» |
| Chip del modelo | `nodes.tsx:612` | Siempre en el panel | `d.modelRef`, `modelSummary` | Abre «Model» (`ModelList` de tipo `kind`, 420 px) | Siguiente fila | Sin modelo: «No audio model»; un `local::` se llama «Local Sketch» o «Local Motion». Cada tipo muestra solo modelos de su tipo (`ModelList.tsx:139`); la búsqueda, filtros y orden están descritos en [composer](../studio-controles/composer.md) |
| Elegir un modelo de la lista | `nodes.tsx:620`) | Popover del modelo | Esquema del nuevo modelo | `coerceSettings` adapta los ajustes (aspecto, resolución, duración al valor más cercano; vacía `advanced` y `audio`) y `setNodeModel` cambia el modelo (`flow/actions.ts:100`) | Ajustes, puertos y coste del nodo | Cambio explícito del usuario (clic en la fila). Los enlaces de salida que ya no encajan se quitan sin aviso. La lista usa los modelos conectados (`ModelList.tsx:139`) |
| Chip de ajustes (resumen) | `nodes.tsx:469` | Si el esquema ofrece proporción, resolución, duración, audio u opciones de audio (`nodes.tsx:466`) | `catalog.schemas[modelRef]` | Abre «Settings» (340 px) | Siguientes filas | El resumen muestra resolución, duración y proporción; sin nada, un icono de ajustes |
| Settings › Resolution | `nodes.tsx:488` | Modelo con opciones de resolución | `res.options`; activo = `settings.resolution` o la primera opción | `set({ resolution })` (`nodes.tsx:489`) | Coste | Control segmentado |
| Settings › Length | `nodes.tsx:494` | Solo vídeo con duraciones (opciones del modelo o rango entero min–max hasta 60 valores, `duration.ts:9`) | `durationChoices` | `set({ duration })` | Coste | 0 o negativo se rotula «Auto» (`duration.ts:22`) |
| Settings › Resolution (tamaño) y Ratio con píxeles exactos | `nodes.tsx:506` | Modelo cuyas proporciones son tamaños en píxeles | `pixelSizes` | `set({ aspect: px.pick(...) })` | Coste | El nivel («1K», «2K»…) y la proporción se derivan del área |
| Settings › Ratio | `nodes.tsx:513` | Modelo con lista de proporciones | `aspect.options` | `set({ aspect })` | Coste, forma del resultado | Cada opción lleva un glifo |
| Settings › Audio: Generate audio | `nodes.tsx:541` | Modelo con parámetro de audio | `settings.audio` | `set({ audio })` | Coste | |
| Settings › opciones del modelo de audio | `nodes.tsx:459` | Solo nodos de audio: parámetros booleanos o de lista del esquema con rol «other» | `settings.advanced[clave]`, valor por defecto del modelo | `setOption` guarda en `advanced` y borra la clave si vuelve al defecto | Petición | Los parámetros avanzados de imagen o vídeo **no** aparecen en el nodo |
| Images (1× a 4×) | `nodes.tsx:632` | Solo nodos de imagen | `settings.count` | `patchNodeData({ settings: { count } })` | Coste (cada resultado es una petición) y puertos numerados | Opciones fijas 1, 2, 3, 4 (`nodes.tsx:632`); el código de ajustes admite 1 a 8 (`settings.ts:102`). Vídeo, audio y 3D no tienen este control |
| Run con coste | `nodes.tsx:634` | Siempre en el panel | `previewRun` | Abre la revisión de gasto | [ejecucion](ejecucion.md) | La etiqueta del botón es el coste estimado |

## Parámetros de un nodo de generación (`GenNodeData`, `engine/types.ts:709`)

Al crear el nodo, el modelo y los ajustes se copian del Composer del tipo (con `seed: undefined`) (`flow/actions.ts:48`); al crearlo desde otro nodo del mismo tipo se copian de ese nodo (`addConnected.ts:23`).

| Control | Dónde aparece | Cuándo aparece | De qué depende | Qué modifica | Influye en | Notas |
| --- | --- | --- | --- | --- | --- | --- |
| `prompt` (texto libre) | Cuadro Prompt | Siempre | — | Texto enviado | Estado «desactualizado» | Por defecto vacío |
| `modelRef` | Chip del modelo | Siempre | Catálogo | Modelo | Todo el nodo | Por defecto el del Composer |
| `settings.aspect` (cadena de la lista del modelo) | Settings › Ratio | Si el modelo tiene lista | Esquema | Forma del resultado | Coste | Por defecto: la más cercana a 1:1 (16:9 para vídeo) (`settings.ts:81`) |
| `settings.resolution` | Settings › Resolution | Si hay lista | Esquema | Coste | | Por defecto: la del esquema o la primera; en vídeo la «media» (`settings.ts:28`) |
| `settings.duration` (segundos) | Settings › Length | Solo vídeo | Esquema | Coste | | Por defecto el del esquema, o 5 s si existe, o la primera opción |
| `settings.audio` (sí/no) | Settings › Generate audio | Si el modelo lo tiene | Esquema | | | Por defecto el del esquema o no |
| `settings.count` | Images | Solo imagen en el nodo | — | Peticiones y coste | | Por defecto 1 |
| `settings.seed` | Sin control | — | — | — | — | Se pone a `undefined` al crear; no hay forma de fijarlo en el nodo (el agente sí puede: `tools.ts:23`) |
| `settings.negative` | Sin control | — | Heredado del Composer | Se envía si el modelo lo admite (`settings.ts:135`) | | Oculto en el nodo |
| `settings.advanced` | Solo parámetros de audio | — | Heredado | Petición | | En imagen y vídeo oculto aunque se herede |
| `settings.shots` (varias tomas de vídeo) | Sin control | — | Heredado | Petición de vídeo con varias tomas | | Oculto |
| `settings.extras` | Solo letras (audio) | — | Heredado | | | Otros valores estructurados, ocultos |
| `settings.realism`, `settings.shot`, `settings.capture` | Sin control | — | Heredados del Composer | Cambian el texto que se envía a imagen y vídeo (`realism.ts:98`) | | Oculto; que se aplique en una ejecución desde nodo no está comprobado: sin confirmar |
| `outputIndex` | Tira de resultados / puertos numerados | Con 2+ resultados | | Resultado que sale por defecto | Nodos conectados | Por defecto 0 |
| `sketchAssetId` | Sketch / Reset image | Imagen | | Sustituye al resultado | Aguas abajo | |
| `textOutput` | Sin control | Nodos de audio cuyo modelo responde con texto | Modelo | Salida de tipo texto | Puertos | Se recalcula al cambiar de modelo (`flow/actions.ts:106`) |

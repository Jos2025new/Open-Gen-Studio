# Validación de modelos prioritarios

Revisión: 2026-09-24. Modelos: Wan 3.0 (y Prime), MiniMax H3 (H3, Fast, Developer, Max, Max Turbo), Seedance 2.0 (normal, Fast, Mini) y 2.5, FLUX 3 (y Edit Video), Veo 3.1 (normal, Fast, Lite), Kling V3 (Std, Pro, 4K, Turbo), Kling O3/Omni 3 (Std, Pro, 4K), Grok Imagine Video (1.0 y 1.5, Edit, Extend), Gemini Omni Flash (1.0 y 1.1), HappyHorse (1.0 y 1.1).

**Método.** Catálogos y esquemas públicos descargados en vivo, sin clave ni coste: Atlas (95 variantes, esquema OpenAPI de cada una), fal (116, OpenAPI de cola) y NanoGPT (63, `video-models?detailed=true` más su guía de vídeo). Cada esquema de Atlas y fal se pasó por nuestro `schemaFromJson`, y el de NanoGPT por la lógica de `videoSchema`. Se compararon las claves de entrada que declara el proveedor con los slots y parámetros resultantes. No se envió ninguna generación.

## Lo que ya funciona

- **Texto a vídeo**: todas las variantes de los tres proveedores. Prompt, duración, resolución, proporción, audio y semilla se reconocen.
- **Imagen a vídeo (primer fotograma y, donde existe, último)**: Wan 3.0/Prime (`image`/`last_image`), MiniMax H3/Fast/Developer/Max/Max Turbo (`image`/`end_image`), Seedance 2.0/2.5/Mini (`image`/`last_image`), Veo 3.1 (`image`/`last_image`, `first_frame_url`/`last_frame_url` en fal), Kling V3/O3 (`image`/`end_image`, `start_image_url`/`end_image_url`), Grok (`image_url`), Gemini Omni (`image`/`last_image`), HappyHorse (`image`), FLUX 3 (`image_url`, `start_image_url`/`end_image_url`).
- **Edición y extensión con vídeo de origen** (`video` / `video_url`): Gemini Omni Flash y 1.1 (edit, extend), Kling O3 video-edit, Grok edit-video, FLUX 3 edit-video y extend, HappyHorse 1.0 video-edit, Veo 3.1 extend (fal).
- **Duración automática (`-1`)**: Wan 3.0 y Seedance 2.5 la ofrecen; desde la tarea anterior se muestra como "Auto" y se estima con la duración máxima.

## Fallos encontrados

1. **Atlas oculta variantes sin categoría.** El catálogo sirve sin `categories` los 6 FLUX 3 (texto, imagen, primer/último fotograma, keyframes, extend) y los reference-to-video de Gemini Omni Flash, Gemini Omni 1.1 y HappyHorse 1.0/1.1. `listModels` los descarta y no aparecen en la app.
2. **Atlas clasifica mal algunas variantes.** Wan 3.0/Prime reference-to-video están en VIDEO-TO-VIDEO: la app las trata como "necesita vídeo" y no tienen campo de vídeo, así que nunca pueden ejecutarse. Grok extend-video y Kling motion-control están en IMAGE-TO-VIDEO: aparecen como imagen a vídeo, pero exigen un vídeo.
3. **Las imágenes de referencia nunca llegan a un modelo de vídeo.** El composer, el agente y los nodos envían la primera imagen solo como primer fotograma (`refs: []` en vídeo). Los reference-to-video sin primer fotograma (Veo 3.1, Grok, HappyHorse, Gemini Omni, Seedance, MiniMax, Kling O3) fallan con "cannot start from an image".
4. **`refers` de Atlas** (`[{url, type}]`, obligatorio en MiniMax H3/Fast/Developer reference, hasta 20 en Wan 3.0/Prime reference) no se reconoce.
5. **Vídeos de referencia sin soporte**: Atlas `reference_videos` (Seedance 2.0/2.5/Mini, Gemini Omni 1.1), fal `video_urls` (Seedance) y `reference_video_urls` (MiniMax H3/Max, Wan 3.0/Prime).
6. **NanoGPT clasifica mal los modelos multimodo.** Seedance 2.5 y Turbo, Wan 3.0 Prime, MiniMax H3 y H3 Max, Gemini Omni Flash y 1.1, FLUX.3, Kling O3 4K y HappyHorse 1.0 declaran vídeo como entrada opcional. La app los marca como "necesita vídeo": desaparecen de los selectores normales y pierden la imagen inicial.
7. **NanoGPT: referencias y último fotograma no se envían.** Varios modelos declaran `reference_images`/`reference_videos` (MiniMax H3, H3 Max, Seedance 2.0, Grok 1.5) o `last_image` (Seedance 2.0, H3 Singularity). La guía documenta `referenceImages`/`referenceVideos` (URLs o data URLs).
8. **Parámetro obligatorio descartado (fal).** MiniMax H3 Max/Max Turbo exigen `prompt_expansion_mode` (texto con valor por defecto `balanced`). El parser lo omite y la petición no lo incluye.
9. **Opción desactivada visible.** `omni_reference_task_type` de Seedance 2.5 viene marcada `disabled` y aun así se ofrece como ajuste.
10. **Límite de NanoGPT para el vídeo de origen**: `videoDataUrl` admite hasta 4 MB. Si el vídeo es mayor, la app lo envía igualmente y falla en el proveedor.

## Correcciones aplicadas (2026-09-24)

Todos los fallos 1–10 están corregidos:
- **Listado.** `needsVideo` (no puede ejecutarse sin vídeo) está separado de `acceptsVideo` (admite vídeo de origen). En Atlas, la tarea del nombre del endpoint manda sobre la categoría (`atlasVideoCaps`). En fal, reference-to-video nunca se clasifica como "necesita vídeo". En NanoGPT, solo edit/extend/motion-control necesitan vídeo; los multimodo aparecen en el selector normal y conservan la imagen inicial.
- **Entradas de vídeo.** `routeVideoInputs` y `videoInputProblem` (en `params.ts`), compartidas por el composer y `jobs.ts`. La primera imagen es el fotograma inicial si el modelo lo tiene; el resto son referencias (todas, si no lo tiene). Los vídeos adjuntos son referencias. El composer admite varias referencias y vídeos cuando el modelo los acepta.
- **Slots nuevos.** `refVideos` (`reference_videos`, `video_urls`, `reference_video_urls`; NanoGPT `referenceVideos`) y `mixedRefs` (`refers` de Atlas, que se sube y se envía como `{url, type}`). En NanoGPT, `referenceImages` y `last_image`.
- **Parser.** Los campos obligatorios con valor por defecto se envían fijos (`ModelSchema.fixed`). Las opciones `disabled` se omiten. NanoGPT rechaza antes de enviar un vídeo de origen de más de 4 MB. La caché de esquemas pasa a `v2`.

Verificación: 35 tests, incluidos fragmentos de los esquemas reales en `tests/fixtures/provider-schemas.json`. En el navegador, con los catálogos públicos, se comprobó el listado de FLUX 3 (Atlas y NanoGPT), Wan 3.0/Prime reference, Grok extend y Seedance 2.5 de NanoGPT. Además, con el envío interceptado, se comprobaron los payloads de Atlas (`refers`) y de NanoGPT (`imageDataUrl`, `referenceImages`). No se ha hecho ninguna generación de pago.

## Fuera de alcance (anotado, no corregido)

- **Audio de referencia** (`reference_audios`, `audio_urls`, `refers` de tipo audio, lip-sync, talking avatar): la app no tiene assets de audio.
- **Elementos de Kling** (`elements`/`element_list`, sujetos reutilizables), `multi_prompt` (multiplano) y `voice_ids` de Grok: requieren una interfaz propia.
- ~~FLUX 3 keyframes-to-video y Gemini reference-to-video-developer~~: implementados (ver `TRAZABILIDAD.md`, fase 3).
- **Seedance 2.5, edición y extensión explícitas** (un vídeo de 4–30 s, `ratio: adaptive`, `duration: -1`): con referencias se deja `omni_reference_task_type` sin fijar (modo automático del proveedor), como recomienda su documentación.
- **Kling motion-control** necesita imagen y vídeo a la vez; se lista como "necesita vídeo", pero la operación Edit video no aporta la imagen.
- NanoGPT no publica los nombres de sus campos de medios por modelo. `referenceImages`, `referenceVideos` y `last_image` con data URL siguen la guía, pero no se han probado con una generación real.

---

# Familias de imagen

Revisión: 2026-09-24. Familias: GPT Image 2 y 2.5 (Flare, Sunburst, developer), Seedream V5 (Pro, Lite, Flash, sequential, layerize), Nano Banana (1, 2, 2 Lite/Fast, Pro, Pro Ultra), Qwen Image (2.0, 2.1, 2512, 3.0, Max, Edit/Plus/2509/2511), Grok Imagine Image (1.0, Quality, 2.0), Step Image (Step1X Edit, StepX Edit 2, Step Image Edit 2), P Image (Pruna), Recraft (V3, V4, V4.1, Style, vector, utility), Ideogram (V2, V2a, V3, V4, Character) y Z-Image (Turbo, Base, image-to-image).

**Método.** El mismo que en vídeo: catálogos y esquemas públicos en vivo, sin clave ni coste. Atlas: 67 variantes. fal: 137. NanoGPT: 76. Atlas no tiene Recraft, P Image ni Step. Cada esquema se pasó por el parser real.

## Lo que ya funcionaba

- Texto a imagen y edición en las diez familias. Prompt, número de imágenes, semilla y prompt negativo se reconocen.
- Imágenes de entrada: `images` (Atlas), `image_urls`/`image_url` (fal) e `imageDataUrls` (NanoGPT), con sus máximos (hasta 16 en GPT Image 2.5 y 14 en Nano Banana 2).
- Proporción en los modelos con `aspect_ratio` o `image_size` preestablecido (Nano Banana, Grok, Ideogram y Recraft en fal…), y resolución `1k`/`2k`/`4k`.

## Fallos encontrados

1. **Tamaño en píxeles ignorado como proporción (Atlas).** GPT Image 2 y 2.5 y Seedream V5 exponen `size` como lista de píxeles (`2048x1152`, `2048*2048`). El parser lo trataba como resolución: una proporción pedida por el agente o el composer (16:9) se descartaba sin aviso.
2. **Tamaño de texto libre descartado (Atlas).** Qwen Image 2.0 y 3.0 y Z-Image Turbo usan `size` como texto `ancho*alto` sin lista de valores. No había ningún control de encuadre: Z-Image salía siempre en retrato (`1024*1536`, su valor por defecto).
3. **Imagen de origen en el campo equivocado (fal).** Ideogram V3 remix, reframe y replace-background exigen `image_url`, y el parser elegía `image_urls` (referencias de estilo opcionales). Ideogram Character exige `reference_image_urls` y se elegía `image_urls`.
4. **Campos obligatorios imposibles de enviar.** Máscaras (Ideogram edit, Qwen inpaint, Z-Image inpaint) y `video_clips` (Nano Banana 2 y 2 Lite reference-to-image en Atlas). La app lanzaba la petición y el proveedor la rechazaba.
5. **NanoGPT: encuadre mezclado.** Seedream V5 Pro y la versión alternativa ponen proporciones y niveles en el mismo `resolution` (`16:9`, `2k`). Se trataba como resolución y la proporción pedida se perdía.
6. **NanoGPT: imágenes en endpoints solo de texto.** GPT Image 2.5 text-to-image, Nano Banana Pro Ultra y Qwen Image Max declaran `max_input_images`, pero su entrada es solo texto. La app ofrecía adjuntar imágenes.
7. **"Auto" con otro nombre.** P Image usa `match_input_image` y Seedance `adaptive`. Solo se reconocía `auto`, así que las operaciones sobre una imagen no conservaban su encuadre.

## Correcciones aplicadas

- Una lista de tamaños en píxeles es el control de encuadre ("Size"). Al pedir una proporción se elige el tamaño más cercano con la escala del valor por defecto (16:9 → `2048x1152` en GPT Image 2).
- Un `size` de texto `ancho*alto` genera tamaños para 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3 y 21:9, a la escala del valor por defecto o del máximo documentado. Si el modelo puede elegir el tamaño, se ofrece "Auto", que no se envía (`ParamDef.omit`).
- La imagen de origen va al campo obligatorio (`image_url`, `reference_image_urls`) cuando la lista alternativa es opcional.
- `ModelSchema.missing`: los campos obligatorios que la app no puede enviar bloquean el envío con un mensaje claro ("needs mask_url…"), antes de gastar.
- NanoGPT: el `resolution` mixto es el encuadre, y solo se adjuntan imágenes si el modelo declara entrada de imagen.
- `isAutoOption` reconoce `auto`, `match_input_image` y `adaptive`. La caché de esquemas pasa a `v3`.

Verificación: 39 tests, con fragmentos reales en `tests/fixtures/image-schemas.json`. En el navegador, con catálogos públicos y el envío interceptado, un 16:9 se envió como `size: 2048x1152` (GPT Image 2), `2048*1152` (Qwen 3.0), `1536*864` (Z-Image) y `resolution: 16:9` (Seedream V5 Pro en NanoGPT). Nano Banana 2 reference-to-image muestra "needs video_clips". No se hizo ninguna generación de pago.

## Fuera de alcance

- Máscaras (inpaint, edit con máscara, object removal): la app no tiene editor de máscaras. Estos modelos se bloquean con aviso.
- Paletas y estilos de Recraft (`colors`, `style_id`, `background_color`), `style_codes` y `color_palette` de Ideogram, y `mask` opcional de GPT Image 2.5.
- LoRA (`loras`), ControlNet, tiling, `custom-models` de Ideogram y `rendering_speed` de Ideogram en NanoGPT.
- Seedream sequential: `max_images` (series de hasta 15) se ofrece como ajuste avanzado, no como número de imágenes.

---

## Cobertura ampliada (2026-09-25)

Lo marcado antes como "fuera de alcance" se fue implementando por fases; el detalle, las pruebas y los límites de cada una están en `TRAZABILIDAD.md`:

- **Hecho:** extender vídeo y reglas de Seedance 2.5 (fase 2); keyframes de FLUX 3 y clips recortados (fase 3); audio como asset y como entrada, y transcripción (fases 4a y 4b); avatares parlantes (InfiniteTalk, OmniHuman 1.5) y música y letras de MiniMax (fase 4c); sujetos de Kling, multiplano y voces (fase 5); máscaras en Sketch (fase 6); paletas, `style_codes`, `style_id` y `model_id` (fase 7).
- **Pendiente:** LoRA, ControlNet y tiling (fase 8), motion-control de Kling desde el vídeo y desde la imagen (fase 9). Otras familias de audio, cuando el usuario las elija.

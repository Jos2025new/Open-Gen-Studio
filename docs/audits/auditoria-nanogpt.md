# Auditoría NanoGPT: documentación oficial vs código (solo lectura)

Fecha: 2026-10-25. Repo: ogs-auto-plan-card. Código: `src/engine/providers/nanogpt.ts` (L = línea), `shared.ts`, `bodyBudget.ts`, `registry.ts`.
Método: leí las páginas de docs en crudo (`.md`) y el catálogo público `GET /api/v1/video-models?detailed=true` y `/api/v1/images/models`. Cero llamadas de pago, cero claves.

**Verificado por Manus AI (2026-10-25)** contra la doc y las fichas públicas, sin repo ni JSON del catálogo. Veredicto: fiable sobre las capacidades de NanoGPT, no concluyente sobre fallos del código. Sus correcciones están aplicadas abajo (filas 1, 2, 5, 6, 8, P2-1, P2-6, P2-10, P2-11, P2-13). Lo que dejó pendiente de código se comprobó en el repo y se indica «código comprobado». Endpoints, estados, `data.output.video.url`, `recover` y `referenceImages`/`referenceVideos` en camelCase: confirmados.

## Hallazgo de fondo

NanoGPT no documenta ningún endpoint de subida que devuelva una URL. `llms.txt` solo lista "API Hosts: ... uploads" (subidas de lotes de ficheros) y no hay página de upload/media.
Para imagen/vídeo hay tres vías oficiales:
1. `imageDataUrl` / `videoDataUrl` en base64.
2. `imageUrl` / `videoUrl` con una URL HTTPS pública.
3. `imageAttachmentId` / `videoAttachmentId` (referencia a "library-stored", sin endpoint documentado para crearlos).

Para los campos por modelo del catálogo (`reference_images`, `last_image`, `reference_videos`, `reference_audios`) el catálogo dice "URL" y no ofrece alternativa data URL ni subida. Esos campos son solo para URLs públicas. Para un fichero local no hay camino oficial.
Que lo del "solo URLs http(s)" estuviera escrito en el catálogo es verdad. El código ya lo detecta en `urlOnly()` (L267). Lo que falta es lo de abajo.

## 1. Tabla GAP / WRONG (ordenada por impacto en calidad/fallos de vídeo; las filas P2-x son de la segunda pasada)

| # | Veredicto | Modelo(s) | Qué dice la doc | Qué hace el código | Impacto |
|---|---|---|---|---|---|
| 1 | GAP | Todos los vídeo con imagen inicial | Doc: "Uploads sent via the API must be 4 MB or smaller. For larger assets, host them externally and provide an `imageUrl`" (https://docs.nano-gpt.com/api-reference/video-generation.md). Además https://docs.nano-gpt.com/api-reference/miscellaneous/api-hosts.md: el host `https://api.nano-gpt.com` "has a higher request size limit" que `nano-gpt.com`. | Siempre se envía a `nano-gpt.com` (L13) y, si el cuerpo pasa de 4 MB, `fitBody` (bodyBudget.ts:4,55) recomprime TODAS las imágenes a JPEG y baja a 2048, 1536 o 1024 px. Nunca se usa `imageUrl`. | El fotograma inicial/refs pierde resolución y calidad en silencio con PNG grandes. El host API recomendado por la doc admite cuerpos mayores (límite exacto para generate-video: UNKNOWN). Manus: un límite HTTP mayor no prueba que el endpoint acepte más de 4 MB; no quitar el tope de 4 MB solo por cambiar de host. Código comprobado: `fitBody` solo recomprime si el cuerpo pasa de 4 MB, en escalones 2048 → 1536 → 1024 px. |
| 2 | WRONG (comentario obsoleto) | Todos | `api-hosts.md` recomienda `api.nano-gpt.com` para peticiones con adjuntos grandes y generación larga. | L12 dice que `api.nano-gpt.com` sirve un catálogo desactualizado. Hoy lo comprobé: `video-models?detailed=true` en ambos hosts devuelve 193 modelos y contiene los 8 ids vídeo principales. | La razón para quedarse en `nano-gpt.com` (y su límite Vercel de 4,5 MB) ya no se sostiene para vídeo. Si `images/models` aún difiere en el host API: no lo comprobé. Manus no pudo verificar los 193 modelos iguales; NanoGPT avisa que los catálogos de ambos hosts pueden diferir durante despliegues. |
| 3 | GAP | `alibaba/wan-3.0/image-to-video`, `alibaba/wan-3.0-prime` | Catálogo: "Animate a first-frame image ... with optional last-frame guidance"; tags `first-last-frame`. Pero `supported_parameters` NO lista campo alguno de imagen. | `lastFrame` solo existe si `'last_image' in defs` (L291). Para Wan 3.0 no existe en el catálogo, así que no hay slot de último fotograma. | Se pierde la función de primer+último fotograma de Wan 3. El nombre del campo en NanoGPT es UNKNOWN (doc silenciosa). Hay que probar `last_image` o consultar a NanoGPT. |
| 4 | GAP | `bytedance/seedance-2.5`, `alibaba/wan-3.0-prime`, `alibaba/wan-3.0/reference-to-video`, `minimax-h3` | Seedance 2.5: "text, image, multimodal-reference, video-edit, or video-extend ... from the supplied inputs", entradas image/video/audio. Wan 3 ref: entradas imagen+vídeo+audio. El catálogo no lista campos de referencias para 2.5 ni Wan. | Referencias de imagen: `takesRefs` exige `refModel`, `'reference_images' in defs` o `mode` con `reference-to-video` (L283). Seedance 2.5 y Wan-prime no cumplen nada de eso, así que sin slot de referencias. Wan reference-to-video sí (id) y envía `referenceImages`. Vídeos y audios de ref: solo si `reference_videos`/`reference_audios` están en el catálogo (L295, L304), y en Wan 3 no están. | Modelos que anuncian refs multimodales no reciben refs. Nombre y formato (URL vs data URL) de los campos: UNKNOWN. |
| 5 | NO DOCUMENTADO (rechazo sin probar) | Cualquier modelo con audio de referencia | La doc solo conoce `audioDataUrl`, `audioUrl`, `audio` (https://docs.nano-gpt.com/api-reference/endpoint/video-generation.md). No existe `referenceAudios`. | L304 usa `key: 'referenceAudios'` (el propio comentario L297 dice "unverified"); L498-499 manda audio con `encodeVideo`. | Clave inventada por analogía; Manus confirma que no está documentada, no que el servidor la rechace. Solo se activa si el catálogo trae `reference_audios` (MiniMax H3, Seedance 2.0, URL-only, así que hoy no se activa). Riesgo latente. |
| 6 | POSIBLE (no demostrado) camelCase vs snake_case | Los que usen referencias | La doc genérica lista `referenceImages` / `referenceVideos` (camelCase); el catálogo por modelo lista `reference_images` / `reference_videos` (snake_case). | El código lee el catálogo en snake_case para decidir el slot (L283, L295) pero envía camelCase (`referenceImages`, `referenceVideos`, L293-295). | Para Wan 3 reference-to-video (sin campo en catálogo) vale la doc genérica y es coherente. Para cualquier modelo que sí liste `reference_images` el nombre enviado difiere del que anuncia su catálogo. Cuál acepta el servidor: UNKNOWN. Solo se afecta si la lista no es URL-only. Manus: puede haber normalización interna; es incompatibilidad potencial, no comprobada. |
| 7 | GAP (UX engañosa) | `minimax-h3` | Catálogo: el parámetro `resolution` se llama "LoRA / Edit / Extend Resolution" y dice "Generation without LoRAs remains 2K". | El código lo expone como `resolution` normal (default 480p del catálogo) y lo manda si el usuario lo fija. | El usuario cree que elige resolución de generación y la doc dice que sin LoRA es 2K fija. Efecto real en una generación normal: UNKNOWN. |
| 8 | GAP | `bytedance-seedance-2-0(-fast/-mini)` | `reference_images`, `last_image`, `reference_videos`, `reference_audios` = solo URLs ("Optional JSON array of image URLs", "Last Frame URL (I2V)"). Etiquetas "(T2V)" en refs y "(I2V)" en last_image. | `urlOnly` los descarta correctamente (L267-304). El fotograma inicial se envía por `imageDataUrl`. | Correcto en el código. Consecuencia: en Seedance 2.0 solo se puede dar primer fotograma local; sin refs ni último fotograma salvo URL pública. Las etiquetas T2V/I2V sugieren que refs e imagen inicial son excluyentes (la doc no lo dice en prosa). El código no lo impone (L494-496 manda ambos si existen). UNKNOWN si falla. Manus: exclusividad sin demostrar. |
| 9 | GAP | `kling-v30-pro` | Catálogo: `multi_prompt` (JSON), `element_list` (JSON), `cfg_scale`, `sound`. La doc genérica: Kling admite `negative_prompt`. El catálogo de v30-pro no lista `negative_prompt`. | `multi_prompt` y `element_list` (type text) se descartan en el filtro de L271. No hay tail image (catálogo silencioso). `negative_prompt` no se manda (sin parámetro en catálogo). | Se pierde multi-shot y elementos de Kling v3 (la propia tarjeta de "Shots" no los usa aquí). Soporte real de negative_prompt en v30-pro: UNKNOWN. |
| 10 | GAP menor | Todos con imagen | `imageUrl` (HTTPS) es alternativa documentada a `imageDataUrl`. | No hay camino a `imageUrl` aunque el activo sea ya una URL remota (p. ej. salida previa de otro modelo). | Obliga a base64 + límite 4 MB cuando ya había URL. |
| 11 | CONTRADICCIÓN en doc | `imageDataUrl` | `video-generation.md` (endpoint): "Recommended for private assets or files larger than 4 MB". Guía general: "Uploads sent via the API must be 4 MB or smaller". | Tope de cuerpo total 4 MB. | Límite real por imagen: UNKNOWN. |
| 12 | UNKNOWN | Prompt con referencias | La doc de NanoGPT no define sintaxis `@image1` ni por modelo. | `modelRules.ts:100-118` toma las sintaxis de los esquemas de Atlas/fal y de guías externas. | Aplicadas a NanoGPT sin confirmación oficial. |
| P2-1 | GAP (alto) | `minimax/h3-max`, `minimax/h3-max-turbo`, `google/gemini-omni-flash/v1.1` (y `bytedance/seedance-2.5`: su ficha anuncia primer y último fotograma, añadido por Manus) | El catálogo da campos propios `imageUrl` (inicio) y `lastImageUrl` (final) que aceptan "Public HTTP(S) image URL or base64 image data URI (data:image/...;base64,...)". | El último fotograma exige `'last_image' in defs` (nanogpt.ts:291), así que NO hay slot de último fotograma. El inicio se manda como `imageDataUrl` (L290), no como el `imageUrl` del catálogo. | Se pierden los fotogramas finales en 3 modelos que los anuncian y que aceptan data URL. Sí se puede enviar local. |
| P2-2 | GAP (alto) | `minimax/h3-max` (y Gemini Omni v1.1) | "End frames cannot be combined with reference media or reference-to-video mode" / "...with reference images, reference videos, or a source video". "Requires a start image". Exclusión explícita en la doc. | Ninguna validación: L494-499 manda todo lo que haya. | Fallo de validación del proveedor si se combinan. |
| P2-3 | GAP | `alibaba/wan-3.0-prime/video-extend`, `.../video-edit` | extend: "optional target last-frame guidance"; edit: "optional image or audio references". Sin campos en catálogo. | Sin slot para ninguno (solo `videoDataUrl`). | Funciones anunciadas sin camino de entrada; nombres UNKNOWN. |
| P2-4 | GAP | `kling-o3-4k` (única ruta O3 en NanoGPT) | "text, image, and reference-image workflows" y `source_video_mode` (`video-edit` / `video-reference`). Sin campo de referencias en el catálogo. | Sin slot de refs (L283); `source_video_mode` solo vía `advanced`. | No se pueden pasar refs de imagen a O3; nombre del campo UNKNOWN. |
| P2-5 | GAP | `kling-video-o1`, `-o1-standard` | Doc: "Reference-to-Video supported by `kling-video-o1`, `kling-video-o1-standard`, `wan-wavespeed-26`. Use `referenceImages` with image URLs or data URLs". `mode` incluye `reference-to-video`. | Slot `referenceImages` activo (por `modes`), pero `max` cae a 4 (L293, `upTo` sin descripción) y `mode` no se fija solo. | Tope real de refs UNKNOWN. Con `mode: auto` el servidor decide (no probado). |
| P2-6 | GAP | `grok-imagine-video-reference-to-video`, `xai/grok-imagine-video/v1.5/image-to-video` | ref-to-video: "supports prompt references like @Image1"; sin campo de refs en catálogo. v1.5: `reference_images` = URL. | ref-to-video: slot `referenceImages` por id, min 1. v1.5: refs descartadas (urlOnly). | Nombre del campo UNKNOWN en ref-to-video. v1.5 sin refs locales. Manus: NanoGPT anuncia hasta 7 referencias; código comprobado: el máximo cae a 4 (`upTo(…, 4)`, L293). 1080p de Grok 1.5 solo en t2v: restricción real sin validar. |
| P2-7 | GAP | `bytedance/seedance-2.5/talking-avatar` | `audio`: "Required voice recording, up to 120 seconds"; 480p/720p. Formato (URL/data URL) no dicho. | Slot `audio` requerido (L298) con data URL. El audio de 120 s va inline y `fitBody` solo reduce imágenes: puede superar 4 MB y abortar ("Nothing was sent"). | Formato UNKNOWN; riesgo de bloqueo por tamaño. |
| P2-8 | GAP | `google/gemini-omni-flash/v1.1` | Multimodal reference e instruction-based editing anunciados; solo `imageUrl`/`lastImageUrl` en catálogo. `aspect_ratio` solo 16:9 y 9:16. | Sin slots de refs; `video` slot (videoDataUrl) sí. | Refs UNKNOWN. |
| P2-9 | GAP | `minimax/h3-max` | `aspect_ratio` incluye `adaptive`; `prompt_expansion_mode`, `enable_safety_checker`. | L505 elimina cualquier aspecto que no sea ratio ni `auto`, así que `adaptive` no se puede enviar. `prompt_expansion_mode` solo en `advanced`. | Menor. |
| P2-10 | GAP | `xai/grok-imagine-image/v2.0/*`, `quality/*` | Descripción: "1K or 2K output, and selectable low or medium quality". Los precios son por `1k`/`2k` pero el catálogo llama `resolutions` a las proporciones (16:9...). | El código manda `resolution: "16:9"` (imageSchema L199-201). No hay selector de 1K/2K ni de calidad. | Manus: NanoGPT sí muestra calidad Low/Medium y 1K/2K; es una brecha de integración nuestra (sin selector), no una ausencia en NanoGPT. Nombre del campo UNKNOWN. Se factura según el tier por defecto del servidor. |
| P2-11 | GAP | `ideogram/v4.5`, `ideogram/vector` | "low, medium, and high quality, prompt expansion". Corrección de Manus: V4.5 da hasta 8 imágenes de *salida* y ninguna de entrada; las referencias son de la ruta `ideogram/v4.5/edit`. Vector: salida SVG, referencias y conversión a vector; `ideogram/v4.5/edit`: "optional masks select the edit region". Ninguno en `supported_parameters`. | No hay selector de calidad ni slot de máscara para NanoGPT imagen. | Calidad y máscara inaccesibles; campos UNKNOWN. |
| P2-12 | GAP menor | `nano-banana-2.1` | `seed {type:"integer"}`, `enable_web_search {type:"boolean"}`, `system_prompt {type:"string"}`, `thinking_level`, `output_format`. | imageSchema solo convierte `enum`/`range`/listas (L214-223). `thinking_level` y `output_format` sí; `seed`, `enable_web_search`, `system_prompt` se ignoran. | Sin semilla ni búsqueda web en 2.1. (El precio es "actual_usage": estimado.) |
| P2-13 | UNKNOWN | `recraft-ai/recraft-v4*-style/*` | "up to 10 style references or a reusable Recraft style ID". | Refs de imagen sí (max 10); el style ID no tiene campo. | Manus: el style ID está documentado como capacidad y control; solo falta el nombre del parámetro. |

## 2. Detalle por modelo

Rutas de código: envío `generate()` L449-520; esquema `videoSchema()` L269-310; `imageSchema()` L191-242; sondeo `pollVideo()` L580-600.

### Vídeo: reglas comunes (https://docs.nano-gpt.com/api-reference/video-generation.md y /endpoint/video-generation.md)
- POST `/api/generate-video`, respuesta 202 con `runId`/`id` (`vid_...`), `status: "pending"`, `cost`. Código: L509-519, OK.
- Sondeo: `GET /api/video/status?requestId=` o `runId`, auth `x-api-key`. Estados `IN_QUEUE`, `IN_PROGRESS`, `COMPLETED`, `FAILED`, `CANCELED`. Resultado en `data.output.video.url`; error en `data.error`/`userFriendlyError`. Código: L582-598 más `extractOutputs`/`extractErrorMessage`. OK. Intervalo 5 s, máximo de espera 30 min (`pollJob`, shared.ts:183). La doc sugiere unos 10 min; el código es más permisivo, OK.
- Recuperación: `GET /api/generate-video/recover?model&limit<=50`, 20/min. Código L537-545, OK.
- La doc avisa: "Provide only the media fields that your target model expects. Extra media inputs often trigger validation errors." El código solo manda los campos con slot, pero no impide combinar imagen inicial + refs (ver fila 8).
- `duration`: la doc genérica dice string ("5"). El catálogo manda: para `select` se envía el valor de la opción (cadena); para `number` (Wan 3: min 2, max 30) se envía número (params.ts:892-899). Coherente con el catálogo.
- Subida local: no documentada (ver "Hallazgo de fondo").
- `seed`: `number or string`, "forwarded on model/provider routes that support it".

### bytedance-seedance-2-0-mini
| Entrada | Doc/catálogo | Código | Veredicto |
|---|---|---|---|
| prompt | genérico | `body.prompt` L452 | OK |
| imagen inicial | `imageDataUrl` o `imageUrl` (genérico); catálogo sin campo propio | `imageDataUrl` data URL (L290, L494) | OK (formato aceptado); límite 4 MB: ver fila 1 |
| último fotograma | `last_image`: URL | descartado (urlOnly) | OK, limitación |
| refs imagen/vídeo/audio | `reference_*`: arrays de URL | descartados | OK, limitación |
| duración | select 5..12 | opciones del catálogo | OK |
| resolución | 720p, 1080p | catálogo | OK |
| aspect_ratio | 16:9, 9:16, 4:3, 3:4, 1:1, 21:9 | catálogo | OK |
| audio | `generateAudio` default true | role audio, se manda si el usuario lo fija | OK. Si no se manda, el default del servidor es true (genera y puede cobrar audio) |
| `variant` | standard/turbo | solo si va en `advanced` | OK |
| `enable_web_search` | switch | solo en `advanced` | OK |
| seed / negative | no listados | no se mandan | OK |

### bytedance-seedance-2-0-fast y bytedance-seedance-2-0
Igual que mini, con estas diferencias:
- duración 5, 10 o 15.
- sin `generateAudio` (capabilities `audio_generation: false`).
- `reference_videos`/`reference_audios`: "(max 15s total)".
- Todo lo que sea URL queda fuera por `urlOnly`.
Veredicto: OK con la limitación de la fila 8.

### bytedance/seedance-2.5
| Entrada | Doc/catálogo | Código | Veredicto |
|---|---|---|---|
| modalidades | text, image, video, audio | `takesVideo` true | video slot `videoDataUrl` (L305) |
| `mode` | auto, text-to-video, image-to-video, video-edit, video-extend | role other, no se manda salvo `advanced` | OK ("auto" infiere por entradas) |
| imagen inicial | no hay campo en catálogo; descripción: "image and video inputs determine framing" | `imageDataUrl` | OK (genérico), UNKNOWN en particular |
| refs imagen/vídeo/audio | descripción "multimodal-reference"; sin campo | sin slot | GAP / UNKNOWN (fila 4) |
| vídeo fuente | `videoUrl` (preferido) / `videoDataUrl` máx. 4 MB | `videoDataUrl`, tope 4 MB (L84, L501) | OK; falta `videoUrl` |
| duración 4..30, resolución 480p..4k | catálogo | catálogo | OK |
| `aspect_ratio` | "Used for text and multimodal-reference generation; image and video inputs determine framing" | se manda siempre que esté fijado | inocuo, el servidor lo ignora con imagen |
| audio | `generate_audio` (snake_case) | role audio detecta el parámetro del catálogo | OK |

### minimax-h3
| Entrada | Doc/catálogo | Código | Veredicto |
|---|---|---|---|
| prompt | `max_prompt_characters` 4000 | no se valida el tope | GAP menor. UNKNOWN si trunca o rechaza |
| `mode` | auto, reference-to-video, video-edit, video-extend | solo `advanced` | OK |
| duración 3..15 | catálogo | OK | OK |
| aspect_ratio | auto, 21:9, 16:9, 4:3, 1:1, 3:4, 9:16, 9:21 | OK | OK. "auto" se conserva (L505) |
| resolución | "LoRA / Edit / Extend Resolution"; sin LoRA fija en 2K | se manda como resolución normal | GAP (fila 7) |
| refs imagen/vídeo/audio | "Optional URL, one URL per line, or a JSON array of URLs" | descartados por urlOnly | OK, limitación. Con ref vacía no se puede dar refs locales |
| imagen inicial | no listada; modalidad image | `imageDataUrl` | UNKNOWN por modelo |
| LoRA | `lora_url_N` (HTTPS) | omitidos | OK |
| seed | -1..2147483647 | role seed | OK |
| audio | `generate_audio` ("Generate Edit Audio") | role audio | OK, etiqueta del catálogo indica que es solo para edición |

### alibaba/wan-3.0 (t2v / i2v / reference-to-video; prime)
| Entrada | Doc/catálogo | Código | Veredicto |
|---|---|---|---|
| t2v | prompt + resolución 480/720/1080 + aspect (16:9, 9:16, 1:1, 4:3, 3:4) + duración 2..30 (number) + `thinking_mode` + `enable_audio` + `seed` (0..2147483647) | role audio detecta `enable_audio`; `thinking_mode` va a `advanced` | OK |
| i2v primer fotograma | "first-frame image"; sin campo en catálogo | `imageDataUrl` | UNKNOWN nombre, formato genérico OK |
| i2v último fotograma | "optional last-frame guidance" | sin slot | GAP (fila 3) |
| aspect_ratio i2v | "" = Auto ("the input image ratio is used when omitted") | `''` se elimina antes de enviar (L505) | OK |
| reference-to-video | imágenes+vídeos+audios; "input plus output duration may not exceed 30 seconds" (prime) | solo `referenceImages` (key genérica, max 4 por defecto L293 porque no hay "up to N") | GAP: vídeos/audio sin slot; tope de imágenes UNKNOWN |
| prime | `mode` auto/t2v/i2v/ref | solo `advanced` | OK |
| duración + vídeos de ref | límite 30 s entrada+salida (prime) | sin validación | GAP menor |

### kling-v30-pro
| Entrada | Doc/catálogo | Código | Veredicto |
|---|---|---|---|
| duración 3..15 (select) | catálogo | OK | OK |
| aspect_ratio 16:9, 9:16, 1:1 | "Applies to text-to-video" | se manda siempre | inocuo con imagen (el servidor lo ignora, no documentado) |
| audio | `sound` | role audio | OK |
| imagen | "Upload an image to switch to image-to-video" | `imageDataUrl` | OK |
| `cfg_scale` 0..1 | catálogo | `advanced` | OK |
| `multi_prompt`, `element_list` (JSON) | catálogo | descartados | GAP (fila 9) |
| negative_prompt | doc genérica de Kling: sí; catálogo v30: no | no se manda | UNKNOWN |
| aviso | "currently timing out frequently due to high demand" | sin tratamiento especial | informativo |

### Imagen: reglas comunes
Páginas: https://docs.nano-gpt.com/api-reference/image-generation.md, /endpoint/image-api-generate.md, /endpoint/image-api-model-endpoints.md.
- La API normalizada es `POST /api/v1/images` con `input_references` (URL, data URL u objeto `image_url`). "Do not mix `input_references` with legacy image aliases such as `imageDataUrl`, `imageDataUrls` ... in the same request."
- El código usa `/v1/images` pero manda `imageDataUrls` (L237, L456) y el comentario (L236) dice que `input_references` se ignora "despite the docs", verificado 2026-09-25. Contradice la doc; la verificación empírica prevalece, pero ver nota. Manus pidió el registro de esa prueba: está en [historial 014](../history/014-2026-09-W39.md) (punto 1 de NanoGPT: probado sin coste con `birefnet/v2`, en ambos hosts; la imagen solo llegaba como `imageDataUrl(s)`). Es la evidencia; se conserva hasta que una prueba nueva diga lo contrario.
- `n` se normaliza a `nImages` (OK, L208).
- Límites por ruta (`input_image_constraints`): máx. 8x8 mín., 16384 px máx., 31457280 bytes (30 MiB), formatos png/jpeg/webp. El código recorta a 4 MB de cuerpo total (bodyBudget). Es más estricto que la doc; con `api.nano-gpt.com` podría relajarse (límite exacto: UNKNOWN).

### nano-banana-2
- Entrada máx. 14 imágenes (`max_input_images`); salida máx. 4. Resoluciones 1k/2k/4k, aspect_ratio incl. `auto`, `21:9`. Sin `seed`/`quality` en el catálogo.
- Código: `images` slot `imageDataUrls`, max 14, `n` max 4. Resolución/aspect del catálogo, `auto` filtrado de resolución (L194). OK.
- Variante "edit": en el catálogo oficial no existe `nano-banana-2-edit` (hay `nano-banana-2`, `-2.1`, `-2-lite`, `-2-fast`). `registry.ts:122` solo crea `-edit` para `nano-banana`/`nano-banana-pro`. El propio `nano-banana-2` ya acepta imágenes. Consistente con `PREFERRED.nanogpt.edit` (registry.ts:70). OK.

### nano-banana-pro y nano-banana-pro-edit
- pro: entrada máx. 10, salida máx. 4, 1k/2k/4k. pro-edit: entrada 10, salida 10.
- Código idéntico (L191-242). OK.

### seedream-4.5-alternative
- Entrada máx. 10, salida máx. 4. `resolutions` son tamaños (1920x1920 ... 4096x4096), sin `aspect_ratio`. El código lo trata como "framing" (L199) y lo mapea al aspecto. OK.
- Variantes edit de Seedream 4.5: no hay; el mismo id hace t2i e i2i (`image_to_image: true`). OK.

## 3. Respuestas a preguntas concretas
- ¿Endpoint de subida para obtener URL de un fichero local? No documentado (UNKNOWN). Solo: data URL, URL HTTPS pública, o `*AttachmentId` de biblioteca (sin endpoint para crearlo documentado).
- ¿Cómo se consulta el resultado? `GET /api/video/status?requestId=<runId>` (o `runId`) hasta `COMPLETED`/`FAILED`/`CANCELED`; URL en `data.output.video.url`. El código coincide. Endpoint antiguo `/api/generate-video/status` está "Deprecated".
- ¿Restricción "refs y primer fotograma excluyentes"? No hay frase en la doc. Evidencia indirecta: etiquetas del catálogo de Seedance 2.0 ("Reference Images (T2V)" vs "Last Frame URL (I2V)"); la doc general advierte que "Extra media inputs often trigger validation errors". Para Wan 3 la regla interna de la app (modelRules.ts:108) la declara exclusiva, con fuente fal.
- ¿Cómo se citan roles/orden en el prompt (@image1)? La doc de NanoGPT no lo dice (UNKNOWN). Las sintaxis de `modelRules.ts` vienen de Atlas/fal.

## 4. URLs leídas
- https://docs.nano-gpt.com (índice) y https://docs.nano-gpt.com/llms.txt
- https://docs.nano-gpt.com/api-reference/video-generation.md
- https://docs.nano-gpt.com/api-reference/endpoint/video-generation.md
- https://docs.nano-gpt.com/api-reference/endpoint/video-models.md
- https://docs.nano-gpt.com/api-reference/endpoint/video-status-unified.md
- https://docs.nano-gpt.com/api-reference/image-generation.md
- https://docs.nano-gpt.com/api-reference/endpoint/image-api-generate.md
- https://docs.nano-gpt.com/api-reference/endpoint/image-api-model-endpoints.md
- https://docs.nano-gpt.com/api-reference/endpoint/image-api-models.md
- https://docs.nano-gpt.com/api-reference/endpoint/image-models.md
- https://docs.nano-gpt.com/api-reference/endpoint/image-edits.md
- https://docs.nano-gpt.com/api-reference/miscellaneous/api-hosts.md
- https://nano-gpt.com/api/v1/video-models?detailed=true
- https://api.nano-gpt.com/api/v1/video-models?detailed=true (comparación de hosts)
- https://nano-gpt.com/api/v1/images/models y https://nano-gpt.com/api/v1/image-models?detailed=true
- Copias locales crudas en `/tmp/claude-1000/-home-samuel-Documentos-Projects-My-New-App-ogs-workflow-ask/f0f359ce-4a06-46ff-b2bc-da27c7f1ba95/scratchpad/docs/`


---


Continúa en [auditoria-nanogpt-2.md](auditoria-nanogpt-2.md) (segunda pasada).

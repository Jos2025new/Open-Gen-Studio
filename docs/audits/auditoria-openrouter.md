# Auditoria OpenRouter: documentacion oficial vs. codigo (ogs-auto-plan-card)

Fecha de lectura: 2026-10-25. Solo lectura; GET publicos a docs y catalogos. Codigo: `src/engine/providers/openrouter.ts` (OR), `shared.ts`, `params.ts`, `registry.ts`.
Convencion: OK / GAP (la doc lo ofrece y no lo implementamos) / WRONG (hacemos algo que contradice la doc) / UNKNOWN (la doc calla).

## 0. Respuesta directa: data URLs

- Imagenes (API `/images`, `input_references`): SI. OpenAPI: "Reference images ... as base64 data URLs or HTTP(S) URLs" (https://openrouter.ai/docs/api/api-reference/images/generate-an-image.md). Guia de imagen: "Reference images can be HTTP(S) URLs or base64 data URLs" (https://openrouter.ai/docs/guides/overview/multimodal/image-generation.md). Maximo 16 items en el esquema; por modelo, ver catalogo.
- Video (`frame_images` e `input_references`): la DOCUMENTACION OFICIAL (guia, referencia OpenAPI `POST /videos`, cookbooks) NO lo dice. El esquema solo define `image_url.url: string` y todos los ejemplos usan https. Los cookbooks piden "public HTTPS image URL", "directly downloadable" y avisan que "Some providers cannot fetch image URLs that require cookies, redirects...". Veredicto: UNKNOWN en docs.
  - Unica fuente que lo afirma: el skill oficial del equipo de OpenRouter (no es docs/ ni API reference): `OpenRouterTeam/skills/skills/openrouter-video/SKILL.md`: "Image `url` can be a public `https://` URL or a local-file data URL" (https://github.com/OpenRouterTeam/skills/blob/main/skills/openrouter-video/SKILL.md, linea 86). Es indicio razonable, no garantia; sin limite de tamano documentado.
  - Nosotros SIEMPRE enviamos data URL en video (`encodeImage` -> `blobToDataUrl`, shared.ts:7-13; openrouter.ts:307,310). Sin prueba de pago no se puede confirmar para cada modelo/proveedor aguas abajo.

## 1. Tabla GAP / WRONG ordenada por impacto en calidad/fallos de video

| # | Veredicto | Campo / funcion | Doc oficial | Nuestro codigo | Impacto |
|---|---|---|---|---|---|
| 1 | GAP (grave) | Video `input_references` (reference-to-video) | Guia: "`input_references`: ... reference-to-video ... visual guidance rather than exact frames". Catalogo describe Seedance 2.0 / Fast / Mini como "multimodal reference-to-video" (Mini: "image, video, and audio inputs"). | Nunca se construye. `loadSchema` solo emite `firstFrame`/`lastFrame` (openrouter.ts:266-275), sin `slots.images`; `generate` ignora `req.refs` en video (openrouter.ts:303-312). `acceptsImage` = tiene first_frame (l.212). | Seedance 2.0/Fast/Mini, Wan 2.6/2.7, Grok Imagine, HappyHorse, Hailuo 2.3 declaran referencias y nunca las usamos; el agente cree que solo hay imagen inicial. Perdida de consistencia de personaje/estilo. |
| 2 | GAP (grave) | `input_references` con audio y video | OpenAPI: "Accepts image, audio, and video references. Audio and video references are only honored by providers that support them (including BytePlus Seedance generation 2 and newer)"; esquemas `ContentPartAudio` (`audio_url`) y `ContentPartVideo` (`video_url`). | No existe ruta. El motor ya tiene `slots.refVideos`, `slots.refAudios`, `mixedRefs` (types.ts:62-76) y `encodeVideo` (shared.ts), pero OR no los usa. | Seedance 2.x: referencia de movimiento (video) y de voz/sonido (audio) imposibles. Nota precio: `video_tokens_with_video_input` mas barato (catalogo). |
| 3 | GAP | `provider.options.<slug>.parameters` (passthrough) | Guia + cookbook "provider-specific-video-options": se debe leer `allowed_passthrough_parameters` del modelo y enviar `{"provider":{"options":{"google-vertex":{"parameters":{...}}}}}`. Catalogo: Veo `personGeneration, aspectRatio, negativePrompt, conditioningScale, enhancePrompt`; Kling v3 `negative_prompt, cfg_scale`; Seedance 2.0/Fast `watermark, req_key`; Mini `watermark, req_key, return_last_frame`. | Interfaz `OrVideoModel` ni siquiera declara `allowed_passthrough_parameters` (l.31-43); nunca se envia `provider`. | Sin negative prompt en Veo/Kling, sin `cfg_scale`, sin `watermark` (comportamiento por defecto en Seedance: UNKNOWN), sin `return_last_frame` (encadenar clips). |
| 4 | GAP | `previous_job_id` (editar/extender video) | OpenAPI: "ID of a completed video job to edit or extend ... Only models that support continuation accept this field." | No existe; `registry.ts` deja `videoExtend: []` para openrouter. El catalogo no expone que modelos lo soportan (UNKNOWN cuales; la descripcion de `flux-3-video` menciona continuacion). | Extension de clips imposible en OR. |
| 5 | GAP | Imagen: `provider.options` / `allowed_passthrough_parameters` por endpoint | Guia imagen: pasar `provider.options[slug]`; `GET /images/models/{id}/endpoints` lista `allowed_passthrough_parameters`. Catalogo: gpt-image-2 -> `moderation`; Gemini -> `cachedContent`; Seedream -> `[]`. | No se consulta `/endpoints` para capacidades (solo para precio, `imagePrice`) ni se envia `provider`. | Menor: `moderation` de gpt-image-2 inaccesible. |
| 6 | GAP | Imagen: `quality` extendido, `output_format`, `background: transparent`, `output_compression` | OpenAPI: `quality` incluye `xhigh`,`max`; `background` incluye `transparent`; `output_format` png/jpeg/webp/svg. | Solo se exponen los valores que el catalogo del modelo lista (params dinamicos, openrouter.ts l.226-231, roles 'other'). Para gpt-image-2 el catalogo da `quality: auto/low/medium/high`, `background: auto/opaque`, `output_compression 0-100`: coincide, pero `output_format` no aparece en ninguno de los 5 modelos, asi que OK en la practica. | Sin impacto real hoy; solo riesgo si el catalogo cambia. |
| 7 | UNKNOWN/RIESGO | `polling_url` relativo | OpenAPI de ejemplo: `polling_url: /api/v1/videos/job-abc123` (relativo); guia: absoluto `https://openrouter.ai/api/v1/videos/abc123`. Cookbook resuelve con `new URL(polling_url, "https://openrouter.ai")`. | Se usa tal cual (openrouter.ts l.321 y l.340). Si llegara relativo, el fetch fallaria desde un origen distinto. | Bajo (hoy llega absoluto segun la guia), pero es un 1 linea de robustez. |
| 8 | GAP menor | `size` ("1280x720") | Video e imagen: `size` "Interchangeable with resolution + aspect_ratio"; catalogo video trae `supported_sizes`. | Nunca se envia; usamos `resolution`+`aspect_ratio`. `supported_sizes` no se lee. | Cosmetico. Util si un modelo no admite el par resolution/aspect elegido (la doc dice que da 400 con lista de validos). |
| 9 | GAP menor | `callback_url`, `session_id`, `user`, `trace` | Opcionales de la API. | No enviados (callback_url ademas es HIDDEN_KEY en params.ts). Polling cada 5 s (l.364) vs. "reasonable polling interval (e.g., 30 seconds)". | Sin impacto funcional. Polling 6x mas frecuente que lo recomendado. |
| 10 | UNKNOWN | Limites de tamano/formato/dimensiones de las imagenes de video | La doc de OR no da maximos de bytes, MIME ni dimensiones para `frame_images`/`input_references`; solo "high quality and relevant", "accessible and in supported formats" (guia, Best Practices/Troubleshooting). | `prepareImageForUpload` limita a 2048 px y reconvierte a PNG si no es png/jpeg/webp (media.ts:279-290); sin presupuesto de cuerpo para OR (bodyBudget.ts solo lo usa NanoGPT). | Un PNG de 2048 px en base64 puede pesar varios MB por frame; el limite real es desconocido. |
| 11 | UNKNOWN | Como citar las referencias en el prompt | La doc de OR no define sintaxis (`@Image1`, `[Image 1]`...). Solo el cookbook: "Reference images work best when the prompt explains what should stay consistent" (texto libre). | `slots.promptRefs` existe en el motor (types.ts:56) pero OR no lo rellena. | Al implementar #1, no inventar sintaxis: describir en lenguaje natural o probar con una generacion de pago aprobada. |

| 12 | GAP (grave, 2a pasada) | Deteccion de soporte de referencias: `architecture.input_modalities` de `/api/v1/models` | El catalogo `/videos/models` no trae campo de referencias, pero `/api/v1/models` marca `input_modalities` con `video`/`audio` en Seedance 2.0/Fast/Mini/2.5, Wan 3.0/Prime, Hailuo 3, flux-3-video, aleph-2, heygen. | Solo se lee `/videos/models` (openrouter.ts:75-77); nunca `/models`. | Habria una senal estructurada para activar refs de video/audio (ver Segunda pasada). |
| 13 | GAP (2a pasada) | Imagen: `x-ai/grok-imagine-image-2.0` `quality` low/medium y recraft `style/controls/text_layout` | Catalogo por endpoint: xai sin passthrough; recraft passthrough `style, controls, text_layout`. | `quality` se expone via catalogo (OK); recraft passthrough no se envia (sin `provider.options`). | Recraft: sin control de estilo/texto. |
| 14 | UNKNOWN | Modelos pedidos que OpenRouter NO aloja | Ver Segunda pasada: Gemini Omni Flash 1.1, Kling O3, Pruna P-Image, Ideogram, Grok Imagine Image "std" no figuran en los catalogos. | n/a | n/a |

No encontrados como WRONG: ningun campo que enviemos contradice la doc. Lo que enviamos (model, prompt, duration, resolution, aspect_ratio, generate_audio, seed, frame_images con `frame_type`) respeta el esquema.

## 2. Reglas de la doc relevantes (video)

- Precedencia: "If both fields are provided, `frame_images` takes precedence and the request is treated as image-to-video" (guia y cookbook image-to-video). Por tanto: first/last frame + referencias en la misma peticion NO se combinan; elegir modo. Fuente: https://openrouter.ai/docs/guides/overview/multimodal/video-generation.md
- `frame_images[].frame_type` obligatorio (`first_frame`/`last_frame`); el modelo debe listar el tipo en `supported_frame_images` (cookbook image-to-video). Nuestro codigo lo respeta (l.273-274, 307-312). Que `last_frame` se acepte sin `first_frame`: UNKNOWN (enviamos last solo si hay `req.lastFrame`, sin exigir first).
- `prompt`: "Optional for models that support generating a video from image input alone; required by all other models" (OpenAPI). Nuestro `promptRequired: !frames.length` (l.272) es una aproximacion razonable; la doc no dice que modelos aceptan solo imagen: UNKNOWN por modelo.
- `generate_audio`: "Defaults to the endpoint's generate_audio capability flag, false if not set" (OpenAPI) / guia: "Defaults to true for models that support audio". Contradiccion interna de la doc (OpenAPI vs guia). Nosotros enviamos solo si el usuario lo fija (wireParams l.907-909) y el default de UI es true (l.264).
- `seed`: "not guaranteed by all providers"; el catalogo trae booleano `seed`. Lo usamos solo si `seed: true` (l.265). OK.
- Valores invalidos devuelven 400 con lista de validos: validamos contra catalogo (enum). OK.
- Descarga: `unsigned_urls` requieren Authorization; `GET /videos/{id}/content?index=N`. Implementado (l.340-361). OK. `urls` firmadas (sin API key, con `expires_at`): no usadas, no necesarias.
- Estados: pending/in_progress/completed/failed (+ cancelled/expired en webhooks y cookbook): manejados (l.358).

## 3. Detalle por modelo (video). Catalogo de /videos/models leido el 2026-10-25.

Campos comunes que implementamos bien: `prompt`, `duration` (enum del catalogo, orden ascendente, default 5 si existe), `resolution`, `aspect_ratio`, `generate_audio` (si `generate_audio` true), `seed` (si `seed` true), `frame_images` first/last.

### bytedance/seedance-2.0-mini
- Catalogo: resoluciones 480p/720p; aspect 1:1,3:4,9:16,4:3,16:9,21:9,9:21; duraciones 4-15; `supported_frame_images` first_frame+last_frame; audio true; seed true; passthrough `watermark, req_key, return_last_frame`. Descripcion: "text-to-video, image-to-video with first and last frame control, and multimodal reference-to-video with image, video, and audio inputs".
- prompt/duration/resolution/aspect/audio/seed/first/last: OK (openrouter.ts l.258-275).
- `input_references` imagen: GAP (#1). Video y audio de referencia: GAP (#2). Passthrough (`watermark`, `return_last_frame`): GAP (#3).
- Data URLs en frame_images: UNKNOWN en docs (ver seccion 0).
- Confirmado el sintoma del usuario: nuestro modelo marca `acceptsImage` solo por `first_frame` (l.212), asi que se le dice al agente "solo imagen inicial".

### bytedance/seedance-2.0 y seedance-2.0-fast
- Catalogo: 2.0: 480p/720p/1080p/4K, 2.0-fast: 480p/720p; mismos aspects y duraciones 4-15; frames first+last; audio y seed true; passthrough `watermark, req_key`. Descripcion: "multimodal reference-to-video" (2.0 con "character consistency"). El cookbook de reference-to-video usa justamente `bytedance/seedance-2.0-fast` con `input_references` (https://openrouter.ai/docs/cookbook/video-generation/reference-to-video.md) y hasta 3 referencias de ejemplo, avisando de comprobar el maximo por modelo (el catalogo no lo expone: maximo de referencias UNKNOWN).
- Resto igual que Mini: #1, #2, #3 GAP. 4K en 2.0: se ofrece desde el catalogo, OK.

### google/veo-3.1-fast
- Catalogo: 720p/1080p/4K; 16:9 y 9:16; duraciones 4,6,8; first+last; audio y seed true; passthrough `personGeneration, aspectRatio, negativePrompt, conditioningScale, enhancePrompt`. Descripcion: "text or image prompts"; no menciona referencias.
- Estandar OK. Soporte de `input_references` para Veo: UNKNOWN (la doc no lo dice; no inventar). Passthrough: GAP (#3), en especial `negativePrompt`, `enhancePrompt`, `personGeneration` (el cookbook usa exactamente estos con Veo y el slug `google-vertex`).
- Nota: `aspectRatio` como passthrough duplica `aspect_ratio` del cuerpo; no enviarlo (puede chocar), UNKNOWN su precedencia.

### kwaivgi/kling-v3.0-pro
- Catalogo: solo 720p; 16:9, 9:16, 1:1; duraciones 3-15; first+last; audio true; seed FALSE (no se envia, correcto); passthrough `negative_prompt, cfg_scale`.
- Estandar OK. Referencias: no declaradas en la descripcion; UNKNOWN. Passthrough: GAP (#3).
- Precios: `duration_seconds_with_audio` vs sin audio (parseOrVideoPricing los distingue, l.84-95): OK.

## 4. Detalle por modelo (imagen). API `POST /api/v1/images` (no chat/completions); nuestro codigo usa esa ruta (openrouter.ts l.292-300): OK.

Esquema oficial de la peticion (https://openrouter.ai/docs/api/api-reference/images/generate-an-image.md): `model, prompt (requerido, minLength 1), aspect_ratio, resolution, size, quality, background, output_format, output_compression, n (1-10), seed, input_references (<=16, data URL o HTTP(S)), stream, provider, session_id, user`.
Nosotros: `model`, `prompt` (solo si no esta vacio, l.284), parametros del catalogo via `wireParams`, `input_references` como `{type:'image_url', image_url:{url:dataURL}}` con `slice(0, max)` (l.289). Ninguna contradiccion. Si el prompt llega vacio la API devolveria 400 (minLength 1); `promptRequired: model.acceptsText` lo cubre en UI.

| Modelo | Catalogo `supported_parameters` (2026-10-25) | Resultado |
|---|---|---|
| google/gemini-3-pro-image | resolution 1K/2K/4K; aspect 1:1,2:3,3:2,3:4,4:3,4:5,5:4,9:16,16:9,21:9; n max 1; input_references 0-14; endpoint passthrough `cachedContent` | prompt/aspect/resolution/refs OK. Passthrough: GAP menor (#5). `seed` no soportado, no se envia, OK. |
| google/gemini-3.1-flash-image | resolution 512/1K/2K/4K; aspect incluye 1:4,4:1,1:8,8:1; n 1; refs 0-14 | OK (incluye 512, que `resolution` del esquema acepta). |
| bytedance-seed/seedream-4.5 | resolution 1K/2K/4K; aspect amplio incl. `auto`, 9:19.5, 9:20; n 1-10; refs 0-14; seed boolean; passthrough `[]` | OK. `seed` -> param Seed (openrouter.ts l.114). |
| bytedance-seed/seedream-5-0-flash | resolution 1K/2K; mismo aspect; n max 1; refs 0-14; seed | OK. |
| openai/gpt-image-2 | aspect 1:1,3:2,2:3,4:3,3:4,16:9,9:16,21:9,auto; quality auto/low/medium/high; background auto/opaque; n 1-10; refs 0-16; output_compression 0-100; streaming true; passthrough `moderation` | OK para lo expuesto. GAP menor: `moderation` (#5), `stream` (parcial; oculto a proposito, HIDDEN_KEYS), `output_format` no listado por el catalogo. Nota: la doc generica dice `background: transparent`, pero el catalogo para este modelo solo ofrece auto/opaque: seguir al catalogo. |

Reglas de imagen de la doc:
- `size`: "An explicit pixel size is authoritative: a mismatched resolution or aspect_ratio alongside it is rejected with a 400". No enviamos `size`, sin riesgo (#8).
- `aspect_ratio: auto` permitido para algunos modelos; el catalogo lo lista y `p.omit` se gestiona en wireParams (params.ts:887). OK.
- Referencias: "number of references accepted varies by provider"; usamos el `max` del catalogo. OK. Gemini 2.5 flash image: max 3 (tambien del catalogo).
- Seedream 4.5 con `n` > 1: la doc dice "providers that only support single-image generation reject n > 1"; catalogo `n` por modelo (range) ya lo limita: OK.

## 5. Recomendacion tecnica (para quien implemente)
1. Anadir en `loadSchema` de video un `slots.images` (`key: 'input_references'`, `format: 'content-part'`) y, para Seedance 2.x, `refVideos`/`refAudios` con items `{type:'video_url'|'audio_url', ...}`; respetar la regla de precedencia (si hay frames, no mandar referencias o avisar al usuario). Maximo de referencias: la doc no lo da por modelo (UNKNOWN); empezar bajo y validar con una generacion aprobada.
2. Detectar soporte de referencias: el catalogo `/videos/models` NO tiene un campo para ello (el propio cookbook lo admite: "may still need confirmation from the model description"). Solo queda la descripcion (texto libre; truncada con "..." en la lista) o una lista propia en el repo, marcada como dato editable.
3. Leer `allowed_passthrough_parameters` y enviar `provider.options[<slug>].parameters` (el slug del proveedor aguas abajo, p. ej. `google-vertex`; para Seedance el slug exacto es UNKNOWN: probablemente `byteplus`, no verificado).
4. Resolver `polling_url` con `new URL(url, 'https://openrouter.ai')`.
5. Antes de afirmar al agente "solo imagen inicial" para Seedance 2.0 Mini, corregir `acceptsImage`/descripcion de capacidades segun #1-#2.

## 6. URLs leidas
- https://openrouter.ai/docs/guides/overview/multimodal/video-generation.md
- https://openrouter.ai/docs/guides/overview/multimodal/image-generation.md
- https://openrouter.ai/docs/api/api-reference/video-generation/submit-a-video-generation-request.md (OpenAPI completo: VideoGenerationRequest, FrameImage, InputReference, ContentPart*)
- https://openrouter.ai/docs/api/api-reference/video-generation/list-all-video-generation-models.md
- https://openrouter.ai/docs/api/api-reference/video-generation/poll-video-generation-status.md
- https://openrouter.ai/docs/api/api-reference/images/generate-an-image.md (ImageGenerationRequest)
- https://openrouter.ai/docs/cookbook/video-generation/reference-to-video.md
- https://openrouter.ai/docs/cookbook/video-generation/image-to-video.md
- https://openrouter.ai/docs/cookbook/video-generation/provider-specific-video-options.md
- https://openrouter.ai/docs/cookbook/video-generation/choose-video-model.md
- https://openrouter.ai/docs/llms.txt (indice)
- https://raw.githubusercontent.com/OpenRouterTeam/skills/main/skills/openrouter-video/SKILL.md (skill oficial del equipo; unica fuente sobre data URLs en video)
- https://openrouter.ai/api/v1/videos/models (catalogo video)
- https://openrouter.ai/api/v1/images/models y /api/v1/images/models/{id}/endpoints para los 5 modelos de imagen
- (No se pudo leer: /docs/api/api-reference/images/list-image-generation-models ni la pagina `create-videos`, 404.)


---
# Segunda pasada (modelos adicionales)

Fuentes: https://openrouter.ai/api/v1/videos/models, https://openrouter.ai/api/v1/models?output_modalities=all (691 modelos), https://openrouter.ai/api/v1/images/models y `/images/models/{id}/endpoints`. Las reglas de la doc (precedencia frame_images > input_references, esquema de `input_references` con image/audio/video, passthrough via `provider.options`, `previous_job_id`) son las de la primera parte y valen para todos los modelos de abajo. Todas las descripciones del catalogo vienen truncadas con "..." por el propio catalogo: lo que no dicen es UNKNOWN.

## A. Hallazgo transversal: como saber si un modelo admite referencias de video/audio
`/api/v1/models` expone `architecture.input_modalities`. Video con `video` y `audio` en ese campo (ie. admiten referencias de esos tipos segun el catalogo; la doc no lo afirma textualmente como regla, es inferencia): seedance-2.0, 2.0-fast, 2.0-mini, 2.5, wan-3.0, wan-3.0-prime, minimax/hailuo-3 (`text,image,video,audio`), flux-3-video y runway/aleph-2 (`video`). Solo `text,image`: Kling v3/O1, Veo 3.1, Grok Imagine Video, Hailuo 3 Max, Hailuo 2.3, Wan 2.6/2.7, HappyHorse, Gen-4.5. Nuestro codigo no lee `/models` (veredicto GAP, #12). Que `image` en esos modelos signifique referencias y no solo frames: UNKNOWN (p. ej. `x-ai/grok-imagine-video` dice en su descripcion "reference-conditioned" pero su `supported_frame_images` solo tiene `first_frame`).

## B. Modelos que OpenRouter NO aloja (segun catalogos del 2026-10-25)
- Gemini Omni Flash 1.1: no hay ningun id `google/*omni*` ni en `/videos/models` ni en `/models` (solo `cloudflare/clef-omni`, `qwen/qwen3.8-omni-flash`, `nvidia/nemotron-3-nano-omni...`, otros modelos). No alojado (o con otro nombre desconocido).
- Kling O3: no existe; solo `kwaivgi/kling-v3.0-pro`, `kling-v3.0-std`, `kling-video-o1`.
- Grok Imagine Image "std": no existe id sin sufijo; solo `x-ai/grok-imagine-image-quality` y `x-ai/grok-imagine-image-2.0`.
- P-Image (Pruna) e Ideogram: no hay ningun id `pruna*`/`ideogram*` en `/images/models` ni en `/models`. En el repo solo aparecen como ids de otros proveedores (registry.ts:63-64,75: fal / nanogpt / atlas), no de OpenRouter.

## C. Video (campos comunes a todos: prompt, duration, resolution, aspect_ratio, frame_images, generate_audio, seed. Nuestro codigo: openrouter.ts:258-275 construye params solo con lo que el catalogo marca; 303-312 envia frames. OK en todos salvo lo indicado.)

### bytedance/seedance-2.5
- Catalogo: 480p/720p (no 1080p); aspect 16:9,4:3,1:1,3:4,9:16,21:9; duraciones 4-30; first+last; audio y seed true; passthrough `watermark, req_key, output_format`; `input_modalities` text,image,video,audio. Descripcion: "long-form storytelling, multimodal reference-based generation, video editing, and video extension".
- Estandar: OK. `input_references` imagen/video/audio: GAP (#1,#2). Edicion y extension (`previous_job_id`): GAP (#4); la descripcion dice que lo soporta, la doc de `previous_job_id` dice "Only models that support continuation accept this field" (cuales: UNKNOWN en la API). Passthrough (`watermark`, `output_format`): GAP (#3). Duracion hasta 30 s: el selector sale del catalogo, OK (params.push duration, l.260-263).

### alibaba/wan-3.0-prime y alibaba/wan-3.0
- Catalogo: 480p/720p/1080p; 16:9,4:3,1:1,3:4,9:16; duraciones 2-30; first+last en ambos (pero Prime dice "text-to-video and first-frame image-to-video": contradiccion catalogo `supported_frame_images` vs descripcion; `last_frame` en Prime: UNKNOWN); audio true; seed true; sin passthrough; wan-3.0 describe "reference-guided video generation"; modalidades text,image,video,audio.
- Estandar OK. Referencias (imagen/video/audio): GAP (#1,#2) para wan-3.0; para Prime UNKNOWN (descripcion no las menciona aunque `input_modalities` si). Sin passthrough: nada que enviar.
- Riesgo: enviamos `last_frame` a Prime si el usuario lo da (l.310), la descripcion sugiere que solo admite first frame: UNKNOWN si falla.

### minimax/hailuo-3-max
- Catalogo: 768p/480p; aspect 21:9,16:9,4:3,1:1,3:4,9:16; duraciones 5-15; first+last; `generate_audio: false` (no se ofrece param audio, correcto: l.264 solo si truthy); `seed: false`; passthrough `aigc_watermark`; `input_modalities` text,image.
- Estandar OK. Referencias: no declaradas (UNKNOWN). Passthrough `aigc_watermark`: GAP menor (#3). Nota: lista de resolucion trae "768p" antes de "480p" (orden del catalogo, no ordenamos resoluciones, l.257-259): cosmetico.
- minimax/hailuo-3 (hermano): solo 2K, audio true, input_modalities con video/audio, mismo passthrough; mismos veredictos que Seedance respecto a refs (GAP #1/#2, soporte exacto UNKNOWN).

### kwaivgi/kling-video-o1 (Kling O3: no alojado)
- Catalogo: 720p; 16:9,9:16,1:1; duraciones SOLO [5,10]; first+last; audio true; seed false; passthrough `negative_prompt` (sin `cfg_scale`). Descripcion: "text and image inputs", "cinematic content".
- Estandar OK (duracion enum correcta, default 5). Passthrough `negative_prompt`: GAP (#3). Referencias: UNKNOWN (la descripcion truncada no las menciona; modalidades text,image).

### Grok Imagine Video: x-ai/grok-imagine-video (1.0), x-ai/grok-imagine-video-1.5, x-ai/grok-imagine-video-1.5-lite
- Catalogo (los tres): aspect 16:9,9:16,1:1,4:3,3:4,3:2,2:3; duraciones 1-15; SOLO `first_frame`; `generate_audio: null` y `seed: null` (no se ofrecen, correcto: l.264-265); sin passthrough. Resoluciones: 1.0 480p/720p; 1.5 y 1.5-lite 480p/720p/1080p.
- Estandar OK. `last_frame` no soportado: el esquema lo omite (`lastFrame` undefined, l.274), OK; si el agente intenta last frame se descarta en silencio (l.309 exige `schema.slots.lastFrame`).
- 1.0 dice "reference-conditioned": referencias GAP (#1) pero cuantas/como UNKNOWN (el catalogo no las expone y `input_modalities` es solo text,image). 1.5 y Lite: "optional starting image"; sin referencias documentadas (UNKNOWN).
- Sin audio generado: el catalogo no da `generate_audio`; no sabemos si el modelo produce audio (UNKNOWN).

## D. Imagen (API `/images`; refs como data URL permitidas por la doc, ver parte 1). Codigo: params dinamicos (openrouter.ts:226-231), refs con `slice(0,max)` (l.289) y `min` (l.242).

| Modelo | Catalogo | Veredicto |
|---|---|---|
| google/gemini-nano-banana-2.1 (Nano Banana 2.1) | resolution 1K/2K/4K; aspect 1:1,1:4,1:8,2:3,3:2,3:4,4:1,4:3,4:5,5:4,8:1,9:16,16:9,21:9; n max 1; refs 0-14; endpoint google-ai-studio, passthrough `cachedContent` | prompt/aspect/resolution/refs OK. Passthrough: GAP menor (#5). Sin `seed`. |
| x-ai/grok-imagine-image-2.0 | resolution 1K/2K; aspect amplio + auto; `quality` low/medium; n max 1; refs 0-3; endpoint xai sin passthrough | OK (quality sale del catalogo como param 'other'). Max 3 refs respetado por `slice`. |
| x-ai/grok-imagine-image-quality | igual pero sin `quality`; refs 0-3 | OK. |
| "Grok Imagine Image std" | no existe en catalogo | No alojado. |
| recraft/recraft-v4.1, v4.1-pro, v4, v4-pro, v3, utility(-pro), flash | aspect 1:1,4:3,3:4,16:9,9:16,auto; n 1-6 (flash: sin input_references, solo texto); refs 0-1; endpoint recraft con passthrough `style, controls, text_layout` | Estandar OK; flash es solo texto (`acceptsImage` false por `input_modalities`, l.195). Passthrough `style/controls/text_layout`: GAP (#13) - es la forma de fijar estilo, colores y capas de texto. |
| recraft/recraft-v4-styles, -pro, -vector variants | refs 1-10 con **min 1** ("Every request requires at least one style reference image"); `-vector`: `output_format: ["svg"]` | `slots.images.min = 1` se calcula (l.242) pero queda por comprobar que el flujo del app impida enviar sin referencia (no verificado en esta pasada: UNKNOWN en codigo). Para `-vector`, el `output_format` svg sale como param enum de un valor; la respuesta SVG viene en `b64_json` (doc: "UTF-8 base64-encoded"); `extractOutputs` usa mime `media_type` si existe (shared.ts:~96) -> probablemente OK, no probado. |
| Ideogram | no alojado en OpenRouter | n/a (el repo usa Ideogram solo via fal, registry.ts:63-64) |
| P-Image (Pruna) | no alojado en OpenRouter | n/a (solo `pruna-ai/p-image/upscale` en otro proveedor, registry.ts:75) |

## E. Hallazgos principales de esta pasada
1. `/api/v1/models` -> `architecture.input_modalities` incluye `video`/`audio` en Seedance 2.0/Fast/Mini/2.5, Wan 3.0/Prime, Hailuo 3: senal estructurada para detectar refs de video/audio que hoy ignoramos (GAP #12).
2. Seedance 2.5 y Wan 3.0 anuncian "multimodal reference-based generation" / "reference-guided": mismo GAP #1/#2/#4 (referencias y extension) que Seedance 2.0.
3. Grok Imagine Video (los tres): solo first frame, sin audio ni seed en catalogo; nuestro esquema ya lo refleja. El unico GAP es la descripcion "reference-conditioned" de 1.0 (UNKNOWN en forma).
4. No alojados en OpenRouter: Gemini Omni Flash 1.1, Kling O3, Grok Imagine Image std, P-Image (Pruna), Ideogram.
5. Recraft: passthrough `style, controls, text_layout` no enviable (GAP #13); `-styles` exige >= 1 referencia.
6. Wan 3.0 Prime: catalogo dice first+last pero la descripcion solo first-frame; UNKNOWN si `last_frame` falla.

# Auditoría NanoGPT contra su doc oficial — segunda pasada (2026-10-25)

Primera parte y tabla GAP/WRONG completa: [auditoria-nanogpt.md](auditoria-nanogpt.md).

# Segunda pasada

Misma metodología (doc primero, UNKNOWN si la doc calla, solo GET públicos). Fuentes extra: catálogos `video-models?detailed=true`, `images/models` y `images/models/{id}/endpoints` (api.nano-gpt.com). Referencias de código: `nanogpt.ts` (L), igual que arriba.

## Qué ids aloja NanoGPT (catálogo público, 2026-10-25)
| Pedido | Ids en NanoGPT |
|---|---|
| Seedance 2.5 | `bytedance/seedance-2.5` (unificada: texto, imagen, refs multimodales, edit, extend; sin ruta `reference-to-video` aparte), `bytedance/seedance-2.5-turbo`, `bytedance/seedance-2.5-spicy`, `bytedance/seedance-2.5/talking-avatar` |
| Wan 3 Prime | `alibaba/wan-3.0-prime`, `.../video-edit`, `.../video-extend`, `.../image-to-video-spicy` |
| MiniMax H3 Max | `minimax/h3-max`, `minimax/h3-max-turbo`, `.../h3-max/extend-video`, `.../h3-max-turbo/extend-video`, `.../h3-max/multi-angle/image-to-video`, `.../h3-max/lip-sync/image-to-video`, `.../h3-max/recast`, `.../h3-max/relight` |
| Kling O3 | Solo `kling-o3-4k`. No hay "O3" estándar/pro. Existen también `kling-v30-*`, `kling-v3-4k`, `kling-v3-turbo-*` |
| Kling O1 | `kling-video-o1`, `kling-video-o1-standard` |
| Gemini Omni Flash 1.1 | `google/gemini-omni-flash/v1.1` (y `google/gemini-omni-flash` sin versión) |
| Grok Imagine Video | 1: `grok-imagine-video`, `grok-imagine-video-reference-to-video`, `-edit`, `-extend`. 1.5: `xai/grok-imagine-video/v1.5/image-to-video` (modos auto/t2v/i2v/ref). 1.5 Lite: `grok-imagine-video-1.5-lite` |
| Grok Imagine Image | std `grok-imagine-image`; quality `xai/grok-imagine-image/quality/{text-to-image,edit}`; 2: `xai/grok-imagine-image/v2.0/{text-to-image,edit}`; además `grok-2-image` |
| Nano Banana 2.1 | `nano-banana-2.1` |
| P-Image (Pruna) | `pruna-ai/p-image/{text-to-image,edit,upscale,text-to-image-lora,edit-lora}` |
| Ideogram | `ideogram/v4.5`, `ideogram/v4.5/edit`, `ideogram/v4/{fast,instant}`, `ideogram/vector`, `ideogram-v3-*`, `ideogram-ai/ideogram-v2*` |
| Recraft | `recraft-v3`, `recraft-v4`, `recraft-v4-pro`, `recraft-ai/recraft-v4.1[-pro]/{text-to-image,text-to-vector,text-to-image-utility}`, `recraft-ai/recraft-v4[-style[-pro]]/*`, `recraft-v3-svg-edit` |

## Hallazgo nuevo de fondo
Tres rutas (MiniMax H3 Max, H3 Max Turbo, Gemini Omni Flash 1.1) documentan en el catálogo `imageUrl` y `lastImageUrl` aceptando URL pública **o data URI base64** ("Raw base64 without the data URI prefix is not supported"). Es la única documentación oficial por modelo de un último fotograma local. El código no la usa (ver P2-1). Para el resto de rutas, `last_image` y las listas de refs siguen siendo "URL" a secas.

## Vídeo: detalle

### Seedance 2.5 (`bytedance/seedance-2.5`, `-turbo`, `-spicy`)
| Entrada | Doc/catálogo | Código | Veredicto |
|---|---|---|---|
| ruta reference-to-video | No existe como id. Descripción: "text, image, multimodal-reference, video-edit, or video-extend ... from the supplied inputs"; `mode` = auto/text-to-video ("Text / references to video")/image-to-video/video-edit/video-extend | Sin slot de refs: `takesRefs` falso (L283) | GAP/UNKNOWN: refs multimodales anunciadas sin campos (ya en la fila 4) |
| imagen inicial | sin campo; "image and video inputs determine framing" | `imageDataUrl` (L290) | UNKNOWN nombre; formato genérico OK |
| vídeo fuente | genérico `videoUrl`/`videoDataUrl` (4 MB) | `videoDataUrl` L305, tope 4 MB L501 | OK |
| `generate_audio` | switch default true | role audio | OK |
| turbo | resolución 720p/1080p (sin 480p ni 4k), aspect sin 9:16? (tiene 9:16, 21:9) | catálogo | OK |
| talking-avatar | `audio` requerido (≤120 s), `resolution` 480p/720p | ver P2-7 | GAP |
| `mode` | auto por defecto | solo `advanced` | OK |

### Wan 3 Prime (`alibaba/wan-3.0-prime`, `/video-edit`, `/video-extend`)
- Prime: ver tabla de la primera pasada (sin campos de medios; `mode` auto/t2v/i2v/reference). "With reference videos, input plus output duration may not exceed 30 seconds": sin validación. Verdicto GAP (filas 3-4).
- video-edit: "Uses the first 15 seconds of the source", salida 2-15 s, `generate_audio` (role audio OK), `enable_prompt_expansion`, `seed` -1..2147483647. Código: `needsVideo` (id `edit`) y `videoDataUrl`; sin tope de 15 s de salida (opciones del catálogo `number` max 15, OK). Refs de imagen/audio: P2-3.
- video-extend: source ≤120 s; el audio de la fuente se conserva; `enable_audio`. Último fotograma objetivo: P2-3. Fuente por `videoDataUrl` limitada a 4 MB: un clip de varios segundos suele pasar de eso; la doc admite `videoUrl` (sin camino para ficheros locales).

### MiniMax H3 Max (`minimax/h3-max`) y Turbo
| Entrada | Doc/catálogo | Código | Veredicto |
|---|---|---|---|
| imagen inicial | catálogo `imageUrl`: URL o data URI | `imageDataUrl` | UNKNOWN si el alias genérico se normaliza a `imageUrl` para esta ruta (doc genérica dice que `imageDataUrl` es válido). P2-1 |
| último fotograma | `lastImageUrl`, "Requires a start image" | sin slot | GAP P2-1 |
| refs imagen/vídeo/audio | `reference_*`: URL o lista; "One URL per line, or a JSON array" | descartadas (urlOnly) | OK, limitación |
| exclusión | fotograma final vs refs/reference-to-video | sin guarda | GAP P2-2 |
| `mode` | h3-max: auto/reference-to-video | solo advanced | OK |
| resolución 480p/768p/1080p (default 768p) | catálogo; en la H3 base era "LoRA/Edit/Extend" | OK en Max | OK (a diferencia de `minimax-h3`) |
| aspect | `adaptive` en Max; Turbo: "Applies to text-to-video; image-to-video follows the input image" | `adaptive` borrado (L505) | P2-9 |
| duración 5-15, seed -1..2147483647, `prompt_expansion_mode`, `enable_safety_checker` | catálogo | duración y seed sí, resto `advanced` | OK |

### Kling O3 (`kling-o3-4k`) y O1 (`kling-video-o1`, `-standard`)
- O3: duración 3-15, aspect 16:9/9:16/1:1, `generate_audio` (role audio), `source_video_mode`, `keep_original_sound`. Entrada: text, image, video. Refs: P2-4. Imagen: `imageDataUrl` (genérico). `video` slot `videoDataUrl`. Verdicto: OK salvo refs.
- O1: duración 5 o 10; `mode` auto/video-edit/reference-to-video; `keep_original_sound` como cadena "true"/"false" (select). Doc genérica: refs por `referenceImages` URL o data URL (única afirmación oficial para data URL en refs). Código: `referenceImages` data URL, max 4 (L293). Verdicto OK en formato, UNKNOWN el máximo (P2-5). `kling-video-o1-standard` no tiene `aspect_ratio` en el catálogo: el código solo manda lo que el catálogo lista, OK.
- Ninguna ruta O1/O3 lista `negative_prompt` en el catálogo.

### Gemini Omni Flash 1.1
| Entrada | Doc/catálogo | Código | Veredicto |
|---|---|---|---|
| `imageUrl` / `lastImageUrl` | URL o data URI | solo `imageDataUrl` | P2-1 |
| refs de imagen/vídeo, vídeo fuente | anunciados; exclusión con fotograma final | slot de vídeo sí; sin refs | P2-2, P2-8 |
| duración 3-10; resolución 360p/720p/1080p/4k; aspect 16:9 y 9:16 | catálogo | OK | OK |
| audio | "synchronized native audio" sin parámetro | no hay switch | UNKNOWN (no hay forma de desactivarlo) |
| versión sin `/v1.1` | solo duración y aspect | igual | OK |

### Grok Imagine Video 1 / 1.5 / 1.5 Lite
| Ruta | Doc/catálogo | Código | Veredicto |
|---|---|---|---|
| `grok-imagine-video` (1) | t2v/i2v; duración 1-15; aspect 16:9/1:1/9:16 (solo t2v); resolución 480p/720p | firstFrame `imageDataUrl`; resto catálogo | OK |
| `grok-imagine-video-reference-to-video` | "Requires one or more reference images, supports prompt references like @Image1"; duración 1-10; 7 aspectos | slot refs por id, `min: 1` (L293); firstFrame excluido (L290) | formato (data URL) UNKNOWN para esta ruta; sintaxis `@Image1` oficial aquí (modelRules.ts:100 dice `<IMAGE_0>` para "Grok Imagine Video" tomando Atlas/fal) |
| `xai/grok-imagine-video/v1.5/image-to-video` | `mode` auto/t2v/i2v/ref; `reference_images` URL; 1080p solo en t2v ("Image and reference modes support 480p and 720p") | refs descartadas; resolución 1080p se ofrece siempre | GAP menor: no se bloquea 1080p con imagen inicial; refs locales imposibles |
| `grok-imagine-video-1.5-lite` | t2v/i2v, 1-15 s, 480/720/1080p, aspect "Text-to-video only" | OK | OK |
| edit / extend | edit: clips facturados hasta 8 s; extend: duración 2-10 | `needsVideo` por id | OK |
| audio | `audio_generation: true`, sin parámetro | no hay switch | UNKNOWN |

## Imagen: detalle
Reglas comunes de la primera pasada (`input_references` vs `imageDataUrls`, 30 MiB por imagen según doc, 4 MB de cuerpo en el código) se mantienen.

| Modelo | Doc/catálogo | Código | Veredicto |
|---|---|---|---|
| `grok-imagine-image` (std) | entrada máx. 3; salida 4; `resolutions` = proporciones (incl. 19.5:9, 9:20) | `resolution` con valor de proporción como framing (L199); max 3 | OK según catálogo; calidad/1K-2K inaccesible (P2-10) |
| `xai/.../quality/text-to-image`, `/edit` | edit: máx. 1 entrada, `auto` válida; text-to-image sin entradas | `auto` filtrada (L194) en `resolutions`; edit max 1 | OK |
| `xai/.../v2.0/*` | text-to-image solo texto; edit máx. 3; "1K or 2K ... low or medium quality"; precio por 1k/2k | sin selector | P2-10 |
| `nano-banana-2.1` | 14 entradas, salida 4, 1k/2k, aspect incl. 1:4, 4:1, 1:8, 8:1, thinking_level, output_format, seed, web search, system_prompt | enum/listas sí; seed/web/system no | P2-12 |
| `pruna-ai/p-image/text-to-image` | resoluciones tamaño fijo, solo texto | OK | OK |
| `pruna-ai/p-image/edit` | 1-5 entradas; `aspect_ratio` con `match_input_image` | max 5; opción `match_input_image` se muestra tal cual | OK. Formato de salida ("controls for output format") sin campo en catálogo: UNKNOWN |
| `ideogram/v4.5` | tamaños WxH (36 opciones), hasta 8 imágenes; calidad low/medium/high, prompt expansion | tamaños como framing; sin calidad | P2-11 |
| `ideogram/v4.5/edit` | máx. 5 entradas ("up to four reference images" más la fuente); máscaras opcionales; "High precision preserves unchanged pixels" | sin máscara | P2-11 |
| `ideogram/v4/fast` | `rendering_speed` TURBO/BALANCED/QUALITY | lista simple a enum (L219-222) | OK |
| `ideogram/vector` | SVG, hasta 5 refs, 1-8 salidas, 18 aspectos incl. Auto | OK; la salida es SVG: manejo de mime en `extractOutputs` no revisado | UNKNOWN |
| `recraft-v4`, `recraft-v4-pro`, `recraft-ai/recraft-v4.1[-pro]/text-to-image` | tamaños fijos (v4.1-pro 2048), hasta 8 salidas, solo texto | OK | OK |
| `recraft-ai/recraft-v4[-style]*/text-to-image` | "up to 10 style references or a reusable Recraft style ID" | refs sí; style ID sin campo | P2-13 |
| `recraft-v3-svg-edit` | 1 entrada, salida SVG | OK | OK; mime SVG UNKNOWN |

## URLs leídas en esta pasada
- https://nano-gpt.com/api/v1/video-models?detailed=true (catálogo)
- https://nano-gpt.com/api/v1/images/models y /api/v1/image-models?detailed=true
- https://api.nano-gpt.com/api/v1/images/models/xai/grok-imagine-image/v2.0/edit/endpoints
- https://api.nano-gpt.com/api/v1/images/models/ideogram/v4.5/edit/endpoints
- Las páginas de docs de la primera pasada (video-generation, image-generation, api-hosts).

## Verificación de Manus AI (2026-10-25)

Correcciones aplicadas en la tabla de [la primera parte](auditoria-nanogpt.md). Prioridades que propone, con las que coincidimos:

- P0: compresión de imágenes y uso de URLs de origen cuando el activo ya tiene una; fotogramas finales de H3 Max, Gemini Omni, Wan 3 y Seedance 2.5.
- P1: referencias multimodales y exclusiones entre entradas; `multi_prompt` y `element_list` de Kling; controles de Grok Image, Ideogram y Nano Banana 2.1.
- P2: camelCase/snake_case, máximos de referencias y parámetros no documentados.

No cambiar el tope global de 4 MB ni añadir claves especulativas al adaptador sin evidencia. Sin verificar todavía (doc pública insuficiente): los 193 modelos iguales en ambos hosts, el rechazo real de `referenceAudios`, los alias del último fotograma por ruta, y si los campos anunciados fuera de `supported_parameters` se pueden enviar.

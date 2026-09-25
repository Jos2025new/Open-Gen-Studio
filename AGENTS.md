# AGENTS.md — Open Gen Studio

Guía para agentes. Estado general e historial: `PROGRESS.md`. Repo git desde 2026-09-24 (`main`).

## Reglas de trabajo
- Antes de operar, escribe aquí el plan paso a paso con su razón (breve). Marca `[x]` al terminar.
- Cambios mínimos: un detalle de 1–2 líneas (color, espaciado) no requiere leer todo el código.
- Verifica con `npx tsc --noEmit -p .`, `npm test` y navegador (`npm run dev`, puerto 5173).
- Un commit por tarea terminada.

## Tarea actual — cobertura completa de las familias prioritarias (2026-09-25)
Lo que quedó "fuera de alcance" en `MODEL_VALIDATION.md` pasa a implementarse. Reglas: un commit por fase; en cada una, tests, diff revisado de `tests/fixtures/live/expected.txt` (la red de regresión) y una fila en `TRAZABILIDAD.md`. Las decisiones de producto se preguntan antes de la fase que las necesita; los bugs se corrigen.
0. [x] Documentar lo hecho y crear la red de regresión (`TRAZABILIDAD.md`, `npm run snapshot:models`, `tests/live-snapshot.test.ts`). Línea base: 557 variantes, 21 con entradas obligatorias sin enviar. *Razón: saber si un cambio nuevo rompe algo.*
1. [x] **Bugs sin decisión.** Ideogram Character remix/edit: imagen de origen y referencias a la vez (slot `source`). Seedream sequential: `max_images` como número de imágenes cuando no hay otro. NanoGPT: parámetros de catálogo en forma de lista (`rendering_speed`). *Razón: fallos del parser.* Hallado al verificar: el listado de fal sin clave recibía 429 (cinco categorías en paralelo) y la app se quedaba sin catálogo de fal → categorías una a una, clave si la hay (sin clave si la rechaza) y reintento con espera creciente ante 429.
2. [x] **Extender vídeo y Seedance 2.5.** Operación nueva "Extend video" (Grok, Veo 3.1, FLUX 3, Wan 3.0, Seedance, Gemini Omni 1.1, MiniMax H3 Max). Si el modelo no tiene campo de vídeo de origen, el vídeo va a `reference_videos` con las reglas de Seedance 2.5: un vídeo de 2–30 s (4–30 s al editar), `ratio: adaptive` y `duration: -1` al editar. Validación antes de enviar. *Razón: reglas explícitas de edición/extensión.* Hecho con un registro de reglas por modelo (`engine/modelRules.ts`, cada regla con su fuente) y errores con código (`engine/errors.ts`, p. ej. `[VIDEO_DURATION]`). El modo explícito de NanoGPT (`mode: video-edit|video-extend`) se fija solo. El agente ve la operación porque su lista sale de `OPS`.
3. [x] **Clips y keyframes.** Slot `clips` (`video_clips: {url, start, ends[, fps]}`: Gemini reference-developer, Nano Banana 2 reference-to-image) y slot `keyframes` (FLUX 3: `{image_url, frame_index}` a 24 fps). Se vuelven a mostrar los endpoints ocultos. Colocación según la guía de BFL/Runware: 1 imagen = inicio; 2 = inicio y final; 3–10 = repartidas de forma uniforme (experimental). Segundo de cada keyframe editable; posiciones únicas; duración numérica 5–20 s obligatoria; la proporción sigue a la primera imagen. El agente recibe estas reglas y los campos `refs`/`times` en los pasos de vídeo. *Decidido (usuario: "buscar la mejor implementación").* Hecho: `placeKeyframes`/`clipTrim` (params), `structuredInputs` (Atlas/fal), segundo o recorte editable en cada adjunto del composer, puertos de nodo "References / keyframes", "Reference videos" y "Video clip", `capabilityHints` para el agente (también en la red de regresión). Límite: en los nodos los keyframes se reparten solos y los clips usan el recorte por defecto (no hay control por arista).
4. [ ] **Audio.** Tipo de asset `audio` (subir, galería, reproductor, adjuntar) y nodos de audio. Como entrada: referencias de audio (`reference_audios`, `audio_urls`, `reference_audio_urls`, `refers` de tipo audio) y audio obligatorio (lip-sync `audio_url`, talking avatar, `target_audio_url`). Primera familia: transcripción en NanoGPT (Whisper-Large-V3, xai/speech-to-text/v1, gpt-4o-mini-transcribe, Elevenlabs-STT): audio → texto, utilizable como prompt en nodos y agente. *Decidido: subir y generar, con nodos y como entrada o salida según el modelo. Las familias de generación (voz, música, efectos, audio a vídeo) se confirman con el usuario antes de implementarlas.*
   - [x] 4a. Asset `audio` (subir MP3/WAV/M4A/AAC/OGG/FLAC/WebM, disco con su extensión, reproductor, filtro de galería, color propio) y audio como entrada: slots `audio` (una pista, obligatoria en lip-sync) y `refAudios`, `refers` con `type: audio`, NanoGPT `audio`/`audioDataUrl`/`referenceAudios` (este último sin verificar). Composer, plan del agente y puerto "Audio" en el nodo de vídeo.
   - [ ] 4b. Transcripción (NanoGPT `/api/transcribe`): audio → texto.
5. [ ] **Sujetos de Kling (`elements`)**, multiplano (`multi_prompt`) y voces (`voice_ids`/`voice_id`). Biblioteca de sujetos por sesión (nombre, imagen frontal, hasta 3 referencias o 1 vídeo); `@Nombre` en el prompt → `<<<element_N>>>`. Editor de planos (prompt + segundos; la suma = duración). Voz: se escribe o se elige de las voces del proveedor; crear una voz tiene coste y pide confirmación. *Decidido.*
6. [ ] **Máscaras en el modo Sketch.** Modo máscara en el editor Sketch para editar zona, quitar objeto e inpaint. Slot `mask` con la convención de cada proveedor (blanco = editar en Ideogram, Qwen y Z-Image; transparente = editar en GPT Image), mismo tamaño que la imagen. Solo se envía a modelos que la soporten; cada rechazo lleva un código de error explicativo (`MASK_UNSUPPORTED`, `MASK_SIZE`…) para depurar. *Decidido.*
7. [ ] **Estilo.** Paletas (`colors`, `background_color` de Recraft; `color_palette` de Ideogram con preset o colores con peso), `style_codes` (Ideogram), `model_id` (Ideogram custom) y `style_id` de Recraft: crear desde imágenes (con confirmación de coste) o pegar un ID; se guarda en la sesión. *Decidido.*
8. [ ] **LoRA, ControlNet y tiling.** Slot `loras` (`{path, scale}` en fal y Atlas; `lora_url_N`/`lora_scale_N` en NanoGPT) y editor de LoRA (URL + peso). Comprobar ControlNet (imagen de control + `preprocess`) y tiling (`tiling_mode`, máscara opcional) con la red de regresión.
9. [ ] **Kling motion-control** (imagen del personaje + vídeo de movimiento, `character_orientation` obligatorio). Desde el vídeo ("Transfer motion") y desde la imagen ("Animate with motion"), y como nodo con dos entradas. *Decidido: ambas.*
10. [ ] **El agente conoce cada capacidad.** Herramientas y prompt del agente con referencias, keyframes, clips, máscaras, sujetos, multiplano, audio y LoRA, según lo que declare el esquema de cada modelo. Se hace en cada fase, no al final.
Fuentes de keyframes: docs.bfl.ai/flux_3/flux3_video, runware.ai/docs/models/bfl-flux-3-video/guides/keyframes, fal.ai/models/blackforestlabs/flux-3/keyframes-to-video.

## Tarea anterior — validación de familias de imagen (2026-09-24)
Familias: GPT Image 2/2.5, Seedream V5, Nano Banana, Qwen Image, Grok Imagine Image, Step Image, P Image, Recraft, Ideogram, Z-Image (con variantes).
1. [x] Catálogos y esquemas públicos de Atlas, fal y NanoGPT (sin clave ni coste); pasar cada esquema por el parser. *Razón: mismo método que en vídeo.*
2. [x] Informe en `MODEL_VALIDATION.md` (sección de imagen). *Razón: saber qué falla antes de tocar código.*
3. [x] Corregir lo hallado con tests de fixtures reales; typecheck, navegador sin envío real; commit. 7 fallos corregidos (tamaños como encuadre, `size` de texto libre, campo de imagen obligatorio, `missing`, NanoGPT mixto y solo texto, `isAutoOption`); 39 tests; payloads verificados con envío interceptado.

## Tarea anterior — validación de modelos prioritarios (vídeo) (2026-09-24)
Modelos: Wan 3, MiniMax H3, Seedance 2.0/2.5, Flux 3 (y Video Edit), Veo 3.1, Kling V3, Kling O3/Omni 3, Grok Imagine Video (y Edits), Gemini Omni Flash 1.1, HappyHorse 1.1, con todas sus variantes.
1. [x] Descargar catálogos y esquemas públicos (Atlas 95, fal 116, NanoGPT 63 variantes; sin clave ni coste). *Razón: validar contra lo que sirve el proveedor, no contra ejemplos.*
2. [x] Pasar cada esquema por nuestro parser y comparar. Informe en `MODEL_VALIDATION.md` (10 fallos, límites anotados). *Razón: saber qué falla antes de tocar código.*
3. [x] Listado: `ModelSummary.needsVideo` (no puede ejecutarse sin vídeo) separado de `acceptsVideo` (admite vídeo de origen). Atlas deduce la capacidad del sufijo del ID cuando falta la categoría o contradice al esquema; NanoGPT distingue multimodo de edición/extensión. *Razón: fallos 1, 2 y 6.*
4. [x] Entradas de vídeo: el composer, el agente y los nodos envían también las referencias; `jobs.ts` las reparte según el esquema (primer fotograma si existe, el resto como referencias; sin primer fotograma, todas como referencias) y por tipo de asset (imagen/vídeo). *Razón: fallo 3.*
5. [x] Slots `refVideos` (`reference_videos`, `video_urls`, `reference_video_urls`, NanoGPT `referenceVideos`) y `mixedRefs` (`refers` de Atlas con `{url, type}`); NanoGPT `referenceImages` y `last_image`. *Razón: fallos 4, 5 y 7.*
6. [x] Parser: parámetros obligatorios con valor por defecto se envían fijos; propiedades `disabled` se omiten; NanoGPT rechaza antes de enviar vídeos de más de 4 MB. *Razón: fallos 8–10.*
7. [x] Tests de payload con esquemas reales recortados (`tests/fixtures/provider-schemas.json`), typecheck, navegador; commit. 35 tests. Navegador con catálogos públicos y `fetch` interceptado (sin envío real): Atlas Wan 3.0 reference manda `refers` con dos imágenes subidas; NanoGPT Seedance 2.5 manda `imageDataUrl` y MiniMax H3 reference `referenceImages`. Datos de prueba borrados.

## Tarea anterior — trabajos remotos y duración automática (2026-09-24)
Fallos 4, 5 y 6 de `API_DOC_REVIEW.md`. Sin llamadas de pago.
1. [x] `http.ts`: `NetworkError` (red o timeout por petición, `timeoutMs`) y `JobFailedError` (el proveedor confirma el fallo). `providers/shared.ts`: `pollJob()` común con reintentos y espera creciente ante fallos temporales (red, 408/429/5xx) y límite local de espera que no declara fallido el trabajo. Atlas, fal y NanoGPT lo usan. *Razón: un fallo al consultar no es un fallo remoto.*
2. [x] `jobs.ts`: solo `JobFailedError` borra `remoteJob`; con cualquier otro error, límite de espera o cancelación local se conserva, y `recheckGeneration()` reanuda la consulta (botón "Check again" en la tarjeta). *Razón: no perder un trabajo ya pagado.*
3. [x] NanoGPT: mensaje de error legible aunque `error` sea un objeto; mismo criterio en Atlas. *Razón: `[object Object]`.*
4. [x] `pricing.ts`/`costs.ts`: duración `<= 0` (automática) se estima con la duración máxima del modelo y se marca aproximada con nota; etiqueta "Auto" en la interfaz. *Razón: `-1` daba un importe negativo; el máximo mantiene prudente el control de gasto.*
5. [x] Tests (poll simulado, precio con `-1`), typecheck, navegador; commit. 25 tests. Navegador con `fetch` simulado: 503→completed guarda el resultado; 401 y cancelar conservan el trabajo; `failed` lo cierra. Pendiente: `/generate-video/recover` de NanoGPT (solo si el ID ya se perdió) y los fallos 1–3.

## Tarea — licencia (2026-09-25)
1. [x] Apache 2.0: `LICENSE` (texto oficial de apache.org), `NOTICE` con la atribución, `"license": "Apache-2.0"` en `package.json` y sección en el README. *Razón: el usuario quiere uso libre para cualquiera con atribución explícita; comparada con MIT, MPL 2.0 y AGPL 3.0 (Gentle AI usa MIT; OpenMontage, AGPL-3.0).*

## Tarea — comparación documental de proveedores (2026-09-25)
1. [x] Comparar los ejemplos de `/home/samuel/Descargas/API DOC` con los adaptadores y parámetros. *Razón: identificar incompatibilidades concretas sin consumir APIs de pago.*
2. [x] Comunicar diferencias, coincidencias y límites en `API_DOC_REVIEW.md`; registrar la revisión documental. *Razón: separar errores de funciones no implementadas, sin modificar la aplicación. Typecheck y 20 tests correctos; sin navegador ni ejecución remota por ser revisión documental.*

## Tarea — plan auditado (2026-09-24)
1. [x] Crear `REMEDIATION_PLAN_AUDITED.md` con la revisión de GPT 6 ASTRA. *Razón: corregir premisas y prioridades conservando el original.*
2. [x] Revisar el documento y registrar un commit. *Razón: dejar una propuesta trazable; sin cambios de código. Verificación documental; pruebas de aplicación pendientes de implementación.*

## Tarea anterior — persistencia en disco (2026-09-25)
La app no tiene backend; el navegador perdió sesiones, archivos y claves al reiniciarse su perfil.
1. [x] `server/local-store.js`: plugin de Vite (dev/preview) con `/x/store`: estado en `data/state.json` (permisos 600, contiene claves) y archivos en `data/<ns>/<id>.<ext>` (PNG/MP4 legibles). Escritura atómica, nombres validados. *Razón: mini-backend local que solo existe mientras se ejecuta el servidor; mismo patrón que los relays `/x/*`.*
2. [x] `src/lib/disk.ts` + `idb.ts`: espejo en el único punto de guardado (`stateDb`, `blobDb`). Estado con marca `savedAt`: al cargar gana el más reciente. Archivos: si faltan en el navegador se leen del disco. Al arrancar se suben al disco los que falten. Sin servidor (web estática) se desactiva solo. *Razón: el resto de la app no cambia.*
3. [x] "Wipe all data" mueve `data/` a `data.bak-<fecha>` en vez de borrarlo, para que no reaparezca al recargar y sin pérdida irreversible. `navigator.storage.persist()`. *Razón: coherencia y seguridad.*
4. [x] `data/` en `.gitignore`. Tests, typecheck, navegador; commit. `PROPUESTAS.md` con las opciones de despliegue discutidas (no es un plan fijo).

## Tarea anterior — NanoGPT ignoraba las imágenes de entrada (2026-09-25)
1. [x] Relight devolvía otra persona y Remove BG/Upscale decían "requires an image". Probado contra la API (sin coste, con `birefnet/v2` e imágenes por debajo del mínimo): `POST /api/v1/images` **ignora `input_references`** (pese a la documentación) en ambos hosts y lee `imageDataUrl`/`imageDataUrls` (PNG, JPEG y WebP). El adaptador pasa a `imageDataUrls` y usa la clave del slot. *Razón: la imagen nunca llegaba y los modelos que aceptan solo texto generaban sin ella.*
2. [x] Nota: una prueba con `nano-banana-pro` y una imagen de 4×4 px generó de verdad (~0,28 USD no autorizados). Para sondear la API sin coste usar solo modelos que no generan sin imagen (`birefnet/v2`) o imágenes por debajo del mínimo (1×1).

## Tarea anterior — correcciones tras la primera generación real (2026-09-25)
Prueba real: el agente (GLM 5.3 Flash · NanoGPT) animó un personaje con Seedance 2.0 Mini de Atlas. Estimado 0,055 USD; cobrado 0,122 USD (saldo Atlas 3,319255 → 3,197287).
1. [x] Tarjeta del plan en "Running" para siempre tras recargar a mitad: la ejecución vive en memoria. `settleInterruptedPlans()` sigue al arrancar las generaciones que `resumeInterrupted` retoma (sin reenviar nada) y cierra el plan con su estado real. *Razón: el vídeo llegaba pero la tarjeta nunca se cerraba.*
2. [x] El resultado de Atlas quedó solo en su almacén (`*.volces.com`, sin CORS, URL firmada que caduca en 24 h), así que no se guardaba y Extract frame fallaba ("Video failed to load"). Relay `/x/media` en dev/preview solo para hosts de almacenamiento de proveedores (lista blanca, 403 al resto); `fetchBlob` reintenta por él; `ensureAssetBlob` guarda el archivo al usarlo y `adoptRemoteAssets()` al arrancar; los fotogramas se leen de bytes locales. *Razón: no perder resultados ni fallar herramientas.* Límite: sin backend en producción, esos hosts seguirán sin poder descargarse.
3. [x] Precio de vídeo de Atlas mostrado como mínimo (`≥`, `PriceRule.lowerBound`): Atlas solo publica el tramo más barato; a 720p cuesta ~2×. *Razón: no prometer un importe menor al real.*

## Tarea anterior — fase 3: entrada de vídeo (2026-09-25)
Contrastado con esquemas vivos y docs: fal usa `video_url`; Atlas `video` o `video_url` (sube con `uploadMedia`); NanoGPT `videoDataUrl` en `generate-video` (docs oficiales). fal está bloqueado por saldo agotado.
1. [x] `InputSlots.video`, `ModelSummary.acceptsVideo`, `GenRequest.video`. `schemaFromJson` detecta la clave de vídeo; NanoGPT la declara (`videoDataUrl`). *Razón: extensión mínima ya prevista.*
2. [x] Descubrimiento: fal categoría `video-to-video`; Atlas deja de saltar `VIDEO-TO-VIDEO`; NanoGPT incluye modelos con entrada de vídeo. Los que necesitan vídeo no salen en los selectores normales. *Razón: evitar modelos que fallarían sin vídeo.*
3. [x] Operaciones `video_upscale` y `video_edit` con listas preferidas por proveedor (IDs verificados) y fallback por etiqueta; ajustes Auto/override como el resto. *Razón: fallback entre los tres proveedores.*
4. [x] Adaptadores: fal y NanoGPT envían data URL; Atlas sube con `uploadMedia` (extensión según MIME). Sin infraestructura nueva de subidas. *Razón: KISS; límite: vídeos grandes pueden exceder el tamaño de petición.*
5. [x] Tests, typecheck, navegador (sin gastar sin permiso); commit. Verificado con adaptadores reales: NanoGPT 62 y Atlas 23 modelos con entrada de vídeo; esquemas y slots correctos. Falta una ejecución de pago de extremo a extremo (pendiente de permiso).

## Tarea anterior — fase 1 de herramientas (2026-09-25)
1. [x] Engine `frame` → `local` (operaciones gratis en el navegador). Extract frame gana "en el segundo X" (Capture). *Razón: un solo camino para lo local.*
2. [x] Grid-split (local): corta una imagen en 2×2 o 3×3; cada trozo es una salida y el nodo elige cuál pasa aguas abajo. *Razón: gratis, sin proveedor.*
3. [x] Nine-grid (edit): hoja de contactos 3×3 con nueve ángulos, vía el modelo de edición y su fallback. *Razón: ningún proveedor lo ofrece como modelo; es una instrucción, igual que Relight.*
4. [x] Barra del nodo: menú "More" con el resto de herramientas para ese tipo y el atajo Panorama (Reframe 21:9). *Razón: la barra solo muestra 4 rápidas.*
5. [x] Tests, typecheck, navegador; commit.
6. [x] Hallado al probar: `addConnected` apilaba nodos nuevos encima de los hijos existentes → se colocan bajo el último hijo. Medidas/selección del canvas con actualizaciones funcionales (varios avisos antes de un render perdían datos). Nota de pruebas: con la pestaña del navegador oculta los ResizeObserver no se ejecutan y los nodos salen ocultos; no es un fallo de la app.

## Tarea anterior — Sketch sobre imagen (2026-09-25)
1. [x] Trazo del pincel a `design/raster.ts` (`strokeSegment`), usado por el Designer y por Sketch. *Razón: no duplicar el pincel.*
2. [x] `SketchEditor` modal: imagen grande, pincel, color, borrador, tamaño, deshacer/rehacer (trazos vectoriales, poca memoria), Guardar y ✕ que pide guardar o descartar si hay cambios. Reutiliza `ui.brush`, `assetCanvas` y el guardado de assets del Designer. *Razón: pintar sin salir del flujo.*
3. [x] ~~Guardar crea nodos nuevos~~ → corregido a petición del usuario: el nodo guarda `sketchAssetId`; esa copia es lo único que va aguas abajo (`nodeOutputAsset`), la tarjeta muestra "Edited" y la barra "Reset image" vuelve al original. La copia (origen `sketch`) no sale en la galería y se borra al restablecer, reeditar o regenerar. *Razón: sin nodos duplicados ni dos imágenes enviadas al proveedor.*
5. [x] Upscale de NanoGPT: `seedvr2-image`, `pruna-ai/p-image/upscale`, `clarity-ai-creative-upscaler` (verificados). IDs de vídeo/audio anotados en `PROGRESS.md` para fases futuras.
4. [x] Accesos: botón Sketch en la barra del nodo con imagen y clic en las miniaturas de referencia. Tests, typecheck, navegador; commit.

## Tarea anterior — tarjeta de prompt del nodo (2026-09-25)
1. [x] Panel del nodo como tarjeta de prompt: miniaturas de las entradas conectadas + "Ref" (elegir de la galería crea un nodo asset conectado), prompt amplio, fila inferior con modelo · resumen de ajustes (resolución | duración | proporción) · nº de imágenes · Run con coste. *Razón: todo a mano sin abrir menús; mismos datos del schema.*
2. [x] Popover de ajustes con segmentados (resolución, proporción con glifo, duración, audio) según el schema del modelo. *Razón: el proveedor decide qué opciones existen.*
3. [x] Tests, typecheck, navegador; commit.

## Tarea anterior — prioridad de modelos del agente (2026-09-24)
IDs contrastados con los catálogos vivos de OpenRouter, NanoGPT y Atlas.
1. [x] `llm.ts`: `PREFERRED_LLM` → `NORMAL_LLM` y `TOP_LLM` (IDs reales de los tres catálogos, en orden); `pickDefaultLlm(models, tier)` recorre la lista del tier (top cae a normal) y exige tools + visión; luego el fallback genérico actual. `LlmModel.vision` leído del catálogo. *Razón: una sola lógica; el catálogo decide qué existe.*
2. [x] `settings.agent.tier` (`normal` por defecto). *Razón: el Top Tier solo se usa si se elige explícitamente.*
3. [x] `catalog.ts`: `repickAgentModel()` para cambio de proveedor o tier; elimina la copia de la lógica en `SettingsPanel`. *Razón: DRY.*
4. [x] Ajustes: selector Normal/Top junto al modelo; el selector manual sigue igual. *Razón: elección explícita.*
5. [x] Tests, typecheck, commit.

## Tarea anterior — parámetros de proveedores (2026-09-24)
Contrastado con esquemas vivos de fal, Atlas y NanoGPT antes de tocar código.
1. [x] `ROLE_KEYS.count`: quitar `max_images` y `batch_size`. *Razón: Seedream (fal v4.5/edit) trae `max_images` antes que `num_images`; ambos recibían N (hasta N² imágenes). Ningún esquema vivo usa `batch_size`.*
2. [x] Rol `aspect` solo si alguna opción del enum se interpreta como proporción; si no, `other`. *Razón: `image_size`/`orientation`/`ratio` a veces no son proporciones (p. ej. `align_image`, enteros); así el schema decide.*
3. [x] `ratioOf`: entender `portrait_3_4`/`portrait_9_16` (Krea/Ideogram en Atlas) además de `portrait_4_3` (fal). *Razón: hoy un 9:16 se envía como `square`.*
4. [x] fal discovery: paginar hasta el final (tope 10 páginas) en vez de 3. *Razón: image-to-image tiene 400 modelos; se perdían 100. No existe categoría `reference-to-video`: Seedance/Wan Reference y SAM ya entran por image-to-video/image-to-image; video-to-video no se añade (pide vídeo de entrada, no soportado).*
5. [x] `MAX_PLAN_STEPS` único (tool, zod, normalizador). *Razón: 16 vs 24.*
6. [x] `agent/tools.ts` usa `OP_IDS`; la lista de ops del system prompt se genera desde `OPS`. *Razón: evitar drift.*
7. [x] Tests, typecheck, commit.

## Tarea anterior — correcciones Designer (2026-09-24)
1. [x] "Free" en la lista de modelos muy separado → pegarlo al nombre. *Razón: lectura rápida del precio junto al modelo.*
2. [x] Aviso "Creates a new vector layer" fijo (`Stage.tsx`, `.stage-hint subtle`): sale mientras haya herramienta de forma y la capa activa no sea vectorial (p. ej. tras colocar una imagen) → eliminarlo. *Razón: con el paso 4 toda forma crea su capa; el aviso ya no informa nada.*
3. [x] Tinte verdoso: lo aplica el modelo demo "Local Sketch" (`demo/ops.ts` `stylize`) al simular img2img con la imagen adjunta → bajar la intensidad. *Razón: la demo no debe alterar tanto la referencia.*
4. [x] Formas se fusionan: cada forma nueva se añadía a la capa vectorial activa → cada forma crea su propia capa (salvo capa vectorial activa vacía). *Razón: edición independiente.*
5. [x] Caja de texto enorme: se creaba con ancho fijo (60 % del lienzo) → ancho `0` = automático, la caja mide el texto y crece al escribir (`scaleLayer` conserva el 0). *Razón: selección precisa.*
6. [x] Pincel/borrador destructivos → `RasterLayer.allowPaint`; una imagen (`sourceAssetId`) está protegida salvo que se active "Allow painting" en Propiedades. El pincel sobre imagen/otra capa crea una capa "Paint N" encima (o reutiliza la de encima) y la deja activa, así los siguientes trazos van a ella. Borrador bloqueado en imágenes protegidas. *Razón: edición no destructiva sin una capa por trazo.*
7. [x] Panel derecho: ancho arrastrable (borde izquierdo, guardado en localStorage), botón para plegar, secciones "Layers" y "Properties" plegables; el composer se centra con la variable `--layers-w`. *Razón: más espacio de lienzo.*
8. [x] Typecheck, tests, navegador; commit.
9. [x] Extra hallado al verificar: el editor de texto se cerraba al crearse (el `mousedown` del lienzo le quitaba el foco) → foco en `requestAnimationFrame`. Separado el contador de grupo en la lista de modelos ("LOCAL DEMO 1").

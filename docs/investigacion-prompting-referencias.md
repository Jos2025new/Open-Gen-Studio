# Investigación: prompting, roles de referencia y guías por modelo

2026-10-14. Resumen de informes de Haiku/Sonnet (solo existían en transcripciones). Sonnet escribió las guías sin releer las fuentes; URLs y datos vienen de los informes de Haiku: verificar antes de citar.

## Biblioteca de prompts externa frente al código

`ops.ts` ya cubre ángulo, relight (8 presets), upscale, reframe, inpaint/remove_object con máscara, reference_sheet y continuidad. Faltaban: Match Color, transferencia de luz desde referencia, cambio de fondo, pose/ropa/expresión, realismo y roles.

## Roles por modelo (documentación oficial)

- FLUX: por posición «image N», hasta 10 — https://docs.bfl.ai/guides/prompting_editing_overview
- Gemini/Nano Banana: por categorías (objeto, personaje, estilo), con límites — https://ai.google.dev/gemini-api/docs/image-generation
- Qwen: doc oficial 403; «Image N»/«Figure N».
- GPT Image y Seedream: sin sintaxis oficial. Kling: solo terceros.

## Esquemas públicos (Atlas, fal, OpenRouter)

Ningún modelo de imagen revisado tiene campo de rol. Campos estructurados solo en fotogramas inicial/final (Kling O1/O3), `elements` de Kling (sin rol), `character_orientation` y `omni_reference_task_type`. Sin verificar: Runway, NanoGPT, subesquemas de fal. La afirmación vale solo para lo leído.

## Cláusulas frente a guías

Conflictos: ideogram (JSON), recraft, krea/step-image/p-image (longitud), flux (orden, ref de estilo), nano-banana (duplicado). Compatibles: seedream, z-image, product, photography, social. Resultado: `REALISM_POLICY` por familia.

## Guías nuevas

Contrastadas con Higgsfield Supercomputer (referencia de la industria, no fuente de verdad).

- Qwen-Image: https://github.com/QwenLM/Qwen-Image
- Recraft: https://www.recraft.ai/docs/recraft-models/choosing-a-model — paleta en `colors`/`background_color`, `model_type`.
- Grok Imagine: https://docs.x.ai/docs/guides/image-generation — escena corta, mood concreto mejor que adjetivos, primero lo que se conserva; límite de refs según plataforma (xAI 5 / Higgsfield 3).

## Repositorios reales (H3, Seedance, Wan), 2026-10-14

- **Fuentes y límites.** [awesome-minimax-h3-prompts](https://github.com/BeatAPI/awesome-minimax-h3-prompts): 550 prompts, selección editorial. [awesome-seedance](https://github.com/LearnPrompt/awesome-seedance): 832 casos, 27 plantillas y 495 reejecuciones (72–82 % reproducidas en H3/Grok; no es un ranking; el README da cifras distintas en la cabecera y atada a goodcase.ai). Wan ([guía de Alibaba](https://www.alibabacloud.com/help/en/model-studio/wan3-video-generation-prompt-guide)): 0 pares aceptados; solo se leyeron sus primeros 100 000 caracteres.
- **Ya cubierto por `VIDEO_DIRECTION_POLICY`:** rol y rasgos de cada referencia, un estilo común, física como cadena, continuidad entre beats, diálogo cronometrado.
- **Nuevo:** realismo con los defectos del dispositivo de captura (móvil, Hi8/VHS, operador imperfecto) en vez de superlativos; plantillas por género (guion cronometrado, bloqueo de personaje, UGC a mano, estilo anime, stop-motion); storyboard por paneles hecho antes como imagen y usado de referencia.
- **Advertencia.** Las galerías se contradicen (un vlog «continuo» con cortes; «16:9 vertical»). No copiar un caso sin leerlo.
- **Pendiente (no implementar ahora):** fichas de captura de vídeo, análogas a las fichas de toma de imagen.

## Pendiente

Datos de Higgsfield/OpenArt sobre roles para decidir la UI. Historial: [037](history/037-2026-10-W42.md).

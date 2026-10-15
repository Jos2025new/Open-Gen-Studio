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

## Pendiente

Datos de Higgsfield/OpenArt sobre roles para decidir la UI. Historial: [037](history/037-2026-10-W42.md).

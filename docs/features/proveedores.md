# Proveedores

| Comportamiento documentado | Código | Test |
| --- | --- | --- |
| El registro incluye los adaptadores local, OpenRouter, fal, NanoGPT y Atlas. | [src/engine/providers/registry.ts](../../src/engine/providers/registry.ts) | sin test |
| Los esquemas describen entradas y parámetros; el enrutamiento adapta imágenes a fotogramas o referencias según las capacidades. | [src/engine/params.ts](../../src/engine/params.ts) | [tests/providers.test.ts](../../tests/providers.test.ts) |
| NanoGPT genera voz (Gemini 3.8 Flash TTS por defecto, GPT-4o mini TTS, ElevenLabs v4 y v4 Turbo, MiniMax Speech 2.8) y efectos de sonido (ElevenLabs Sound Effects v2) con `POST /v1/audio/speech`. La voz se cobra por cada 1000 caracteres, sin redondear nunca a gratis; un efecto se estima a su duración máxima (22 s). | [nanogptAudio.ts](../../src/engine/providers/nanogptAudio.ts) | [nanogpt-speech.test.ts](../../tests/nanogpt-speech.test.ts) |
| La cotización de Atlas usa modelo y parámetros del envío; una cotización fallida mantiene la estimación. | [src/engine/quotes.ts](../../src/engine/quotes.ts) | [tests/quotes.test.ts](../../tests/quotes.test.ts) |

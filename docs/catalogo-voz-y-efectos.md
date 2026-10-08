# Catálogo de texto a voz y efectos de sonido (2026-10-08)

Consulta en vivo del 2026-10-08, sin gasto, para elegir qué modelos implementar. Los precios cambian: vuelve a consultarlos antes de decidir.

## Método

- **Atlas:** `GET https://api.atlascloud.ai/api/v1/models` (536 modelos). El listado no dice en qué unidad cobra el texto a voz, así que se usó la cotización gratuita `POST /api/v1/model/calculate` con 1000 y 2000 caracteres en el campo `text`. El precio se duplica: **la unidad es 1000 caracteres**. Seed Audio 1.0 cobra lo mismo con cualquier longitud, así que su precio es por generación.
- **NanoGPT:** `GET https://nano-gpt.com/api/v1/audio-models?detailed=true` (101 modelos de audio), con precio y unidad publicados.
- **Novedad:** ningún catálogo da fechas de publicación (NanoGPT pone la misma fecha en todos). Lo «más nuevo» se juzga por la versión del nombre.

## Texto a voz, USD por 1000 caracteres

| Modelo | Atlas | NanoGPT | Nota |
| --- | --- | --- | --- |
| GPT-4o mini TTS (2025-12-15) | — | **0,00102** | El más barato y la versión más reciente de OpenAI. El tono se indica con instrucciones. |
| Kokoro 82M | — | 0,0017 | Abierto, muy barato |
| Inworld TTS 1.5 Mini / Max | — | 0,0102 / 0,0204 | |
| GPT-4o mini TTS (sin fecha) | — | 0,01326 | |
| xAI TTS v1 | 0,015 | 0,0165 | |
| tts-1 / tts-1-hd (OpenAI) | — | 0,0255 / 0,051 | Generación anterior |
| MAI-Voice-2.1 Flash / 2.1 (Microsoft) | — | 0,0255 / 0,0374 | |
| Seed Speech TTS 2.0 (ByteDance) | — | 0,03 | |
| Gemini 2.5 Flash TTS | 0,04 | 0,05117 | |
| **Gemini 3.8 Flash TTS** | — | **0,05** | La versión más nueva de Google. Tono descrito con palabras y diálogo entre dos voces. |
| Omnivoice / Inworld Realtime TTS 2 | — | 0,05 | |
| MiniMax Speech 2.6 Turbo / HD | 0,048 / 0,08 | 0,06 / 0,10 | |
| **MiniMax Speech 2.8 Turbo / HD** | — | **0,06 / 0,10** | La versión más nueva de MiniMax |
| **ElevenLabs v4 Turbo / v4** | — | **0,068 / 0,136** | La versión más nueva de ElevenLabs; la referencia en calidad |
| Gemini 2.5 Pro TTS | 0,08 | 0,10217 | |
| Qwen Audio 3.0 TTS Flash | — | 0,085 | |
| ElevenLabs v3 | 0,10 | 0,17 | Versión anterior a v4 |
| ElevenLabs Turbo v2.5 | — | 0,102 | |
| Gemini 3.1 Flash TTS | 0,15 | 0,102 | |
| Seed Audio 1.0 (ByteDance) | 0,286 por generación | 0,30 por generación | |
| VibeVoice (Microsoft) | — | 0,15 por generación | |

**Conclusión:** las versiones más nuevas (ElevenLabs v4, Gemini 3.8, MiniMax 2.8 y GPT-4o mini TTS 2025-12-15) y la más barata están solo en NanoGPT. Atlas tiene versiones anteriores.

## Efectos de sonido

**En Atlas no hay ninguno.** Se revisaron los 536 modelos: el único con «effects» en el nombre es Kling Effects, que aplica efectos a vídeo. En NanoGPT:

| Modelo | Precio | Nota |
| --- | --- | --- |
| **ElevenLabs Sound Effects v2** | 0,002 USD por segundo | El más barato |
| Stable Audio 3 Small SFX | 0,0227 USD por generación | |
| Mirelo SFX 1.6 | 0,01 USD por segundo | También alarga un sonido y rellena un tramo |

## Selección

Pendiente del usuario: ver [pendientes](pendientes.md).

Propuesta del asistente:
- **Voz barata:** GPT-4o mini TTS 2025-12-15.
- **Voz expresiva y diálogos:** Gemini 3.8 Flash TTS.
- **Voz de calidad:** ElevenLabs v4, y v4 Turbo como versión más barata.
- **Voz multilingüe:** MiniMax Speech 2.8 Turbo y HD.
- **Efectos:** ElevenLabs Sound Effects v2.

La prueba con gasto real la hará el usuario.

# Precios de vídeo por proveedor (datos duros, 2026-09-26)

Fuentes, consultadas por terminal el 2026-09-26, sin clave y sin coste:
- Atlas: `GET https://api.atlascloud.ai/api/v1/models` → `price.actual.base_price` (USD/s). **Es el tramo más barato** (menor resolución); Atlas no publica el precio por resolución ni en la API ni en los README. Dato real previo: Seedance 2.0 Mini estimado 0,055 → cobrado 0,122 a 720p (~2,2×).
- OpenRouter: `GET https://openrouter.ai/api/v1/videos/models` → `pricing_skus`. Seedance se cobra por *tokens de vídeo*; a 24 fps, 480p ≈ 9 608 tokens/s y 720p ≈ 21 600 tokens/s (cálculo: ancho × alto × fps / 1024; cuadra con el "desde" de la web de OpenRouter).
- NanoGPT: `GET https://nano-gpt.com/api/v1/video-models?detailed=true` → `pricing`.
- Capturas del usuario de la web de Atlas y OpenRouter (`~/Imágenes/*.txt`).

## Los seis recomendados por el usuario (USD por segundo)

| Modelo | Atlas (API, tramo mínimo) | OpenRouter 480p | OpenRouter 720p | NanoGPT 480p | NanoGPT 720p | Más barato con dato duro |
|---|---|---|---|---|---|---|
| Seedance 2.5 | 0,134 | **0,103** | 0,231 | 0,18 | 0,36 | OpenRouter a 480p. A 720p: OpenRouter (0,231) frente a NanoGPT (0,36); Atlas a 720p sin publicar |
| Wan 3.0 | **0,040** | 0,05 | 0,10 | 0,07 | 0,13 | Atlas en el tramo mínimo; a 720p: OpenRouter (0,10) frente a NanoGPT (0,13); Atlas a 720p sin publicar |
| Wan 3.0 Prime | **0,061** | 0,068 | 0,14 | 0,0625 | 0,125 | Atlas en el tramo mínimo; a 720p NanoGPT (0,125) |
| Seedance 2.0 Fast | **0,027** | 0,040 | 0,091 | — | 0,071 | Atlas en el tramo mínimo; a 720p NanoGPT (0,071) frente a OpenRouter (0,091); Atlas a 720p sin publicar |
| MiniMax H3 (standard) | **0,038** | 0,13 (tarifa única) | 0,13 | 0,13 | 0,13 | Atlas, aunque se duplique a 768P |
| HappyHorse 1.1 | **0,070** (720P es su mínimo) | — | 0,0988 | — | 0,082 | Atlas (0,070 a 720p: dato comparable) |
| Grok Imagine Video 1.5 | **0,028** (Developer) / 0,08 | 0,08 | 0,14 | 0,08 | 0,14 | Atlas v1.5 Developer |

## Discrepancias con las capturas de la web de Atlas
- MiniMax H3: web 0,08/s frente a API 0,038/s (~2,1×) → la web parece mostrar la resolución por defecto (768P), la API el mínimo (480P).
- Gemini Omni 1.1 Flash: web 0,099/s frente a API 0,037/s.
- Seedance 2.5: web 0,1397 "estimated" frente a API 0,134; Seedance 2.0 Mini: 0,0112 frente a 0,011.
Conclusión: el precio de la web de Atlas no siempre es el de la API; ninguno de los dos es el precio a 720p. La app muestra los precios de Atlas como mínimo (`≥`).

## Hallazgos fuera de la lista
- **MiniMax H3 Developer (Atlas): 0,015/s**, con texto, imagen y referencias, 480P/768P. Es el H3 más barato del catálogo, más que H3 Max Turbo (0,024).
- Veo 3.1 Lite: Atlas 0,05; OpenRouter 0,03 sin audio y 0,05 con audio a 720p; NanoGPT 0,05 a 720p.
- Kling V3 std: Atlas 0,071, OpenRouter 0,084 (0,126 con audio), NanoGPT 0,084/s (×1,5 con audio).

## Límites de este análisis
- Atlas a 720p no está publicado: solo una generación real (de pago) lo mide. La comparación justa a 720p hoy solo se puede hacer entre OpenRouter y NanoGPT.
- Precios de catálogo a esta fecha; cambian.

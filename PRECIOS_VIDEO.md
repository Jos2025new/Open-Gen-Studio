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
| HappyHorse 1.1 | 0,070 (480p) | — | 0,0988 (720p) | — | 0,082 (720p) | Ver comparación a 720p: NanoGPT |
| Grok Imagine Video 1.5 | **0,028** (Developer) / 0,08 | 0,08 | 0,14 | 0,08 | 0,14 | Atlas v1.5 Developer |

## Cobros reales de Atlas por resolución (dato duro)
Fuente: `open-generation-studio/data/studio.db` (tabla `jobs`: `actual_cost`, duración y resolución de cada trabajo ejecutado), leída en solo lectura el 2026-09-26.

| Atlas | 480p (USD/s) | 720p (USD/s) | 720p / 480p |
|---|---|---|---|
| Wan 3.0 (i2v, r2v) | 0,040 (1 trabajo, 12 s) | **0,080** (2 trabajos, 5 s) | ×2,0 |
| Seedance 2.0 Fast (i2v, r2v) | 0,027 (3 trabajos) | **0,0585** (2 trabajos) | ×2,2 |
| Seedance 2.0 Mini (r2v, t2v) | 0,0113 (2 trabajos) | **0,0244** (19 trabajos, con y sin audio) | ×2,2 |

El precio base de la API de Atlas es el de 480p. Seedance escala con los píxeles (×2,2, igual que sus tokens de vídeo: 720p ≈ 2,25 × 480p); Wan ×2. El audio no cambió el precio de Seedance 2.0 Mini.

### Presupuesto exacto de Atlas (`POST /api/v1/model/calculate`, 2026-09-26)
Atlas calcula el precio de una petición concreta **sin ejecutarla y sin clave**; devuelve `price`, `origin_price` y `discount`. Coincide con los cobros reales (Wan 3.0 720p 5 s = 0,40 USD = 0,08/s; Seedance 2.0 Fast 720p = 0,0585/s). Es el método que usaba `open-generation-studio` (regla "nada gasta sin quote").

| Atlas | 480p (USD/s) | 720p / 768P (USD/s) |
|---|---|---|
| Wan 3.0 | 0,040 | **0,080** |
| Wan 3.0 Prime | — | **0,126** |
| Seedance 2.0 Fast | 0,027 | **0,0585** |
| Seedance 2.5 | 0,141 | **0,303** |
| MiniMax H3 (standard) | 0,038 | **0,080** (768P) |
| MiniMax H3 Developer | — | **0,024** (768P) |
| MiniMax H3 Max Turbo | — | **0,038** (768P) |
| HappyHorse 1.1 | 0,070 | **0,140** |
| Grok Imagine Video 1.5 Developer | 0,028 | **0,049** |
| Kling V3 std (sin resolución) | — | 0,071 sin sonido / **0,107** con sonido |
| Veo 3.1 Lite | — | **0,050** (8 s) |
| Gemini Omni 1.1 Flash | — | **0,099** |

### Comparación a 720p (resolución media por defecto de la app)
| Modelo | Atlas 720p (exacto) | OpenRouter 720p | NanoGPT 720p | Más barato |
|---|---|---|---|---|
| Wan 3.0 | **0,080** | 0,10 | 0,13 | Atlas |
| Wan 3.0 Prime | 0,126 | 0,14 | **0,125** | Empate Atlas / NanoGPT |
| Seedance 2.0 Fast | **0,0585** | 0,091 | 0,071 | Atlas |
| Seedance 2.5 | 0,303 | **0,231** | 0,36 | OpenRouter |
| MiniMax H3 (768P) | **0,080** | 0,13 | 0,13 | Atlas (y H3 Developer 0,024) |
| HappyHorse 1.1 | 0,140 | 0,0988 | **0,082** | **NanoGPT** (corrige la versión anterior de este documento) |
| Grok 1.5 | **0,049** (Developer) | 0,14 | 0,14 | Atlas |

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
- Atlas a 720p no aparece en el catálogo, pero su endpoint de presupuesto lo da exacto (arriba). NanoGPT no tiene presupuesto: su precio sale del catálogo y solo el cobro real lo confirma.
- Precios de catálogo a esta fecha; cambian.

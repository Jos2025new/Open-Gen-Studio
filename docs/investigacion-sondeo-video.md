# Investigación: sondeo (polling) de trabajos asíncronos de generación de vídeo

Fecha de la investigación: 2026-10-25. Solo lectura: no se editó ningún archivo del repositorio, no se llamó a APIs de pago y no se usaron claves.

Notas de método: las citas de código vienen de descargas directas de GitHub (`gh api`, versiones de la rama por defecto en el momento de la consulta). Las líneas indicadas son las de esa descarga. La API de GitHub llegó al límite de cuota durante la investigación, así que el cliente oficial de Replicate en Python no se pudo inspeccionar. Lo que no se encontró figura como UNKNOWN.

---

## 1. OpenRouter (nuestro proveedor)

Fuente: https://openrouter.ai/docs/guides/overview/multimodal/video-generation (y el tutorial https://openrouter.ai/blog/tutorials/video-generation-api/ citado en búsqueda).

- Intervalo recomendado: "Use a reasonable polling interval (e.g., 30 seconds) to avoid excessive API calls." Es una recomendación, no un límite.
- Duración típica según la doc: "30 seconds to several minutes depending on the model and parameters".
- Ejemplo de código oficial: `time.sleep(30)` en Python (tutorial, citado en búsqueda; la versión comunitaria usa `interval` = 30.0).
- Backoff: no documentado. Timeout de polling: no documentado. Límites de tasa: no documentados (UNKNOWN).
- Estados de polling: `pending`, `in_progress`, `completed`, `failed`. Los webhooks añaden `cancelled` y `expired` (`expired` con el mensaje "Job exceeded maximum time to live"; el valor del TTL es UNKNOWN).
- `polling_url`: absoluta, por ejemplo `https://openrouter.ai/api/v1/videos/abc123` (misma doc).
- Webhooks: `callback_url` por petición (tiene prioridad sobre el valor por defecto del workspace). Debe ser HTTPS. Cabeceras `X-OpenRouter-Idempotency-Key` (`<job_id>-<status>`) y `X-OpenRouter-Signature` si hay secreto configurado. Fuente: doc de video-generation.
- Receptor de webhooks: https://openrouter.ai/docs/cookbook/video-generation/video-generation-webhooks. Requiere URL pública HTTPS alcanzable por OpenRouter. "A local tunnel or deployed preview URL works as long as OpenRouter can reach it over HTTPS." Además, la firma usa el cuerpo crudo y un `t=...,v1=...` con HMAC-SHA256, y rechaza marcas de tiempo de más de 300 s. Los ejemplos de polling de esa página muestran comprobaciones en t=1, 11, 21, 31, 41 s, pero no declaran ningún intervalo.

## 2. Proveedores y apps de código abierto

### 2.1 OpenMontage (https://github.com/calesthio/OpenMontage)

Directorio con las herramientas de vídeo: `tools/video/`. No aparece ningún uso de webhooks en ese directorio (búsqueda por "webhook" sin resultados en los `.py` descargados).

| Herramienta | Intervalo | Backoff | Timeout | Fuente (líneas) |
|---|---|---|---|---|
| minimax_video.py | `poll_interval_seconds` por defecto 5 s | No (constante, con `min` contra el plazo) | `timeout_seconds` por defecto 900 s | https://github.com/calesthio/OpenMontage/blob/main/tools/video/minimax_video.py (líneas 195-202, 495-577) |
| grok_video.py | 5 s (mínimo 2 s) | No | 900 s (mínimo 30 s) | .../tools/video/grok_video.py (194-195, 408-431) |
| runway_video.py | 5 s fijo | No | 60 iteraciones × 5 s (≈5 min) | .../tools/video/runway_video.py (411-417) |
| kling_official_video.py | `poll_interval` 5 s | No | 900 s | .../tools/video/kling_official_video.py (129-130, 228-240) |
| kling_video.py | 5 s fijo | No | UNKNOWN en la lectura | .../tools/video/kling_video.py (164) |
| seedance_ark.py (BytePlus ModelArk) | 3 s por defecto (0-60 s permitido) | No en el polling; sí reintentos de la petición con backoff ×2 | 1200 s | .../tools/video/seedance_ark.py (301-325, 1308-1334) |
| seedance_replicate.py | 3 s | No | UNKNOWN | .../tools/video/seedance_replicate.py (195) |
| jimeng_video.py | 5 s por defecto | No | 600 s | .../tools/video/jimeng_video.py (122-140, 293-322) |
| gemini_omni_video.py | 5 s fijo | No | 900 s (`_MAX_POLL_SECONDS`) | .../tools/video/gemini_omni_video.py (52-53, 385-457) |
| gemini_omni_fal.py / minimax_fal_video.py | 5 s fijo | No | UNKNOWN | .../tools/video/minimax_fal_video.py (155-160) |
| higgsfield_video.py | 5 s fijo | No | UNKNOWN | .../tools/video/higgsfield_video.py (205-219) |
| heygen (`_shared.py`) | 5 s, ×1.2 por intento | Sí, tope 30 s | 600 s | .../tools/video/_shared.py (485-512) |
| atlas_video.py | `poll_interval` 5 s | No | `poll_timeout` 1200 s | .../tools/video/atlas_video.py (135-136) |

Webhooks: ninguno encontrado.

### 2.2 ComfyUI, nodos de API (https://github.com/Comfy-Org/ComfyUI)

Cliente compartido: https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_api_nodes/util/client.py

- `poll_op` (líneas 230-250): `poll_interval=5.0`, `max_poll_attempts=480`, `timeout_per_poll=120`, `max_retries_per_poll=10`, `retry_delay_per_poll=1.0`, `retry_backoff_per_poll=1.4`.
- Bucle `poll_op_raw` (líneas 341-560): las consultas en cola (`is_queued`) no consumen intentos (`consumed_attempts` solo sube cuando no está en cola, línea ~558). Dormir `poll_interval` entre consultas (línea ~538). Si hay interrupción por el usuario, llama a un endpoint de cancelación (líneas ~452-460). Mensaje de tiempo agotado: "Polling timed out after N non-queued attempts".
- Por nodo (cada archivo en `comfy_api_nodes/`):
  - nodes_veo2.py líneas 207 y 377: `poll_interval=9.0`.
  - nodes_kling.py línea 2654: `max_poll_attempts=800` (intervalo por defecto 5 s, ≈4000 s activos).
  - nodes_wan.py líneas 214, 342, 525…: 3 s, 4 s, 6 s, 7 s según el modelo.
  - nodes_minimax.py: 5, 10 y 15 s según el endpoint (líneas 550, 628, 1482, 1781).
  - nodes_bytedance.py líneas 365-366 (Seedance assets): 5 s, 1200 intentos.
  - nodes_vidu.py: 480 a 1440 intentos (intervalo por defecto).
- Webhooks: no encontrados en la búsqueda sobre esos nodos.

### 2.3 fal (cliente Python, https://github.com/fal-ai/fal/blob/main/projects/fal_client/src/fal_client/client.py)

- `PollBackoff` (líneas 1158-1178): `initial=0.25`, `multiplier=1.05`, `maximum=10.0`, `jitter=0.2` (±20 %).
- `DEFAULT_POLL_BACKOFF = PollBackoff()` (línea 1188). Comentario de la línea 1189: "polling no longer uses a fixed interval".
- `iter_events` (líneas 1610-1640): el backoff se reinicia cuando cambia el estado (`type(status) is not previous_status_type`). Con `interval` fijado, se usa ese intervalo fijo. La ultima comprobación `Completed` sale sin dormir.
- Timeout de consulta: `QUEUE_POLL_TIMEOUT = httpx.Timeout(120.0, connect=30.0)` (línea 1152).
- Documentación oficial del queue (https://fal.ai/docs/model-endpoints/queue, redirigida desde docs.fal.ai):
  - Estados: `IN_QUEUE`, `IN_PROGRESS`, `COMPLETED`.
  - Webhooks: sí, `webhook_url` (o `?fal_webhook=`). Se envía el resultado al completar. "Return 200 quickly to acknowledge the webhook." fal puede reintentar; usar `request_id` para idempotencia.
  - "Requests in the queue are never dropped." No hay límite de tamaño de cola.
  - `request_timeout` por defecto 3600 s por intento de proceso; `start_timeout` opcional; reintentos automáticos hasta 10 veces.
  - Streaming: `iter_events(with_logs=True)` en Python; `streamStatus()` (SSE) en JS; `GET .../status/stream` en REST.
  - Límites de tasa: UNKNOWN en esa página.

### 2.4 Replicate (https://replicate.com/docs)

- Estados: `starting`, `processing`, `succeeded`, `failed`, `canceled`, `aborted` (https://replicate.com/docs/topics/predictions/lifecycle).
- Recomienda "poll the API or use webhooks"; no da intervalo de sondeo.
- Webhooks (https://replicate.com/docs/topics/webhooks): POST al crear, al actualizar y al terminar. Filtro con `webhook_events_filter`. Un guía de setup indica que los eventos `output` y `logs` se envían como mucho cada 500 ms (https://replicate.com/docs/topics/webhooks/setup-webhook). Reintentos: UNKNOWN en esa doc.
- Límites de tasa (https://replicate.com/docs/topics/predictions/rate-limits): crear predicciones 600/min; el resto de endpoints, incluido el GET de predicciones, 3000/min. Si hay throttling: HTTP 429 con "Your rate limit resets in ~30s".
- Cliente oficial Python: UNKNOWN (no se pudo inspeccionar; el repositorio no se encontró con la API de GitHub al alcance y la cuota se agotó).

### 2.5 Runway SDK (Node, https://github.com/runwayml/sdk-node)

- `src/lib/polling.ts` (descargado con WebFetch desde https://raw.githubusercontent.com/runwayml/sdk-node/main/src/lib/polling.ts; líneas aproximadas):
  - `POLL_TIME = 6000` ms con `POLL_JITTER = 3000` ms; espera entre 4,5 s y 7,5 s.
  - Sin backoff exponencial.
  - Timeout por defecto 10 min (`60 * 10 * 1000`); `timeout: null` lo desactiva.
  - `skipInitialWait` existe (espera inicial antes de la primera consulta).
  - API: `waitForTaskOutput({ timeout?, abortSignal? })`.

### 2.6 Vercel AI SDK (https://github.com/vercel/ai)

- MiniMax (packages/minimax/src/minimax-video-model.ts, líneas 69-70 y 762-775): `DEFAULT_POLL_INTERVAL_MS = 10_000`, `DEFAULT_POLL_TIMEOUT_MS = 600_000`. Las opciones son `pollIntervalMs` y `pollTimeoutMs` (por proveedor).
- Google (packages/google/src/google-video-model-options.ts, líneas 6-7 y 25-26): también expone `pollIntervalMs` y `pollTimeoutMs`. Los valores por defecto del modelo de Google: UNKNOWN (no se leyó su bucle).
- Webhooks: no encontrados.

### 2.7 LiteLLM (cookbook, https://github.com/BerriAI/litellm/blob/main/cookbook/veo_video_generation.py)

- Líneas 82-142: `max_wait_time=600` s; `poll_interval = 10` s inicial; tras cada consulta `poll_interval = min(poll_interval * 1.2, 30)`, tope 30 s.
- Webhooks: no.

### 2.8 BytePlus / ModelArk Seedance (fuentes oficiales no encontradas)

- Documentación oficial de ModelArk: UNKNOWN (la búsqueda solo devolvió terceros).
- Guía de TanStack (https://tanstack.com/ai/latest/docs/adapters/byteplus): espera de unos 5 s entre consultas; para cuando el estado ya no es pending o processing.
- DataCamp (https://www.datacamp.com/es/tutorial/seedance-2-0-api-guide): consulta de estado con el ID de la tarea en un bucle.
- Una guía de terceros afirma que las URL de vídeo caducan 24 h tras completarse y que el registro de la tarea se conserva 7 días. No verificado en la doc oficial.
- Código de OpenMontage (`seedance_ark.py`): 3 s, 1200 s (ver tabla).

---

## 3. Patrones observados (resumen)

1. Intervalo fijo de 5 s es la opción más habitual (OpenMontage casi todos; ComfyUI por defecto; Runway 6 s ±1,5 s; Vercel usa 10 s en MiniMax).
2. Backoff suave, con tope: fal (0,25 s ×1,05, tope 10 s, jitter ±20 %, reinicio al cambiar de estado), LiteLLM (10 s ×1,2, tope 30 s), HeyGen en OpenMontage (5 s ×1,2, tope 30 s).
3. Plazo total típico: 600 s a 1200 s (Vercel MiniMax 600 s; OpenMontage Grok/Kling/Gemini 900 s; Seedance 1200 s; Runway SDK 600 s; ComfyUI por número de intentos, unos 4000 s para Kling).
4. Consultas en cola: ComfyUI no las cuenta contra el máximo de intentos. Es el único que lo distingue explícitamente.
5. Webhooks: los proveedores los ofrecen (OpenRouter, fal, Replicate), pero ninguna app de código abierto revisada los usa para vídeo en el cliente. OpenMontage no los usa.
6. Ninguna fuente documenta un tope de frecuencia para el polling en OpenRouter (UNKNOWN). Replicate sí documenta 3000/min para GET.

---

## 4. Recomendación para nuestra app (navegador + servidor local, el usuario espera viendo el progreso)

Propuesta de diseño (recomendación propia, no una cita de fuente):

1. Primera consulta a los 5 s tras enviar el trabajo (el 5 s coincide con la mayoría de las implementaciones y añade como máximo 5 s de latencia tras completarse el trabajo). Un primer sondeo antes de 5 s no sirve de nada, porque OpenRouter indica duraciones típicas de 30 s o más.
2. Intervalo fijo de 5 s durante los primeros 120 s. Después, backoff ×1,2 con jitter ±20 %, con tope de 10 s (nunca 30 s: añadiría hasta 30 s de latencia al final, que es lo que el usuario no quiere). Esto está alineado con fal (tope 10 s, jitter) y con LiteLLM/HeyGen (crecimiento ×1,2).
3. Plazo total de 15 min (900 s), que es el valor más frecuente entre proveedores. Al agotarlo, no descartar el trabajo: guardar el ID y el `polling_url`, mostrar un mensaje y permitir reanudar. El trabajo sigue existiendo en el proveedor.
4. Cancelar el sondeo al salir del flujo o al cancelar el usuario. Si la pestaña queda oculta, mantener el mismo intervalo (no hay fuente que sugiera otra cosa; decisión de diseño).
5. Persistir el ID del trabajo en el servidor local para poder reanudar tras recargar. Esto es decisión de diseño, no una cita.
6. Webhooks con `callback_url`: no es viable como vía principal en una app local. OpenRouter exige una URL pública HTTPS alcanzable. La doc admite un túnel local, pero eso añade una dependencia externa, un secreto de firma y gestión de reintentos. Solo tiene sentido si la app se despliega en un servidor con URL pública. Como complemento, no sustituto: el sondeo sigue siendo necesario por si el webhook no llega.
7. Límites de tasa de OpenRouter: UNKNOWN. Con 5 s por trabajo y un solo trabajo activo por usuario, la carga es pequeña. Si el usuario puede tener varios trabajos a la vez, conviene un único bucle compartido y un intervalo de sondeo por trabajo, no un temporizador por petición.

Resumen de la configuración propuesta: primera consulta a 5 s; 5 s fijos hasta 120 s; luego ×1,2 con jitter, tope 10 s; plazo 900 s; reanudable por ID.

---

## 5. Fuentes (lista)

1. https://openrouter.ai/docs/guides/overview/multimodal/video-generation
2. https://openrouter.ai/blog/tutorials/video-generation-api/
3. https://openrouter.ai/docs/cookbook/video-generation/video-generation-webhooks
4. https://github.com/calesthio/OpenMontage (archivos en `tools/video/`, líneas indicadas en la tabla)
5. https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_api_nodes/util/client.py (líneas 230-560)
6. https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_api_nodes/nodes_veo2.py, nodes_kling.py, nodes_wan.py, nodes_bytedance.py
7. https://github.com/fal-ai/fal/blob/main/projects/fal_client/src/fal_client/client.py (líneas 1148-1191, 1608-1640)
8. https://fal.ai/docs/model-endpoints/queue
9. https://replicate.com/docs/topics/predictions/lifecycle
10. https://replicate.com/docs/topics/webhooks
11. https://replicate.com/docs/topics/predictions/rate-limits
12. https://raw.githubusercontent.com/runwayml/sdk-node/main/src/lib/polling.ts
13. https://github.com/vercel/ai (packages/minimax/src/minimax-video-model.ts; packages/google/src/google-video-model-options.ts)
14. https://github.com/BerriAI/litellm/blob/main/cookbook/veo_video_generation.py
15. https://tanstack.com/ai/latest/docs/adapters/byteplus (terceros)

UNKNOWN: límites de tasa de OpenRouter; TTL del trabajo en OpenRouter (`expired`); cliente oficial Python de Replicate; documentación oficial de ModelArk/BytePlus; valores por defecto de polling del adaptador Google en Vercel AI SDK; reintentos de webhooks de Replicate.

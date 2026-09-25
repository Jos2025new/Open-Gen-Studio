# Trazabilidad de cambios

Para cada cambio: qué hace, dónde está, qué lo verifica y qué queda sin verificar. Sirve para saber si un cambio nuevo rompió algo que antes funcionaba. El plan paso a paso está en `AGENTS.md`, el historial en `PROGRESS.md` y el detalle de proveedores en `MODEL_VALIDATION.md`.

## Cómo comprobar que nada se rompió

| Comprobación | Comando | Qué detecta |
| --- | --- | --- |
| Tipos | `npx tsc --noEmit -p .` | Contratos rotos entre módulos. |
| Tests unitarios | `npm test` | Lógica de precios, parámetros, rutas de entradas, polling, payloads (tests con nombre en la tabla). |
| **Red de regresión de proveedores** | `npm test` (incluye `tests/live-snapshot.test.ts`) | Cómo se lista e interpreta **cada** variante de las familias prioritarias (~560: Atlas 162, fal 257, NanoGPT 138). Compara con `tests/fixtures/live/expected.txt`. Si un cambio altera un modelo, el test falla y muestra la diferencia. |
| Aceptar un cambio intencionado | `npx vitest run -u tests/live-snapshot.test.ts` y revisar `git diff tests/fixtures/live/expected.txt` | El diff se revisa y se sube en el mismo commit que el cambio de código. Así cada commit dice exactamente qué modelos cambiaron. |
| Catálogos nuevos del proveedor | `npm run snapshot:models`, luego lo anterior | Descarga de nuevo los catálogos y esquemas públicos (sin clave ni coste). El diff muestra qué cambió **en el proveedor**. Conviene hacerlo en un commit aparte del de código, para no mezclar causas. |
| Navegador | `npm run dev` (puerto 5173) | Interfaz y payloads reales con `fetch` interceptado (sin gastar). Pasos concretos en cada fila. |

Familias cubiertas por la red: `scripts/model-families.json`. Para ampliar la cobertura se añade el patrón y se regenera.

## Registro

| Commit | Cambio | Archivos | Verificación automática | Verificación manual | Sin verificar / límites |
| --- | --- | --- | --- | --- | --- |
| `97aed17` | Un fallo al consultar un trabajo remoto no lo da por perdido: reintentos con espera creciente y límite local de espera. `JobFailedError` solo cuando el proveedor confirma el fallo. **Check again** reanuda. Duración `-1` estimada con la máxima y mostrada como "Auto". | `lib/http.ts`, `providers/{shared,atlas,fal,nanogpt}.ts`, `jobs.ts`, `pricing.ts`, `costs.ts`, `GenerationCard.tsx` | `engine.test.ts`: *remote job polling* (4), *prices an automatic duration* | Navegador con `fetch` simulado: 503→completed, 401 conserva el trabajo, `failed` lo cierra, cancelar lo conserva. | `/generate-video/recover` de NanoGPT no integrado. |
| `a8604c9` | Validación de modelos de vídeo. `needsVideo` separado de `acceptsVideo`. Clasificación de Atlas por el nombre del endpoint. Referencias hacia modelos de vídeo (`routeVideoInputs`). Slots `refVideos` y `mixedRefs` (`refers`). En NanoGPT, `referenceImages`/`referenceVideos`/`last_image`. `fixed` para campos obligatorios, `disabled` omitido, límite de 4 MB. | `params.ts`, `jobs.ts`, `actions.ts`, `Composer.tsx`, `ModelList.tsx`, `SettingsPanel.tsx`, `catalog.ts`, `providers/*` | `providers.test.ts`: *reference inputs*, *video input routing*, *model classification*, *request payloads*; red de regresión. | Payloads interceptados: Atlas `refers`, NanoGPT `imageDataUrl` y `referenceImages`. | Campos de NanoGPT con data URL, sin generación real. |
| `6def2d0` | Validación de familias de imagen. Tamaños en píxeles como encuadre (con su escala). `size` de texto libre con opciones y "Auto" no enviado (`omit`). Campo de imagen obligatorio preferido. `missing` bloquea con aviso. En NanoGPT, `resolution` mixto y endpoints solo de texto. `isAutoOption`. | `params.ts`, `jobs.ts`, `actions.ts`, `providers/{atlas,fal,nanogpt}.ts` | `providers.test.ts`: *image schemas* (4); red de regresión. | Con 16:9, payloads interceptados: `2048x1152`, `2048*1152`, `1536*864` y `16:9`. | Sin generación real. |
| `(ver git log)` | Red de regresión de proveedores: instantánea de esquemas reales y parse esperado. | `scripts/model-snapshot.mjs`, `scripts/model-families.json`, `tests/live-snapshot.test.ts`, `tests/fixtures/live/*` | La propia red: línea base del estado tras `6def2d0`. | — | La instantánea es del 2026-09-25; los catálogos cambian con el tiempo. |

## Estado de la línea base (antes de cubrir lo que faltaba)

En `tests/fixtures/live/expected.txt`, `MISSING:` marca los modelos que aún no pueden ejecutarse porque exigen algo que la app no envía (21 casos: máscaras, `keyframes`, `video_clips`, audio, LoRA, la imagen de origen de Ideogram Character junto a sus referencias…). `ERROR` marca los esquemas que el proveedor no sirve: fal `minimax/h3-max/director` devuelve 404. Cada tarea siguiente debe reducir esos casos, y el diff lo deja registrado.

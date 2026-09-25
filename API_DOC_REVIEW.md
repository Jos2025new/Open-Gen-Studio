# Comparación con los ejemplos aportados

> **Estado (2026-09-24):** los puntos 1–6 están corregidos (ver `PROGRESS.md` y `MODEL_VALIDATION.md`). Pendiente: `/generate-video/recover`, audio de referencia y las restricciones explícitas de edición/extensión de Seedance 2.5.

Revisión: GPT 6 ASTRA, 2026-09-25. Fuentes: `/home/samuel/Descargas/API DOC`. Comparación estática del código actual; ninguna generación ni consulta autenticada. Los ejemplos se tratan como contratos documentados, no como prueba de disponibilidad actual de esos modelos.

## Diferencias que afectan al funcionamiento

1. **Atlas: `refers` no está soportado.** Los documentos de MiniMax H3 Fast/Developer requieren una lista de objetos `{url, type}`; Wan 3.0 Reference también la utiliza. `src/engine/params.ts:45` no reconoce esa clave y el parser omite arrays que no identifica como slots. `src/engine/providers/atlas.ts:120` solo construye cadenas o listas de URLs. No basta con añadir un alias: hace falta conservar el tipo de medio y serializar objetos. MiniMax quedaría sin una entrada obligatoria; Wan no recibiría las referencias. No se ha comprobado si estos IDs aparecen actualmente en el selector.

2. **Seedance 2.5: soporte parcial.** Se reconoce `reference_images`, pero no `reference_videos` ni `reference_audios`. El slot de vídeo admite una URL individual, no listas. Por tanto no reproduce los ejemplos de edición/extensión multimodal. Su documento exige además duración -1 y ratio adaptive para edición explícita; actualmente no existe una validación de ese contrato. Las imágenes de referencia sí tienen una ruta compatible si el esquema las declara.

3. **NanoGPT: faltan las referencias múltiples de vídeo.** POST - VIDEO documenta `referenceImages` y `referenceVideos`; `videoSchema` solo declara `imageDataUrl` y `videoDataUrl`, y `generate` no serializa `req.refs` en la rama de vídeo. El soporte de imagen inicial no equivale al de referencias de identidad/estilo.

4. **Un error consultando un trabajo puede hacer perder su ID.** Los adaptadores propagan errores HTTP/red; `src/engine/jobs.ts:284` y `:349` borran `remoteJob` al marcarlos como error. NanoGPT documenta `/generate-video/recover`, que no está implementado. Existe reanudación si el ID sigue guardado, pero no recuperación por ese endpoint cuando se pierde. Conviene conservar el ID y distinguir un fallo de consulta de un fallo confirmado de generación, antes de ofrecer regenerar.

5. **Duración automática y precio.** Wan 3.0 y Seedance 2.5 documentan `duration: -1`. Los parámetros permiten transmitirlo, pero `src/engine/pricing.ts:60` multiplica el precio por esa duración y puede producir una estimación negativa. Debe tratarse como duración desconocida y reconciliarse con el resultado; -1 es una instrucción, no segundos facturables.

6. **NanoGPT: consultas sin límite y errores poco legibles.** El ejemplo de estado unificado limita el polling a 120 intentos de 5 s; nuestro `for (;;)` no tiene límite ni timeout individual de red (sí admite cancelación). Si `data.error` es un objeto, `String(data.error)` muestra `[object Object]` en vez de `error.message`, que recomienda la documentación. El timeout debe detener la espera preservando el trabajo remoto, no declarar que la generación falló.

## Coincidencias y diferencias justificadas

- Atlas: Bearer, `generateVideo`, `data.id`, consulta a `prediction/{id}`, estados completed/succeeded/failed y lectura de `data.outputs` coinciden. Consultar cada 5 s en vez de 2 s para vídeo no es una incompatibilidad.
- Atlas: `uploadMedia` multipart está expresamente permitido. Las claves `image`, `last_image` y `end_image` tienen mapeo; Wan Prime y MiniMax H3 Max encajan en la ruta de primer/último fotograma, sujeto al esquema servido por el catálogo.
- NanoGPT: `generate-video`, persistencia de runId/id, `video/status?requestId=...`, autenticación x-api-key y extracción de `data.output.video.url` coinciden con el documento detallado.
- Los documentos de NanoGPT discrepan entre sí: el resumen de endpoints remite al estado legacy y modelSlug; POST - VIDEO declara deprecated esa ruta y recomienda el estado unificado. El código sigue esta última recomendación. Models también recomienda catálogos separados para medios, como hace la app, aunque POST - VIDEO remite al catálogo general.
- El host del código es nano-gpt.com, frente a api.nano-gpt.com en muchos ejemplos. Hay una explicación histórica en el código, pero esta revisión no ha comparado los hosts en vivo; no se concluye que sea un error.
- La carpeta no incluye el contrato completo de generación de imágenes. No permite decidir si `/v1/images` debe sustituirse por `/generate-image`. AGENTS.md registra una prueba anterior que motivó usar `imageDataUrls`; no se ha repetido esa prueba.
- Los ejemplos Atlas contienen valores de relleno (`example_value`) y una cadena Python literal `Bearer $ATLASCLOUD_API_KEY`: requieren sustituirlos, no ejecutarlos literalmente.

## Funciones adicionales, no errores del flujo básico

Usage y Request Billing no están integrados. La app no captura `X-Request-ID` para consultar cargos por petición; el coste de envío usado como fallback tampoco demuestra un cargo final. Request Billing exige el ID de cabecera, la misma clave, una ventana de 24 h y respetar Retry-After; no debe asumirse que runId sirve ni que cubre todo cargo de vídeo. Depósitos y Device Login son funciones de cuenta/autenticación ausentes, no requisitos para generar con una API key.

El enlace de ATLAS COMMUNITY GITHUB apunta a una lista de integraciones, no a un SDK normativo: https://github.com/AtlasCloudAI/awesome-atlas-cloud-integrations. Se consultó únicamente esa página, sin auditar sus proyectos externos.

## Verificación y alcance

`npx tsc --noEmit -p .`: correcto. `npm test`: 20/20. No se añadieron tests ni se modificó la aplicación. Sin prueba de navegador ni ejecución remota: los hallazgos son de contrato/código, no una validación end-to-end. Prioridad propuesta: conservar trabajos y corregir duración automática; después completar los formatos de referencias. No se ha implementado ninguna corrección.

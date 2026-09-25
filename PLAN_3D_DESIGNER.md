# Plan de implementación: 3D y Designer

Fecha: 2026-09-25. Estado: propuesta; ninguna fase de código ejecutada.
Lista de seguimiento: sección P0–P9 de AGENTS.md. Una fase por commit, dividida en incrementos compilables cuando afecte varios subsistemas. No se reanuda ni modifica la tarea de audio en paralelo.

## Alcance y decisiones

- Elección del usuario: Tripo H3.1, Meshy 7.1, Seed3D 2.0 y TRELLIS.2; proveedores Atlas y NanoGPT. Ocho endpoints en total. Meshy v7 de Atlas y Tripo P2/2.5 de NanoGPT no son sustitutos de esas versiones.
- 3D debe ser una generación normal: coste, aprobación, estado remoto, galería, descarga, agente y nodos. No convertir un modelo en una imagen para simular soporte 3D.
- Propuesta: GLB como formato de visualización inicial; otros originales conservables/descargables con indicación de formato no visualizable. No convertir FBX a escondidas ni desactivar quads silenciosamente.
- Propuesta de pinceles: gesto editable y renderer separado, recuperada del chat «Tecnología de brushes híbridos» (6ab5443a-7d04-83ea-9fee-0a6ef48532b0). No se promete equivalencia completa con SAI ni edición paramétrica de nuestro pincel dentro de Inkscape.
- Rendimiento: carga de dependencias bajo demanda, miniaturas en listas y un visor activo. No se promete coste cero para cualquier tamaño de malla.

## Evidencia concreta

Inspección del código actual: `src/engine/types.ts` limita MediaKind a image/video; `providers/atlas.ts:listModels` excluye las categorías 3D; `providers/nanogpt.ts` no consulta el catálogo 3D. `providers/shared.ts:extractOutputs`, `jobs.ts` y `lib/media.ts` deben distinguir archivos 3D de imágenes/vídeos. `server/local-store.js` necesita MIME/extensiones 3D. El sistema existente ya persiste assets y trabajos remotos: se amplía, no se duplica.

Designer: `engine/design/render.ts:exportDoc` admite PNG/JPEG; `design/actions.ts:exportDocFile` y `components/designer/DesignerWorkspace.tsx` exponen la descarga PNG. `design/raster.ts:strokeSegment` pinta píxeles; no conserva un trazo editable con presión. `VectorShape` representa formas, no un motor de pinceles. `package.json` no incluye visor 3D ni motor de trazo.

Catálogos públicos consultados en esta tarea (sin claves ni generación); esquemas Atlas descargados y leídos:

| Objetivo | ID exacto / proveedor | Dato que determina la implementación |
|---|---|---|
| Tripo H3.1 texto | `tripo-h3.1/text-to-3d` / Atlas | `prompt` obligatorio, máximo 1024 caracteres; `quad=true` produce FBX. |
| Tripo H3.1 imagen | `tripo-h3.1/image-to-3d` / Atlas | `image_url` obligatorio. `files` contiene metadatos; `thumbnail` es imagen y `outputs` puede incluirla al final. |
| Seed3D 2.0 | `bytedance/seed3d-v2.0/image-to-3d` / Atlas | `image` obligatorio; `file_format=glb` por defecto; salida ZIP con URL de 24 h. POST `generateImage`, consulta `/model/result/{request_id}`. |
| Seed3D 2.0 | `bytedance/seed3d-2.0` / NanoGPT | Imagen obligatoria; `subdivision_level` low/medium/high, medium por defecto. |
| TRELLIS.2 | `wavespeed-ai/trellis-2/image-to-3d` / NanoGPT | GLB texturizado; resolution 512/1024/1536; texture_size 1024/2048/4096; target_face_count 10.000–1.000.000. |
| Meshy 7.1 | `meshy/v7.1/text-to-3d`, `meshy/v7.1/image-to-3d`, `meshy/v7.1/multi-image-to-3d` / NanoGPT | Parámetros distintos por variante; topología, textura, remallado, resolución y opciones de rigging/animación. No equiparar quad con el comportamiento de Tripo. |

Atlas Tripo usa POST `/api/v1/model/generateImage` y GET `/api/v1/model/prediction/{request_id}` según sus esquemas. No hay una ruta universal de consulta Atlas.

Fuentes reproducibles:
- [Catálogo Atlas](https://api.atlascloud.ai/api/v1/models).
- [Schema Tripo texto](https://static.atlascloud.ai/model/schema/tripo-h3.1-text-to-3d.json), [Tripo imagen](https://static.atlascloud.ai/model/schema/tripo-h3.1-image-to-3d.json), [Seed3D Atlas](https://static.atlascloud.ai/model/schema/bytedance-seed3d-v2.0-image-to-3d.json).
- [Catálogo 3D NanoGPT detallado](https://nano-gpt.com/api/v1/3d-models?detailed=true). Documenta capacidades, ajustes y precios; no prueba por sí solo las claves de envío y salida de cada variante.
- [Ejemplo oficial NanoGPT 3D](https://nano-gpt.com/models/3d/wavespeed-ai/hunyuan-3d-v3.1-rapid): usa `/api/generate-video`. Referencia de transporte, no un modelo objetivo ni prueba de las referencias multivista de Meshy.
- [model-viewer: carga diferida](https://modelviewer.dev/examples/loading/), [perfect-freehand](https://github.com/steveruizok/perfect-freehand), [Affinity: textura sobre curvas](https://affinity.help/designer2ipad/en-US.lproj/pages/CurvesShapes/texture_line_style.html), [SVG: imágenes incrustadas](https://www.w3.org/TR/SVG2/embedded.html).

## Fases: qué, dónde, por qué y aceptación

### P1. Contratos y regresión (sin ejecutar modelos)
**Dónde:** nuevos `tests/fixtures/3d/` y `tests/3d-contracts.test.ts`; extensión de `scripts/model-snapshot.mjs` y `tests/live-snapshot.test.ts` cuando el parser soporte el tipo.
**Qué/por qué:** guardar extractos de los ocho contratos, URL de origen, fecha y hash; comprobar claves de imagen/multivista, formato, consulta y precio. Los fixtures inventados para fallos se etiquetan como simulados; no como respuestas reales.
**Aceptación:** matriz de los ocho endpoints con contratos conocidos y vacíos identificados. Para NanoGPT faltan confirmar payload, cantidad/orden de imágenes Meshy y estructura del resultado. No habilitar una variante cuyo contrato obligatorio siga desconocido. Atlas: no presentar base_price como precio final cuando no cubre los ajustes. Precio desconocido nunca significa gratis.

### P2. Archivo 3D y visor local (sin API)
**Dónde, incrementos:** (a) `engine/types.ts`, `lib/media.ts`, `lib/idb.ts`, `server/local-store.js`; (b) nuevo `components/assets/Model3DViewer.tsx`, `assets/Lightbox.tsx`, `ui/AssetMedia.tsx`, `gallery/GalleryPanel.tsx`, `assets/AssetActions.tsx`; `package.json`/lock para model-viewer.
**Qué/por qué:** añadir asset `model3d`, MIME `model/gltf-binary`, archivo original, miniatura y metadatos separados. GLB no pasa por probeMedia ni por un canvas 2D. Importar una muestra GLB local para verificar el recorrido antes de conectar proveedores. Persistir bytes originales; no regenerar al recargar.
**Aceptación:** importar → galería → abrir/orbitar/zoom → cerrar → recargar → descargar bytes idénticos. Una miniatura por tarjeta; sin WebGL ni descarga de malla al recorrer la galería. Manejar GLB inválido y WebGL no disponible conservando descarga. Liberar referencias/URLs y limitar la caché del visor al cerrar; medir, no asumir que desmontar libera todo.

### P3. Primera generación completa: TRELLIS.2
**Dónde, incrementos:** (a) `providers/types.ts`, `providers/nanogpt.ts`, `catalog.ts`, `params.ts`, `pricing.ts`, `costs.ts`, `jobs.ts`; (b) `store/store.ts`, `composer/ModeMenu.tsx`, `Composer.tsx`, controles 3D específicos pequeños y `ModelList.tsx`; (c) `plan.ts`, `executor.ts`, `agent/{tools,context,runtime}.ts`, `flow/{graph,actions}.ts`, `components/node/{nodes,NodeWorkspace}.tsx`, `chat/GenerationCard.tsx`.
**Qué/por qué:** extender los contratos existentes con generación 3D, defaults y selección propios; no reutilizar proporción/duración de vídeo. Modo 3D, paso de plan 3D y nodo con imagen de entrada y modelo de salida. Las sesiones antiguas reciben defaults sin perder sus datos. Designer mantiene composición 2D: no colocar una malla como capa raster.
**Aceptación:** composer, agente y nodo producen el mismo payload y asset mediante transporte simulado; coste y aprobación existentes; reload/timeout conservan el trabajo remoto y consultar no reenvía POST. Rechazar texto sin imagen. No filtrar modelos 3D hacia selectores image/video. No aumentar modelos fuera de la lista elegida.

### P4. Tripo H3.1 Atlas: texto e imagen
**Dónde:** `providers/atlas.ts`, `providers/shared.ts`, `modelRules.ts`, `jobs.ts`, controles 3D y fixtures/tests 3D.
**Qué/por qué:** permitir las dos categorías concretas, enviar `prompt` o `image_url`, consultar prediction. Preferir `files` para clasificar; separar miniatura del modelo, conservar variantes. GLB normal; con quads, conservar FBX y mostrar que el visor inicial no admite ese formato.
**Aceptación:** no aparecerán renders PNG como modelos ni archivos FBX como imágenes. Errores de entrada previos al envío. Tests de `outputs=null`, múltiples archivos y miniatura final. Sin conversor FBX añadido en esta fase.

### P5. Seed3D 2.0 Atlas + NanoGPT
**Dónde:** adaptadores, `modelRules.ts`, `jobs.ts`, nuevo `lib/model3d.ts` para inspección/extracción; lector ZIP pequeño cargado solo para ZIP, fijado en package/lock tras revisar licencia.
**Qué/por qué:** Atlas requiere `/result`, no `/prediction`; pedir GLB y extraerlo del ZIP, conservando original. NanoGPT usa su contrato propio. Guardar enseguida el resultado, porque la URL Atlas expira. No tratar ZIP como imagen ni confiar solo en la extensión.
**Aceptación:** caso ZIP normal, corrupto, sin GLB y con exceso de tamaño/número de entradas; extracción sin rutas de escritura arbitrarias ni resolución automática de recursos remotos. Límites de descarga/descompresión explícitos y error recuperable. Validar los límites Atlas de imagen (≤10 MB, píxeles <4096×4096 y ratio dentro de 0,4–2,5). Reload no vuelve a generar. Si hace falta CORS, ampliar solo hosts demostrados en `vite.config.ts`.

### P6. Meshy 7.1 NanoGPT: tres variantes
**Dónde:** `providers/nanogpt.ts`, `modelRules.ts`, controles 3D, `agent/context.ts`, puertos existentes de referencias y tests.
**Qué/por qué:** separar texto, imagen y multivista; controles desde el catálogo real, orden de vistas y validación según P1. Mantener rigging/animación desactivados por defecto como en el catálogo. Exponerlos solo con contrato y precio verificados; no afirmar cobertura completa si quedan pendientes.
**Aceptación:** cardinalidad/orden correctos y sin reutilizar claves multivista de otro proveedor; precios por variante; GLB identificado y persistido. Las tres variantes pasan tests de payload y recuperación. Un clip de previsualización nunca reemplaza el modelo.

### P7. Exportar documentos
**Dónde:** `components/designer/DesignerWorkspace.tsx`, `design/actions.ts`, `design/render.ts`, nuevo `design/export.ts`; pruebas `tests/design-export.test.ts`.
**Qué/por qué:** un menú PNG/JPG/SVG/PDF. PNG/JPG reutilizan exportDoc; JPG conserva el fondo blanco existente si hay transparencia. SVG serializa formas/texto/imágenes embebidas con transformaciones; no exportar todo como un único PNG disfrazado. PDF usa el SVG mediante una librería local con licencia compatible y carga diferida, seleccionada tras probar mezcla de capas y fuentes.
**Aceptación:** tamaños, orden, opacidad, rotación y caracteres XML correctos; SVG sin referencias temporales blob. Rasterizar solo efectos no representables y declararlo. Comparar muestras con el renderer actual y abrir SVG/PDF en Inkscape. La edición de texto depende de disponer de las fuentes; no prometer fidelidad sin comprobarlas. PDF es entrega, el proyecto conserva la edición completa.

### P8. Lineart editable
**Dónde, incrementos:** (a) `types.ts`, `design/doc.ts`, `design/history.ts`, nuevo `design/strokes.ts`; (b) `designer/Stage.tsx`, `ToolRail.tsx`, `LayersPanel.tsx`, `design/render.ts`, `design/actions.ts`; (c) exportador y tests.
**Qué/por qué:** objeto trazo con puntos/presión y parámetros; perfect-freehand calcula el contorno, no la UI ni el historial. Añadir herramienta Lineart independiente del pincel destructivo actual. Presión real si existe y simulada para ratón; suavizado, grosor, extremos y edición de puntos del recorrido después de dibujar. Un gesto = una entrada de undo; no persistir cada pointermove.
**Aceptación:** mover puntos/cambiar grosor regenera el mismo trazo; undo/redo y reload conservan datos y aspecto; SVG contiene paths editables en Inkscape. El contorno expandido no equivale a conservar la curva de presión como pincel nativo de Inkscape. Guardar nuestros datos del gesto en el proyecto y, opcionalmente, metadata SVG propia, sin exigirle a Inkscape que los interprete.

### P9. Pincel híbrido con textura
**Dónde:** `design/strokes.ts`, `design/render.ts`, `designer/Stage.tsx`, propiedades del pincel y `design/export.ts`; pequeñas texturas locales con licencia registrada.
**Qué/por qué:** distribuir estampas por distancia y tangente sobre el recorrido con presión, espaciado y semilla. No es rellenar un contorno con una textura inmóvil. Caché por trazo invalidada al editarlo, liberada al borrar documento/trazo; durante dibujo actualizar solo el trazo activo sobre las capas ya renderizadas. Ningún nuevo renderer WebGL hasta que una medición lo justifique.
**Aceptación:** doblar la curva cambia orientación y distribución de textura; repetir semilla conserva aspecto; borrar/undo/reload funcionan. SVG usa imagen embebida reutilizada en defs/use con transformaciones, verificadas en Inkscape. Limitar estampas y probar tamaño/coste del SVG: si la fidelidad y el rendimiento entran en conflicto, presentar la limitación antes de sustituirlo por un raster plano. La compatibilidad visual no implica edición del motor de pincel en otro editor.

## Verificación, rendimiento y cierre

- Este turno: revisión documental, enlaces/IDs/archivos y `git diff --check`; sin pruebas de aplicación porque no cambia código.
- Implementación: por fase `npx tsc --noEmit -p .`, `npm test`, diff revisado de `tests/fixtures/live/expected.txt` cuando cambie parser/catálogos y fila en `TRAZABILIDAD.md`. Build para comprobar separación de bundles. No sobrescribir cambios de audio u otras tareas.
- El estado local registra una petición previa de no seguir usando navegador. Respetarla: sin lanzarlo automáticamente; marcar pruebas visuales y rendimiento como pendientes hasta que se autoricen de nuevo. Tests no acreditan FPS, memoria GPU ni apariencia. Inkscape también debe probarse realmente antes de declarar interoperabilidad.
- Cuando se pueda medir: misma máquina, build, viewport y muestras. Comparar arranque sin 3D antes/después; primera apertura e interacción de una malla pequeña y otra de ~500.000 caras; diez ciclos abrir/cerrar; dibujar y editar sobre 100/1.000 trazos. Registrar tiempos y crecimiento retenido, no inventar umbrales de memoria a partir del peso GLB comprimido.
- Criterios estructurales verificables: visor y PDF fuera del bundle inicial; galería sin instancias 3D; sin render continuo para escenas estáticas, rotación/animación automática desactivada; no redibujar todos los trazos al mover uno. Si aparece regresión medible, corregir la fase antes de avanzar.
- Pruebas de APIs: transporte interceptado y fixtures; una ejecución real requiere autorización de coste/modelo/ajustes. La aprobación del plan no concede gasto. Soporte simulado y soporte real se reportan por separado.
- Riesgos pendientes de P1: contratos de referencias/salida NanoGPT, precios por opción, CORS real y muestras auténticas de ZIP/GLB. Riesgos de P7–P9: fuentes, modos de mezcla y coste de muchos elementos SVG. No bloquear el 3D por la investigación de pinceles.

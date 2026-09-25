# Open Gen Studio — estado del trabajo (handoff)

Última sesión: 2026-09-25. App React 19 + Vite 8 + TS 7 + zustand 5 + @xyflow/react 12, sin backend.
Proveedores: **OpenRouter, fal.ai, NanoGPT, Atlas Cloud** (+ "Local demo" procedural para usar sin claves).
Sin backend: corre en el navegador; el servidor de Vite solo la sirve en local y aporta rutas `/x/*` (relays y copia en disco). Opciones de despliegue discutidas en `PROPUESTAS.md`.
El agente LLM usa chat completions OpenAI-compatible de OpenRouter/NanoGPT/Atlas (sin SDK de Anthropic; se desinstaló `@anthropic-ai/sdk`).

## Hecho (build y typecheck verificados)
- `src/lib/*`: ids, rng, format, lang, IndexedDB (state/blobs/cache), http (errores, SSE), media.
- `src/engine/types.ts` modelo de dominio; `pricing.ts` (SKUs normalizados + estimate); `params.ts` (roles de parámetros, JSON-schema→ParamDef, coerceSettings, wireParams); `ops.ts` (relight, angle, upscale, remove_bg, reframe, variations, edit, animate, extract_frame, continue, contact_sheet/Nine-grid, grid_split, video_upscale, video_edit).
- `engine/providers/`: openrouter.ts (/images, /videos + polling), fal.ts (api.fal.ai/v1/models + OpenAPI vía relay `/x/fal-web`, queue.fal.run), nanogpt.ts (/api/v1/images, /api/generate-video, /api/video/status), atlas.ts (/api/v1/models, esquemas vía relay `/x/atlas-static`, uploadMedia, prediction), llm.ts (chat streaming con tools), demo/ (arte procedural, video MediaRecorder, ops locales), registry.ts (modelos preferidos).
- `engine/catalog.ts` (catálogos dinámicos, esquemas, modelos por defecto, modelo por operación), `costs.ts`, `jobs.ts` (runner con reanudación tras recarga), `plan.ts` (validación DAG + reglas de capas), `executor.ts`, `actions.ts`, `flow/graph.ts` + `flow/actions.ts` (plan→nodos, auto-layout, grafo→pasos), `design/*` (reglas de capas, doc, buffers raster copy-on-write, render canvas, historial, acciones).
- `engine/agent/`: tools.ts (ask_questions, propose_plan + zod), context.ts (system prompt + contexto), offline.ts (planificador local bilingüe), runtime.ts (auto/guiado con límite de rondas, validación de coste antes de gastar, aprobación, ejecución por workspace).
- `src/store/store.ts` (zustand + persistencia IndexedDB debounced, wipeAllData).
- UI escrita: App, main, shell (Sidebar, TopBar+slot, SettingsPanel, SidePanel, SessionsPanel), gallery/GalleryPanel, ui (Popover arriba-derecha, TooltipLayer, primitives, SpendConfirm, AssetMedia, Toasts, hooks), assets (OpForm, GenerationInfo, AssetActions, Lightbox), composer (Composer, ModeMenu, AgentControls, MediaControls, ModelList, ThreadPeek), chat (ChatWorkspace, FeedList, GenerationCard, PlanCard, QuestionsCard), node (NodeWorkspace, nodes), designer/Stage.tsx.

## Cierre de pendientes — 2026-09-24
- Completados `DesignerWorkspace.tsx`, `ToolRail.tsx` y `LayersPanel.tsx`: presets/documentos, zoom, historial, exportación PNG, galería, atajos, herramientas, propiedades y operaciones sobre raster.
- Creados los seis CSS importados: UI, shell, composer, chat, node y designer; conservados los tokens originales.
- Corregidos el scroll automático de Chat y el ajuste del lienzo al redimensionar. El visor conserva su botón de cierre en móvil.
- `npm run typecheck`, `npm run build` y `npm test`: correctos; **12 pruebas** en `tests/engine.test.ts` (pricing, params, plan, graph, offline y reglas/documentos de Designer).
- Los imports de lucide quedan comprobados por TypeScript y el build.
- Navegador real con agent-browser: Chat Auto; Guided con dos rondas y aprobación; Node con texto conectado a imagen y resultado; Designer con texto, undo/redo, forma vectorial, pincel raster, operación Relight local y descarga PNG 1080×1080; galería, visor y listado/creación de sesiones. Sin errores JS en las lecturas realizadas.
- Texto del documento conservado tras recargar. La comprobación adicional de raster tras cambiar de sesión y recargar inmediatamente no concluyó: volvió a la sesión vacía, por lo que no se afirma validación de ese caso. La persistencia usa debounce de 350 ms para estado y 700 ms para raster.
- Layout inspeccionado a 320, 768, 1024 y 1440 px, sin desbordamiento horizontal del documento. En móvil, herramientas y acciones superiores tienen scroll horizontal.
- No se hicieron llamadas de pago. El build emite un aviso no bloqueante por el bundle principal de ~815 kB antes de gzip.

## Correcciones Designer — 2026-09-24 (detalle en `AGENTS.md`)
- Cada forma crea su capa; texto con ancho automático (`width: 0`) que crece al escribir; editor de texto ya no se cierra al crearse.
- Imágenes protegidas (`RasterLayer.allowPaint`): el pincel pinta en una capa "Paint N" encima y la reutiliza; borrador bloqueado en imágenes protegidas.
- Panel de capas: redimensionable (200–520 px), plegable y con secciones plegables; preferencias en `localStorage` (`ogs:layers-*`), el composer usa `--layers-w`.
- Verificado en navegador (1400×860): formas, texto, pincel sobre vacío e imagen, panel, lista de modelos. Typecheck, 12 tests y build correctos.

## Cambios 2026-09-24 → 2026-09-25 (un commit por tarea; plan paso a paso en `AGENTS.md`)
Criterio común: KISS/YAGNI/DRY, sin capas nuevas; todo IDs, campos y endpoints se contrastaron antes con catálogos, esquemas o docs en vivo.

**Parámetros de proveedores** (`486d890`) — `engine/params.ts`, `providers/{fal,openrouter,nanogpt}.ts`, `plan.ts`, `agent/{tools,context}.ts`
- `max_images`/`batch_size` fuera del rol `count`. *Por qué:* Seedream (fal) trae `max_images` y `num_images`; ambos recibían N → hasta N² imágenes cobradas.
- `aspect` solo si las opciones del enum son proporciones; `ratioOf` entiende `portrait_3_4`. *Por qué:* `image_size`/`orientation` no siempre son proporciones, y en Krea/Ideogram un 9:16 se enviaba como `square_hd`.
- fal pagina todas las páginas (tope 10). *Por qué:* image-to-image tiene ~400 modelos y se perdían 100.
- `MAX_PLAN_STEPS` único y ops del agente desde `OPS`/`OP_IDS` (`8fc3df9` añade el test de bordes 16/17). *Por qué:* 16 vs 24 y listas duplicadas que podían divergir.

**Agente y catálogos** (`d175c77`, `c04d479`) — `providers/llm.ts`, `catalog.ts`, `store.ts`, `SettingsPanel.tsx`, `providers/nanogpt.ts`
- Tiers: Normal (GLM 5.3 Flash › GPT-6 Luna › DeepSeek V4.1 Flash) y Top (GPT-6 Sol › GPT-5.6 Sol › Claude Opus 5.5 › Qwen 3.8 Max); exige tools + visión; `repickAgentModel()` sustituye la lógica duplicada. *Por qué:* prioridad pedida; el catálogo decide qué existe; Top solo si se elige.
- NanoGPT usa `nano-gpt.com/api` (`NANO_BASE`). *Por qué:* `api.nano-gpt.com` sirve catálogos desfasados (faltaban GPT-6 Sol/Luna, Opus 5.5 y modelos de imagen/vídeo).
- `.env.local` ignorado por git (`d21ad88`) para claves temporales de prueba.

**Selectores, sesiones, galería y barra superior** (`b5e2e3f`, `029f531`) — `ModelList.tsx`, `SettingsPanel.tsx`, `registry.ts`, `SessionsPanel.tsx`, `GalleryPanel.tsx`, `TopBar.tsx`, `lib/format.ts`
- Selectores de modelo: recomendados primero (`PREFERRED` + variantes; tiers del agente) y "Browse all models (N)"; buscar recorre todo el catálogo. *Por qué:* listas de cientos de modelos.
- Sesiones: búsqueda por título, chat y prompts (`useSessionMatcher`, compartido), filtro de fijadas, dirección de orden, vista compacta, filas de una línea. Selector rápido de sesiones y lápiz junto al título. *Por qué:* tarjetas demasiado altas y búsqueda solo por título.
- Densidad de galería con ancho acotado; fechas relativas con "yesterday" y semanas.

**Barra lateral, Provider pool y vistas completas** (`489f413`) — `Sidebar.tsx`, `ProviderPool.tsx`, `SidePanel.tsx`, `providers/{openrouter,nanogpt,atlas}.ts`, `ui/hooks.ts`
- Barra plegable (riel o ancha con etiquetas); `usePref` pasa a `ui/hooks`. *Por qué:* preferencia del usuario; segundo uso de `usePref`.
- Provider pool: saldo unificado con `adapter.balance()` (OpenRouter `/credits`, NanoGPT `/check-balance`, Atlas `/public/v1/balance`; fal no expone saldo a claves normales). *Por qué:* ver el saldo sin salir de la app.
- Galería y Sesiones con vista completa (`panelExpanded` compartido) y grupos por fecha (`groupByDate`).

**Canvas de nodos y tarjeta de prompt** (`c7e9490`, `246508f`) — `node/{nodes,NodeWorkspace}.tsx`, `flow/{actions,graph}.ts`, `styles/node.css`
- Tarjetas centradas en el resultado; modelo/prompt/ajustes en un panel bajo el nodo seleccionado; barra flotante (Run, herramientas rápidas, abrir, descargar, duplicar, borrar con confirmación); "+" añade un nodo compatible conectado (`addConnected`); clic derecho para añadir/duplicar/borrar. Se quitó la papelera de la barra superior. *Por qué:* borraba sin aviso y las tarjetas eran pesadas.
- Tarjeta de prompt: miniaturas de entradas conectadas + "Ref" desde la galería, resumen de ajustes con popover según el schema, Run con coste.
- Correcciones: el flujo controlado descartaba las medidas de React Flow (nodos ocultos); medidas y selección con actualizaciones funcionales (ráfagas perdían datos); nodos nuevos se apilan bajo los hijos existentes.

**Sketch** (`248abfd`, `e75e0f6`) — `assets/SketchEditor.tsx`, `design/{raster,actions}.ts`, `flow/{actions,graph}.ts`, `types.ts`
- Editor emergente: pincel, borrador (solo tus trazos), colores, tamaño, deshacer/rehacer (trazos vectoriales), Guardar, y ✕ que pide guardar o descartar. Reutiliza `ui.brush` y el trazo común `strokeSegment`.
- Edita el nodo en su sitio: `sketchAssetId` es lo único que va aguas abajo (`nodeOutputAsset`), "Edited" + "Reset image" vuelve al original; la copia (origen `sketch`) no sale en la galería y se borra al restablecer, reeditar o regenerar. *Por qué (a petición del usuario):* sin nodos duplicados ni dos imágenes enviadas al proveedor. Test incluido.

**Herramientas fase 1** (`ab9f327`) — `ops.ts`, `jobs.ts`, `costs.ts`, `lib/media.ts`, `nodes.tsx`, `registry.ts`
- Engine `local` (gratis, en navegador): Extract frame con "At second…" (Capture) y Grid-split 2×2/3×3 (cada trozo es una salida). Nine-grid como instrucción del modelo de edición (con su fallback). Menú "More" en la barra del nodo con el atajo Panorama (Reframe 21:9). Upscalers de NanoGPT (`seedvr2-image`, `pruna-ai/p-image/upscale`, `clarity-ai-creative-upscaler`). *Por qué:* lo que ofrecen las referencias, reutilizando motores existentes; ningún proveedor tiene Nine-grid como modelo.

**Fase 3: entrada de vídeo** (`19a12b1`) — `types.ts`, `params.ts`, `providers/{fal,atlas,nanogpt,shared,registry}.ts`, `catalog.ts`, `jobs.ts`, `costs.ts`, `ops.ts`, `ModelList.tsx`, `SettingsPanel.tsx`
- `InputSlots.video`, `ModelSummary.acceptsVideo`, `GenRequest.video`. Campo de vídeo: fal `video_url`; Atlas `video`/`video_url`; NanoGPT `videoDataUrl` (docs de `generate-video`).
- Descubrimiento de modelos vídeo→vídeo en los tres; no aparecen en selectores normales (fallarían sin vídeo). *Efecto lateral corregido:* NanoGPT `wan-3.0/video-edit` ya no se ofrece como texto→vídeo.
- Operaciones Upscale video y Edit video: override en Ajustes → lista preferida por proveedor (IDs verificados) → cualquier modelo etiquetado. Se conserva duración y encuadre del original; el coste usa la duración del clip.
- fal/NanoGPT reciben data URL; Atlas sube con `uploadMedia`. *Por qué:* sin infraestructura nueva de subidas; límite: clips grandes pueden superar el tamaño máximo de petición.

**Primera generación real y correcciones** (2026-09-25) — `agent/runtime.ts`, `jobs.ts`, `lib/media.ts`, `vite.config.ts`, `providers/atlas.ts`, `pricing.ts`, `App.tsx`
- Prueba: animación de caminata de un personaje con el agente (GLM 5.3 Flash · NanoGPT) y Seedance 2.0 Mini de Atlas; 5 s a 960×960. Estimado 0,055 USD, cobrado 0,122 USD.
- Planes cortados por una recarga se cierran con su estado real (`settleInterruptedPlans`). Resultados en almacenes sin CORS (Atlas `*.volces.com`, enlaces de 24 h) se descargan por el relay `/x/media` (solo dev/preview, lista blanca) y se guardan (`ensureAssetBlob`, `adoptRemoteAssets`); Extract frame lee bytes locales. Precio de vídeo de Atlas mostrado como mínimo (`≥`).

**Persistencia en disco** (2026-09-25) — `server/local-store.js`, `src/lib/{disk,idb}.ts`, `store.ts`, `App.tsx`, `vite.config.ts`
- *Por qué:* el navegador integrado perdió sesiones, archivos y claves al reiniciarse su perfil; todo vivía solo en IndexedDB.
- Plugin de Vite `/x/store` (dev/preview): `data/state.json` (permisos 600, incluye claves) y archivos legibles `data/asset/<id>.png|jpg|mp4…` y `data/raster/<id>.png` (capas del Designer). Escritura atómica, claves validadas (400 si intentan salir de la carpeta).
- Espejo en el único punto de guardado (`stateDb`/`blobDb`): el estado lleva `savedAt` y al cargar gana la copia más reciente; un archivo que falte en el navegador se lee del disco; al arrancar se suben los que falten (uno a uno). Sin el servidor (web estática) se desactiva solo.
- "Wipe all data" mueve `data/` a `data.bak-<fecha>`: no reaparece al recargar y no se pierde. `navigator.storage.persist()` al arrancar.
- Verificado: generar una imagen → aparece en `data/`; borrar a mano todo el almacenamiento del navegador → al recargar vuelven sesión e imagen; wipe → copia en `data.bak-*` y arranque limpio. `data/` y `data.bak-*` fuera de git.

**Trabajos remotos y duración automática** (2026-09-24) — `lib/http.ts`, `providers/{shared,atlas,fal,nanogpt}.ts`, `jobs.ts`, `pricing.ts`, `costs.ts`, `GenerationCard.tsx`
- *Por qué:* fallos 4–6 de `API_DOC_REVIEW.md`. Un error al consultar borraba el ID de un trabajo ya pagado; `duration: -1` daba precios negativos; NanoGPT esperaba sin límite y mostraba `[object Object]`.
- `pollJob()` común: reintenta con espera creciente los fallos temporales (red, timeout de 30 s por petición, 408/429/5xx); límite local de 10 min (imagen) o 30 min (vídeo). Solo `JobFailedError` (fallo confirmado por el proveedor, o un 4xx de fal al leer el resultado) borra `remoteJob`. Error de autenticación, límite de espera, cancelación local o recarga sin clave conservan el trabajo y la tarjeta ofrece **Check again** (`recheckGeneration`).
- Duración `<= 0`: se estima con la mayor duración del modelo, aproximada y con nota; la interfaz la muestra como "Auto".
- Verificado en navegador con `fetch` simulado (sin llamadas reales): 503 → processing → completed guarda el resultado; 401 conserva el trabajo; `failed` lo cierra con el mensaje de `error.message`; cancelar conserva el trabajo. Datos de prueba borrados.

**Descartado:** fase 2 (Analysis/describir con el LLM), por decisión del usuario.

Estado: typecheck limpio y **25 tests**. Verificación en navegador con modelos demo (gratis). No se ha hecho ninguna ejecución de pago de vídeo a vídeo.

## Fuera de la verificación local
- Integraciones reales con claves y los casos de proveedor anotados abajo siguen sin verificar.
- No hay backend ni despliegue de producción en este alcance.

## Decisiones clave
- Validación de coste sólo antes de gastar: botón Generate muestra el coste; regenerar/ops/nodos/planes usan `SpendConfirm`; en Auto un plan gratis se ejecuta directo; Guiado siempre pide aprobar el plan. Presupuesto en USD (Ajustes).
- Popovers: `placement="top-start"` (encima y alineados a la izquierda, crecen a la derecha); barra lateral `right-end`.
- La generación del agente va a la capa 1 (`target: 'base'`); las imágenes sólo en capas raster, texto en capas de texto, formas en vectoriales; video nunca en capas.
- Esqueleto de carpetas vacío creado por el usuario a las 09:13 se adoptó (`src/engine/{agent,design,flow,providers/demo}`, `src/components/{shell,ui,...}`).

## Notas para el siguiente agente
- Arranque: `npm install`, `npm run dev` (puerto 5173). Los datos quedan también en `data/` (copia de seguridad = copiar esa carpeta; contiene claves). Typecheck: `npx tsc --noEmit -p .`. Tests: `npm test` (vitest, `tests/**/*.test.ts`, entorno node).
- Designer integra `Stage`, `newBlankDoc` y `selectDoc`; sus controles y exportación se probaron en navegador.
- zustand 5: un selector nunca debe devolver un objeto o array nuevo en cada llamada (bucle de renders). Usa primitivos, referencias del estado o `useShallow`.
- xyflow: los controles interactivos dentro de nodos llevan la clase `nodrag` (y `nowheel` si hacen scroll).
- Popovers: `usePopover()` + `<Popover anchor={ref} placement="top-start">`; tooltips con el atributo `data-tip`.
- Relays de Vite (sólo dev/preview): `/x/fal-web` (OpenAPI de fal) y `/x/atlas-static` (esquemas de Atlas); sin ellos esos modelos caen a un esquema mínimo.
- IDs de NanoGPT verificados (2026-09-25): upscale y edición de vídeo ya en `PREFERRED` (fase 3). Pendientes para el futuro: quitar fondo de vídeo `pixelcut/video-background-removal`; audio (catálogo `nano-gpt.com/api/v1/audio-models`, 90 modelos: STT Whisper-Large-V3, gpt-4o-mini-transcribe, Elevenlabs-STT; música/TTS elevenlabs/music, lyria, minimax, xai-tts). `sam3-image` es segmentación, no quitar fondo. Kling en NanoGPT solo edita vídeo en `kling-o3-4k`.
- fal (2026-09-25): la cuenta de prueba está bloqueada por saldo agotado; su API de subida (`rest.alpha.fal.ai/storage/upload/initiate`) existe y admite CORS, por si hiciera falta para clips grandes.
- Pruebas en el navegador integrado: si la pestaña está oculta (`document.hidden`), los ResizeObserver no se ejecutan y React Flow deja los nodos ocultos. Traer la pestaña al frente antes de verificar el canvas.
- NanoGPT imágenes de entrada: `POST /api/v1/images` **ignora `input_references`** (aunque la documentación lo presenta como campo principal) y lee `imageDataUrl`/`imageDataUrls` (PNG/JPEG/WebP); el adaptador usa `imageDataUrls`. Comprobado 2026-09-25 en ambos hosts. Para sondear la API sin coste: `birefnet/v2` (no genera sin imagen) o imágenes 1×1 (bajo el mínimo); nunca un modelo que acepte solo texto.
- NanoGPT: usar `nano-gpt.com/api` (`NANO_BASE`); `api.nano-gpt.com` sirve catálogos desfasados (LLM, imagen y vídeo). Comprobado 2026-09-24.
- Sin verificar con clave real: forma de respuesta de NanoGPT `POST /api/v1/images`, respuesta de Atlas `uploadMedia`, CORS de OpenRouter `/videos/{id}/content`. Los parsers son tolerantes (`extractOutputs` en `providers/shared.ts`).

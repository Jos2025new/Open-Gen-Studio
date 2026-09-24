# Open Gen Studio — estado del trabajo (handoff)

Última sesión: 2026-09-24. App React 19 + Vite 8 + TS 7 + zustand 5 + @xyflow/react 12, sin backend.
Proveedores: **OpenRouter, fal.ai, NanoGPT, Atlas Cloud** (+ "Local demo" procedural para usar sin claves).
El agente LLM usa chat completions OpenAI-compatible de OpenRouter/NanoGPT/Atlas (sin SDK de Anthropic; se desinstaló `@anthropic-ai/sdk`).

## Hecho (build y typecheck verificados)
- `src/lib/*`: ids, rng, format, lang, IndexedDB (state/blobs/cache), http (errores, SSE), media.
- `src/engine/types.ts` modelo de dominio; `pricing.ts` (SKUs normalizados + estimate); `params.ts` (roles de parámetros, JSON-schema→ParamDef, coerceSettings, wireParams); `ops.ts` (relight, angle, upscale, remove_bg, reframe, variations, edit, animate, extract_frame, continue).
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

## Fuera de la verificación local
- Integraciones reales con claves y los casos de proveedor anotados abajo siguen sin verificar.
- No hay backend ni despliegue de producción en este alcance.

## Decisiones clave
- Validación de coste sólo antes de gastar: botón Generate muestra el coste; regenerar/ops/nodos/planes usan `SpendConfirm`; en Auto un plan gratis se ejecuta directo; Guiado siempre pide aprobar el plan. Presupuesto en USD (Ajustes).
- Popovers: `placement="top-start"` (encima y alineados a la izquierda, crecen a la derecha); barra lateral `right-end`.
- La generación del agente va a la capa 1 (`target: 'base'`); las imágenes sólo en capas raster, texto en capas de texto, formas en vectoriales; video nunca en capas.
- Esqueleto de carpetas vacío creado por el usuario a las 09:13 se adoptó (`src/engine/{agent,design,flow,providers/demo}`, `src/components/{shell,ui,...}`).

## Notas para el siguiente agente
- Arranque: `npm install`, `npm run dev` (puerto 5173). Typecheck: `npx tsc --noEmit -p .`. Tests: `npm test` (vitest, `tests/**/*.test.ts`, entorno node).
- Designer integra `Stage`, `newBlankDoc` y `selectDoc`; sus controles y exportación se probaron en navegador.
- zustand 5: un selector nunca debe devolver un objeto o array nuevo en cada llamada (bucle de renders). Usa primitivos, referencias del estado o `useShallow`.
- xyflow: los controles interactivos dentro de nodos llevan la clase `nodrag` (y `nowheel` si hacen scroll).
- Popovers: `usePopover()` + `<Popover anchor={ref} placement="top-start">`; tooltips con el atributo `data-tip`.
- Relays de Vite (sólo dev/preview): `/x/fal-web` (OpenAPI de fal) y `/x/atlas-static` (esquemas de Atlas); sin ellos esos modelos caen a un esquema mínimo.
- Sin verificar con clave real: forma de respuesta de NanoGPT `POST /api/v1/images`, respuesta de Atlas `uploadMedia`, CORS de OpenRouter `/videos/{id}/content`. Los parsers son tolerantes (`extractOutputs` en `providers/shared.ts`).

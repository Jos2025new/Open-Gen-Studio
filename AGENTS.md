# AGENTS.md — Open Gen Studio

Guía para agentes. Estado general e historial: `PROGRESS.md`. Repo git desde 2026-09-24 (`main`).

## Reglas de trabajo
- Antes de operar, escribe aquí el plan paso a paso con su razón (breve). Marca `[x]` al terminar.
- Cambios mínimos: un detalle de 1–2 líneas (color, espaciado) no requiere leer todo el código.
- Verifica con `npx tsc --noEmit -p .`, `npm test` y navegador (`npm run dev`, puerto 5173).
- Un commit por tarea terminada.

## Tarea — plan auditado (2026-09-24)
1. [x] Crear `REMEDIATION_PLAN_AUDITED.md` con la revisión de GPT 6 ASTRA. *Razón: corregir premisas y prioridades conservando el original.*
2. [x] Revisar el documento y registrar un commit. *Razón: dejar una propuesta trazable; sin cambios de código. Verificación documental; pruebas de aplicación pendientes de implementación.*

## Tarea actual — fase 1 de herramientas (2026-09-25)
1. [x] Engine `frame` → `local` (operaciones gratis en el navegador). Extract frame gana "en el segundo X" (Capture). *Razón: un solo camino para lo local.*
2. [x] Grid-split (local): corta una imagen en 2×2 o 3×3; cada trozo es una salida y el nodo elige cuál pasa aguas abajo. *Razón: gratis, sin proveedor.*
3. [x] Nine-grid (edit): hoja de contactos 3×3 con nueve ángulos, vía el modelo de edición y su fallback. *Razón: ningún proveedor lo ofrece como modelo; es una instrucción, igual que Relight.*
4. [x] Barra del nodo: menú "More" con el resto de herramientas para ese tipo y el atajo Panorama (Reframe 21:9). *Razón: la barra solo muestra 4 rápidas.*
5. [x] Tests, typecheck, navegador; commit.
6. [x] Hallado al probar: `addConnected` apilaba nodos nuevos encima de los hijos existentes → se colocan bajo el último hijo. Medidas/selección del canvas con actualizaciones funcionales (varios avisos antes de un render perdían datos). Nota de pruebas: con la pestaña del navegador oculta los ResizeObserver no se ejecutan y los nodos salen ocultos; no es un fallo de la app.

## Tarea anterior — Sketch sobre imagen (2026-09-25)
1. [x] Trazo del pincel a `design/raster.ts` (`strokeSegment`), usado por el Designer y por Sketch. *Razón: no duplicar el pincel.*
2. [x] `SketchEditor` modal: imagen grande, pincel, color, borrador, tamaño, deshacer/rehacer (trazos vectoriales, poca memoria), Guardar y ✕ que pide guardar o descartar si hay cambios. Reutiliza `ui.brush`, `assetCanvas` y el guardado de assets del Designer. *Razón: pintar sin salir del flujo.*
3. [x] ~~Guardar crea nodos nuevos~~ → corregido a petición del usuario: el nodo guarda `sketchAssetId`; esa copia es lo único que va aguas abajo (`nodeOutputAsset`), la tarjeta muestra "Edited" y la barra "Reset image" vuelve al original. La copia (origen `sketch`) no sale en la galería y se borra al restablecer, reeditar o regenerar. *Razón: sin nodos duplicados ni dos imágenes enviadas al proveedor.*
5. [x] Upscale de NanoGPT: `seedvr2-image`, `pruna-ai/p-image/upscale`, `clarity-ai-creative-upscaler` (verificados). IDs de vídeo/audio anotados en `PROGRESS.md` para fases futuras.
4. [x] Accesos: botón Sketch en la barra del nodo con imagen y clic en las miniaturas de referencia. Tests, typecheck, navegador; commit.

## Tarea anterior — tarjeta de prompt del nodo (2026-09-25)
1. [x] Panel del nodo como tarjeta de prompt: miniaturas de las entradas conectadas + "Ref" (elegir de la galería crea un nodo asset conectado), prompt amplio, fila inferior con modelo · resumen de ajustes (resolución | duración | proporción) · nº de imágenes · Run con coste. *Razón: todo a mano sin abrir menús; mismos datos del schema.*
2. [x] Popover de ajustes con segmentados (resolución, proporción con glifo, duración, audio) según el schema del modelo. *Razón: el proveedor decide qué opciones existen.*
3. [x] Tests, typecheck, navegador; commit.

## Tarea anterior — prioridad de modelos del agente (2026-09-24)
IDs contrastados con los catálogos vivos de OpenRouter, NanoGPT y Atlas.
1. [x] `llm.ts`: `PREFERRED_LLM` → `NORMAL_LLM` y `TOP_LLM` (IDs reales de los tres catálogos, en orden); `pickDefaultLlm(models, tier)` recorre la lista del tier (top cae a normal) y exige tools + visión; luego el fallback genérico actual. `LlmModel.vision` leído del catálogo. *Razón: una sola lógica; el catálogo decide qué existe.*
2. [x] `settings.agent.tier` (`normal` por defecto). *Razón: el Top Tier solo se usa si se elige explícitamente.*
3. [x] `catalog.ts`: `repickAgentModel()` para cambio de proveedor o tier; elimina la copia de la lógica en `SettingsPanel`. *Razón: DRY.*
4. [x] Ajustes: selector Normal/Top junto al modelo; el selector manual sigue igual. *Razón: elección explícita.*
5. [x] Tests, typecheck, commit.

## Tarea anterior — parámetros de proveedores (2026-09-24)
Contrastado con esquemas vivos de fal, Atlas y NanoGPT antes de tocar código.
1. [x] `ROLE_KEYS.count`: quitar `max_images` y `batch_size`. *Razón: Seedream (fal v4.5/edit) trae `max_images` antes que `num_images`; ambos recibían N (hasta N² imágenes). Ningún esquema vivo usa `batch_size`.*
2. [x] Rol `aspect` solo si alguna opción del enum se interpreta como proporción; si no, `other`. *Razón: `image_size`/`orientation`/`ratio` a veces no son proporciones (p. ej. `align_image`, enteros); así el schema decide.*
3. [x] `ratioOf`: entender `portrait_3_4`/`portrait_9_16` (Krea/Ideogram en Atlas) además de `portrait_4_3` (fal). *Razón: hoy un 9:16 se envía como `square`.*
4. [x] fal discovery: paginar hasta el final (tope 10 páginas) en vez de 3. *Razón: image-to-image tiene 400 modelos; se perdían 100. No existe categoría `reference-to-video`: Seedance/Wan Reference y SAM ya entran por image-to-video/image-to-image; video-to-video no se añade (pide vídeo de entrada, no soportado).*
5. [x] `MAX_PLAN_STEPS` único (tool, zod, normalizador). *Razón: 16 vs 24.*
6. [x] `agent/tools.ts` usa `OP_IDS`; la lista de ops del system prompt se genera desde `OPS`. *Razón: evitar drift.*
7. [x] Tests, typecheck, commit.

## Tarea anterior — correcciones Designer (2026-09-24)
1. [x] "Free" en la lista de modelos muy separado → pegarlo al nombre. *Razón: lectura rápida del precio junto al modelo.*
2. [x] Aviso "Creates a new vector layer" fijo (`Stage.tsx`, `.stage-hint subtle`): sale mientras haya herramienta de forma y la capa activa no sea vectorial (p. ej. tras colocar una imagen) → eliminarlo. *Razón: con el paso 4 toda forma crea su capa; el aviso ya no informa nada.*
3. [x] Tinte verdoso: lo aplica el modelo demo "Local Sketch" (`demo/ops.ts` `stylize`) al simular img2img con la imagen adjunta → bajar la intensidad. *Razón: la demo no debe alterar tanto la referencia.*
4. [x] Formas se fusionan: cada forma nueva se añadía a la capa vectorial activa → cada forma crea su propia capa (salvo capa vectorial activa vacía). *Razón: edición independiente.*
5. [x] Caja de texto enorme: se creaba con ancho fijo (60 % del lienzo) → ancho `0` = automático, la caja mide el texto y crece al escribir (`scaleLayer` conserva el 0). *Razón: selección precisa.*
6. [x] Pincel/borrador destructivos → `RasterLayer.allowPaint`; una imagen (`sourceAssetId`) está protegida salvo que se active "Allow painting" en Propiedades. El pincel sobre imagen/otra capa crea una capa "Paint N" encima (o reutiliza la de encima) y la deja activa, así los siguientes trazos van a ella. Borrador bloqueado en imágenes protegidas. *Razón: edición no destructiva sin una capa por trazo.*
7. [x] Panel derecho: ancho arrastrable (borde izquierdo, guardado en localStorage), botón para plegar, secciones "Layers" y "Properties" plegables; el composer se centra con la variable `--layers-w`. *Razón: más espacio de lienzo.*
8. [x] Typecheck, tests, navegador; commit.
9. [x] Extra hallado al verificar: el editor de texto se cerraba al crearse (el `mousedown` del lienzo le quitaba el foco) → foco en `requestAnimationFrame`. Separado el contador de grupo en la lista de modelos ("LOCAL DEMO 1").

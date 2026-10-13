# Investigación: memoria del Designer con 4 GB y 2 GB (solo lectura)

Fecha: 2026-10-13. Rama `task/render-bench`. Solo lectura: no se tocó código de la app, no se abrió navegador ni sandbox, no se compiló ni ejecutó código externo. Las cifras de OGS son **estimaciones de modelo**, no medidas. Enlazado desde [README](README.md) y [render-estado.md](render-estado.md).

Etiquetas: **RAM** = afecta a la memoria en uso; **DISCO** = afecta a lo que se escribe fuera de la RAM (swap o almacenamiento); **AMBOS** = las dos cosas. Toda cita no comprobada en esta sesión se marca **no verificada**.

## Parte 1. Verificación de lo ya investigado

| Afirmación (documento) | Veredicto | Evidencia |
|---|---|---|
| Photopea 1.3: 2048×1152, 10 capas completas y 3 efectos, 850 ms → 55 ms con WebGL | **Confirmada** | Blog: «takes 850 ms without WebGL acceleration, and 55 ms with acceleration». |
| Photopea: sin GPU no se redibuja a 60 fps al mover una capa | **Confirmada** | Entrevista (Gigazine): «you can not render a 10 megapixel document with lots of layers at 60 fps». |
| Figma: motor por mosaicos en GPU, WebGL y luego WebGPU | **Confirmada** | Blog 2017: «highly-optimized tile-based engine», «implemented everything from scratch using WebGL». Blog WebGPU. |
| Figma: adaptar el motor para que WebGPU no empeorara | **Confirmada** | Blog WebGPU: «ensure that the transition to WebGPU would improve performance, not regress it». |
| pixiv: 1 a 7 pinceles con WebGL y point sprites | **Confirmada** | web.dev: «increase the number of available brushes to seven»; «point sprites and shaders». |
| Krita: mosaicos de 64×64 creados bajo demanda | **Parcial** | `TILEWIDTH 64` aparece en el wiki de formato como ejemplo, no como valor por defecto. Tamaño real (`KisTileData::WIDTH`): **no verificada**. Creación bajo demanda: `getTileLazy` en el código; sin texto que lo diga. |
| Krita: mementos por mosaico para deshacer | **Parcial** | `kis_memento_manager.cc`: «store the changes of the paint device». El detalle por mosaico: no verificado. |
| Krita: compresión y swap de mosaicos | **Parcial** | Confirmado: `KisTileDataStore` «When needed compresses them and swaps». LZF: etiqueta por mosaico en el formato. Que el swapper use LZF en memoria: **no verificada**. |
| GEGL: `Buffer.dup` con copia al escribir | **Confirmada** | «Aligned tiles will create copy-on-write clones in the new buffer.» |
| Krita: Instant Preview a menor resolución | **Parcial** | Docs: «taking a smaller version of the canvas»; umbral por tamaño de pincel de 100 px por defecto. No habla de lienzos grandes en general. |
| Krita: KisUpdateScheduler, walkers, redisplay | **No verificada** | Enlaces de código no abiertos. |
| GEGL: `get_required_for_output` / `get_invalidated_by_change` | **No verificada** | API no abierta. |
| Inkscape `DrawingCache`; Fresco pinceles pixel/vivos; Procreate 4 Silica M | **No verificada** | Páginas no abiertas. |
| PhotoCraft: mosaicos 256² en `BTreeMap<TileCoord, Arc<Tile>>`, píxel por defecto | **Confirmada** | `crates/raster/src/lib.rs`: «an infinite plane of 256×256 tiles»; «Missing tiles read as the surface's default pixel». |
| OGS: `FX_CACHE_PX = 48 M` en `render.ts` 386 | **Errónea** | No existe. `render.ts:310` define `FX_MAX_PX = 16_000_000`. `BELOW_CACHE_PX = 48_000_000` sí existe (`belowFxCache.ts:12`). |
| OGS: `beginEdit` clona en `raster.ts` 335–340 | **Errónea (líneas obsoletas)** | Está en `raster.ts:439–447` y clona el lienzo entero (`cloneCanvas(current)`). |
| PhotoCraft: presupuesto de GPU de 4 GiB con expulsión LRU; cuarto de la RAM | **No verificada** | Enlaces de `crates/gpu` y `crates/ui-egui` no abiertos. |
| PhotoCraft: proxies de submuestreo | **No verificada** | No abierto. |

Resumen: confirmadas Photopea, Figma, pixiv, GEGL COW y PhotoCraft 256²/Arc. Parciales Krita (tamaño, mementos, LZF). Erróneas `FX_CACHE_PX` y las líneas de `beginEdit`. El resto, no verificado.

## Parte 2. Cifras por proyecto

Para cada uno: tamaño del bloque, compresión (algoritmo y cuándo), umbral de volcado a disco y comportamiento al exceder la RAM. Etiqueta de la técnica: RAM, DISCO o AMBOS.

**Krita** (fuentes: cabecera `kis_tile_data_store.h` y `kis_tile_data_swapper_p.h`, wiki de formato)
- Bloque: `TILEWIDTH 64` en el ejemplo del wiki. Valor real de `KisTileData::WIDTH`: **no verificado**.
- Compresión: etiqueta por mosaico en el formato (`LZF`, `NONE`). Cuándo se comprime: «When needed compresses them and swaps» (`KisTileDataStore`). Algoritmo en memoria: **no verificado**.
- Umbrales (`kis_tile_data_swapper_p.h`, comentario del diagrama): `emergencyThreshold` («new tiles are not created until we free some memory»); `hardLimit`: el swapper expulsa mosaicos de trabajo hasta llegar; `softLimit`: el swapper expulsa primero los mosaicos de «memento» (undo). La cifra en MB de esos umbrales: **no verificada**.
- Al exceder la RAM: no se crean mosaicos nuevos hasta liberar memoria (emergencia); se expulsa undo antes que trabajo; el volcado va a un fichero de swap (`KisSwappedDataStore`). Qué pasa si el swap también se llena: **no verificado**.
- Disparo: `kickPooler` «Called by The Memento Manager after every commit».

**GIMP** (fuente: docs 3.2 «System Resources»)
- Bloque: no documentado en la sección leída: **no verificado**.
- Compresión del swap: «Values are best performance (the default), balanced, and best compression, or none». Compresión que se aplica en el swap, no en RAM.
- Umbral: «Tile Cache» = RAM asignada a datos de imagen. Si GIMP necesita más, pasa a swap en disco. Recomendación: «setting the Tile Cache to half of your RAM will probably give good performance», y «Probably even 3/4 of your RAM would be fine». Fórmula de cuatro pasos sobre RAM libre y velocidad del disco de swap.
- Al exceder: «a dramatic slowdown»; si se asigna demasiado, otras apps «may cause some of them to start to malfunction or even terminate».
- Etiqueta: DISCO (swap) y RAM (tamaño de la caché).

**Procreate** (fuente: ayuda, solo fragmento de búsqueda)
- Bloque: no publicado.
- Compresión: **no encontrado**.
- Límite: depende de la memoria que el sistema da a la app y de las dimensiones del lienzo; no publica fórmula. En 8 GB y 16 GB M1 Pro la app puede usar unos 5 GB (según el fragmento). Al exceder, no se pueden añadir capas (límite de capas). Sin volcado a disco documentado: **no verificado**.
- Etiqueta: RAM.

**Figma** (fuentes: foros y ayuda de Figma, vía búsqueda; secundario)
- Bloque: no publicado en las fuentes abiertas; motor por mosaicos (blog 2017).
- Límite: unos 2 GB de memoria WebAssembly por pestaña; no es una cifra exacta («varies by browser and device»).
- Umbrales: aviso amarillo al 60 %, rojo al 75 % (no se puede descartar), y al 100 % el archivo se bloquea.
- Al exceder: bloqueo del archivo; Figma recomienda dividir el archivo. Sin volcado a disco documentado en las fuentes leídas: **no verificado**.
- Etiqueta: RAM.

**Navegadores** (fuentes de terceros; secundarias)
- Chrome: límite de 16 384² y 268 435 456 píxeles por canvas (html2canvas FAQ). **No verificado** con fuente de Chromium.
- Safari en iOS: límite por canvas en conflicto (16 777 216 píxeles según un blog de 2022; 3–5 MP según html2canvas). Límite total de memoria de canvas entre **224 MB y 384 MB** según la versión de iOS (foros de Apple y CanvasJS). Al exceder: aviso «Total canvas memory use exceeds the maximum limit» y fallo del canvas. Sin volcado a disco.
- Etiqueta: RAM. El límite de la GPU frente a la CPU: **no encontrado**.

**Photopea**: sin cifras de memoria en las fuentes leídas («The article makes no statements about memory»). **No encontrado.**

**PhotoCraft** (commit citado): bloque de 256² confirmado. Compresión y volcado: **no verificados**.

## Parte 3. Cálculo para OGS

### Supuestos

- Lienzo 2048² RGBA = 16 MiB por capa completa. Mosaico 64² = 16 KiB.
- Documento de 80 capas: 77 raster y 3 FX (sin píxeles). 60 capas de personaje (lineart, color, efectos, formas) con trazos dispersos; 17 de escenario y fondo.
- Capa raster = buffer + base, cada uno de 16 MiB (el requisito indica «y además una base»). Par = 32 MiB.
- Caja de contenido (técnica 1): capa de personaje ocupa de media el 40 % del lienzo (bounding box). Escenario, 100 %.
- Ocupación dentro de la caja, tras recorte: 60 % de los mosaicos 64² (personaje). Escenario: 100 %; con 30 % de mosaicos uniformes.
- Máscara 1 canal: 20 de las 60 capas de personaje son lineart; alfa de 8 bits = 1/4 de RGBA.
- Historial: 30 pasos. (a) retiene un lienzo completo por paso. Desde el recorte, cada paso guarda la caja (factor medio 0,7). Desde los mosaicos, solo los tocados (~20 mosaicos por paso, ≈ 0,3 MiB).
- Cachés FX: 16 Mpx + 48 Mpx = 256 MiB. Página retenida: 16 MiB. Se mantienen en todas las etapas salvo que se indique.
- Compresión de inactivos: 90 % de los bytes, ratio 4:1 (**supuesto, no medido**).
- Volcado a IndexedDB: 10 capas activas en RAM; las demás, con proxy 1/4 (1 MiB) en RAM.
- Sobrecarga de JS, UI y decodificación: 150 MiB (no medida).
- Disponible para la app: 4 GB → 4 − SO 1,2 − navegador 0,4 ≈ 2,46 GB ≈ **2 460 MiB**. 2 GB → 2 − SO 1,0 − navegador 0,4 ≈ **614 MiB**.
- Criterio de cabida: total ≤ 80 % del disponible (margen para picos).

**Advertencia de calibración.** ADR 0015 registra un pico de más de 1 800 MB con 13 capas raster. Este modelo no reproduce ese pico con 30 pasos de historial. Las cifras comparan técnicas, no son valores absolutos. La medida real manda.

### Desglose por técnica (acumulativo, en el orden pedido)

MiB de datos de píxel (sin sobrecarga). Cada fila suma la técnica sobre la anterior.

| Paso | Técnica (etiqueta) | Personaje (60) | Escenario (17) | Historial | Cachés y página | Total | + sobrecarga 150 |
|---|---|---|---|---|---|---|---|
| S0 | Actual (—) | 1 920 | 544 | 480 | 272 | **3 216** | 3 366 |
| S1 | 1. Recorte a caja de contenido (AMBOS: RAM y el guardado por caja) | 60 × 12,8 = 768 | 544 | 336 | 272 | **1 920** | 2 070 |
| S2 | 2. Máscara 1 canal, 20 lineart (RAM) | 40 × 12,8 = 512 + 20 × 3,2 = 64 → 576 | 544 | 336 | 272 | **1 728** | 1 878 |
| S3 | 3. Mosaicos dispersos 64² (60 % ocupación) y uniformes 30 % escenario (RAM) | 40 × 7,7 = 307 + 20 × 1,9 = 38 → 345 | 17 × 22,4 = 381 | 200 | 272 | **1 198** | 1 348 |
| S4 | 4. Compresión de inactivos 4:1 (AMBOS: RAM y el disco de swap o IDB) | 345 y 381 → 726 × 0,1 + 726 × 0,9 / 4 = 236 | (incluido) | 200 | 272 | **708** | 858 |
| S5 | 5. Volcado a IndexedDB de capas no activas (DISCO) | 10 activas × 7,7 = 77 | proxies 77 × 1 MiB | 200 | 272 | **626** | 776 |
| S6 | 6. Límite de capas como red de seguridad (RAM) | Límite N = 80 (no reduce la cifra; evita escenarios peores) | — | — | — | 626 | 776 |

Variantes que no están en el orden pedido y que el usuario debe decidir: **cachés a pantalla** (16 MiB en lugar de 256; −240 MiB) y **historial de 10 pasos** (−130 MiB).

### Primera combinación que cabe

Regla: total con sobrecarga ≤ 80 % del disponible.

- **4 GB (límite 0,8 × 2 460 = 1 968 MiB):** S1 (2 070) no cabe; **S2 (1 878) sí cabe**. Primera combinación: recorte + máscaras 1 canal.
- **2 GB (límite 0,8 × 614 = 491 MiB):** ningún paso de S0 a S6 cabe (S5 = 776). Con S5 + cachés a pantalla (−240) + historial de 10 pasos (−130): 626 − 370 = 256 pixel → 406 con sobrecarga, que sí cabe. **Primera combinación para 2 GB: S5 + cachés a pantalla + historial de 10 pasos.** Sin esas dos variantes, 2 GB no cabe con ninguna combinación de la lista.

Límite de capas (S6) como red de seguridad: con 2 GB el coste por capa activa es ~7,7 MiB y por capa inactiva 1 MiB (proxy). Un límite de 40 capas raster activas con 10 activas en RAM deja el peor caso (todas activas) en 40 × 7,7 = 308 MiB, que cabe. Se propone un límite de 80 capas raster y un aviso al superar 40 capas activas.

## Técnicas (tabla)

| Técnica | Etiqueta | Quién la usa | Cita | Ahorro en OGS (de S0) | Dificultad en Canvas2D hoy | Natural en port a Rust |
|---|---|---|---|---|---|---|
| 1. Recorte a la caja de contenido | AMBOS | Ninguno citado; práctica de SDK | **no verificada** como práctica de editor | −1 296 MiB (S0→S1) | **Baja**: `createCanvas` de la caja; crece al pintar fuera; no cambia el guardado (se guarda la caja con su origen) | Fácil |
| 2. Máscara 1 canal (lineart, monocolor) | RAM | Ninguno verificado | **no encontrado** en fuente de producción | −192 MiB (S1→S2) | **Media**: canvas 2D no tiene canal único; `ImageData` con `Uint8Array` y composición propia | Muy natural (`Vec<u8>`) |
| 3. Mosaicos dispersos 64² y uniformes | RAM | PhotoCraft (256², confirmada); Krita (64 en ejemplo, no verificada); GEGL (COW, confirmada) | Ver Parte 1 | −530 MiB (S2→S3) | **Alta**: reescritura de `raster.ts` y del historial | Muy natural (`BTreeMap`, `Arc`) |
| 4. Compresión de inactivos | AMBOS | Krita (`compresses ... and swaps`, confirmada); GIMP (swap compression, confirmada) | Parte 2 | −490 MiB (S3→S4) | **Media-alta**: LZ en JS o `CompressionStream`; ratio **no medido** | Natural (`lz4`/`zstd`) |
| 5. Volcado a IndexedDB | DISCO | Krita (swap a fichero, confirmada); GIMP (swap, confirmada) | Parte 2 | −82 MiB con 10 activas (S4→S5), más −240 con cachés a pantalla | **Alta**: sincronización con el guardado; no tocar `data/` (AGENTS.md) | Natural (`sled`/fichero) |
| 6. Límite de capas (red de seguridad) | RAM | Procreate (límite por memoria, confirmada como concepto) | Fragmento de ayuda | Evita escenarios peores; no reduce el coste típico | **Baja** | Fácil |
| Cachés a pantalla y presupuesto en bytes | RAM | PhotoCraft (presupuesto, **no verificada** en detalle) | Parte 1 | −240 MiB (S5) | **Baja** | Fácil |
| Proxies 1/4 para vista alejada | RAM | Krita Instant Preview (parcial); PhotoCraft (no verificada) | Parte 1 | Costa +77 MiB; ganancia en zoom | Media | Natural |
| Composición en GPU | RAM (CPU) | Photopea, Figma, pixiv (confirmadas) | Parte 1 | No reduce memoria | **Muy alta** | Natural con wgpu |
| Vectorizar trazos bajo demanda | RAM | Fresco (**no verificada**) | — | No cuantificado | Muy alta | Media |

## Recomendación (de más rentable a más caro, según lo que se puede hacer hoy)

Prioridad 1: **implementable hoy en TypeScript/Canvas2D sin tocar el guardado**.
1. **Recorte a la caja de contenido** (técnica 1). Mayor ahorro de la lista (−1,3 GiB en el modelo), sin cambio de formato: se guarda la caja con su origen. Prueba: medir con el banco del sandbox antes de aprobar.
2. **Cachés en bytes y a resolución de pantalla** (variante). −240 MiB, cambio local en `render.ts` y `belowFxCache.ts`.
3. **Historial por mosaicos** ya existente (`79bf595`); usarlo en `beginEdit` (`raster.ts:439`). Requiere pruebas de paridad.

Prioridad 2: requiere aprobación (AGENTS.md, regla 3) y prueba de paridad.
4. **Máscara 1 canal para lineart** (técnica 2). −192 MiB; más natural en Rust.
5. **Mosaicos dispersos y uniformes** (técnica 3; ADR 0015). Cambio estructural. Tamaño 256² (PhotoCraft) o 64² (Krita) se decide con medida.

Prioridad 3: solo con medida y aprobación explícita de datos.
6. **Compresión de inactivos** (técnica 4). Ratio real no medido.
7. **Volcado a IndexedDB** (técnica 5). Solo para 2 GB. Riesgo alto en datos.
8. **Límite de capas** (técnica 6) como red de seguridad.

Port a Rust: las técnicas 2, 3, 4 y 5 son más naturales (`Vec<u8>`, `BTreeMap`, `Arc`, compresión y almacenamiento de fichero). La 1 es fácil en ambos. La composición en GPU es el principal motivo para el port, no la memoria.

**Primer paso sin riesgo para los datos:** medir el pico real con el banco del sandbox, separando el guardado grande (pendiente 7 de render-estado). Sin esa medida, todas las cifras de esta nota son orientativas.

## Fuentes

- Photopea 1.3: https://blog.photopea.com/photopea-1-3.html
- Photopea (entrevista): https://gigazine.net/gsc_news/en/20181111-photopea-developer-ask-question
- Figma 2017: https://www.figma.com/blog/building-a-professional-design-tool-on-the-web/
- Figma WebGPU: https://www.figma.com/blog/figma-rendering-powered-by-webgpu/
- pixiv (web.dev): https://web.dev/case-studies/pixiv
- Krita, `kis_tile_data_store.h`: https://lxr.kde.org/source/graphics/krita/libs/image/tiles3/kis_tile_data_store.h
- Krita, `kis_tile_data_swapper_p.h`: https://lxr.kde.org/source/graphics/krita/libs/image/tiles3/swap/kis_tile_data_swapper_p.h
- Krita, `kis_memento_manager.cc`: https://lxr.kde.org/source/graphics/krita/libs/image/tiles3/kis_memento_manager.cc
- Krita, formato de datos: https://community.kde.org/Krita/Tile_Data_Format
- Krita, Instant Preview: https://docs.krita.org/Instant_Preview
- GEGL, `Buffer.dup`: https://developer.gimp.org/api/gegl/method.Buffer.dup.html
- GIMP 3.2, recursos del sistema: https://docs.gimp.org/3.2/en/gimp-prefs-system-resources.html
- Procreate, límite de capas: https://help.procreate.com/articles/YB7CjQ-maximum-layer-limit (solo fragmento de búsqueda)
- Figma, límite de memoria (foros y ayuda, vía búsqueda): https://forum.figma.com/t/out-of-memory/78115
- Canvas en Safari: https://pqina.nl/blog/canvas-area-exceeds-the-maximum-limit/ y https://www.pqina.nl/blog/total-canvas-memory-use-exceeds-the-maximum-limit/
- Canvas en Chrome (secundaria): https://html2canvas.hertzen.com/faq
- PhotoCraft, commit `3f0a633056d5ea8c9f1a0aec2d3572f4789780bf`: https://github.com/storytold/photocraft/blob/3f0a633056d5ea8c9f1a0aec2d3572f4789780bf/crates/raster/src/lib.rs

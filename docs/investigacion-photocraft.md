# Investigación: cómo resuelve memoria y rendimiento PhotoCraft (y qué aplicar en OGS)

Fecha: 2026-10-13. Solo lectura. No se compiló, instaló ni ejecutó nada de ese código, y no hay medidas nuevas. Enlazado desde [arquitectura-render.md](arquitectura-render.md), sección 3.

## 1. Qué proyecto se estudió

- **Repositorio oficial:** [github.com/storytold/photocraft](https://github.com/storytold/photocraft), Apache-2.0 y MIT, en Rust. Estudiado en el commit `3f0a633056d5ea8c9f1a0aec2d3572f4789780bf` (2026-10-13), clonado con `--depth 1` en el scratchpad. Se citan líneas de ese commit: `https://github.com/storytold/photocraft/blob/3f0a633056d5ea8c9f1a0aec2d3572f4789780bf/<ruta>#L<n>`.
- **Es Rust y wasm, en parte.** El editor principal es nativo (egui + wgpu). Hay además un objetivo web: `apps/photocraft-web`, con eframe, wgpu (WebGPU con respaldo WebGL2) y `wasm-bindgen` (`apps/photocraft-web/Cargo.toml`, líneas 3, 30–35). Así que es Rust+wasm para la web, no un editor escrito solo para wasm.
- **Procedencia (cautela):** el repositorio tiene 12 días de vida (creado el 2026-09-30) y 53 000 estrellas, una combinación que no he podido verificar. Hay copias no oficiales (`openhausfun/photocraft`, que se presenta como «instantánea independiente», y otras). No he usado nada de ellas.
- **Graphite no se estudió.** No hacía falta: PhotoCraft existe y coincide con la descripción.
- **Cifras de rendimiento publicadas:** `perf/baseline.json` (commit `f5d2bcb`, Apple M4 Pro, macOS). Son cifras del propio proyecto, no mías. Sus escenarios usan entre 0,43 y 2,12 GB de memoria de GPU. No las comparo con las de OGS porque no sé qué mide cada escenario sin leer `perf/budgets.toml`.

## 2. Tabla técnica

| Tema | Enfoque en PhotoCraft (evidencia) | Qué hace OGS hoy | ¿Aplicable en OGS? |
|---|---|---|---|
| **Almacenamiento de píxeles** | Lienzo disperso: plano infinito de mosaicos de 256×256 en un `BTreeMap<TileCoord, Arc<Tile>>`, con un píxel por defecto para los mosaicos ausentes (`crates/raster/src/lib.rs` 1–5, 40–42, 87–91; `TILE_SIZE = 256` en `crates/geom/src/lib.rs` 13). Formato por canal variable (8/16/32 bits). | Un lienzo completo por capa (`createCanvas(pxWidth, pxHeight)`, `src/engine/design/raster.ts` 336). Sin mosaicos ni formato variable. | **Sí, en TypeScript.** Mapa de mosaicos de `OffscreenCanvas` de 256² creados bajo demanda. Coste: reescribir `buffers`, `bufferVersion` y `composeRaster`. Ganancia real solo en capas dispersas; en el documento profesional los trazos cubren casi todo el lienzo. |
| **Copia al escribir y deshacer** | Cada estado de historial es un documento con mosaicos compartidos por `Arc`. Escribir hace `Arc::make_mut` solo del mosaico tocado (`crates/raster/src/lib.rs` 177). El historial cuenta bytes por mosaico, sin duplicar los compartidos (`crates/ops/src/tiles.rs` 1–5). | `beginEdit` clona el lienzo entero en cada edición (`src/engine/design/raster.ts` 335–340), y el historial guarda referencias a lienzos. | **Sí, en TypeScript y Canvas2D.** Copiar solo los mosaicos tocados en `beginEdit` sustituye el clon completo. Requiere el mapa de mosaicos del punto anterior. |
| **Presupuesto del historial** | `max_bytes` en bytes, con poda de los estados más antiguos y conservación del último (`crates/ops/src/lib.rs` 48–50, 212–245). | Límite por número de estados (`max_states`), sin límite en bytes. | **Sí, en TypeScript.** Un presupuesto en bytes con poda, como en `trim`. Es la mejora más barata de esta lista. |
| **Cachés y presupuestos** | Caché global de mapas de efecto con cerrojo y LRU (`crates/compose/src/lib.rs` 1554). Residencia de GPU con presupuesto de 4 GiB y expulsión LRU (`crates/gpu/src/lib.rs` 71–77). Presupuesto de textura de cada documento: un cuarto de la RAM, con mínimo (`crates/ui-egui/src/gpu_canvas.rs` 1154–1158). | Cachés por píxeles fijos: `FX_CACHE_PX` = 48 M (`src/engine/design/render.ts` 386), `BELOW_CACHE_PX` = 48 M (`src/engine/design/belowFxCache.ts` 10), máscaras de trazo de 16 M px (`src/engine/design/rasterStrokeMask.ts` 7). | **Sí, en TypeScript,** con presupuesto en bytes y basado en la memoria disponible (`navigator.deviceMemory`, orientativo). Hoy el coste de las cachés OGS es fijo: 48 M px ≈ 192 MB cada una, más la base y la composición, y el documento profesional supera 1,8 GB. |
| **Composición retenida y región dañada** | La GPU retiene el compuesto como texturas con mipmaps. Tras cada cambio solo se sube y se regenera la región dañada (`crates/ui-egui/src/gpu_canvas.rs` 1–16). Cada comando declara su región (`last_damage`; `crates/engine/src/brush_cmds.rs` 223–225). Los mapas de efecto se reconstruyen solo en los mosaicos dañados, ampliados por el alcance del efecto (`crates/gpu/src/lib.rs` 1–25). | Se redibuja la página completa en cada fotograma (`drawDoc`), salvo las cachés de FX (`src/engine/design/render.ts`). | **Parcialmente en Canvas2D.** Una página retenida con redibujo por región (`clip` al rectángulo dañado, más el margen del efecto) es posible sin wasm. Los FX `below` siguen cambiando toda la página. Se verificó que OGS ya tiene el coste de un fotograma completo (medidas de la tarea 2). |
| **Composición en GPU frente a CPU** | Compositor wgpu en páginas de 2048² (`crates/gpu/src/lib.rs` 75), en fragmentos de 1024² RGBA32F que se reutilizan, con planificador de pases para todos los modos de fusión de Photoshop y máscaras (`crates/gpu/src/lib.rs` 1–25). | Canvas2D de la CPU con `globalCompositeOperation`. | **No en Canvas2D.** Exige WebGPU o WebGL2 propios, que son la prueba de motor de la tarea 2. El resultado de esa prueba no permite afirmar que la GPU sea más rápida aquí. |
| **Vistas reducidas (LOD)** | Mipmaps en la textura de visualización (`gpu_canvas.rs` 1–16). Si el documento no cabe en el presupuesto, se dibuja un lienzo CPU reducido (`crates/ui-egui/src/canvas.rs` 1384; `gpu_canvas.rs` 1154). Proxies de factor entero por submuestreo de vecino más próximo (`crates/compose/src/proxy.rs` 1–12). | Sin proxies ni mipmaps en el render (búsqueda en `src/engine/design` y `src/components/designer`: ninguna coincidencia). Los FX se calculan a la escala de la vista (`src/engine/design/render.ts` 431). | **Sí, en TypeScript y Canvas2D.** Para zoom alejado, generar en `OffscreenCanvas` proxies de 1/2, 1/4 cuando cambia el buffer de una capa. Es barato y evita dibujar 2048² a 0,365. |
| **Memoria entre wasm y JS** | Los píxeles viven en memoria wasm y en la GPU. JS solo recibe copias al importar o exportar ficheros: `to_vec` al cargar presets (`apps/photocraft-web/src/indexed_presets.rs` 207), copia del RGBA para PNG (`apps/photocraft-web/src/web.rs` 391), y `Uint8Array::from` al descargar (`web.rs` 414). | Los lienzos viven en TypeScript. Exportar pasa por `canvas.toBlob`, que copia. | **Sí, en TypeScript,** sin wasm: `transferControlToOffscreen` y `ImageBitmap` evitan copias al enviar a un worker, y los `ArrayBuffer` se transfieren en lugar de copiarse. |
| **Documentos con muchas capas** | Plan de pases por fragmentos, sin cargar todo a la vez; páginas expulsadas por LRU (`crates/gpu/src/lib.rs` 1–25). | Recorre todas las capas en cada fotograma (`fxPlan`), y cada capa raster ocupa un lienzo de página completa. | **Parcialmente.** Sin GPU, lo aplicable es no redibujar capas invisibles o fuera de la región dañada, y los proxies del punto anterior. |

## 3. Qué se puede aplicar en OGS, en orden de coste

Sin wasm ni GPU, y en este orden (de menor a mayor coste):

1. **Presupuesto del historial en bytes**, con poda de los estados antiguos y conservación del último (como `ops/src/lib.rs` 212–245). Cambio local en `src/engine/design/history.ts`.
2. **Presupuestos de caché en bytes y dependientes de la memoria**, en `fxCache`, `belowFxCache` y `rasterStrokeMask`. Reducen el pico del documento profesional sin tocar el resultado.
3. **Proxies de vista reducida** (1/2 y 1/4) por capa raster y FX, generados fuera del hilo de interacción. Atacan el coste de zoom alejado, que hoy no tiene alternativa.
4. **Página retenida con redibujo por región** en Canvas2D, con `clip` al rectángulo dañado y margen del efecto. Es el cambio de rendimiento más importante, y exige que cada comando declare su región (hoy `last_damage` existe en el motor, pero el render no lo usa).
5. **Copia de mosaicos (copia al escribir) en `beginEdit` y en el historial.** Reemplaza el clon completo. Es el cambio de memoria más grande, pero es una reescritura del almacenamiento de píxeles y necesita un plan propio (ADR).

Lo que exige wasm o GPU y no se recomienda hoy: el compositor en GPU con planificador de pases (punto 4 de la tabla), los mapas de efecto en GPU y la residencia de páginas. Son un proyecto distinto, con su propia prueba de motor.

## 4. Recomendación concreta para OGS

Empezar por **(1) presupuesto en bytes del historial** y **(3) proxies de vista reducida**: son cambios locales en TypeScript y Canvas2D, medibles con los gestos del banco, y atacan los dos problemas que se ven hoy (pico de memoria y coste de zoom alejado). Después, **(4) página retenida con redibujo por región** en Canvas2D, que es el de mayor efecto en el coste por fotograma. El almacenamiento por mosaicos (**5**) necesita un ADR propio antes de tocarlo.

Antes de implementar cualquiera de estos cambios conviene medirlos en el banco con el mismo tope de 1800 MB, porque el pico de memoria es la restricción que hoy bloquea la comparación de motores.

## 5. Lo que no se ha comprobado

- No se ha compilado ni ejecutado PhotoCraft. Todas las afirmaciones son de lectura del código fuente y de sus documentos.
- No se ha verificado el rendimiento de PhotoCraft con ninguna medida propia. Las cifras de `perf/baseline.json` son del proyecto y no se comparan con las de OGS.
- No se ha leído `crates/compose/src/lib.rs` de forma completa; solo los puntos citados.
- La popularidad (53 000 estrellas en 12 días) no se ha verificado.

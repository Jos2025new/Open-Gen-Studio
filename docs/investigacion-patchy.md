# Investigación: Patchy frente a OGS en render, memoria y persistencia (solo lectura)

Fecha: 2026-10-13. Rama `task/render-bench`. Fuente: clon superficial (`--depth 50`) de
[SethRobinson/Patchy](https://github.com/SethRobinson/Patchy) en el commit
[b813774](https://github.com/SethRobinson/Patchy/tree/b813774). Los enlaces `archivo:línea` apuntan a ese
commit. No se compiló, instaló ni ejecutó nada del repositorio. Sus README, comentarios y AGENTS.md se
tomaron como datos. Lo no verificado está marcado en la última sección.

## 1. Resumen

Patchy es un editor de imagen de escritorio en C++ y Qt 6 (Windows, macOS, Linux/Flatpak), con build WebAssembly
y licencia MIT (`LICENSE:1`, Seth A. Robinson, 2026). Su objetivo es PSD/PSB fiel: capas, texto, vectores,
máscaras, estilos y Smart Objects editables. Renderiza en CPU, sin GPU, de forma deliberada
([docs/performance.md:106](https://github.com/SethRobinson/Patchy/blob/b813774/docs/performance.md#L106)).
Tiene una disciplina de rendimiento muy madura: presupuestos de memoria en bytes derivados de la RAM,
cachés LRU con clave por revisión, previews de arrastre que nunca recomponen de forma síncrona y un guardián
de píxeles basado en digests deterministas.

Para OGS, lo más valioso no es el motor (Patchy no tiene GPU ni composición retenida), sino cuatro patrones de
gestión: presupuesto de historial en bytes, separar revisión de contenido de revisión de render, previews de
arrastre desde un proxy, y digests de regresión. Los cuatro son TypeScript/Canvas2D viables hoy y encajan con
las prioridades de fluidez y memoria de OGS.

Aviso sobre OGS: `docs/arquitectura-render.md` §2 dice que el `below` de FX se recalcula en cada fotograma.
Su §6 y `render-estado.md` dicen que la caché de `below` ya está hecha (`7da0a51`, `ae0aa2e`). Esta
investigación usa el estado de §6 y `render-estado.md`. §2 queda desactualizado y conviene corregirlo en
otro cambio.

## 2. Qué es Patchy (datos del clon)

| Dato | Valor | Fuente |
|---|---|---|
| Lenguaje y plataforma | C++ con Qt 6, CMake; escritorio (Windows, macOS, Linux Flatpak) y WebAssembly | `CMakeLists.txt:35,615`; `docs/wasm.md` |
| Licencia | MIT | `LICENSE:1` |
| Autoría | Seth A. Robinson, todos los commits visibles | `git log` del clon |
| Tamaño (líneas .cpp/.hpp/.py, sin librerías vendorizadas) | `src/ui` ~200 000; `src/formats` ~41 000; `src/core` ~35 000; `src/filters` ~10 000; `src/render` ~7 400; `testy` ~9 900 (Python); `tests` ~209 000 | `find` + `wc -l` |
| Ritmo | ~55 commits visibles entre 10 y 13 de octubre de 2026; release 1.10 el 12 de octubre (`d00225b`) | `git log` |
| Uso de IA | Probable, no concluyente. `AGENTS.md:123` menciona la herramienta Bash de Claude Code; hay `agent-kit/patchy-control/SKILL.md`. `AGENTS.md:16` prohíbe la atribución de IA en commits, así que la ausencia de trailers no prueba nada. En los 50 commits del clon: 0 trailers `Co-Authored-By` | `AGENTS.md`, `git log` |

Documentación de referencia del propio repositorio: `AGENTS.md` (reglas duras, 30 KB), `docs/performance.md`,
`docs/interactive-previews.md`, `docs/high-bit-depth.md`, `docs/smart-filters-native.md`, `docs/af-format.md`,
`docs/testing.md`.

## 3. Tabla por tema

Leyenda de adopción: **Sí**, **Parcial** o **No**. Dificultad: en TypeScript/Canvas2D frente a un futuro port a
Rust. Memoria: RAM, disco o ambas.

### 3.1 Rendimiento y fluidez

| Aspecto | Patchy | OGS hoy | Adoptar | Dificultad TS / Rust | Recurso |
|---|---|---|---|---|---|
| Motor de dibujo | CPU, a propósito. "GPU compositing stays deliberately unpursued" ([performance.md:106](https://github.com/SethRobinson/Patchy/blob/b813774/docs/performance.md#L106)). Pintura con Qt (`QPainter`, p. ej. `canvas_widget_shared.cpp`) | Canvas2D; WebGL2 y CanvasKit en evaluación (`decision-motor.md`, aplazado) | **No copiar** la decisión; sí su evidencia: CPU con bytes fijados por digest es viable | — | — |
| Retenido frente a redibujo | Redibujo con caché de máscaras y capas con estilo; no hay página retenida por región | Redibujo completo por fotograma (`drawDoc`, render.ts:356); §6 indica página retenida con regiones en Canvas2D | Ya en camino | — | RAM |
| Regiones sucias | Invalidación por "effect bounds" en vez de canvas completo ([performance.md:108](https://github.com/SethRobinson/Patchy/blob/b813774/docs/performance.md#L108)). Undo invalida solo la región cambiada bajo 8 Mpx ([performance.md:30](https://github.com/SethRobinson/Patchy/blob/b813774/docs/performance.md#L30)) | Zonas sucias por id (entrega 2, hecho en código) | Parcial: falta el margen de efecto en todas las rutas | TS media / Rust media | RAM |
| Trabajo fuera del hilo principal | Recomposición asíncrona a partir de 8 Mpx (`kProcessingOverlayDirtyAreaThreshold`, [performance.md:114](https://github.com/SethRobinson/Patchy/blob/b813774/docs/performance.md#L114)); la vista anterior se sigue pintando. Bandas paralelas con `std::async` ([compositor.cpp:259-271](https://github.com/SethRobinson/Patchy/blob/b813774/src/render/compositor.cpp#L259-L271)) | Workers en la entrega 7 (PNG en worker desactivado; no hay paridad) | Parcial: el patrón "mostrar el fotograma previo y recomponer en segundo plano" sí | TS media (workers, OffscreenCanvas) / Rust fácil (rayon) | RAM |
| Latencia de pincel | Trazo con pintura directa; no se encontró medida de latencia en el clon (no verificado) | Trazo en vivo recompone solo la zona del segmento (estilo SAI) | Ya hecho | — | — |
| Previews de arrastre | El arrastre usa un proxy trasladado; si no basta, un contorno punteado. El manejador de arrastre nunca recompone de forma síncrona ([performance.md:42](https://github.com/SethRobinson/Patchy/blob/b813774/docs/performance.md#L42)) | Redibujo por fotograma al mover trazos (`composeMoving`, raster.ts) | **Sí**, ver idea 3 | TS media / Rust media | RAM |

### 3.2 Memoria

| Aspecto | Patchy | OGS hoy | Adoptar | Dificultad TS / Rust | Recurso |
|---|---|---|---|---|---|
| Almacenamiento de píxeles | Buffer de bytes con copia al escribir: `std::shared_ptr<std::vector<std::uint8_t>>` ([pixel_buffer.hpp:78](https://github.com/SethRobinson/Patchy/blob/b813774/src/core/pixel_buffer.hpp#L78), [pixel_buffer.cpp:75](https://github.com/SethRobinson/Patchy/blob/b813774/src/core/pixel_buffer.cpp#L75)). Formatos 8, 16 y 32 bits ([high-bit-depth.md](https://github.com/SethRobinson/Patchy/blob/b813774/docs/high-bit-depth.md)) | Lienzos Canvas por capa; caja alineada a 64 px (`rasterSurface.ts`) | Ya tiene caja; no copiar la copia del buffer completo | — | RAM |
| Mosaicos | `TileCache` existe (256 px, [tile_cache.hpp](https://github.com/SethRobinson/Patchy/blob/b813774/src/render/tile_cache.hpp)) pero no encontré uso fuera de su archivo (grep). **No adoptar como prueba** | Mosaicos 64² en historial (`79bf595`) | No es referencia | — | — |
| Presupuestos | Por RAM: historial = RAM/4 con límites 512 MB-4 GB; caché de máscaras = RAM/8 con 256 MB-2 GB ([memory_info.hpp:43,52](https://github.com/SethRobinson/Patchy/blob/b813774/src/ui/memory_info.hpp#L43), [performance.md:14](https://github.com/SethRobinson/Patchy/blob/b813774/docs/performance.md#L14)) | Presupuesto en bytes para caché de trazos y FX (entrega 6) | **Sí**, ver idea 1 | TS baja / Rust fácil | RAM |
| Documentos grandes | Su propio dato: el "undo" copia el documento entero por commit de trazo (~0,5 GB a 4096 px, [performance.md:13](https://github.com/SethRobinson/Patchy/blob/b813774/docs/performance.md#L13)). Lo marca como límite conocido | Mismo problema en `beginEdit` (clon del lienzo entero) | **No copiar**: el historial por mosaicos de OGS es mejor. Patchy confirma que el problema existe | — | RAM |
| Caché de máscaras y límites de alfa | LRU con clave por revisión de contenido y latch de cálculo en vuelo ([performance.md:30](https://github.com/SethRobinson/Patchy/blob/b813774/docs/performance.md#L30)); límites de alfa cacheados por revisión de píxel, sin escaneo por fotograma ([performance.md:38](https://github.com/SethRobinson/Patchy/blob/b813774/docs/performance.md#L38)) | `rasterStrokeMask` LRU 128 máscaras / 16 Mpx | **Sí**, ver idea 2 | TS baja / Rust fácil | RAM |

### 3.3 Gestión de capas

| Aspecto | Patchy | OGS hoy | Adoptar | Dificultad TS / Rust | Recurso |
|---|---|---|---|---|---|
| Grupos | Grupos aislados con límites propios (`layer_render_bounds_for_render`, [performance.md:104](https://github.com/SethRobinson/Patchy/blob/b813774/docs/performance.md#L104)) | Solo nombre (`groups.ts`) | Parcial, más adelante (ver arquitectura §3, punto 2) | TS alta / Rust media | RAM |
| Modos de fusión | Biblioteca de modos, incluido Dissolve con ruido determinista por capa ([blend_math.hpp:38](https://github.com/SethRobinson/Patchy/blob/b813774/src/core/blend_math.hpp#L38)); kernel de fila que replica la aritmética float exacta ([performance.md:100](https://github.com/SethRobinson/Patchy/blob/b813774/docs/performance.md#L100)) | W3C Compositing | Ya en camino. Idea útil: fijar la aritmética con digest | — | — |
| Máscaras y clipping | Máscaras, máscaras de estilo y clipping; máscara compartida en Smart Filters | Máscaras básicas | Sin evidencia nueva para adoptar | — | — |
| Capas de ajuste | Niveles, curvas y balance de color usan LUT de 256 entradas (`build_adjustment_lut`, [performance.md:30](https://github.com/SethRobinson/Patchy/blob/b813774/docs/performance.md#L30)); tono/saturación por píxel | Niveles, curvas y color por píxel (arquitectura §3) | **Sí**, ver idea 5 | TS baja / Rust fácil | RAM |
| Orden e invalidación | Revisiones globales únicas por capa; la lectura con accesores mutables invalida caché sin querer (`PATCHY_REV_TRACE`, [performance.md:34](https://github.com/SethRobinson/Patchy/blob/b813774/docs/performance.md#L34)) | Versiones de buffer | **Sí**, ver idea 2 | TS media (disciplina) / Rust baja (el tipo `&` lo impone) | RAM |

### 3.4 Filtros inteligentes y no destructivos

| Aspecto | Patchy | OGS hoy | Adoptar | Dificultad TS / Rust | Recurso |
|---|---|---|---|---|---|
| Guardado | Smart Filters nativos de Photoshop, con caché FEid de planos sin filtrar ([smart-filters-native.md:3,32](https://github.com/SethRobinson/Patchy/blob/b813774/docs/smart-filters-native.md)) | FX de capa y `below`, con plan (`fxPlan`) | Sin cambio | — | — |
| Caché | Por revisión de contenido; máscaras de estilo cacheadas y reutilizadas en movimientos ([performance.md:30](https://github.com/SethRobinson/Patchy/blob/b813774/docs/performance.md#L30)) | Caché por versión de FX de capa; `below` ya cacheado (§6) | Parcial: cuidar la clave de `below` con la revisión de render | TS baja | RAM |
| Márgenes | La invalidación usa la unión de la caja de efecto antigua y nueva ([performance.md:108](https://github.com/SethRobinson/Patchy/blob/b813774/docs/performance.md#L108)) | Márgenes de FX hechos (entrega 4) | Ya hecho | — | — |
| Recalcular | Solo lo afectado; la LUT evita el trabajo por píxel en ajustes separables | Recalcula `below` si cambia su versión | Ver idea 5 | — | — |

### 3.5 Herramientas avanzadas

| Aspecto | Patchy | OGS hoy | Adoptar | Dificultad TS / Rust | Recurso |
|---|---|---|---|---|---|
| Selección | Selección IA en CPU (`0092537`, ONNX int8); "Select Subject" retenido por revisión de patentes (`fb15c97`) | Selección sin IA (no verificado en el repo de OGS) | No: depende de modelos y licencias | — | RAM/disco |
| Transformación | Vista previa de transformación libre con proxy ([performance.md:42](https://github.com/SethRobinson/Patchy/blob/b813774/docs/performance.md#L42)) | No verificado | Ver idea 3 | — | RAM |
| Pinceles | Motor en `canvas_widget_brush.cpp` (2 975 líneas); pruebas en `tests/core/brush_engine_tests.cpp`. Detalle no leído | Estampado en JS, máscara por trazo (`brushEngine.ts`) | No evaluado en detalle | — | — |
| Texto | Motor de bloques de texto, bloques heredados Txt2 (`93e4a74`) | Sin texto nativo en el alcance de OGS | No aplica | — | — |
| Vectores | Motor de formas y trazados; ediciones invalidan solo su rectángulo ([performance.md:108](https://github.com/SethRobinson/Patchy/blob/b813774/docs/performance.md#L108)) | No es alcance de OGS | Ya cubierto por la idea de invalidar por rectángulo | — | — |
| Deshacer | Historial por bytes con poda de estados antiguos y mínimo de 3 por sesión ([main_window_history.cpp:419](https://github.com/SethRobinson/Patchy/blob/b813774/src/ui/main_window_history.cpp#L419)); máximo 40 estados | Clon de lienzo por edición (`beginEdit`) | **Sí**, ver idea 1 | TS baja / Rust fácil | RAM |

### 3.6 Persistencia y formato de archivo

| Aspecto | Patchy | OGS hoy | Adoptar | Dificultad TS / Rust | Recurso |
|---|---|---|---|---|---|
| Formato nativo | PSD/PSB de lectura y escritura. Regla dura: todo PSD escrito debe abrirse en Photoshop sin avisos ([AGENTS.md:11](https://github.com/SethRobinson/Patchy/blob/b813774/AGENTS.md#L11)). Importador .af de solo lectura ([af-format.md](https://github.com/SethRobinson/Patchy/blob/b813774/docs/af-format.md)) | Formato 2 propio de sesiones en disco y navegador (ADR 0014) | No aplica; sí su regla de compatibilidad verificable | — | disco |
| Escritura segura | Commit `2baa7f9` "Harden file writes and document recovery against crashes and power loss" (título; código no leído) | Sesiones con guardado y ADR 0014 | Sí, revisar cómo OGS escribe (no verificado en Patchy) | TS media / Rust baja | disco |
| Recuperación | `docs/document-recovery.md` (no leído en detalle) | Sesiones separadas | Revisar | — | disco |

### 3.7 Metodología

| Aspecto | Patchy | OGS hoy | Adoptar | Dificultad TS / Rust | Recurso |
|---|---|---|---|---|---|
| Paridad de píxeles | Digests FNV-1a de cada PSD de la corpus, fijados en `test-fixtures/psd/*-digests.txt`. Un cambio de digest significa cambio de render, no de velocidad. Solo se regeneran tras un cambio deliberado ([performance.md:15](https://github.com/SethRobinson/Patchy/blob/b813774/docs/performance.md#L15), [testing.md:32](https://github.com/SethRobinson/Patchy/blob/b813774/docs/testing.md#L32)) | Oráculo de 200 operaciones con tolerancia; resultados contradictorios sin resolver (`render-estado.md`, pendiente 2) | **Sí**, ver idea 4 | TS baja / Rust baja | disco (pequeño) |
| Bancos de rendimiento | `--stress-test=quick\|small\|standard\|huge` con informe; 60 pasos con IDs estables ([performance.md:7](https://github.com/SethRobinson/Patchy/blob/b813774/docs/performance.md#L7)) | Banco de gestos (5 × 3 repeticiones planeado) | Ya similar | — | — |
| Contadores | `RenderCacheDiagnostics` con contadores que los tests comprueban (`move_proxy_previews`, `move_outline_previews`, [performance.md:11](https://github.com/SethRobinson/Patchy/blob/b813774/docs/performance.md#L11)) | Registro de rendimiento (ADR 0012) | Sí: que el test afirme qué ruta se usó | TS baja / Rust baja | RAM |
| Prueba con otros editores | `testy/` (Python, ~9 900 líneas) con controladores para Photoshop, Krita, GIMP, Photopea, Affinity y Photocraft (`testy/drivers/`) | No aplica | No: alcance distinto | — | — |

## 4. Las 5 ideas más rentables para OGS

Orden por rentabilidad frente al riesgo. Todas se pueden medir con el banco actual antes de aprobar.

1. **Presupuesto de historial en bytes, con poda y mínimo de estados.** Patchy aplica RAM/4 acotada a
   512 MB-4 GB y poda el historial más antiguo al superar el presupuesto, conservando al menos 3 estados
   por sesión ([main_window_history.cpp:419](https://github.com/SethRobinson/Patchy/blob/b813774/src/ui/main_window_history.cpp#L419),
   [memory_info.hpp:43](https://github.com/SethRobinson/Patchy/blob/b813774/src/ui/memory_info.hpp#L43)).
   En OGS, `beginEdit` clona el lienzo entero por edición. Encaja con el objetivo de 2 GB y 4 GB de
   `investigacion-memoria.md`. RAM. TS baja, Rust fácil. Riesgo: si se poda un estado que el usuario espera
   deshacer, hay que decirlo en la interfaz (sin `confirm()`, según la memoria de UI del usuario).

2. **Separar revisión de contenido y revisión de render.** Un movimiento puro cambia solo la revisión de
   render, así las máscaras y cachés por píxel siguen calientes
   ([performance.md:30](https://github.com/SethRobinson/Patchy/blob/b813774/docs/performance.md#L30);
   `translate_moved_layer_metadata`). En OGS, `composeMoving` (raster.ts) recompone desde el primer trazo
   movido, y un movimiento de trazo 5 de 300 hace 295 trazos por fotograma. Con revisiones separadas, las
   cachés de máscaras de trazo y `below` sobreviven al movimiento. RAM. TS media (requiere disciplina: leer
   sin mutar; Patchy documenta que cualquier acceso mutable invalida todo). Rust baja: el tipo de solo
   lectura lo impone. Probar con un registro de invalidaciones como `PATCHY_REV_TRACE`.

3. **Previsualización de arrastre desde un proxy, con refresco completo asíncrono.** Patchy arrastra con un
   proxy trasladado y, si no basta, con un contorno punteado; un manejador de arrastre no recompone nunca de
   forma síncrona ([performance.md:42](https://github.com/SethRobinson/Patchy/blob/b813774/docs/performance.md#L42),
   [interactive-previews.md](https://github.com/SethRobinson/Patchy/blob/b813774/docs/interactive-previews.md)).
   Es la prioridad de fluidez del usuario: la UI que se vuelve lenta con el uso es el fallo principal. RAM (un snapshot).
   TS media (workers para el refresco completo). Rust media.

4. **Digest determinista por fixture como guardián de regresión.** Patchy compara FNV-1a de la composición
   de cada PSD de la corpus, y un cambio de digest significa que cambió el render, no solo la velocidad
   ([performance.md:15](https://github.com/SethRobinson/Patchy/blob/b813774/docs/performance.md#L15)). Esto
   resuelve el problema de OGS hoy: el oráculo de 200 operaciones tiene dos resultados contradictorios
   (`render-estado.md`, pendiente 2) y no hay un criterio único de cuál vale. Coste: pocos bytes en disco,
   sin RAM extra. TS baja, Rust baja. Antes de implementarlo, decidir la semilla y la tolerancia por escrito.

5. **Tabla de búsqueda de 256 entradas para ajustes separables.** Niveles, curvas y balance de color se
   componen con LUT exactas de 256 entradas (`build_adjustment_lut`,
   [performance.md:30](https://github.com/SethRobinson/Patchy/blob/b813774/docs/performance.md#L30)); tono y
   saturación siguen por píxel. OGS tiene niveles, curvas y color por píxel (arquitectura §3). Coste bajo,
   reduce CPU por fotograma en esos ajustes. Cuidado: la LUT cambia el resultado de 8 bits frente al cálculo
   por píxel, así que hay que regenerar el digest de la idea 4 de forma deliberada. RAM mínima (256 entradas
   por canal). TS baja, Rust fácil.

Quedan fuera del top 5 a propósito: la composición en GPU (Patchy la descarta, y OGS aún no ha probado el
motor), el volcado a disco de mosaicos (ya está en la idea de ADR 0015) y la copia de todo el documento al
deshacer (es un problema que Patchy tiene, no un modelo a seguir).

## 5. Lo que no se ha comprobado

- No se compiló ni ejecutó Patchy. No hay cifras de Patchy: sus cifras de rendimiento están en su
  documentación y no se reprodujeron.
- No se leyó el código de `canvas_widget_brush.cpp`, de la selección, de los vectores ni de la recuperación
  de documentos. Las menciones a ellos vienen del título del commit o del índice de `docs/`.
- `TileCache` (`src/render/tile_cache.hpp`) parece sin uso fuera de su archivo, según un grep. No se
  verificó en los tests ni en la compilación.
- No se midió la latencia real del pincel en Patchy ni en OGS.
- No se comprobó la atomicidad de escritura de Patchy (solo el título del commit `2baa7f9`).
- La atribución de IA en Patchy es probable (por AGENTS.md), pero no está demostrada: los 50 commits del
  clon no tienen trailers y las reglas prohíben escribirlos.
- Los números de OGS (2 057 MB en 2048², historial de 1 200 MB) vienen de sus notas y no se re-midieron.
- Las citas de OGS son de sus documentos a 2026-10-13. `arquitectura-render.md` §2 está desactualizado
  respecto a §6 (ver resumen).
- No se revisó la licencia de dependencias de Patchy (`NOTICE-THIRD-PARTY.md`); sí es MIT el código propio.
  Ninguna idea de este informe copia código: son patrones de diseño.

# Arquitectura de render profesional para el Designer (2026-10-12; estado al 2026-10-13)

Investigación de cómo resuelven el problema los editores profesionales y qué significa para OGS. Fuentes primarias enlazadas; el estado de OGS en las secciones 2 a 5 se leyó en el código de `9c061f8` el 2026-10-12. Las secciones 3 a 5 son la propuesta original. **El estado actual de cada tarea está en la sección 6.**

**Nota de cambio de rumbo.**
- **2026-10-12:** el usuario aprobó los cinco puntos en TypeScript sobre Canvas2D (no sobre un motor nuevo). La composición retenida se hace primero sobre Canvas2D y el motor se decide después. Los cinco puntos no constan en este documento; el usuario los comunicó en la sesión.
- **2026-10-13:** el usuario autorizó el plan único de 6 entregas ([plan-fluidez.md](plan-fluidez.md)). Sustituye la secuencia de tareas de la sección 5 para la ejecución; la tabla de la sección 6 recoge el resultado.

**Requisito de producto:** varias carpetas, ~1 capa por personaje y por localización, muchas capas de ajuste y filtro, raster y vector combinados, lienzos de 1K–2K, cientos o miles de trazos. Diseñar sin esperas.

## 1. Qué hacen los profesionales (comprobado)

| Técnica | Quién | Evidencia |
|---|---|---|
| **Píxeles y composición en la GPU.** Cada capa es una textura; los modos de fusión, máscaras y estilos son shaders. | Photopea, Figma, pixiv Sketch, Procreate | Photopea 1.3: redibujar 2048×1152 con 10 capas completas y 3 efectos pasó de **850 ms a 55 ms** al llevar capas y fusión a WebGL ([blog](https://blog.photopea.com/photopea-1-3.html)); su autor: sin GPU no se puede redibujar a 60 fps al mover una capa ([AMA](https://gigazine.net/gsc_news/en/20181111-photopea-developer-ask-question)). Figma: motor por mosaicos en GPU, WebGL y ahora WebGPU ([2017](https://www.figma.com/blog/building-a-professional-design-tool-on-the-web/), [WebGPU](https://www.figma.com/blog/figma-rendering-powered-by-webgpu/)). Procreate: motor Silica M sobre Metal ([Procreate 4](https://procreate.com/insight/2017/meet-procreate-4)). |
| **Pinceles estampados en la GPU.** Cada «dab» es un punto con shader de dureza, presión y textura. | pixiv Sketch, Wacom SDK, glbrush.js | pixiv pasó de 1 a 7 pinceles al dejar Canvas2D por WebGL con point sprites ([web.dev](https://web.dev/case-studies/pixiv)); [Wacom BrushGL](https://developer-docs.wacom.com/docs/sdk-for-ink/api/digital-ink-web/Rendering.WebGL.BrushGL); [glbrush.js](https://github.com/Oletus/glbrush.js) (WebGL + respaldo Canvas2D, deshacer ilimitado). Motor de pinceles de MyPaint en wasm: [Hokusai](https://docs.rs/crate/hokusai/0.1.0). |
| **Proyecciones retenidas + propagación de regiones sucias.** Cada grupo guarda su resultado; un cambio sube por el árbol como rectángulo, y cada filtro declara qué entrada necesita (`needRect`) y qué salida invalida (`changeRect`). | Krita, GIMP/GEGL | Krita: [KisUpdateScheduler](https://github.com/KDE/krita/blob/69a4ea48fa88c136c1166eb59dddf894c149d9f8/libs/image/kis_update_scheduler.h#L118), [walkers](https://github.com/KDE/krita/blob/69a4ea48fa88c136c1166eb59dddf894c149d9f8/libs/image/kis_base_rects_walker.h), [redisplay](https://community.kde.org/Krita/redisplay). GEGL: `get_required_for_output` / `get_invalidated_by_change`, que un blur amplía por su radio ([API](https://gegl.org/gegl-operation.h.html)). Inkscape: [DrawingCache](https://inkscape.gitlab.io/inkscape/doxygen/classInkscape_1_1DrawingCache.html). |
| **Mosaicos con copia al escribir para deshacer.** El deshacer guarda solo los mosaicos tocados; los demás se comparten. Con presupuesto: comprimir o volcar a disco. | Krita, GIMP | Krita: mosaicos de 64×64 creados bajo demanda, «mementos» por mosaico para deshacer, compresión y swap ([kis_tiled_data_manager.h](https://lxr.kde.org/source/graphics/krita/libs/image/tiles3/kis_tiled_data_manager.h), [kis_memento_manager.cc](https://lxr.kde.org/source/graphics/krita/libs/image/tiles3/kis_memento_manager.cc)). GEGL: [Buffer.dup](https://developer.gimp.org/api/gegl/method.Buffer.dup.html). |
| **Trazos raster destructivos; lo editable es vectorial.** | Krita, Fresco | Krita pinta directo en mosaicos y deshace por mementos (arriba). Fresco separa pinceles de píxel, vivos y vectoriales ([pixel](https://helpx.adobe.com/fresco/using/pixel-brushes.html), [live](https://helpx.adobe.com/fresco/using/live-brushes.html)). |
| **Vista previa a menor resolución** con pinceles grandes en lienzos grandes; el trazo completo se calcula detrás. | Krita | [Instant Preview](https://docs.krita.org/Instant_Preview) (antes «LOD»). Ayuda poco a tamaño 1:1. |

**Consecuencia para tu límite raster:** es coherente con la práctica revisada, no un parche. En Krita el trazo raster va directo a los píxeles y lo editable son las capas vectoriales; Fresco separa pinceles de píxel y vectoriales. OGS ofrece más (trazos raster editables hasta el límite) y después hace lo mismo que ellos: integrarlos en píxeles.

## 2. Qué hace OGS hoy (código)

| Punto | Hoy | Coste |
|---|---|---|
| Página | `drawDoc` ([render.ts:356](../src/engine/design/render.ts)) redibuja **todas** las capas en cada fotograma; los vectores se vuelven a rasterizar cada vez. No hay resultado de página retenido. | Proporcional al documento entero, aunque solo cambie una mano. |
| FX | Con FX se crea un lienzo de página nuevo por fotograma (`drawWithFx`). FX de capa: caché por versión (bien). FX «→ todo lo inferior» (`below`): caché por claves de versión (`belowFxCache.ts`, commits `7da0a51` y `ae0aa2e`); se recalcula solo si cambia una entrada de la clave. *(Corregido 2026-10-13: antes decía que no había caché.)* | Cada capa de ajuste multiplica el coste de cada fotograma. |
| Pinceles con punta | Máscara por trazo calculada píxel a píxel en JavaScript ([stampSegment](../src/engine/design/brushEngine.ts)); caché LRU de 128 máscaras / 16 Mpx ([rasterStrokeMask.ts](../src/engine/design/rasterStrokeMask.ts)). | Si cada fotograma recorre en orden más máscaras de las que caben (p. ej. mover un trazo temprano de 300), la caché se vacía en cada pasada y todas se recalculan. Tener 129 trazos no basta para que ocurra. |
| Mover trazos | `composeMoving` ([raster.ts](../src/engine/design/raster.ts)) redibuja desde el primer trazo movido hasta el final, cada fotograma. | Mover el trazo 5 de 300 = 295 trazos por fotograma. |
| Deshacer raster | El historial conserva referencias a los lienzos; `beginEdit` clona el lienzo entero al empezar cada edición para no alterar el que guarda el historial. | Memoria y copia proporcionales a ediciones × tamaño de página. Los mosaicos sustituirían esa copia completa por la de los mosaicos tocados. |
| Carpetas | Solo un nombre sobre capas ([groups.ts](../src/engine/design/groups.ts)): sin composición, FX ni fusión propios. | — |

Lo que ya está bien y se conserva: fusión según W3C Compositing, plan de FX (`fxPlan`), versiones de buffers, caché de FX por capa, trazo en vivo que recompone solo la zona del segmento (estilo SAI), límites de cajas de trazos.

## 3. Arquitectura objetivo

1. **Núcleo de composición en GPU.** Capas como texturas; fusión W3C, opacidad, máscaras y FX (blur, sombra, niveles, curvas, color) como shaders. La página final se retiene; un fotograma sin cambios no compone nada. Es el paso de Photopea (850 → 55 ms).
2. **Grafo de invalidación (Krita/GEGL).** Cada capa: versión de contenido, textura propia y textura con sus FX. Cada FX declara su margen (blur, sombra) para ampliar la región. Un cambio invalida la capa, sus FX y lo que depende de ella (FX `below` por encima); el resto se reutiliza. Si las carpetas reciben fusión o FX, tendrán su proyección del mismo modo.
3. **Raster:** trazos editables con el **límite acordado** (plan-fluidez, etapa 3), dentro de la capacidad de las cachés; al llegar, se integran en la base. Pinceles estampados en la GPU (point sprites, como pixiv), con las mismas reglas de punta, densidad, Keep Opacity y borrador. Mover un trazo: puntos de control cada K trazos y redibujo solo de la región afectada.
4. **Mosaicos con copia al escribir** para deshacer y para la base raster: el deshacer guarda los mosaicos tocados. Presupuesto global de memoria que descarta solo lo regenerable (cachés), nunca el dibujo ni el historial.
5. **Fuera del hilo de interacción:** codificar PNG por trazo, exportar e integrar trazos van a workers/OffscreenCanvas; resultados con versión, los antiguos se descartan.
6. **Opcional:** vista previa a menor resolución para pinceles muy grandes (Instant Preview de Krita).

Los contratos no cambian: trazos editables hasta el límite, orden, borrador, Keep Opacity, fusión, deshacer, guardado, exportación idéntica.

**Investigación de un editor Rust+wasm (solo lectura):** [investigacion-photocraft.md](investigacion-photocraft.md). Los cambios sin wasm ni GPU que propone (historial en bytes, proxies de zoom, página retenida por región) son independientes de la prueba de motor.

## 4. Motor: decisión antes de construir

La composición incremental (puntos 1–3) depende del motor; por eso el motor se decide **primero**.

| Opción | A favor | En contra |
|---|---|---|
| **WebGL2 propio** (lo que hicieron Photopea y pixiv) | Control total de la fusión W3C y los pinceles; sin dependencias pesadas; WebGPU después, como Figma. | Más código propio: fusión, filtros, gestión de texturas. |
| **CanvasKit (Skia en wasm)** | Mismo motor que el Canvas2D de Chrome, con rutas, texto, modos de fusión y filtros de imagen sobre superficie WebGL. Renderer de Flutter web en producción ([Flutter](https://github.com/flutter/flutter/blob/master/engine/src/flutter/lib/web_ui/README.md)). | Descarga real por medir: el paquete npm (`canvaskit-wasm` 0.42.0) ocupa 26 MB sin comprimir, pero cuenta lo desplegado y comprimido. Los pinceles con punta igualmente son shaders o código propios. |
| **PixiJS 8** | Texturas, filtros y WebGPU listos. | Su modelo de escena no reproduce nuestras reglas de pincel/borrador; fusión W3C exacta por verificar. |

**Resultado de la prueba de motor (sin decisión todavía):** [decision-motor.md](decision-motor.md). Ningún motor queda validado en píxeles ni medido bajo el tope de memoria.

**Prueba de decisión (acotada):** el mismo documento sintético (10 personajes, 3 localizaciones, 10 capas de ajuste, 2048×2048, vector y raster) compuesto con Canvas2D actual, WebGL2 propio y CanvasKit. Cada motor implementa el recorrido completo (pintura con punta, composición con fusión W3C, vectores, FX de capa y `below` superpuestos, carpetas, y el límite raster: capa que llega al límite se aplana y sigue en píxeles; capa nueva con trazos editables); nunca una demo pequeña de GPU contra la app entera. GPU no implica fluidez (Figma tuvo que adaptar su motor para que WebGPU no empeorara): se registra el renderer WebGL y se descarta una medida sin aceleración real (SwiftShader/software). Criterios: tiempo por fotograma al pintar, mover, ocultar y ajustar; diferencia de píxeles frente a la exportación actual; memoria; descarga desplegada y comprimida. Termina en una decisión escrita con cifras, no en otra propuesta.

## 5. Objetivo y tareas

**Objetivo:** con el documento profesional anterior y miles de trazos, pintar, mover, ocultar y ajustar cumplen los umbrales de [plan-fluidez](plan-fluidez.md) (≤ 8 ms por fotograma p95, 0 tareas > 50 ms), con píxeles y contratos conservados.

| # | Tarea | Hecho cuando |
|---|---|---|
| 1 | Documento profesional sintético en el banco del sandbox y cifras de partida con Canvas2D | Cifras de mover, pintar, ocultar y ajustar en ese documento |
| 2 | Prueba de motor (sección 4) | Decisión documentada con las cifras |
| 3 | Núcleo de composición en GPU + página retenida | Mismos píxeles que la exportación (tolerancia fijada); ocultar o mover una capa no recompone las demás |
| 4 | Grafo de invalidación, márgenes de FX y caché de FX `below` | **Parcial.** Márgenes de FX, caché de `below` con presupuesto y revisión de dibujo separada (`793f94d`) hechos; el grafo completo no. Paridad en navegador pendiente. | `4e25877`, `2427ddb`, `7a9e88c`, `7da0a51`, `ae0aa2e`, `793f94d` |
| 5 | Límite raster (etapa 3 acordada) + pinceles en GPU | Mismos píxeles al integrar; deshacer en un paso; sin recálculo de máscaras dentro del límite |
| 6 | Mosaicos con copia al escribir para deshacer + presupuesto de memoria | Memoria del historial proporcional a lo pintado, no a la página |
| 7 | PNG, exportar e integrar en workers | 0 tareas > 50 ms al soltar el trazo |
| 8 | Verificación con gestos reales (agente verificador) y prueba del usuario | Umbrales cumplidos en el documento profesional |

**Resultado de la tarea 1:** [cifras de partida](render-baseline.md) (2026-10-12). Ningún gesto cumple los umbrales en el documento profesional; mover un trazo temprano de la capa de 300 es el peor (unos 550 ms por fotograma). Las cifras incluyen un guardado grande del sandbox, pendiente de separar con una medida limpia.

Cada tarea requiere aprobación antes de implementarse (AGENTS.md); la 5 además la autorización propia de la etapa 3. Esta dirección enmienda la regla de plan-fluidez «arquitectura solo si la medida muestra cálculo pesado»: la evidencia externa (Photopea) y el código (todo se recompone cada fotograma) ya la justifican, y la tarea 1 la confirma en OGS.

## 6. Estado de las 8 tareas (2026-10-13)

Estado a fecha del cierre del track; los pendientes completos están en [render-estado.md](render-estado.md). Commits de la rama `task/render-bench`; la atribución de cada commit está en esa misma nota.

| # | Tarea | Estado | Commits clave |
|---|---|---|---|
| 1 | Documento profesional sintético y cifras de partida con Canvas2D | **Parcial.** Medido el 2026-10-12, con el guardado grande del sandbox sin separar; A/B a 1024² pendiente. | `42a09b8`, `e2fa658`, `e68e83f` |
| 2 | Prueba de motor | **Aplazada por decisión del usuario** (Canvas2D con página retenida primero). Sin recomendación en [decision-motor.md](decision-motor.md). | `26c7dc6`, `4e238f8` |
| 3 | Núcleo de composición en GPU y página retenida | **Parcial.** Hay página retenida con regiones sobre Canvas2D (no el núcleo GPU). Paridad en navegador pendiente. | `4e25877`, `6acc817`, `d4c0814`, `fc61510`, `c34b91a`, `08f1748`, `a423862`, `4503594` |
| 4 | Grafo de invalidación, márgenes de FX y caché de FX `below` | **Parcial.** Márgenes de FX y caché de `below` hechos; el grafo completo no. Paridad en navegador pendiente. | `4e25877`, `2427ddb`, `7a9e88c`, `7da0a51`, `ae0aa2e` |
| 5 | Límite raster y pinceles en GPU | **Parcial.** Límite provisional (64 trazos / 8192 segmentos) y prueba de píxeles en Canvas real. Pinceles en GPU no hechos; comprobación visual pendiente. | `4bd93cd`, `2f44d74`, `2039485`, `ae0aa2e` |
| 6 | Mosaicos con copia al escribir y presupuesto de memoria | **Parcial.** Presupuesto en bytes y historial en mosaicos 64² en memoria. Guardado por mosaicos y ADR 0015 pendientes. | `b76835c`, `29c9fc9`, `79bf595` |
| 7 | PNG, exportar e integrar en workers | **Parcial / descartado en parte.** Encoder en worker existe pero desactivado; las tres rutas no dieron paridad. | `5ae9851`, `95e6634`, `7ad9c17`, `89bb605` |
| 8 | Verificación con gestos reales y prueba del usuario | **Pendiente.** | — |

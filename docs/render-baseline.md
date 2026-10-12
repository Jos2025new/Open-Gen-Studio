# Cifras de partida: documento profesional con Canvas2D (Tarea 1)

Fecha: 2026-10-12. Rama `task/render-bench`. Medido en el sandbox (build de producción, puerto 5183, `.sandbox/data`). Es la tarea 1 de [arquitectura-render.md](arquitectura-render.md), sección 5. Umbrales: [plan-fluidez.md](plan-fluidez.md) (≤ 8 ms de trabajo por fotograma p95, 0 tareas > 50 ms).

## Resumen

- **Ningún gesto cumple los umbrales.** Mover un trazo temprano de la capa de 300 es el peor: cada evento tarda unos 550 ms de trabajo por fotograma y el arrastre de 60 movimientos termina en unos 40 s (en lugar de ~1 s).
- **Pintar (a):** trabajo por fotograma p95 de 23 a 44 ms y 3 tareas largas por repetición (hasta 663 ms).
- **Mover una capa entera (c):** el trabajo medido por fotograma es bajo (p95 13–19 ms), pero hay 21–29 tareas largas por repetición (hasta 1,7 s) y la latencia de evento llega a 4,5–6,2 s. Ese coste está fuera de lo que mide la sonda.
- **Ocultar/mostrar carpeta (d) y parámetro de ajuste `below` (e):** el trabajo medido por fotograma es casi cero, pero cada acción produce una tarea larga de 89–147 ms **fuera de la sonda**. Un trabajo por fotograma cercano a cero no significa coste cercano a cero.
- **Reserva principal:** el estado del sandbox contenía seis copias del documento profesional (`state.json` de 30 MB). Cada cambio guarda el estado completo, así que estas cifras **incluyen un guardado grande** que no se ha separado. La medida limpia requiere limpiar las sesiones del banco, lo que necesita aprobación (ver «Pendiente»).

## Máquina, navegador y renderer

| Dato | Valor |
|---|---|
| Máquina | 4 núcleos lógicos, 7,6 GB de RAM, Linux 7.0.0-38 |
| Renderer WebGL | `ANGLE (Intel, Mesa Intel(R) Graphics (ADL GT2), OpenGL 4.6)`, vendor Google (Intel). **Hardware, no SwiftShader ni software:** las medidas son válidas. |
| Navegador | Brave (Chromium 155), con ventana (`--headed`), sesión aislada `ogs-render-bench` |
| Backend de ventana | X11 (`--args "--ozone-platform=x11"`). Con Wayland los fotogramas no llegaban a la página (ver «Pasadas descartadas») |
| Ventana y DPR | 1500 × 940, DPR 1, zoom del lienzo 0,365 |
| Build | `npm run dev:sandbox -- --production`, puerto 5183, `.sandbox/data` del worktree |
| Carga y memoria | Antes de la pasada válida: carga 5,5; 2,9 GB disponibles. Durante la pasada la carga llegó a ~6,5 (la misma sesión de medida, no otro proceso). |

## El documento medido

Generado por [designerBenchProfessional.ts](../src/lib/designerBenchProfessional.ts) (semilla fija 20261012, ids fijos; prueba en [designer-bench-professional.test.ts](../tests/designer-bench-professional.test.ts)).

- Lienzo 2048 × 2048; **26 capas** en **4 carpetas**: Escenario, Personajes, Ajustes, Vectores.
- **13 capas raster:** 3 de localización (60, 40 y 120 trazos) y 10 de personaje. Personaje 1 tiene **300 trazos largos** de 120 segmentos cada uno. Los demás tienen entre 40 y 120 trazos. Total: **1 240 trazos raster**, cada uno con punta editable (dureza, textura, fusión, mantener opacidad).
- **3 capas vectoriales** con **36 formas**: títulos (14) y viñetas (18) en la franja derecha, y «Sello» (4) en la esquina inferior derecha.
- **10 capas FX:** 6 de alcance `below` (niveles, desenfoque, curvas, saturación, tono, sombra) y 4 de alcance `layer` (sombra, brillo, niveles y desenfoque sobre un personaje).
- Tamaño de estado: unos 5 MB de JSON por documento (estimación: 30 MB / 6 documentos).

## Gestos y método

Sonda: [designerBenchProfessionalRun.ts](../src/lib/designerBenchProfessionalRun.ts), sobre `window.__OGS_BENCH__` (solo puerto 5183). Eventos sintéticos de puntero a 60 Hz (como [designerBench.ts](../src/lib/designerBench.ts)), tres repeticiones por gesto.

- **Trabajo por fotograma:** suma de los intervalos de callbacks de `requestAnimationFrame` y de manejadores sincrónicos dentro de cada fotograma activo. Es una cota inferior del trabajo del hilo principal, no CPU total. Ventana activa: desde el inicio del gesto hasta 300 ms después de su última acción.
- **Tareas largas:** entradas `longtask` (siempre ≥ 50 ms) en el gesto y el segundo posterior.
- **Latencia de evento:** `queue` = entrega − previsto; `siguiente RAF` = tiempo hasta el siguiente fotograma. Es un proxy, no el píxel visible.

Sustituciones honestas respecto del plan:
- **(a)** Pintar un trazo sobre Personaje 2 con la herramienta Pincel (arrastre de 60 movimientos).
- **(b)** Mover el trazo 40, 41 y 42 de la capa de 300 (modo Objetos). Se comprueba que el puntero lo recoge; si no, la repetición se aborta.
- **(c)** Mover la capa vectorial «Sello» entera (modo Capas). No es una capa raster de personaje; el punto de pulsación se comprueba antes de medir (no hay píxeles de otra capa encima).
- **(d)** Clic real en el botón de ojo de la carpeta «Personajes» (14 capas), ocultar y mostrar, con 300 ms de espera entre ambos.
- **(e)** Cambio de `midtones` de la curva `below` mediante `runFx` (el mismo comando del panel de capas), no con el deslizador. Valores 0,45, 0,55 y 0,40.

## Resultados (pasada válida, tres repeticiones por gesto)

Cada celda muestra las tres repeticiones, en el orden r1 / r2 / r3.

| Gesto | Duración de la acción (ms) | Fotogramas activos | Trabajo p50 (ms) | Trabajo p95 (ms) | Trabajo máx (ms) | Fotogramas > 8 ms | Tareas > 50 ms | Tarea máx (ms) | Cola de evento p95 (ms) | Siguiente RAF p95 (ms) |
|---|---|---|---|---|---|---|---|---|---|---|
| a. Pintar trazo (personaje) | 1 109 / 1 085 / 1 073 | 21 / 19 / 17 | 7,5 / 6,9 / 6,3 | 23,0 / 37,5 / 43,8 | 24,5 / 37,5 / 43,8 | 8 / 9 / 8 | 3 / 3 / 3 | 296 / 663 / 420 | 21,8 / 16,2 / 17,4 | 122 / 131 / 191 |
| b. Mover trazo temprano (300) | 42 520 / 43 479 / 40 559 | 104 / 100 / 91 | 546,7 / 571,1 / 531,8 | 798,8 / 841,6 / 903,2 | 1 126,9 / 1 121,1 / 1 061,4 | 56 / 57 / 56 | 66 / 66 / 65 | 1 152 / 1 133 / 1 089 | 38 885 / 40 223 / 36 847 | 39 574 / 40 785 / 37 354 |
| c. Mover capa entera («Sello») | 7 644 / 6 484 / 9 547 | 52 / 57 / 49 | 2,6 / 3,1 / 3,6 | 13,3 / 18,3 / 19,0 | 50,2 / 40,8 / 95,8 | 13 / 14 / 10 | 21 / 29 / 26 | 978 / 828 / 1 715 | 6 084 / 4 530 / 6 242 | 6 461 / 5 248 / 7 725 |
| d. Ocultar/mostrar carpeta | 336 / 324 / 321 | 32 / 32 / 30 | 0 / 0 / 0 | 0,8 / 0,2 / 0,2 | 1,0 / 0,8 / 1,2 | 0 / 0 / 0 | 1 / 1 / 1 | 96 / 112 / 100 | 0 / 0 / 0 | 42 / 26 / 30 |
| e. Parámetro de ajuste `below` | 28 / 15 / 12 | 17 / 18 / 17 | 0,1 / 0,1 / 0 | 1,1 / 0,2 / 0,1 | 1,1 / 0,2 / 0,1 | 0 / 0 / 0 | 1 / 1 / 1 | 147 / 124 / 89 | 0 / 0 / 0 | 29 / 19 / 17 |

Lectura:
- **b** es el cuello de botella más claro: 56 de cada 100 fotogramas superan 8 ms, con 65–66 tareas largas por repetición. Los 60 movimientos se procesan en unos 40 s (unos 2,4 fotogramas por segundo). Es coherente con redibujar desde el trazo movido hasta el final (`composeMoving`), pero **no se ha atribuido con una traza**.
- **a** supera el p95 de 8 ms y tiene tareas largas de hasta 663 ms.
- **c** tiene poco trabajo medido dentro de los fotogramas y mucho fuera de la sonda: 21–29 tareas largas por repetición. Un candidato es el guardado del estado en cada movimiento, pero **no está verificado**.
- **d** y **e** muestran una tarea larga por acción (89–147 ms) y trabajo medido casi nulo. Esa tarea ocurre fuera de RAF y de los manejadores, así que la sonda no la mide. Se asocia al guardado de los 30 MB de estado, pero **no está verificado**.

## Pasadas descartadas

1. **Wayland, primera pasada:** los fotogramas no llegaban a la página (`requestAnimationFrame` = 0 durante 2–5 s tras cada carga). Los temporizadores se retrasaron. Sin cifras válidas.
2. **Wayland, segunda pasada:** 0 fotogramas en todas las repeticiones. Descartada.
3. **X11, dos intentos sin resultado:** en el primero, sin foco, los fotogramas bajaron a 1–10 por segundo. En el segundo, con la ventana enfocada, la carga del equipo superó 10 por procesos de navegador de sesiones anteriores del propio banco. Ambos se cerraron sin contabilizar. La medida válida se hizo con la ventana enfocada (`xdotool windowactivate`) y la cadencia comprobada (≈ 60 Hz) antes de medir.

## Lo que no se midió y por qué

- **Píxel visible (latencia de puntero a pantalla):** no medido. No hay cámara y el «siguiente RAF» es solo un proxy.
- **Trabajo fuera de RAF y de manejadores** (tareas largas de c, d y e): no atribuido. La sonda no lo cubre; hace falta la traza (`__OGS_TRACE__`) o el perfil nativo.
- **Tiempo de GPU:** no medido (sin consultas de temporizador de GPU).
- **Memoria:** no medida en esta pasada (memoria del historial y de texturas).
- **Caso habitual** (el documento del usuario): no medido. No forma parte de la tarea 1, y el sandbox de este worktree no tiene ese documento.
- **Medida limpia** sin las seis sesiones acumuladas: no medida. Requiere borrar las sesiones del banco en `.sandbox/data`, y AGENTS.md exige aprobación explícita para cualquier borrado.

## Causas (perfil de CPU, tarea 1b)

**Método.** Perfil de CPU con `agent-browser profiler` sobre el sandbox de producción con sourcemaps (`sourcemap: true`, solo en el build del sandbox). Una repetición por gesto (b, c, d, e). Cada muestra se mapea con los sourcemaps del build a archivo:línea de `src/`. Los porcentajes son **inclusivos**: una muestra cuenta en cada categoría de su pila, así que no suman 100 %. El perfilador multiplica el coste: las proporciones sirven; los milisegundos, solo de orientación. Estado: 7 sesiones y `state.json` de 30 MB (sin limpiar; ver «Pendiente»).

| Gesto | Causa | Evidencia (función, archivo:línea, ms o %) | Arreglo propuesto |
|---|---|---|---|
| b. Mover trazo temprano (300) | **1. Recomposición de todos los trazos desde el movido** en cada evento. `composeMoving` redibuja ~260 trazos por movimiento | `drawRasterStroke` (raster.ts:105) y `drawTipStroke` (raster.ts:132): 79 % inclusivo | Recomponer solo la región de los trazos movidos y reutilizar la base y los trazos anteriores (plan, etapa 3: límite raster y grafo de invalidación) |
| b | **2. Máscaras de trazo reconstruidas en cada cuadro.** La caché LRU tiene 128 entradas y el recorrido toca ~260 trazos: en un recorrido cíclico cada búsqueda falla | `rasterStrokeMask` (rasterStrokeMask.ts:15): 15,6 s inclusivos (43 %). Dentro, `stampSegment` (brushEngine.ts:147) 10,9 s propios y `putImageData` 3,1 s | Guardar la máscara en el propio trazo (es inmutable al terminar) o una caché por bytes sin límite de entradas; no rehacer el estampado |
| b | **3. Composición del trazo sobre el lienzo de trabajo.** `ctx.restore()` concentra el tiempo de cada trazo al componer su máscara | `layMask` (raster.ts:142): `restore` 12,4 s propios | Componer la región con una sola operación o en GPU (WebGL, tarea 3); medir de nuevo |
| b | **4. Lectura de GPU al pulsar.** La prueba de acierto lee píxeles de la capa | `hitTestPixel` (render.ts:499) → `getImageData` 2,0 s, desde `onPointerDown` (Stage.tsx:620) | Acierto por geometría de los trazos (no por píxeles) o máscara de acierto en caché |
| b | **5. PNG de la capa durante el gesto.** `writeLayer` codifica la capa a PNG en el hilo principal | `writeLayer` (raster.ts:395) → `canvasToBlob` (media.ts:35): 0,49 s | No codificar durante el gesto; llevarlo a un worker (plan, etapa 2) |
| b | Otros: GC, React, serialización | GC 0,86 s (2 %); React 13 % inclusivo; `sessionParts` (persistJson.ts:27) 0,65 s propios (3 %) | Tras los anteriores |
| c. Mover capa entera | **1. Redibujo de toda la página en cada movimiento** (la capa movida está arriba y el resto se vuelve a dibujar) | `drawDoc` (render.ts:356) → `drawWithFx` (render.ts:428), llamado desde Stage.tsx:372: 73 % inclusivo | Caché de la página retenida y recomposición solo de la zona de la capa (plan, etapa 3 y 4) |
| c | **2. Pasadas FX `below` sobre la página completa, en cada fotograma.** Cada pasada crea un canvas nuevo y aplica un filtro de página completa | `applyFx`/`mixFx` (canvas.ts:141/152): 31 % inclusivo. `draw` (canvas.ts:109): `drawImage` 18,2 s; `getContext` 3,4 s propios | Caché del resultado de cada FX `below` mientras su entrada no cambie (plan, etapa 4) y reutilizar canvas (pool) |
| c | **3. Serialización del estado en cada cambio.** | `sessionParts` (persistJson.ts:27) 3,7 s propios (7 % inclusivo) | Serializar solo la sesión que cambió (ADR 0014) |
| c | GC 1,7 s (2 %) | — | Reutilizar buffers |
| d. Ocultar/mostrar carpeta | **1. Guardado completo del estado tras el cambio.** Cada guardado diferido serializa las 7 sesiones | `flushWhenIdle` → `writeUnlessPressed` → `flushWrite` (store.ts:287/297/311) → `persistState` (persistJson.ts:45) → `sessionParts` (persistJson.ts:27): 450 ms propios, **52 % de la tarea** | ADR 0014: guardar solo la sesión cambiada; ocultar una carpeta no debe reserializar el resto |
| d | React 31 % inclusivo; dibujo 12 % | `drawDoc` 0,13 s inclusivos | Tras el guardado |
| e. Parámetro de ajuste `below` | **1. Guardado completo tras el cambio** | `sessionParts` 92 ms propios; `persistState` 28 % inclusivo | Igual que d |
| e | **2. React y dibujo** | React 39 % inclusivo (Stage.tsx:296, cierre del componente); `drawDoc` 22 %; pasadas FX 13 % | Memoizar las suscripciones de Stage y de propiedades (plan, etapa 2) |

**Lectura.** En b la causa es de composición: se rehacen todos los trazos y sus máscaras en cada movimiento, con lecturas de GPU. En c la causa es el redibujo completo con FX `below`, que se recalculan en cada fotograma. En d y e la causa dominante es el guardado del estado completo tras cada cambio: el coste escala con el tamaño de todo el estado (30 MB aquí). **Estimación no medida:** con un solo documento profesional (~5 MB) el mismo guardado costaría ~75 ms, según escala lineal; hace falta la medida limpia para confirmarlo.

**Lo no atribuido.** La parte de React en c (86 % inclusivo) incluye el redibujo; no se separa. No hay trazas de GPU: `restore`, `getImageData` y `drawImage` pueden incluir sincronización con la GPU, que no se distingue.

## Etapa A: arreglos y medidas antes/después

Estado de partida: sandbox vacío (una sesión profesional de 4,3 MB; antes el estado tenía 30 MB). Medidas con 10 movimientos en los gestos de arrastre (límite de 5 s por gesto), tres repeticiones, ventana enfocada en X11, renderer Mesa Intel hardware.

**Corrección a la sección «Causas».** El coste de 450 ms que el perfil atribuyó a `sessionParts` en d corresponde a la pasada completa de seguridad (`FULL_EVERY_MS`, cada 30 s), que serializa todas las sesiones. En medidas de d (una repetición por acción) la tarea larga es de 83–112 ms: el guardado normal. Medido en Node: pasada completa con 7 sesiones (30 MB) 523 ms; guardado normal con una sesión cambiada 218 ms, sin cambios 55 ms.

| Arreglo | Gesto | Antes (3 rep.) | Después (3 rep.) | Commit |
|---|---|---|---|---|
| 1. Guardar solo la sesión que cambió (ADR 0014) | d, e | No implementado. El ADR exige un formato de disco y de IndexedDB que las versiones antiguas no leen (PUT legado rechazado), así que se detuvo antes de implementarlo. | — | — |
| 2. Máscaras sin recálculo y acierto sin leer GPU | b (mover trazo, 10 mov.) | Trabajo p50 0,8–3,3 ms; **p95 555–559 ms**; fotogramas > 8 ms: 7–9 de 20–22; tareas > 50 ms: 9–11 (máx. 604–624 ms); cola de evento p95 3,3–4,3 s; duración 3,6–4,5 s | Trabajo p50 0,4–5,7 ms; **p95 21–79 ms**; fotogramas > 8 ms: 2–5 de 9–14; tareas > 50 ms: 5–8 (máx. 104–145 ms); cola p95 0,09–0,71 s; duración 0,44–1,1 s | 066322d |
| 3. Caché de FX `below` | c (mover capa, 10 mov.) | Trabajo p50 0,1–0,2 ms; p95 5,7–14,3 ms; tareas > 50 ms: 3–7 (máx. 211–405 ms); cola p95 136–250 ms | Trabajo p50 0 ms; p95 14–27 ms; tareas > 50 ms: 2–5 (máx. 91–137 ms); cola p95 75–265 ms | 2427ddb |

**Lectura.**
- **Arreglo 2 mejora b de forma clara:** el trabajo por fotograma p95 baja de ~556 ms a 21–79 ms, y la cola de eventos de ~4 s a menos de 0,7 s. **No cumple** el umbral de 8 ms: el coste restante está en la composición de los trazos (`ctx.restore` en `layMask`, raster.ts:142) y en las tareas de guardado fuera de la sonda.
- **Arreglo 3 no mejora c de forma demostrable.** El trabajo por fotograma p95 queda igual o algo mayor (14–27 frente a 6–14 ms) y las tareas largas bajan de 3–7 a 2–5 por repetición. Con tres repeticiones es ruido probable. A zoom 0,365 los FX `below` se calculan sobre lienzos de unos 750 px, así que su coste ya era pequeño en este documento. El commit se conserva por corrección, pero no justifica su coste de mantenimiento por esta medida.
- **Arreglo 1 pendiente de decisión.** Las tareas largas de d y e (83–137 ms) son el guardado normal de la sesión profesional de 4,3 MB, más el commit de React. Un guardado solo de la sesión cambiada reduciría el JSON, pero no el texto unido de 4,3 MB ni el blob; esa parte habría que medirla con el formato 2.

**Medidas de referencia del estado limpio** (sin arreglos, mismo estado que la fila «Antes»): d, tarea larga 83–95 ms por repetición, trabajo p95 0,1–0,4 ms; e, tarea larga 91–137 ms, trabajo p95 0,1–0,2 ms. c con el mismo estado: tareas largas 3–7 por repetición, a diferencia de 21–29 con los 30 MB de la pasada inicial (60 movimientos, no comparable 1:1).

**Incidencias de procedimiento.** Dos medidas empezaron con memoria disponible por debajo de 2,5 GB (2,09 GB en la línea base de b; 2,29 GB en el «antes» de c). La regla exige esperar; no se esperó. Los resultados se anotan con esa reserva. Desde entonces, la espera va dentro de cada comando de medida.

## Pendiente (para decidir)

1. **Sesión reutilizada.** `prepareProfessional` ya reutiliza la sesión existente (una sola) y restaura su contenido; el test del helper pasa. El guardado de la sandbox sigue reserializando todo el estado (ver arreglo 1 de la Etapa A).
2. Verificar la atribución de d y e con una medida limpia (sandbox vacío, una sola sesión).
3. Repetir en una sesión sin procesos ajenos consumiendo CPU (durante el perfil la carga llegó a ~10 por procesos de navegador del propio banco).

## Reproducción

```bash
cd <worktree> && npm run dev:sandbox -- --production     # puerto 5183, .sandbox/data
agent-browser --session ogs-render-bench --headed --executable-path /opt/brave.com/brave/brave \
  --args "--ozone-platform=x11" open 'http://127.0.0.1:5183/?bench=1'
agent-browser --session ogs-render-bench set viewport 1500 940
# Enfocar la ventana (xdotool windowactivate) y comprobar ~60 Hz de requestAnimationFrame antes de medir.
agent-browser --session ogs-render-bench eval 'window.__OGS_BENCH__.prepareProfessional().then(r => JSON.stringify(r))'
# runProfessional tarda más de 30 s: lanzar sin esperar y sondear window.__OGS_PROF__.
agent-browser --session ogs-render-bench eval 'window.__OGS_PROF__ = "pending"; window.__OGS_BENCH__.runProfessional().then(r => { window.__OGS_PROF__ = JSON.stringify(r); })'
agent-browser --session ogs-render-bench close
```

El JSON completo de la pasada válida (todas las repeticiones y metadatos) queda fuera del repositorio.

## Pendiente

- **Etapa C (ADR 0014), en curso.** Hecho: formato 2 en disco (`server/store-v2.js`, con 10 pruebas que incluyen migración con copia previa, escritura de una sola sesión, recarga idéntica, 409, pérdida masiva total y por sesión, PUT legado convertido y vuelta atrás) y en navegador (`ogs-store-v2`, con 4 pruebas: migración, commit de una sola sesión, recarga y disco caído). Pendiente: medidas de d y e antes y después (el «antes» en el worktree `ogs-render-bench-before`: el run de d con tres repeticiones aún no terminó; el navegador con el documento profesional y sus cachés supera el tope de 1800 MB si se encadenan preparación y gestos sin liberar), pruebas de la lista que falten, la vuelta atrás escrita en el ADR 0014, y `npm test` completo.
- **Etapa B en pausa**, a la espera de que el usuario decida entre composición retenida sobre Canvas2D o terminar la comparación de motores.
- El worktree `ogs-render-bench-before` (HEAD separado en `4e238f8`) sigue existiendo para la medida «antes»; se eliminará con `git worktree remove` al terminarla.

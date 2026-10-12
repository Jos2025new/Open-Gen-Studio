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
| Carga y memoria | Antes de la pasada válida: carga 5,5; 2,9 GB disponibles. Durante la pasada la carga llegó a ~6,5: un renderer del navegador personal del usuario consumía CPU. No se tocó. |

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
3. **X11, dos intentos sin resultado:** en el primero, sin foco, los fotogramas bajaron a 1–10 por segundo. En el segundo, con la ventana enfocada, la carga del equipo superó 10 por el navegador personal del usuario. Ambos se cerraron sin contabilizar. La medida válida se hizo con la ventana enfocada (`xdotool windowactivate`) y la cadencia comprobada (≈ 60 Hz) antes de medir.

## Lo que no se midió y por qué

- **Píxel visible (latencia de puntero a pantalla):** no medido. No hay cámara y el «siguiente RAF» es solo un proxy.
- **Trabajo fuera de RAF y de manejadores** (tareas largas de c, d y e): no atribuido. La sonda no lo cubre; hace falta la traza (`__OGS_TRACE__`) o el perfil nativo.
- **Tiempo de GPU:** no medido (sin consultas de temporizador de GPU).
- **Memoria:** no medida en esta pasada (memoria del historial y de texturas).
- **Caso habitual** (el documento del usuario): no medido. No forma parte de la tarea 1, y el sandbox de este worktree no tiene ese documento.
- **Medida limpia** sin las seis sesiones acumuladas: no medida. Requiere borrar las sesiones del banco en `.sandbox/data`, y AGENTS.md exige aprobación explícita para cualquier borrado.

## Pendiente (para decidir)

1. Aprobar la limpieza de las sesiones `Benchmark profesional` creadas por el banco en `.sandbox/data` de este worktree, y repetir la pasada para separar el coste del guardado.
2. Atribuir las tareas largas de c, d y e con la traza (`window.__OGS_TRACE__`, dominios `designer` y `raster`), antes de optimizar. Así se confirma o descarta el guardado.
3. Repetir en otra sesión con la ventana sin ocultar y sin procesos ajenos consumiendo CPU.

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

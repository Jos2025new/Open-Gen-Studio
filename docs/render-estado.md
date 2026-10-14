# Estado de render-bench (cierre del 2026-10-13)

Rama `task/render-bench` (worktree `ogs-render-bench`), HEAD `ab01a02` al cierre de la auditoría y `9ebd8bf` tras las cinco ideas de Patchy (2026-10-13), sin fusionar ni subir. Esta nota es la **fuente única** de lo pendiente del trabajo de rendimiento: el resto de notas de render enlazan aquí. Plan vigente: [plan-fluidez.md](plan-fluidez.md) (plan único del 2026-10-13). Rumbo y tareas originales: [arquitectura-render.md](arquitectura-render.md), sección 6. Investigación de memoria con cifras (4 GB y 2 GB): [investigacion-memoria.md](investigacion-memoria.md). Comparación con el editor de escritorio Patchy y cinco ideas de render: [investigacion-patchy.md](investigacion-patchy.md). Repintado y estructura de sK1 (sin cambios de código): [investigacion-sk1.md](investigacion-sk1.md).

## Cronología de decisiones

- **2026-10-12:** el usuario aprobó los cinco puntos en TypeScript sobre Canvas2D. La composición retenida va primero sobre Canvas2D y el motor se decide después; la comparación de motores queda aplazada. Esta decisión la comunicó el usuario en la sesión de documentación del 2026-10-13; antes de esta nota no constaba en el repositorio.
- **2026-10-13:** el usuario autorizó el plan único de 6 entregas ([plan-fluidez.md](plan-fluidez.md), «Objetivo y aceptación»).
- **2026-10-13:** [ADR 0014](decisions/0014-sesiones-separadas.md) con implementación parcial (formato 2 en disco y navegador, vuelta atrás escrita).

## Estado por entrega del plan único

| # | Entrega | Estado | Commits (asunto) |
|---|---|---|---|
| 1 | PNG raster en worker | **Parcial:** el código existe, pero está desactivado. El guardado usa el encoder Canvas legado porque ninguna ruta en worker dio paridad exacta (tres rutas descartadas, [historial 025](history/025-2026-10-W42.md), entrada 4). | `5ae9851`, `95e6634`, `7ad9c17`, `89bb605` |
| 2 | Zonas sucias por id y cajas por versión | **Hecho** en código y tests. Paridad en navegador **pendiente**. | `6acc817`, `a423862`, `4503594`, `7a9e88c`, `615ab22`, `ae0aa2e` |
| 3 | Pasos vacíos solo en el planificador | **Hecho** (tests). | `7da0a51` |
| 4 | Límite raster con aplanado único | **Parcial:** límite provisional de 64 trazos / 8192 segmentos (no medido). Prueba de píxeles en Canvas real con cuota reducida. Falta comprobación visual de la interfaz. | `4bd93cd`, `2f44d74`, `2039485` |
| 5 | Mosaicos de 64² solo en memoria | **Hecho para el historial** (copia de mosaicos tocados, sin cambiar el guardado). Guardado por mosaicos no hecho: ver ADR 0015. | `79bf595` (sobre `29c9fc9`, presupuesto en bytes) |
| 6 | A/B final (5 gestos × 3 repeticiones a 1024², 2048² si cabe) y prueba del usuario | **Pendiente.** | — |

## Sesión del 2026-10-13 (tarde)

HEAD de la rama: `d2f1a6a` (el registro completo de commits, atribución, decisiones del usuario y retrasos está en [historial 025](history/025-2026-10-W42.md#sesión-del-2026-10-13-en-task-render-bench-commits-5a174cb--d2f1a6a)). Lo que quedó sin confirmar en navegador: paridad de las entregas 2 y 4, clic y arrastre en Object y Layer, PNG en worker (desactivado), A/B final, ADR 0015 para el contenido de las capas, y máscaras de un canal para el objetivo de 4 GB.

## Atribución de los commits del track

Fuente: trailers `Co-Authored-By` de cada commit (`git log 9c061f8..HEAD`). Todos los commits tienen como autor git a Samuel.

| Commits | Trailer | Atribución en el historial 025 |
|---|---|---|
| `42a09b8` … `4443e35`, `65b91da` … `ab01a02` (los que traen trailer) | `Co-Authored-By: Claude Haiku 5.5` | Entradas 1 y 2: Claude. Entradas 3 a 5: GPT y Luna. |
| `c4a611d`, `2039485`, `95e6634`, `615ab22`, `79bf595`, `7da0a51`, `7a9e88c`, `7ad9c17`, `5bf5e34`, `4bd93cd`, `5ae9851`, `dfffd31`, `75c3f7c`, `a5a814b`, `4503594`, `a423862` | sin atribución en el commit | Entradas 4 y 5 (GPT y Luna; Luna y GPT). El historial no asigna cada commit a un autor. |

Ningún commit ni documento del track cita a Claude Opus ni a GPT/Luna en un trailer; esas atribuciones solo constan en el historial 025.

## Cerrado el 2026-10-13 (cinco ideas de Patchy, en código y tests)

Detalle y atribución en [historial 025](history/025-2026-10-W42.md#cinco-ideas-de-patchy-implementadas-en-task-render-bench-2026-10-13-claude-haiku-55); origen en [investigacion-patchy.md](investigacion-patchy.md).

| Idea | Estado | Commits |
|---|---|---|
| Historial: al menos 3 estados de deshacer dentro del tope en bytes | Hecho (tests) | `be389ef` |
| Revisión de dibujo separada: mover o desvanecer una capa raster no invalida su FX | Hecho (tests) | `793f94d` |
| Vista previa reducida al arrastrar sobre páginas con FX; recomposición al soltar | Parcial (ver pendientes 2 y 3) | `d5347fa`, `dda36e0` |
| Helper FNV-1a y referencia de paridad | Parcial: helper hecho, digests pendientes (pendiente 1) | `5dfbb62` |
| LUT de 256 entradas para niveles y curvas (SVG, editor y exportación) | Hecho (tests); brillo y contraste sin cambio | `d4c0abe` |
| Corrección de la caché `below` en `arquitectura-render.md` §2 | Hecho | `9ebd8bf` |

## Pendiente (fuente única)

1. **Digests reales de paridad (FNV-1a):** generar `bench/engines/parity-digests.json` en el navegador del sandbox (CPU, Canvas2D) y añadir `npm run parity:update`. No existe aún; no se ha usado navegador. Ligado a la contradicción de abajo.
2. **Vista previa para selecciones grandes:** no hecha. La vista reducida solo cubre capas con FX.
3. **Limitación de la vista previa al arrastrar:** mientras se arrastra, los FX «below» no cacheados no se calculan; el resultado exacto aparece al soltar.
4. **Clic y arrastre en Object y Layer:** pendiente de prueba del usuario en su sandbox.
5. **Importación SVG de Inkscape con un archivo real:** los tests usan un SVG construido a mano (`6278ed4`).
6. **PNG en worker (entrega 1):** desactivado; no hay método exacto y más rápido. El guardado usa el encoder legado.
7. **A/B final (entrega 6):** 5 gestos × 3 repeticiones a 1024², 2048² si cabe, CPU y GPU por gesto, y prueba del usuario. Lo ejecuta el verificador con navegador (límite: 1 200 MB disponibles antes de medir y 1 800 MB de RSS).
8. **ADR 0015 en memoria para el contenido de las capas:** pendiente de decisión del usuario; el historial en mosaicos ya está hecho (`79bf595`).
9. **Máscaras de un canal** para el objetivo de 4 GB: no hechas.
10. **Contradicción sin resolver en el oráculo de 200 operaciones (CPU):** [render-baseline.md](render-baseline.md) registra 0/255; [historial 025](history/025-2026-10-W42.md), entrada 5, registra con la semilla 20260412 que no pasa (11 de 200 operaciones, máximo 182/255). Reejecutar y decidir cuál registro vale.
11. **Diferencia de 2 000 operaciones:** `paint` en la operación 1116, 3/255. Sigue abierta.
12. **Paridad en navegador:** regiones con dirty raster y cajas de FX (entregas 2 y 4) no verificadas en navegador.
13. **Comprobación visual** del límite raster y de la cuota provisional (64 trazos / 8192 segmentos, a medir).
14. **Medida limpia de la tarea 1:** el sandbox guarda seis copias del documento profesional (`state.json` de 30 MB). Separarlo requiere limpiar las sesiones del banco, con aprobación.
15. **Medidas de d y e antes y después** (ADR 0014): el «antes» está en el worktree `ogs-render-bench-before` (HEAD `4e238f8`), que se eliminará con `git worktree remove` al terminar.
16. **Atribución de d y e** con una medida limpia (sandbox vacío, una sola sesión).
17. **Motor (tarea 2 de arquitectura):** aplazado por decisión del usuario; [decision-motor.md](decision-motor.md) no tiene recomendación.
18. **Riesgos abiertos:** memoria del documento de 2048² con CPU, 2 057 MB (supera el tope de 1 800 MB); la CPU puede ser más lenta al dibujar (no medido); GPU no determinista, hasta 63/255 entre editor y exportación.

**Para decidir por el usuario (no cambiado por esta nota):** el [ADR 0015](decisions/0015-mosaicos-de-pixeles.md) sigue en estado «Propuesto». Su parte de historial en mosaicos ya está implementada en memoria (`79bf595`), pero no el guardado por mosaicos ni la migración. Si se acepta parcialmente, el estado lo cambia el usuario.

**Retirado de las notas anteriores (ya hecho):** aviso «History trimmed» (`384a39c`); reutilización de la sesión del banco (`prepareProfessional`); vuelta atrás del ADR 0014 (sección «Vuelta atrás»); formato 2 con pruebas en disco y navegador; zonas sucias y cajas (entrega 2); pasos vacíos (entrega 3); etapa B «en pausa» (ver cronología).

## Verificación del cierre

Según el informe de cierre de `ab01a02`: `npx tsc --noEmit` sin errores; `npm run test:related` con 849 pasados (4 omitidos); `npm test` con 189 archivos y 1 313 tests pasados (5 omitidos). La nota de esta auditoría es solo documentación: no se volvieron a ejecutar tests de código.

## Cajas de píxeles en memoria (2026-10-13)

- Cada capa raster guarda solo la caja alineada a 64 px de sus píxeles (`rasterSurface.ts`); `getRasterSurface` la da con su desplazamiento, `getBuffer` ensambla el lienzo completo para las operaciones que no lo necesitan.
- El guardado ensambla el lienzo a tamaño de página (mismo PNG); la carga lo recorta; los trazos en vivo y la composición usan la caja. Una capa vacía guarda un lienzo de 1 × 1 (`createCanvas` no admite 0 × 0).
- Prueba: `tests/raster-surface.test.ts` (crecimiento, capa vacía, guardar y cargar, trazo pequeño en 2048² por debajo del 5 %).

## Cuatro ideas de Designer (sK1, 2026-10-13, en código y tests)

Origen: [investigacion-sk1.md](investigacion-sk1.md). Commits en `task/render-bench`: primitivas paramétricas (`f0a41f7`), puntas de flecha y Scale stroke (`31b0c11`), iconos de tipos de nodo (`8b0e623`) y degradados editables (commit de esta nota). Sin navegador: el sandbox es del usuario; la prueba visual queda para él.

| Idea | Estado | Pendiente |
| --- | --- | --- |
| Primitivas paramétricas | Hecho, con tiradores en lienzo (segunda pasada) | Prueba visual en el sandbox del usuario |
| Puntas de flecha y Scale stroke | Hecho (tests de dirección, SVG y escala); canvas sin prueba automática | Importar `marker` como editable (hoy se rasteriza) |
| Tipos de nodo | Ya existían con tests; añadidos iconos | Ninguno |
| Degradados lineales y radiales | Relleno y trazo editables, tiradores en lienzo, export, import e ida y vuelta (tests) | Prueba visual en el sandbox del usuario |

Límite del Stage: `Stage.tsx` ya superaba 30 KB y no puede crecer; la lógica nueva va a `primitives.ts`, `shapeDraw.ts` y `gradientPaint.ts`.

## Segunda pasada: tiradores y degradado del trazo (2026-10-13)

- Tiradores de primitivas en `ShapeHandles.tsx` (lógica pura en `primKnots.ts`). La caja del círculo unitario es fija (`UNIT_BOX`), así que un cambio de ángulo o de radio no vuelve a ajustar la caja.
- Tiradores de degradado en el mismo componente, montados desde Stage con una línea; el trazo tiene el selector Solid / Linear / Radial.
- Stage.tsx: dibujo de sprites movido a `stageSprites.ts` (commit aparte, sin cambio de comportamiento) para que quepa lo nuevo.
- Sin navegador: la prueba visual de los tiradores queda para el sandbox del usuario.


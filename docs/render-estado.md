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

## Designer: estado al cierre de la tanda (2026-10-13)

Historial completo en [026](history/026-2026-10-W42.md). Estado: **hecho, bajo supervisión** — verificado por el usuario el 2026-10-13 en la app; pendiente de uso prolongado.

| Función | Commits | Estado |
| --- | --- | --- |
| Primitivas paramétricas (polígono, estrella, sector, arco, cuerda) y sus tiradores | `f0a41f7`, `1aa514e` | Hecho, bajo supervisión |
| Puntas de flecha y «Scale stroke» | `31b0c11` | Hecho, bajo supervisión |
| Tipos de nodo (esquina, suave, simétrico) con iconos | `8b0e623`, `d318e0b` | Hecho, bajo supervisión |
| Degradados lineales y radiales editables (relleno y trazo), con tiradores | `bd63d8f`, `1aa514e`, `929bf4d` | Hecho, bajo supervisión |
| Barra de forma: «Fill» y «Stroke» como muestras con popover; «Shape» | `ec02c99` | Hecho, bajo supervisión |
| Edición de nodos completa: dos tiradores, suavizado, arrastre de segmento, doble clic | `d318e0b`, `e5b7bc8`, `08f33e8`, `478a0c4` | Hecho, bajo supervisión |
| Refactor de Stage (sprites a `stageSprites.ts`) | `db4f2cc` | Hecho |

Causa de que los nodos no se pudieran agarrar: `designer-connected.css:257` pone `pointer-events: none` en `.stroke-ruler`; la banda de segmento lo heredaba. Lección: los tests de geometría no prueban la interfaz; cada gesto necesita un e2e (`tests-e2e/path-nodes-ux.spec.ts`).

## Lo que sigue abierto (para la próxima sesión)

- El e2e `shape-knots` falla desde antes: los documentos nuevos nacen sin capa («Add a layer, draw a shape…»), así que el dibujo no crea formas. Investigar si es regresión.
- Shift+A (nodo automático): no existe en el modelo.
- Paradas intermedias de los degradados: se conservan al importar, pero la barra solo edita la primera y la última.
- Tiradores de degradado en la herramienta de degradado (hoy solo en Edit).
- «Lo menos usado» de la barra al menú «Settings…» (regla 3 del coordinador): no hecho.
- Las flechas se rasterizan al reimportar un SVG: el importador no las lee todavía.
- Booleanas con Clipper2 o paper.js: no empezadas.
- Ajuste a rejilla, guías y objetos: parcial (sK1 solo como idea).
- Pendientes de antes: paridad en navegador (entregas 2 y 4), PNG en worker (desactivado), A/B final (entrega 6), ADR 0015 en memoria, máscaras de un canal, y el SVG con un archivo real de Inkscape.

## Diagnóstico abierto: lineart que se deforma al encoger (2026-10-13)

Investigación sin cambios de código: [diagnostico-escala-lineart.md](diagnostico-escala-lineart.md). Causa más probable: `transformStroke` no escala los tapers (`affine.ts:52-54`), y `perfect-freehand` usa umbrales absolutos que hacen el contorno no equivariante. Arreglo inmediato propuesto: escalar tapers como `scaleStroke`; el estructural, guardar el trazo con matriz acumulada.

### Lineart y escala: Aprobado con reservas por el usuario (90/100), 2026-10-13; sigue bajo supervisión (2026-10-13)

Herramienta de lineart favorita del usuario. Aplicados el arreglo 1 (tapers con el grosor, `1266df4`) y el arreglo 2 (matriz acumulada, `6319284`; trazos sin matriz intactos). Detalle, decisiones y límites en [diagnostico-escala-lineart.md](diagnostico-escala-lineart.md#arreglo-aplicado-2026-10-13-crítico-pendiente-de-revisión-del-usuario). Verificado en código y e2e (`tests-e2e/lineart-scale.spec.ts`, pasa; `npm test` EXIT=0). Pendiente de mejora:
- **Deformación residual** (el usuario la estima en un 10 %): causa probable, los umbrales absolutos de perfect-freehand en tamaños muy pequeños, o la escala no uniforme con factor medio. Hay que pedirle al usuario un caso concreto.
- **Paridad de canvas y PNG** en el navegador (no probada).
- **Convert to path y flechas** en el lineart (no aplican en este código).

## Ajuste (snapping): estado verificado (2026-10-14)

La investigación fuente y la comparación vigente están en [investigacion-snapping.md](investigacion-snapping.md). Commits relevantes: `7cf09f1` (retardo real conectado), `3f9c9f7` (interruptores independientes de guías y espaciado), `7565c47` (ajuste de nodos), `823f15f` (E2E y estado) y `3945823` (extracción para cumplir el límite de tamaño). El documento conserva Dibujo/Diseño fijado al crearlo o abrirlo (ADR 0016); los ajustes se guardan por modo y solo se aplican si el interruptor de ese modo está encendido. El detalle de evidencia, límites y comprobaciones está en el [cierre del lote](history/026-2026-10-W42.md#cierre-del-lote-de-snapping).

Verificación focalizada, sobre el sandbox `.sandbox/data`, puerto 5183, en el checkout basado en HEAD `7565c47` con los dos casos reactivados: `npx playwright test tests-e2e/snapping.spec.ts --workers=1` pasa **6/6**. Los antiguos `fixme` —borde más arrastre rápido y espaciado entre tres cajas— pasan con sus aserciones originales. También pasan el ajuste por temporizador sin nuevos movimientos, Drawing apagado por defecto y el primer arrastre en Object y Layer. No se demostró la causa de los fallos históricos; no se reprodujeron en esta ejecución. `tests/path-node-snap.test.ts` monta el editor y comprueba el gesto, la espera de 150 ms y un solo undo/redo; al quitar el cableado al arrastre la regresión falla. Resultado final de `npm test` y límites en el [cierre del lote](history/026-2026-10-W42.md#cierre-del-lote-de-snapping).

El motor ya alinea cajas mediante bordes y centros: combina cada uno de los tres anclajes horizontales y verticales con líneas de página, guías y otras capas. Por ello también cubre esquinas y puntos medios; no se añadieron objetivos duplicados. El ajuste de nodos actual se limita a nodos de otros trayectos visibles. Aún no cubre rejilla, márgenes, intersecciones, perpendicular/tangente ni alineación o espaciado entre nodos; esas categorías requieren entidades u objetivos geométricos que el documento hoy no modela. Los indicadores de borde/centro son guías; el indicador de espaciado igual sí muestra medidas.

## Modo fijado al crear (2026-10-14)

Resuelto el límite conocido del ADR 0016: el modo (Dibujo/Diseño) se guarda en el documento la primera vez que se crea o lee (`pinPaintMode`), y después solo lo cambia el interruptor.

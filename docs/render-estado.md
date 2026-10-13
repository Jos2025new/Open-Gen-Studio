# Estado de render-bench (cierre del 2026-10-13)

Rama `task/render-bench` (worktree `ogs-render-bench`), HEAD `ab01a02` al cierre, sin fusionar ni subir. Esta nota es la **fuente única** de lo pendiente del trabajo de rendimiento: el resto de notas de render enlazan aquí. Plan vigente: [plan-fluidez.md](plan-fluidez.md) (plan único del 2026-10-13). Rumbo y tareas originales: [arquitectura-render.md](arquitectura-render.md), sección 6. Investigación de memoria con cifras (4 GB y 2 GB): [investigacion-memoria.md](investigacion-memoria.md).

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

## Atribución de los commits del track

Fuente: trailers `Co-Authored-By` de cada commit (`git log 9c061f8..HEAD`). Todos los commits tienen como autor git a Samuel.

| Commits | Trailer | Atribución en el historial 025 |
|---|---|---|
| `42a09b8` … `4443e35`, `65b91da` … `ab01a02` (los que traen trailer) | `Co-Authored-By: Claude Haiku 5.5` | Entradas 1 y 2: Claude. Entradas 3 a 5: GPT y Luna. |
| `c4a611d`, `2039485`, `95e6634`, `615ab22`, `79bf595`, `7da0a51`, `7a9e88c`, `7ad9c17`, `5bf5e34`, `4bd93cd`, `5ae9851`, `dfffd31`, `75c3f7c`, `a5a814b`, `4503594`, `a423862` | sin atribución en el commit | Entradas 4 y 5 (GPT y Luna; Luna y GPT). El historial no asigna cada commit a un autor. |

Ningún commit ni documento del track cita a Claude Opus ni a GPT/Luna en un trailer; esas atribuciones solo constan en el historial 025.

## Pendiente (fuente única)

1. **Entrega 6:** A/B final a 1024², 2048² si cabe, CPU y GPU por gesto, y prueba del usuario. Lo ejecuta el verificador con navegador que autoriza el plan (solo GPT abre navegador, sin tests en paralelo). El límite de memoria es 1 200 MB disponibles antes de medir y 1 800 MB de RSS del navegador.
2. **Contradicción sin resolver en el oráculo de 200 operaciones (CPU):** [render-baseline.md](render-baseline.md) (sección «Oráculo CPU») registra que pasa con 0/255. [historial 025](history/025-2026-10-W42.md), entrada 5, registra con la semilla 20260412 que no pasa: 11 de 200 operaciones superan la tolerancia, máximo 182/255. Hay que reejecutar el oráculo y decidir cuál registro es el vigente. No se resolvió en esta nota (solo se documentó).
3. **Diferencia de 2 000 operaciones:** `paint` en la operación 1116, 3/255 (dos intentos iguales, máximo de tres). El plan no la considera bloqueante, pero sigue abierta.
4. **Paridad en navegador:** regiones con dirty raster y cajas de FX (entregas 2 y 4) no verificadas en navegador.
5. **Comprobación visual** del límite raster y de la cuota provisional (64 trazos / 8192 segmentos, a medir).
6. **PNG en worker:** no hay método exacto y más rápido. Mientras tanto, el guardado usa el encoder legado.
7. **Medida limpia de la tarea 1:** el sandbox guarda seis copias del documento profesional (`state.json` de 30 MB), así que las cifras incluyen un guardado grande. Separarlo requiere limpiar las sesiones del banco, con aprobación.
8. **Medidas de d y e antes y después** (Etapa C, ADR 0014): el «antes» está en el worktree `ogs-render-bench-before` (HEAD `4e238f8`), que se eliminará con `git worktree remove` al terminar.
9. **Atribución de d y e** con una medida limpia (sandbox vacío, una sola sesión), y repetir sin procesos ajenos consumiendo CPU.
10. **Motor (tarea 2 de arquitectura):** aplazado por decisión del usuario; [decision-motor.md](decision-motor.md) no tiene recomendación.
11. **Riesgos abiertos:** memoria del documento de 2048² con CPU, 2 057 MB (supera el tope de 1 800 MB); la CPU puede ser más lenta al dibujar (no medido); GPU no determinista, hasta 63/255 entre editor y exportación.

**Para decidir por el usuario (no cambiado por esta nota):** el [ADR 0015](decisions/0015-mosaicos-de-pixeles.md) sigue en estado «Propuesto». Su parte de historial en mosaicos ya está implementada en memoria (`79bf595`), pero no el guardado por mosaicos ni la migración. Si se acepta parcialmente, el estado lo cambia el usuario.

**Retirado de las notas anteriores (ya hecho):** aviso «History trimmed» (`384a39c`); reutilización de la sesión del banco (`prepareProfessional`); vuelta atrás del ADR 0014 (sección «Vuelta atrás»); formato 2 con pruebas en disco y navegador; zonas sucias y cajas (entrega 2); pasos vacíos (entrega 3); etapa B «en pausa» (ver cronología).

## Verificación del cierre

Según el informe de cierre de `ab01a02`: `npx tsc --noEmit` sin errores; `npm run test:related` con 849 pasados (4 omitidos); `npm test` con 189 archivos y 1 313 tests pasados (5 omitidos). La nota de esta auditoría es solo documentación: no se volvieron a ejecutar tests de código.

## Cajas de píxeles en memoria (2026-10-13)

- Cada capa raster guarda solo la caja alineada a 64 px de sus píxeles (`rasterSurface.ts`); `getRasterSurface` la da con su desplazamiento, `getBuffer` ensambla el lienzo completo para las operaciones que no lo necesitan.
- El guardado ensambla el lienzo a tamaño de página (mismo PNG); la carga lo recorta; los trazos en vivo y la composición usan la caja. Una capa vacía guarda un lienzo de 1 × 1 (`createCanvas` no admite 0 × 0).
- Prueba: `tests/raster-surface.test.ts` (crecimiento, capa vacía, guardar y cargar, trazo pequeño en 2048² por debajo del 5 %).

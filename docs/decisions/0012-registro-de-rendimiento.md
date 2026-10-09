# 0012 — Registro de rendimiento para sesiones de prueba

## Estado

Propuesto

## Fecha

2026-10-08

## Contexto

El usuario (2026-10-08) quiere poder decirle a un agente «voy a hacer tal cosa» y que después el agente consulte qué pasó: cuántos ms van de cargar un filtro a verlo aplicado, qué ocurre al acumular capas, y dónde está el cuello de botella con cientos de capas (render gráfico, memoria, carga del filtro, retardo o directo). El registro solo debe funcionar durante las pruebas.

GIMP e Inkscape ya resolvieron esto, y su solución está en el código:

- **GIMP: Dashboard y registro de rendimiento.** `app/widgets/gimpdashboard.c` (master `1ef535b`) muestra variables en vivo: caché (`VARIABLE_CACHE_*`), swap, CPU, memoria e hilos. Además graba un registro a archivo (`gimp_dashboard_log_start_recording` / `stop_recording`) con muestras periódicas, trazas opcionales (`log_params.backtrace`) y **marcadores** con texto que el usuario añade mientras graba (`gimp_dashboard_log_add_marker`). El usuario adjunta ese archivo a un informe de fallo. Aparte, `GIMP_LOG=projection` (`app/gimp-log.c`) activa trazas por dominio.
- **Inkscape: framecheck.** Con la preferencia de desarrollo `/options/rendering/debug_framecheck` (`src/ui/widget/canvas/prefs.h:47`), cada evento del lienzo escribe una línea `nombre inicio fin subtipo` en microsegundos en `framecheck.txt`, en la carpeta temporal (`src/ui/widget/canvas/framecheck.cpp`). Con la preferencia apagada, el coste es una comprobación de un booleano (`framecheck_whole_function`). Otras preferencias muestran las zonas redibujadas o retrasan el redibujado. `INKSCAPE_DEBUG_LOG` e `INKSCAPE_DEBUG_FILTER` (`src/debug/logger.cpp:147`) activan un registro general.
- **Lo que hacen ambos en el render**, y que nosotros aún no hacemos: caché de lo ya dibujado con un presupuesto en bytes (Inkscape `Drawing::setCacheBudget`, `src/display/drawing.cpp:196`), y render por teselas solo de la zona que cambia (`render_tile`, `bisect` por `tile_size` en `canvas.cpp`).

Nuestra app ya escribe eventos en `data/logs/app.log` mediante `logEvent` (`src/lib/log.ts`). En el sandbox ese archivo cae en `.sandbox/data`. También guarda métricas del agente (`agentMetrics`).

## Decisión

Propuesta, pendiente de aprobación:

1. **Apagado por defecto, coste casi nulo.** Un módulo `src/lib/trace.ts` con `trace.on` falso. Cada punto medido comprueba ese booleano, como el framecheck de Inkscape. Nunca se guarda en el estado ni se activa solo.
2. **Sesión de prueba con marcadores (modelo GIMP).** Se inicia con una etiqueta («50 capas de desenfoque en 4K»). Durante la sesión, el usuario o el agente añaden marcadores de texto («ahora arrastro la capa»). Se detiene a mano o al cerrar la pestaña.
3. **Qué se mide (eventos con inicio y fin, modelo framecheck):**
   - `drawDoc`: total, número de capas FX y resolución de la composición;
   - cada paso FX: tipo, alcance, tamaño del lienzo y ms;
   - lienzos creados y píxeles reservados por fotograma;
   - **latencia de aplicación:** de la acción (`runFx`, deslizador, comando del agente) al primer fotograma que la muestra;
   - intervalos entre fotogramas mientras se arrastra, y tareas largas (`PerformanceObserver`);
   - memoria de JavaScript donde exista (`performance.memory`, Chrome).
4. **GPU frente a CPU.** Los pases de canvas se encolan en la GPU: el tiempo de JavaScript no incluye el pintado. Un modo «profundo» opcional fuerza la espera leyendo un píxel tras cada paso. Así separa el tiempo de JavaScript del de pintado, a cambio de ralentizar la medida, y el informe lo indica.
5. **Dónde queda.** Un archivo JSON Lines por sesión en `data/logs/trace-<fecha>-<etiqueta>.jsonl` (en el sandbox, `.sandbox/data/logs/`), escrito por el servidor local como `app.log`. `npm run trace:report <archivo>` resume:
   - p50, p95 y máximo por evento;
   - la evolución con el número de capas;
   - el pico de píxeles reservados;
   - la línea de tiempo con los marcadores.
   
   Un agente lo lee sin abrir la app.
6. **Banco reproducible.** Un script de Playwright sobre el sandbox (como `npm run stress`) genera documentos sintéticos con N capas FX (1 a 300) y tamaños de 1080² a 8K, y graba una sesión por caso. Así el escenario de un proyecto profesional se reproduce sin datos reales.
7. **Activación.** En el sandbox, el agente lo activa por el gancho de pruebas del puerto 5183 (como `__OGS_TEST__`). En la app real, solo el usuario, desde un menú de desarrollo. **Pendiente de decidir:** si debe existir en la app real o solo en el sandbox.

## Alternativas

- **Medir siempre.** Descartada: el usuario pidió que solo actúe en pruebas, y medir cada fotograma tiene coste.
- **Solo las herramientas del navegador (DevTools Performance).** Útiles, pero un agente no puede leerlas después y no conocen nuestras capas ni operaciones. El registro propio guarda el contexto (qué capa, qué filtro, qué marcador).
- **Optimizar ya (caché y teselas).** Aplazado: sin cifras no se sabe qué domina. El registro decide qué optimizar primero. Lo probable, por cómo está hecho hoy, es que pese recalcular todas las capas FX en cada fotograma: GIMP e Inkscape lo evitan con caché.

## Consecuencias

- Hay que instrumentar `drawDoc`, `applyFx`, `runFx` y el bucle de fotogramas de `Stage.tsx`, y añadir una ruta de escritura al servidor local con las mismas protecciones que `app.log`.
- Los números de una máquina no valen para otra: cada informe guarda el navegador, los núcleos (`navigator.hardwareConcurrency`) y la carga si se conoce.
- Las pruebas de escala de [fx-pruebas.md](../fx-pruebas.md) (sección 5) dependen de esta propuesta.

# Pendientes cerrados

Lo que salió de las listas abiertas ([índice](pendientes.md)). Una línea por ítem: qué era, cómo se cerró y la evidencia. Nada se borra: si una línea resulta falsa, se reabre en la lista que le toca. Revisión del 2026-10-22 (rama `task/workflow-ask-first`, `c034614`).

Cierres hechos en la revisión del 2026-10-22 llevan **[rev]**; los demás se movieron tal cual estaban marcados `[x]`.

## Hechos el 2026-10-23 (detalle y commits en [050](history/050-2026-10-W43.md))

- **B10** precio del plan con el modelo enviado (`43203ea`, `tests/plan-price-variant.test.ts`), más el margen de precio del usuario (`5eaa8ec`).
- **B11** crédito compara el coste del trabajo (`6ff43fe`, `tests/credit.test.ts`).
- **B12** E1-01 (`1b78aa1`), E3-01 exacto y E2-01 reutilización en Auto (`a047c82`, `bc21a37`).
- **A24** resultado por conexión en Nodes (`33447d2`) y puertos por resultado (`55f31d4`, `tests/node-link-result.test.ts`).
- **D19–D22** (`912d48f`, `f734a40`, `8287a66`, `daeb56c`, `tests/designer-layer-fixes.test.ts`) y **D23–D28** (`tests/designer-audit-d23-d28.test.ts`).
- **Frenos de Nodes con su motivo** (`07f535c`).
- **Auditoría del Designer** (detalle en [051](history/051-2026-10-W43.md)): Keep Opacity (`19499ef`, `tests/keep-opacity-lock.test.ts`), textura y sellos (`b14c7f7`, `3c6c719`), Trim (`aacb89b`), exportación SVG/PDF (`ebb7358`), selección por forma (`4906746`), **D30** capa ilegible sin sobrescribir (`b72412e`, `b19b84a`, `tests/raster-unreadable.test.ts`) y presión simulada por velocidad (`3481b33`, `tests/simulated-pressure-rate.test.ts`).
- Pendiente de prueba en el sandbox: ver [pendientes](pendientes.md), punto 3.

## Hechos: cerrados en la revisión del 2026-10-22 [rev]

- **C5 · `source-map-js` (alta)** (de pendientes-sistema y [problemas conocidos](problemas-conocidos-2026-10-18.md)). Hecho el 2026-10-22 al consolidar ramas: `eea511d` traído como `46045ae` (lockfile a 1.2.2); `npm test` pasa.
- **Deshacer y rehacer conservan el modo de pintura** (rama `task/paintmode-undo`, nunca integrada). Hecho el 2026-10-22: `0cc41bd` traído como `ef77935`, con `tests/paint-mode-history.test.ts` y el contrato `paint-mode`.
- **Fusión de `task/gui-cohesion`** (de pendientes-gui). Hecho: `e618fae` es ancestro de `HEAD` (`git merge-base --is-ancestor e618fae HEAD`). Solo en esta línea: la rama de la app real, `task/agent-forcing`, no lo contiene (ver B2 en [pendientes-agente](pendientes-agente.md)).
- **`task/save-guard` sin fusionar** y **«se perdió todo al recargar tras parar el servidor»** (de [problemas conocidos](problemas-conocidos-2026-10-18.md)). Hecho: la rama es ancestro de `HEAD`; commits `ef55688`, `cd4224f`, `7d153fd`, `bb58598`; pruebas `save-guard-server`, `save-guard-client`, `save-guard-banner` y `save-guard-review`. La fase 2 sigue abierta (C1).
- **Guardar cada sesión por separado** (ADR 0014, Designer segunda parte). Hecho: formato 2 en `server/store-v2.js` (`1e21299` y anteriores), `tests/store-v2.test.ts`; ADR 0014 aprobado el 2026-10-12. Queda la atomicidad (C1).
- **Sonda de la brocha** (Designer segunda parte). Hecho: dominio `raster` (`live`, `compose`, `restore`) en [depuracion](depuracion.md); contrato `trace-probes` (`1837bd5`). La sonda del guardado no existe (sigue en D14).
- **Hoja de 6 ángulos necesita `grid_split` 2×3** (019, punto 37). Hecho: `2387559` (el normalizador ajusta los parámetros desde la petición); ya anotado en 020, punto 21.
- **Conectar el disparo al runtime** (019, punto 35). Superado: 020, puntos 15 a 23; hoy el disparo solo añade dos líneas a la petición y no hay `tool_choice`.
- **Fusión de `task/agent-direct` y `task/agent-triggers`** (019, punto 40). Superado por la purga del 2026-10-09: una sola rama, ver «Purga» más abajo.
- **Un chequeo de tamaño que cubra el código** (019, punto 45). Hecho: `scripts/check-sizes.mjs`; hoy `npm test` lo corre y dice «11 over 30000 bytes held at their baseline».
- **Decidir si las operaciones confirman modelo** y **Fusionar `task/agent-forcing` en `task/modelo-general`** (021 y pendientes). Superado por ADR 0009 / `454d721` y por la rama única.
- **Auto: un plan de coste 0 empieza sin aprobación** (021, `runtime.ts:602`). Obsoleto: es regla escrita del agente («may run a free plan in Auto under its existing spending policy», `context.ts`). Si el usuario quiere cambiarla, es una decisión nueva.
- **«La barra del Designer no cabe y oculta el botón de la Regla»** (023, punto 3). Obsoleto: 024 y `34d031f` corrigen la línea como falsa (la tecla K y el botón existen).
- **Referencia de «13 archivos de más de 30 KB»**. Cifra desactualizada: hoy son 11 (`check-sizes`); el ítem sigue abierto como C9.
- **Error 413 al enviar referencias pesadas a NanoGPT** y **registro de lo enviado con medidas falsas** (049). Hecho en `c034614`: `src/engine/providers/bodyBudget.ts`, `redact` en `src/lib/debug.ts`; pruebas `tests/nanogpt-body-budget.test.ts` y `tests/debug-info.test.ts`. Sin verificar con el proveedor real (A9).
- **Resultados de NanoGPT no se guardan (relay 403)** (048). Hecho en esta línea: `0bbb986`, `05ba71e`, `9b26f69`, `976d81e`; prueba `media-relay-hosts`. Falta llevarlo a la app real (B2).
- **Cinco normas de la sesión house party (ADR 0025 A a G)**. Hechas con pruebas que fallan sin el cambio: `121ba60`, `72329e3`, `504a7f8`, `9a0553f`, `f5ad0d2`, `e5c7d53`, `143fef4` a `09e45bc`. Sin verificar en pantalla (A4).

## Hechos: marcados `[x]` en la lista anterior

- **Velocidad primero** («una interfaz que vaya lenta conforme más se usa deja la app inviable»). Decisión del usuario, 2026-10-09; vigente.
- **Anotar con fecha qué cambio probó el usuario.** Decisión del usuario, 2026-10-09 (precedente en [depuracion](depuracion.md)).
- **Brocha y panel del Designer** (orden, avanzados ocultos, aviso de presión, extremos finos, un motor). Probado y aprobado por el usuario, 2026-10-09. Antes de tocar el Designer o la exportación, tabla «Qué revisar a futuro» de [022](history/022-2026-10-W41.md).
- **Conflictos entre ramas: rige lo más nuevo; una sola rama.** Usuario, 2026-10-09.
- **Calidad por defecto = resolución media** (`mediumResolution`). Usuario, 2026-10-08.
- **Operaciones con modelo de imagen confirman su modelo** (Auto una vez por sesión, Guided cada petición, Direct usa el compositor). `454d721`, ADR 0009; usuario, 2026-10-08.
- **Fusionar `task/agent-forcing` en `task/modelo-general`.** Superado el 2026-10-09: rama única; `task/modelo-general` se borró en la purga. [fusion-agent-forcing](fusion-agent-forcing.md).
- **Registro de rendimiento para sesiones de prueba** (ADR 0012). Aprobado; apagado por defecto. Usuario, 2026-10-08.
- **Sondas y exportación del Designer (plan 1).** 2026-10-09, Astra; `eb2c7f4`, `c19fdf3`, `4e53d5d`, `722564a`; 1029 tests y sandbox (PNG real 256×128 con FX; 8K con canvas doble).
- **Regresión de exportación 8192×8192 sin FX (plan 1b).** Hecho el 2026-10-10: `npm test` 1067, PNG real de 8192×8192 en 1,1 s, rechazo con FX.
- **Niveles y curvas en la capa de filtros.** 2026-10-10, `d4c0abe` (tabla de 256 entradas, vista y SVG iguales; `fx-render.test.ts`).
- **Reglas de trazo recta y elipse; regla de perspectiva.** 2026-10-10, `d7c2099` y `64ed610`; `stroke-ruler.test.ts`, `npm run tools:check`.
- **Margen del ajuste a pantalla.** Hecho el 2026-10-10.
- **Documentos de investigación de otra sesión (ibisPaint, VectorCraft, SmartTracer).** Descartados por el usuario, 2026-10-09; nunca tuvieron commit.
- **Una sola revisión candidata.** Hecho el 2026-10-09 con la purga (más abajo).
- **Primer paso de la caché de FX del editor** (capas con FX «layer»). 2026-10-09, rama `task/rendimiento`; `fx-render.test.ts` (los dos casos clave fallan sin la caché). El resto sigue en D5.
- **Guardado más ligero** (solo se serializa lo que cambió): 131 ms → 24 ms; `persist-json.test.ts`. 2026-10-09.
- **Designer lento al pintar.** 2026-10-09, `task/rendimiento` (caché de FX y guardado); sin medir en el navegador del usuario; la brocha raster se rehízo después (ver D14).
- **Brocha de PaintTool SAI y campos unificados** (ADR 0013). 2026-10-09, `aebf8de`; `brush:check` 7/7; probado por el usuario. Falta la mezcla húmeda (D2).
- **Purga de ramas y carpetas.** 2026-10-09, a petición del usuario; solo lo contenido en `task/agent-forcing` (`merge-base --is-ancestor`). Quedaron `main`, `task/agent-forcing` y la rama de la app real.
- **Sondas y exportación FX corregidas; plan del Designer documentado.** 2026-10-09, Astra; cinco commits (`eb2c7f4`, `c19fdf3`, `4e53d5d`, `722564a`, `6f0d846`), guardados en `9359c85`.
- **Generar voz y efectos de sonido.** 2026-10-08, `tests/nanogpt-speech.test.ts` (10 casos con proveedor simulado). Modelos y precios en el [catálogo](catalogo-voz-y-efectos.md). La prueba con gasto real sigue en B7.
- **Tests fiables con carga** (ADR 0010). 2026-10-08: 4 de 4 ejecuciones sin fallos con carga 25 a 39. Los fallos intermitentes que aparecieron después siguen en C8.
- **Exportar los datos en un `.zip`.** 2026-10-08, real: `/x/store/export`, claves vaciadas. Sin test automático. Importarlo sigue en F5.
- **Precio exacto de Atlas antes de generar** (`src/engine/quotes.ts`). 2026-10-08, real y `quotes.test.ts`; el usuario confirmó que funciona.
- **3D y Designer (P1 a P9)**: cuatro modelos 3D, visor, exportación PDF/SVG, lineart editable, pinceles con textura. 2026-10-08; 22 tests; visor probado por el usuario.
- **Banco del agente, antes y después (R0d/R8).** Ejecutado por el usuario en otras sesiones; `bench/2026-10-01-3273c0a.json`, [comparación](nanogpt-price-comparison.md), [expansión 2](nanogpt-price-expansion-2.md).
- **Nodos: Delete segment y soldar con Shift+J.** 2026-10-12; 9 casos puros y 2 e2e que fallan sin la operación. [plan](plan-edicion-formas.md).
- **e2e de presión simulada y regla de trazo** (fallaban por el pincel guardado en el sandbox). 2026-10-11; los tests fijan el pincel que miden.
- **Rendimiento raster medido** (50 trazos, 1080p 235 → 9,1 ms; 4K 794 → 49,6 ms). 2026-10-11; [raster-pruebas](raster-pruebas.md).
- **Formas: nodos esquina/suave/simétrico, añadir nodo con doble clic, borrar el elegido.** 2026-10-11; `21e99ea`, `5dce5ee`, `846888e`; 1126 tests y 10 e2e.
- **Opacidad y fusión de capa iguales en lienzo y SVG.** 2026-10-11, `ed4fc5d`; 7 casos e2e (0 píxeles > 8/255).
- **Formas al estilo de Inkscape** (Rx/Ry, trazo, blur, Convert to path). 2026-10-11, `523dd35` a `2949201`; 1119 tests; [024](history/024-2026-10-W41.md).
- **Importar SVG de Inkscape** (carpetas, capas, formas editables). 2026-10-13, `6278ed4`; la prueba con un archivo real sigue en D13.

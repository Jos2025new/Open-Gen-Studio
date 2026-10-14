# Investigación: ajuste (snapping) de Inkscape frente a OGS

Investigación de fuente del 2026-10-14, con comparación de implementación actualizada el 2026-10-14 sobre HEAD `7565c47`. La fuente Inkscape se leyó en modo solo lectura; no se ejecutó Inkscape. La verificación OGS está documentada aparte en `render-estado.md`. Fuente: clon `--depth 1` de `gitlab.com/inkscape/inkscape` en el scratchpad, commit **244d48fb2001** (rama master en la fecha del clon). Las rutas son relativas a `src/`. Licencia: Inkscape es GPL; aquí solo se describen principios y fórmulas, sin copiar código.

## Resumen: por qué el de Inkscape es suave

1. **Un solo ganador, con una puntuación.** Cada candidato (objeto, guía, rejilla, alineación, distribución) produce un punto con dos medidas: su distancia de ajuste y su distancia al puntero. Se compara con una métrica normalizada que mezcla ambas (`snapped-point.cpp:381-386`). Así no hay saltos entre ejes ni pelea entre candidatos.
2. **Tolerancia en píxeles de pantalla.** La tolerancia en documento es la de preferencias dividida entre el zoom (`snap.cpp:762-766`). A cualquier zoom el «imán» tiene el mismo tamaño visual (10 px por defecto, `preferences-skeleton.h:71`).
3. **Retardo por velocidad.** Mientras el puntero va rápido (más de 0,02 px/ms) no se ajusta; se ajusta cuando se frena, o cuando salta un temporizador de vigilancia (`ui/tools/tool-base.cpp:1605-1631`). Es lo que evita el «tirón» al pasar cerca de una línea a toda velocidad.
4. **Candidatos acotados.** Los objetos se recogen una vez por gesto (`snap.cpp:696-747`, bandera `_findCandidates_already_called`), solo si están en el área visible (`snap.cpp:975-976`) y, para los puntos de alineación, con tope de 200 y aviso si tarda más de un segundo (`snap.cpp:992`). La distribución filtra por **bandas**: solo cuentan los objetos que se solapan con la caja en horizontal o en vertical (`distribution-snapper.cpp:212-256`).
5. **Espaciado igual como restricción de primera clase.** Busca cadenas de cajas a la misma distancia (huecos iguales), mueve el objeto para igualar el hueco y dibuja el indicador (`distribution-snapper.cpp:101-190`, `:340-345`, `display/control/snap-indicator.cpp:147-183`).

## Fórmulas y principios, con cita

| Principio | Fórmula o regla | Cita (commit 244d48f) |
| --- | --- | --- |
| Tolerancia en px de pantalla | `tol_doc = tol_prefs / zoom` | `snap.cpp:762-766` |
| Tolerancia por defecto | objetos 10 px; rejilla 10 px; guías 10 px; cursor 8 px; peso 0,5 | `preferences-skeleton.h:71-73`, `:273`, `:302` |
| Mínimo de tolerancia | `_tolerance = max(t, 1.0)` (para no dividir entre 0) | `snapped-point.cpp:31` |
| Solo cuentan los puntos dentro de tolerancia | `dist < tol` y `dist < mejor_hasta_ahora` | `snap.cpp:173`, `snap.cpp:672` |
| Comparación de candidatos | `d_p = w·dist_puntero/(min(dist_puntero)+1) + (1−w)·dist_snap/min(50, tol)` | `snapped-point.cpp:361-386` |
| Peso | `w = snapweight` (0,5); `w = 1` si «snap closest only» | `snapped-point.cpp:367-370` |
| Penalización de restricción | un ajuste a una línea de restricción pierde 10⁶ frente a cualquier otro | `snapped-point.cpp:393-399` |
| Desempate | el más cercano gana; con «always snap» gana ese | `snapped-point.cpp:401-410` |
| Alineación | ajusta si `dist < tol` y el objetivo está más cerca que el mejor alineado | `alignment-snapper.cpp:163-205`, `:310-312` |
| Hueco de distribución | `distRight = b.min.x − a.max.x` (y análogos) | `distribution-snapper.cpp:81-99` |
| Igualdad de huecos | `|d1 − d2| < 0,5·10⁻⁴ · nivel` (la tolerancia crece con la cadena) | `distribution-snapper.cpp:27`, `:29`, `:180` |
| Desplazamiento para igualar | `offset = primer_hueco − hueco_igual`; el objetivo se desplaza `offset` | `distribution-snapper.cpp:342`, `:379` |
| Distancia del ajuste de distribución | `|offset|` (es lo que compara `isOtherSnapBetter`) | `distribution-snapper.cpp:366-367` |
| Orden de candidatos | `std::stable_sort` por distancia a la caja | `distribution-snapper.cpp:256` |
| Retardo por velocidad | si `v > 0,02 px/ms`, posponer; si no, ajustar; vigilancia con `snapdelay` (0 por defecto) | `ui/tools/tool-base.cpp:1571`, `:1605`, `:1745-1760`; `preferences-skeleton.h:301` |

Sobre la «histéresis»: Inkscape no tiene una histéresis explícita en píxeles. El equivalente es el retardo por velocidad (no ajustar mientras se mueve rápido) y la comparación de candidatos con el peso 0,5, que evita que el ganador cambie con cada movimiento mínimo.

## Issues y merge requests consultados

- Issue 3437, «Alignment and Distribution snap indicators measurements are not displayed proper» (cerrado 2022-04-20): https://gitlab.com/inkscape/inkscape/-/work_items/3437 — relevante para los indicadores de distribución.
- Issue 4969, «Alignment/same distances snap toggle acts even when Alignment snap toggle disabled» (2024): https://gitlab.com/inkscape/inkscape/-/work_items/4969 — los interruptores de alineación y de distancias iguales son separados.
- Issue 3085, «Snap delay no longer working with select or shape tools» (cerrado 2021-07-09): https://gitlab.com/inkscape/inkscape/-/work_items/3085 — el retardo se aplica en las herramientas de selección.
- Issue 2849, «Snap popover in advanced view gets cut off» (cerrado 2021-10-08): https://gitlab.com/inkscape/inkscape/-/work_items/2849 — el popover simple/avanzado.
- Issue 3421, «Snap panel group does not disable all child tick boxes (1.2 Beta)» (2022-04-12): https://gitlab.com/inkscape/inkscape/-/work_items/3421.
- Issue 3422, «SIGSEGV in AlignmentSnapper::_collectBBoxPoints (1.2 Beta)» (2022-04-12): https://gitlab.com/inkscape/inkscape/-/work_items/3422 — la alineación de 1.2 tenía fallos de memoria.

No se ha encontrado por nombre la «GSoC 2021 snapping improvements» ni un merge request concreto del rediseño de 1.2; las búsquedas de la API pública devolvieron sobre todo paquetes «Snap». Queda como no verificado.

## Comparación con OGS al 2026-10-14

Código de OGS: `src/engine/design/snap.ts`, `snapSession.ts`, `snapNodes.ts`; integración en `src/components/designer/Stage.tsx` y `PathNodes.tsx`.

| Función | Inkscape | OGS verificado | Diferencia vigente |
| --- | --- | --- | --- |
| Tolerancia | 10 px de pantalla, divididos entre zoom | `SNAP_PX = 10`, `snapTolerance(zoom)` | No hay control de tolerancia configurable |
| Elección | Puntuación que compara candidatos | Puntuación por eje para caja; distancia euclídea al objetivo de nodo | No hay un único ganador global que compare caja, guía y nodo a la vez |
| Caja | Bordes, esquinas, puntos medios y centro | Bordes y centro X/Y; sus combinaciones producen esquinas y puntos medios | No hace falta otro control ni otro candidato de caja |
| Nodos | Puntos de trayecto y más tipos de ancla | Nodos finales de otros trayectos visibles, recopilados al empezar el gesto | No ajusta a intersecciones, handles, puntos medios de segmentos ni perpendicular/tangente |
| Guías | Categoría independiente | Interruptor **Guides**, guardado por modo; desactiva sus candidatos | Sin diferencia esencial en esa categoría |
| Espaciado | Restricción de huecos iguales con indicador | **Equal spacing** independiente; indicador muestra las dos medidas | Solo cajas, no distribución/alineación entre nodos |
| Indicadores | Líneas, marcas y medidas | Guías de líneas de borde/centro; medidas para espaciado igual | No hay indicador de alineación distinto de la propia guía |
| Retardo | No ajusta durante movimiento rápido; temporizador al detenerse | 0,02 px/ms; temporizador real de 150 ms en move/objeto/escala/nodo; suelta cancela | El ajuste de nodos no tiene E2E de navegador; tiene prueba montada de componente |
| Candidatos | Área visible, caché por gesto, puntos limitados | Cajas: candidatos por gesto y vista; nodos: 200 objetivos más cercanos de trayectos visibles | La búsqueda de nodos todavía recorre todos los trayectos visibles |
| Interfaz | Panel simple y modo avanzado con categorías | Un popover compacto con activar, página, capas, guías, espaciado y nodos | No hay rejillas o márgenes configurables; el documento no modela esos objetos |
| Modo | No aplica | Valores guardados por modo; Diseño y Dibujo tienen defaults propios; los trazos raster no se ajustan | El usuario puede encender el ajuste en Dibujo con su interruptor |

## Qué conviene conservar y qué queda fuera

- Mantener el popover corto y las categorías independientes: activar ajuste, página, capas, guías, espaciado y nodos. Una interfaz simple/avanzada al estilo Inkscape solo se justificaría cuando existan más objetivos reales; no se replica la lista completa por apariencia.
- La alineación visible de cajas ya existe: al acercar un borde o centro a otro, el snap produce la guía correspondiente. «Sin indicador de alineación» significa que no hay un indicador separado que nombre una relación; no significa que falte ese snap.
- El target de nodo es deliberadamente limitado a nodos de trayecto visibles. Grid y márgenes necesitan entidades/configuración que hoy no existen; intersecciones y restricciones perpendiculares/tangenciales requieren geometría adicional. No se simulan con checks vacíos.
- El control de nodos usa el mismo zoom, velocidad, retardo de 150 ms, Alt para movimiento libre y un solo snapshot de deshacer que el editor existente. La prueba montada cubre posición, espera, undo y redo; no sustituye una prueba visual en navegador.

## Verificación local

- `tests/snap-nodes.test.ts`: fuentes de nodos, coincidencia bidimensional, tolerancia y retardo.
- `tests/path-node-snap.test.ts`: interacción montada, snap tras el retardo y un solo paso de undo/redo.
- `tests-e2e/snapping.spec.ts`: los dos casos antes marcados `fixme` están activos. La ejecución focalizada del archivo en sandbox pasa 6/6; no demuestra la causa de los fallos históricos.
- No se ejecutó Inkscape ni se midió rendimiento con documentos grandes. Los valores de Inkscape se leen de las fuentes citadas, no de mediciones de runtime.

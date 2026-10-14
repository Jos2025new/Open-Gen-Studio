# Investigación: ajuste (snapping) de Inkscape frente a OGS

Investigación de solo lectura del 2026-10-14. No hay cambios de código; no se ha compilado ni ejecutado nada de Inkscape. Fuente: clon `--depth 1` de `gitlab.com/inkscape/inkscape` en el scratchpad, commit **244d48fb2001** (rama master en la fecha del clon). Las rutas son relativas a `src/`. Licencia: Inkscape es GPL; aquí solo se describen principios y fórmulas, sin copiar código.

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

## Comparación con OGS

Código de OGS: `src/engine/design/snap.ts` (2,3 KB) y `src/engine/design/guides.ts` (1,6 KB); la llamada está en `src/components/designer/Stage.tsx:958-995`.

| Función | Inkscape | OGS hoy | Falta |
| --- | --- | --- | --- |
| Tolerancia | px de pantalla / zoom; 10 px | `SNAP_PX = 8` (`Stage.tsx:69`) dividido entre zoom; valor distinto | Igualar a 10 px y exponerlo en preferencias |
| Elección del candidato | un solo ganador con puntuación normalizada y peso puntero/imán (`snapped-point.cpp:361-410`) | Por eje, el más cercano (`snap.ts`, `snapBox`) | Puntuación conjunta, peso 0,5, penalizaciones |
| Objetivos | objetos (bordes, centros, nodos), guías, rejilla, alineación, distribución | Bordes y centros de página, guías del usuario y capas (`snap.ts`, `snapTargets`) | Nodos y rejilla; distribución |
| Espaciado igual | cadenas de cajas a la misma distancia, con indicador (`distribution-snapper.cpp`) | No existe | Todo el mecanismo |
| Indicadores | líneas y marcas de distancia; `snap-indicator.cpp` | Solo líneas de guía (`showGuides`) | Marcas de distancia y de huecos iguales |
| Retardo por velocidad | sí, 0,02 px/ms y vigilancia (`tool-base.cpp`) | No: ajusta en cada movimiento | Retardo y vigilancia |
| Candidatos | una vez por gesto, área visible, bandas (`snap.cpp`, `distribution-snapper.cpp`) | `snapTargets` en cada movimiento, sobre todas las capas (`Stage.tsx:961,980,995`) | Calcular al empezar el arrastre; filtrar por área y banda |
| Índice espacial | no hay RBush; usa el área visible y bandas | No hay (el proyecto no depende de RBush ni de flatbush) | Bandas primero; un índice solo si el conteo lo pide |
| Modo Dibujo / Diseño | no aplica (Inkscape no tiene dos modos) | El ajuste está encendido en todo (`SNAP_DEFAULT`, `snap.ts`) | Modo Dibujo apagado; Diseño encendido |

## Reglas de producto (pedidas por el usuario)

- **Dibujo:** el ajuste está apagado por defecto y nunca se aplica al pintar ni a trazos raster. Solo se ofrece al mover una capa, si el usuario lo activa, para no lastrar la fluidez con muchos trazos. Se decide con `paintModeOf` (`src/engine/design/paintMode.ts:13`).
- **Diseño:** encendido por defecto, con sugerencias de espaciado y alineación al mover.
- **Rendimiento:** los candidatos se calculan al empezar el arrastre (como `setup`, `snap.cpp:696`), se limitan al área visible y se filtran por bandas, y la comparación por movimiento es solo sobre esos pocos candidatos.

## Plan de implementación (del más rentable al menos)

1. **Tolerancia de 10 px de pantalla y umbral común** (pequeño). Cambiar `SNAP_PX` a 10 y leerlo de un único sitio. Test: `snapBox` con zoom 0,5 y 2 da la misma distancia visual.
2. **Elegir un ganador con puntuación conjunta** (pequeño). Función pura `pickSnap(candidates, pointer, weight=0.5, tolerance)` con la fórmula de `snapped-point.cpp:381-386`. Test: dos candidatos, el más cercano al puntero gana cuando la distancia de ajuste empata; el de menor distancia gana con `weight=0`.
3. **Retardo por velocidad** (pequeño-mediano). En Stage, si la velocidad del puntero supera 0,02 px/ms, no ajustar; ajustar al frenar o tras 150 ms (vigilancia). Test: función pura `shouldSnapNow(speed, idleMs)`.
4. **Candidatos al empezar el arrastre y filtrados por banda** (mediano). Calcular `snapTargets` al pulsar, filtrar por el área visible y por solape en horizontal o vertical. Test: con 500 capas, solo entran las de la banda; el conteo no cambia entre movimientos.
5. **Espaciado igual** (mediano-alto). Función pura en la línea de `distribution-snapper.cpp`: cadenas de cajas a la misma distancia en la banda, con la tolerancia por nivel de `0,5·10⁻⁴`. Indicador: marca de hueco en Stage. Test: tres cajas con huecos 10 y 10,00005 se igualan; con 12 no.
6. **Modo Dibujo apagado y Diseño encendido** (pequeño). Leer `paintModeOf` en la inicialización del snap. Test: un documento en Dibujo nunca produce ajustes al pintar; uno en Diseño sí.

Cada paso lleva tests de la función pura y, en lo visual, un e2e con preparación por el store (la lección de `path-nodes-ux`: los tests de geometría no prueban la interfaz).

## Lo no verificado

- No se ejecutó Inkscape; las fórmulas son de lectura del código del commit 244d48f, no de su comportamiento medido.
- No se encontró por nombre la GSoC 2021 de snapping ni el merge request del rediseño de 1.2; las URLs citadas son issues relacionados, no el rediseño.
- Los valores 0,02 px/ms, 150 ms de vigilancia y 0,5·10⁻⁴ del hueco se han tomado del código; no se han medido en el navegador.
- No se midió el coste de OGS con muchos objetos; la recomendación de bandas se basa en la lectura del código.

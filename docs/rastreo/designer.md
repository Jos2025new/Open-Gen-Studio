---
type: rastreo
title: Rastreo del Designer (historia, reversiones, regresiones y respuestas)
description: Qué quedó frágil o pendiente en el Designer, qué decisiones se revirtieron, qué arreglos dejaron secuelas y qué preguntas de los huecos ya tienen respuesta, con commit o archivo:línea y estado verificado contra el código.
tags: [designer, rastreo, historia, regresiones, pendientes]
updated: 2026-10-28
---
# Rastreo del Designer

Rama `task/designer-measure` (HEAD `1f0a2b0`). Todo salió de leer docs, `git log` y el código; no se ejecutó la app ni se probó en navegador. Convención: **cerrado** (con el commit o código que lo cierra), **abierto** (con evidencia de código), **sin verificar** (no se puede comprobar leyendo). Los docs y los mensajes de commit son pistas; el estado actual lo fija el código. Registro de controles: [README](../designer-controles/README.md), [hallazgos](../designer-controles/hallazgos.md), [huecos](../designer-controles/huecos.md).

## 1. Marcas de frágil, pendiente o sin cerrar y su estado hoy

Búsqueda en `docs/pendientes*.md`, `docs/history/*`, `docs/features/designer*.md`, `docs/designer-*.md`, `docs/plan-*`, `docs/audits/`, `docs/render-estado.md` y cuerpos de commit. No hay ningún «FRÁGIL / REVISAR DESPUÉS / TODO» escrito sobre código del Designer: los únicos «frágil» (`docs/history/053-2026-10-W43.md:1`, `f17b857`, `79ea257`, `9933a38`) son del agente y del guardado, fuera de esta área.

| # | Dónde se escribió | Qué decía | Estado hoy |
| --- | --- | --- | --- |
| 1.1 | `docs/pendientes-designer.md:6` (D1, 2026-10-09) | Fusionar, rasterizar y Grow/Shrink sin test propio; probar brocha, zoom 3200 %, modos y espejo en el navegador | **Parcial.** `mergeDown` tiene tests (`tests/designer-layer-fixes.test.ts:31,42`, 2026-10-23) y `pixel-selection.test.ts` cubre selección; `rasterizeLayer` no aparece en ningún test (grep). La prueba en navegador: sin verificar. El texto de D1 sigue diciendo «sin test propio» (desfasado en fusionar) |
| 1.2 | `pendientes-designer.md:7` (D4) | Presión mínima solo probada con ratón | Sin verificar (necesita lápiz real) |
| 1.3 | `pendientes-designer.md:9` (D9) | Clics nativos en el menú FX cierran sin añadir capa; causa sin confirmar | Sin verificar; el código no deja pista (`FxPanel.tsx`) |
| 1.4 | `pendientes-designer.md:13` (D11) | Nodos coincidentes a zoom bajo corregidos en `2949201` sin test propio; revisión de GPT pendiente | **Abierto:** `2949201` (2026-10-11) toca 5 líneas de `PathNodes.tsx`; `tests/path-nodes.test.ts` tiene casos de nodos coincidentes por topología (:232, :290), ninguno por distancia en pantalla a 5 %. Revisión de GPT: sin verificar |
| 1.5 | `pendientes-designer.md:21` (D18) y [diagnostico-escala-lineart](../diagnostico-escala-lineart.md) | Lineart se deforma al encoger; aprobado con reservas (90/100), 10 % residual | **Abierto en lo humano, cambiado en el código.** `transformStroke` hoy solo compone la matriz (`src/engine/design/affine.ts:52-54`, `6319284`, 2026-10-13); la «causa más probable» del diagnóstico (taper fijo en `affine.ts:52-54`) ya no existe tal como se describe (ver 5.5). Falta el caso concreto del usuario |
| 1.6 | `pendientes-designer.md` (D29, 2026-10-23) y `docs/history/050-2026-10-W43.md:17` | Los PNG de capas borradas o fusionadas siguen en disco; borrar requiere aprobación | **Abierto.** `daeb56c` solo libera memoria (`releaseBuffers`); `deleteBuffers` solo se llama al borrar documento o sesión (`src/engine/design/actions.ts:91`, `src/engine/actions.ts:791`). Zona protegida: [persistencia-protegida](../persistencia-protegida.md) |
| 1.7 | `docs/history/051-2026-10-W43.md` «Pendiente» y `docs/pendientes.md:12-22` | Siete pruebas de sandbox sin hacer: Keep Opacity, textura y presión simulada, Trim, SVG con Glow, clic por forma, icono D30 | Sin verificar. Ninguna nota posterior las cierra (grep en `docs/history/052-054`). Los commits `19499ef`, `3c6c719`, `aacb89b`, `ebb7358`, `4906746`, `b19b84a` están probados solo con tests |
| 1.8 | `051-2026-10-W43.md` «Riesgos residuales» | Capas con opacidad 0 seleccionables; Trim puede cortar el halo de un FX; los paths se seleccionan por su caja | **Abierto** (decisión consciente). `4906746`: «paths keep their box». Sin verificar el caso de halo FX |
| 1.9 | `docs/features/designer.md:64` (2026-10-13) | Primitivas, flechas, degradados y nodos «hechos, bajo supervisión… pendiente de uso prolongado» | Sin verificar. No hay nota de cierre; `f17b857` solo marcó páginas de agente «bajo prueba» |
| 1.10 | `docs/history/024-2026-10-W41.md:118` | «Borrar segmento» como botón y soldar nodos contiguos, pendientes | **Cerrado:** `a224c8a` (delete segments) y `099f6a2` (weld, 2026-10-12); botones «Delete segments» y «Join» en `ContextStrip.tsx` (rama de nodos) |
| 1.11 | `024-2026-10-W41.md:168` | e2e «simulate pressure: rápido más fino» falló; sin saber si regresión | **Cerrado:** `619be4f` (2026-10-11): el e2e fija el pincel que mide. Presión por velocidad cambió después (`3481b33`) |
| 1.12 | `docs/render-estado.md:18,64`, `arquitectura-render.md:93` | Límite raster 64 trazos / 8192 segmentos «provisional», sin comprobación visual | Sin verificar (visual). El límite sigue marcado provisional en los docs |
| 1.13 | `pendientes-designer.md:15` (D14) | Sonda del guardado inexistente; 18+9 pendientes de render | Sin verificar; fuente única [render-estado](../render-estado.md) |
| 1.14 | `docs/history/018-2026-10-W40.md:97-100` | Máscara cubre objetos nuevos añadidos a la capa (dibujar fuera queda oculto); detección de `pageFill` sin prueba específica | Sin verificar |
| 1.15 | `pendientes-designer.md` (D31, D10, D13) | Compatibilidad Inkscape completa, prueba permanente y SVG real | Abierto: `4a882c3` (2026-10-24) añadió `sodipodi:` en sector, arco, cuerda, polígono, estrella; faltan los puntos que D31 enumera |
| 1.16 | Auditoría [auditoria-toolbox-guides-sizes](../audits/auditoria-toolbox-guides-sizes.md) (H1-H7) | Siete fallos de Canvas size y Guides | **Cerrado** en `1077248` (2026-10-23). Código: `CanvasSize.tsx` (`useEffect(() => setBgEdit(null), [doc.background])`, `setDpi`, `pickPreset` por orientación), `GuidesCard.tsx` (`setSnapGuides` enciende Snap general), `persistUi.ts:25` valida booleanos, `shortcuts.ts:59` ya dice «Show or hide rulers» |
| 1.17 | `docs/designer-tecnico-2.md:50,62` | «Ramas inalcanzables» de `designerKeys` (Delete de capas y teclas de herramienta) | **Cerrado** en `1994e71` (2026-10-23, «fix designer tool and delete shortcuts»); en el código actual la cadena es plana (`designerKeys.ts:88,93-95`). El doc sigue afirmándolo (ver 5.1) |

Totales de la sección: 17 filas; 4 cerradas (1.10, 1.11, 1.16, 1.17), 1 parcial (1.1), 5 abiertas con evidencia (1.4, 1.5, 1.6, 1.8, 1.15), 7 sin verificar (1.2, 1.3, 1.7, 1.9, 1.12, 1.13, 1.14).

## 2. Decisiones revertidas o sustituidas

| # | Decisión original | Reversión | Huellas que quedan |
| --- | --- | --- | --- |
| 2.1 | Contextos de canvas por CPU para toda la app (`0ee9f2f`) | `65b91da` (2026-10-12): «GPU by default again»; CPU solo para el oráculo y el banco | Limpio: el conmutador existe a propósito (`src/lib/media.ts:77`, `src/lib/designerBench.ts:12`, `bench/engines/cacheoracle.ts:2`) y [render-baseline](../render-baseline.md):171-179 lo explica (2057 MB de RSS con CPU) |
| 2.2 | Edit, modo Objects: un clic cae en el objeto superior de cualquier capa visible y desbloqueada (`3112c37`, 2026-10-23) | `7f976b4` el mismo día: se retira el respaldo entre capas; con Auto-select apagado solo actúa la capa activa | Código coherente (`src/engine/design/autoSelect.ts` `clickCandidate`, `Stage.tsx:687`). Antes: `958e123` (2026-10-14) había «restaurado» el autoselect entre capas. Los docs actuales ya lo dicen bien (`features/designer.md:49`); el mensaje de `3112c37` es la única huella |
| 2.3 | [plan-toolbox-dock](../plan-toolbox-dock.md): dos toolbox, uno por modo (Drawing y Design), con familia «visitante» y `PaintModeToggle` siempre visible junto a Layers | `1c2b24f` (2026-10-23): un solo toolbox para ambos modos, y Drawing/Design «stays in the brush card»; `2f78f9c`: el interruptor se muestra una vez | **Huellas:** `plan-toolbox-dock.md:7,11,52,58,72,76,110,116` siguen describiendo dos toolbox, familia visitante (no existe: grep `visit` vacío en `ToolDock.tsx` y `toolboxModel.ts`) y el interruptor siempre visible. El único montaje es `ToolSettings.tsx:266` dentro de la tarjeta del pincel |
| 2.4 | Plan: familia «Shapes» con las 9 formas en Design | `b258f6e` (2026-10-23): las formas viven en la fila de Edit, sin familia propia | Huella: tabla de `plan-toolbox-dock.md:11` |
| 2.5 | Plan: al pulsar una variante se despliega la tarjeta (`plan-toolbox-dock.md:18`) | `c1a1df7`: elegir variante solo cambia la herramienta; la tarjeta se abre con el chevron o un segundo clic (`toolboxModel.ts` `reduceToolboxState`) | Huella en el plan |
| 2.6 | Rail de herramientas (`RAIL`, `ToolRail.tsx`) con `ContextStrip` encima | `f11a0dd` (2026-10-23): `ToolRail` eliminado; el Studio usa `ToolDock`; la tira queda solo dentro de `EditCard`. Lectura de `ToolDock.tsx:60,64-67,133`: `EditCard` solo se monta con la variante `edit`, y el efecto solo re-despacha al cambiar de familia; por eso las ramas de texto, pincel, borrador, curva, lineart, ruler, fill y gradient son código muerto por lectura. La lectura inicial incluía Select en Edit y dejaba R/O/L/M sin probar. La prueba posterior con la variante Edit abierta observó las ramas compactas de R/O/L; M pasa a la familia Brush y cierra la tarjeta. No se observaron todas las combinaciones ([revisión P1/S1](../designer-controles/revision-ubicacion.md#visto-en-sandbox)) | **Huellas:** `designer-tecnico.md:48` (`ToolRail.tsx`, `RAIL`, `railTools`: ni el archivo ni los símbolos existen) y `features/designer.md:56` (barra por familias `RAIL` y franja contextual «encima») |
| 2.7 | Seis herramientas de forma (Sector, Arc, Chord, Polygon, Star, Arrow) como botones propios | `b955f45` (2026-10-23): tres herramientas tras Inkscape (Ellipse con tipo, Polygon/Star, Line con Arrow); los tipos guardados no cambian | Huellas: `designer-guia-usuario.md:167` y `designer-tecnico.md:211` («Diez herramientas»), y la ayuda `ToolHelp.tsx:24-27` (ver 3.3) |
| 2.8 | Reducir los presets de tamaño a 8 (maqueta A1/C9) | Rechazado: se mantienen 14 (`4f37e64`, 2026-10-23; [huecos](../designer-controles/huecos.md) §3) | Sin huellas |
| 2.9 | B8: quitar el botón del panel derecho de la barra del dock | Descartada ([huecos](../designer-controles/huecos.md), párrafo inicial) | El duplicado «Show or hide right panel» + «Collapse layers panel» sigue (hallazgos, Duplicados) |
| 2.10 | Sustituir Inter por DM Sans/Outfit en toda la app (Home, `docs/history/042`) | `ee332e5` (2026-10-17): Inter vuelve para el Designer, porque sus documentos nombran `Inter Variable`; ADR [0019](../decisions/0019-tipografia-app-y-designer.md) lo registra | Coherente: `src/main.tsx:3`, `src/engine/design/doc.ts:11`, `tests/fonts.test.ts` |
| 2.11 | Propuesta de interfaz del Designer (2026-10-05) | `8ee3bb3` (2026-10-07): «drop the superseded Designer proposal» | Sin huellas localizadas. Le sucede [propuesta-gui-pintura](../propuesta-gui-pintura.md) (D17, sin decidir el orden) |
| 2.12 | Inventarios del Designer (2026-10-23) | `ee1424f` (2026-10-28): pasan a notas de redirección; fuente de verdad [designer-controles](../designer-controles/README.md) | Correcto: `inventario-herramientas-designer*.md:3` lo avisa. Pero `designer-tecnico.md` sigue citando el rail (2.6) |

Totales: 12 reversiones o sustituciones; 5 con huellas obsoletas en docs (2.3, 2.4, 2.5, 2.6, 2.7); código muerto asociado: ninguno encontrado (`polygonPath` ya se quitó en `b955f45`).

## 3. Arreglos con secuelas y contradicciones entre decisión y código

| # | Gravedad | Prueba | Evidencia |
| --- | --- | --- | --- |
| 3.1 | **Media** | Probado por lectura | La rama «texto seleccionado» de la tira es código muerto desde `f11a0dd`. `ContextStrip.tsx` define `selectedText = tool === 'text' && active?.type === 'text'`, pero la tira solo se monta en `EditCard.tsx:37`, que `ToolDock.tsx:133` muestra con la variante Edit (herramienta `move`). Con Text activo no hay tira, y `ToolSettings.tsx` no tiene ninguna rama para «capa de texto elegida» (grep `type === 'text'` vacío). Promesa rota: `features/designer.md:56` y el comentario de `ContextStrip.tsx` («con un texto seleccionado los campos cambian esa capa»). El texto de una capa solo se edita en Properties (`LayersPanel.tsx:277`). Alcance: [hallazgos](../designer-controles/hallazgos.md) y [huecos](../designer-controles/huecos.md) §4.7 lo marcan «no alcanzable por lectura»; aquí queda demostrado con las dos condiciones incompatibles |
| 3.2 | Media | Probado por commits | Cadena D30: `b72412e` (nunca guardar encima una capa ilegible) dejó que una edición hecha sobre la capa en blanco se descartara al recuperarla; `b35dfd1` (edición nunca se almacena) y `3a8362c` (mensaje a `pixelsNotReady` por tamaño). Cerrado con `tests/raster-unreadable.test.ts` y fila en [persistencia-protegida](../persistencia-protegida.md) |
| 3.3 | Baja | Probado por lectura | Ayuda de herramienta desfasada tras `b955f45`: Star dice «Sides, Inner and Round» (`ToolHelp.tsx:25`), Sector/Arc/Chord «From and To» (`:26-28`) y **Polygon dice «Sides is in the strip»** (`:24`), pero los controles son Corners, Spoke ratio, Rounded, Start y End (`ShapeKindFields.tsx:23,35-37`). El caso Polygon no está en hallazgos |
| 3.4 | Baja | Probado por lectura | La variante Sculpt (soon) pide un icono `sculpt` que no está en `ICONS`; `iconFor` cae a `CircleHelp` (`ToolDock.tsx:26`; grep `sculpt` en `ToolDock.tsx` vacío) y muestra «?» |
| 3.5 | Baja | Probado por commits | Cadena de revisión del 2026-10-27: `c04a908` (parada de zoom) y `b9bc783` (distancias al mover) seguidas por `a0be491` («Ctrl measures only when pressed in the drag», rueda con vista reciente, etiquetas enteras). Rama `task/designer-measure` pendiente de revisión del usuario. El registro `lienzo-gestos.md:23` solo dice «Ctrl cambia el modo (`moveMode`)» y no menciona las distancias a vecinos (ver 5.4) |
| 3.6 | Baja | Probado por commits | Audit Guides/Sizes (`c7cef80`, `26fcf1b`, `03e9f9d`): 7 fallos graves por la propia auditoría (color deshecho que se reaplica, HD vertical, Keep ratio, Snap a guías apagado, flags sin validar, A4 con DPI, ayuda Shift+R). Todos corregidos en `1077248`; ver 1.16. Efecto lateral aceptado: activar «Snap to guides» enciende el Snap general (`GuidesCard.tsx` `setSnapGuides`), mientras que el check «Guides» del popover Snap solo cambia `guides` y se deshabilita con Snap apagado (`SnapControl.tsx:23`). Dos controles, mismo campo, semántica distinta: sospecha de confusión, sin verificar en pantalla |
| 3.7 | Baja (el usuario lo declaró bug y grave el 2026-10-29: S3) | Probado por lectura; visto en sandbox (100-900 en la herramienta, 300-900 en Properties; sin Line/Spacing) | Weight de un texto: 100-900 en la herramienta (`ToolSettings.tsx:202`) y 300-900 en Properties (`LayersPanel.tsx:277`); un peso 100/200 puesto desde la herramienta no se puede reproducir al editar la capa (el select no tiene esa opción) |
| 3.8 | Media | Sospecha | Keep Opacity cambió de significado con `19499ef` (bloqueo estricto de alfa). Los docs lo describen como «pinta solo donde la capa ya tiene píxeles» ([pincel-avanzado](../designer-controles/pincel-avanzado.md):36), que es coherente, pero el efecto en bordes suaves solo está probado por test, no a la vista (1.7) |

Totales: 8; 4 probados por lectura (3.1, 3.3, 3.4, 3.7), 3 por commits (3.2, 3.5, 3.6), 1 sospecha (3.8).

## 4. Preguntas de huecos y hallazgos que la historia o el código ya responden

| Pregunta (archivo) | Respuesta | Evidencia |
| --- | --- | --- |
| Regla `.align-action-row`: ¿pensada para tres columnas? ([huecos](../designer-controles/huecos.md) §4.4 y §5) | **No: es una rejilla de 5 columnas** (`repeat(5, …)`), con borde divisorio en el hijo 4. Las 4 acciones borde a ancla caben en una segunda fila de 5 sin tocar la regla | `src/styles/designer.css:131-134` |
| ¿El texto «add one below» del estado vacío de FX está mal? (huecos §5) | Hoy es correcto: la lista de operaciones va arriba y el campo «Add» debajo. Solo cambia si se adopta A5 (Add arriba) | `FxPanel.tsx:90-94` |
| Criterio con que `AgentGlow` ilumina el lienzo (huecos §6; `lienzo-gestos.md:39`) | Se ilumina cada capa cuyo objeto cambió entre el documento anterior y el posterior en la ruta del agente, durante 1,2 s; solo en memoria, nunca se guarda ni exporta | `src/engine/design/agentGlow.ts` (`agentChangedIds`, `GLOW_MS = 1200`), commit `44311e3` (2026-10-27) |
| ¿Los presets de tamaño se reducen a 8? (huecos §1 y §3) | No; los 14 se confirmaron en código y commit | `4f37e64` |
| ¿Delete layer crea paso de deshacer? (hallazgos, «Acciones destructivas») | Sí: `deleteLayers` pasa por `mutateDoc`, un solo paso para varias capas (`src/engine/design/actions.ts:273-279`); hallazgos lo dejaba «sin confirmar» |
| Zoom: ¿hay atajos? (hallazgos) | Siguen sin atajos de teclado; sí hay paradas de rueda a 25, 50, 100, 150 y 200 % desde `c04a908` | `wheelZoom.ts` (`ZOOM_STOPS`) |
| Max de Sides (inventario antiguo punto 7) y ramas inalcanzables (punto 6) | Ya no se reproducen (Corners hasta 24; cadena plana tras `1994e71`) | hallazgos.md; `ShapeKindFields.tsx:35`; ver 1.17 |
| Weight 100-900 vs 300-900 (hallazgos) | Confirmado hoy en código | ver 3.7 |
| Sin responder aún | Vista previa P1/P2, icono Guides, ubicación de Advanced, fila Angle (rotación de la vista: [propuesta-gui-pintura](../propuesta-gui-pintura.md):42,57 la pide, «medio», sin decidir), muestra de color fija, A4 «Modo primero» | huecos §4; ninguna decisión posterior en `docs/history` |

Totales: 8 respondidas; 1 fila con las decisiones que siguen abiertas.

## 5. Documentos que se contradicen o contradicen el código

| # | Documento | Afirmación obsoleta | Realidad (evidencia) |
| --- | --- | --- | --- |
| 5.1 | `docs/designer-tecnico-2.md:50,62` | Ramas de Delete y teclas de herramienta inalcanzables en `designerKeys.ts:78-97` | Corregido en `1994e71`; [hallazgos](../designer-controles/hallazgos.md) ya lo desmiente y pide corregir este punto |
| 5.2 | `docs/designer-tecnico-2.md:47` | `Edit` (Object/Layer) y `Auto-select` solo en la pestaña Tool | Ya no hay pestañas: en el dock están en el ajuste Edit (`ToolSettings.tsx:250`) y quedan ocultos con una forma elegida (hallazgos, punto 3) |
| 5.3 | `docs/designer-tecnico.md:48`, `docs/features/designer.md:56` | `ToolRail.tsx`, `RAIL`, `railTools`, franja contextual sobre el carril | Eliminado en `f11a0dd` (2.6) |
| 5.4 | `designer-controles/lienzo-gestos.md:23` | Arrastrar lo elegido: «Ctrl cambia el modo (`moveMode`)» | Incompleto: Ctrl pulsado durante el arrastre apaga el imán y muestra las distancias a los vecinos más cercanos (`Stage.tsx:1028-1036`, `neighbourGaps.ts`; `docs/features/designer-selection.md:25`) |
| 5.5 | `docs/diagnostico-escala-lineart.md:7,64` | `transformStroke` multiplica `size` y no toca los tapers | Superado por `6319284`: solo compone la matriz (`affine.ts:52-54`). Es un diagnóstico histórico sin aviso de que la causa ya no aplica |
| 5.6 | `docs/plan-toolbox-dock.md` | Dos toolbox, familia visitante, `PaintModeToggle` siempre visible, Shapes como familia | Ver 2.3-2.5. El mismo doc lleva fecha 2026-10-23 y no tiene nota de supersesión |
| 5.7 | `docs/pendientes-designer.md:6` (D1) | Fusionar sin test propio | `tests/designer-layer-fixes.test.ts:31,42` (1.1) |
| 5.8 | `designer-guia-usuario.md:167`, `designer-tecnico.md:211` | «Diez herramientas en un solo botón» | La interfaz agrupa en tres (`b955f45`); las diez siguen existiendo como valores de `ui.tool` |
| 5.9 | `designer-controles/hallazgos.md` («El comentario de `ViewToggles`…») y `ToolHelp.tsx:47-51` | El comentario habla de reglas y guías | Solo hay el botón de ayuda; cierto (auditoría Guides/Sizes, afirmación 3) |
| 5.10 | `designer-controles/toolbox-dock.md` vs `inventario-herramientas-designer.md:3` | El inventario viejo declara su sustitución | Correcto; sin contradicción. Un fallo menor: el registro cuenta 31 variantes (7 soon) y el código define `MULTI_SOON` aparte (`toolboxModel.ts`), que el recuento puede no incluir (sin verificar) |

Totales: 10 filas; 8 con contradicción real (5.1 a 5.8); 5.9 y 5.10 son consistentes o sin verificar.

## Los diez asuntos de más impacto para el usuario

1. **Editar el texto elegido desde la tira no es posible** (3.1): promesa documentada sin camino de código.
2. **Siete pruebas visuales del 2026-10-23 sin hacer** (1.7): Keep Opacity, texturas, Trim, exportación SVG y selección por forma solo verificados con tests.
3. **PNG huérfanos en disco** (1.6, D29): crecimiento de datos; pide aprobación por tocar la zona protegida.
4. **Lineart que se deforma al encoger, 10 % residual** (1.5): sin caso concreto del usuario.
5. **Riesgos residuales aceptados** (1.8): Trim puede cortar halos FX, paths se eligen por su caja.
6. **Controles ocultos o duplicados** ([hallazgos](../designer-controles/hallazgos.md)): Object/Layer y Auto-select desaparecen con una forma elegida; Ctrl+E y Ctrl+Y sin lista; doble clic FX sin botón.
7. **Rendimiento del render** (1.12, 1.13): D14 es «alto»; límite raster aún provisional.
8. **Ayuda de herramienta engañosa** (3.3): nombres de campos que no existen.
9. **Weight desigual** (3.7): 100/200 no editable en Properties.
10. **Menú FX con clics que no añaden capa** (1.3, D9) e icono «?» de Sculpt (3.4).

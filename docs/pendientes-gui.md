# Pendientes de la interfaz por espacios (`task/gui-cohesion`)

Lista viva de lo que quedó sin hacer o sin ver tras [039](history/039-2026-10-W42.md), con su porqué y dónde mirar. Formato: casilla, asunto, porqué, lugar. Al cerrar uno, pásalo a [pendientes-cerrados](pendientes-cerrados.md) con fecha y evidencia. El resto de pendientes está en el [índice](pendientes.md).

**Origen y prioridad (revisión del 2026-10-22).** Origen por sección: «Código sin arreglar» y «Diseño sin decidir» y «Sin ver en navegador», 2026-10-15/16 (039), salvo fecha propia; «Home rediseñado», 2026-10-17; «Tarjetas del chat», 2026-10-18. Prioridad por defecto: **medio** si es «sin ver en navegador», **bajo** si es diseño sin decidir. **Alto**: la F de abajo (fricción de uso), «Acciones de varias salidas» (error reportado por el usuario, sin reproducir) y «Borrar capas con el teclado» (decisión del usuario de no arreglar todavía). `gui-cohesion` ya está fusionada en esta línea (ver cerrados).

## Código sin arreglar (hallados, no introducidos)

- [ ] **Borrar capas con el teclado y teclas de herramienta (V, H, B, E…) nunca se ejecutan.** El bloque de `deleteLayers` y la búsqueda en `DESIGN_TOOL_KEYS` están anidados dentro de la rama de las flechas. Pasa también en el Designer completo; el código se movió tal cual. Decisión del usuario: no arreglar todavía. `src/components/designer/designerKeys.ts:87` (borrar) y `:94` (teclas de herramienta). **2026-10-15**, código; **revisado 2026-10-16**, sigue igual.
- [ ] **Edición de nodos de trazados con escuchas de `window` no acotadas al tablero.** Escape y atajos de nodos actúan aunque el foco esté en el chat si hay un trazado en edición; ya ignoran campos de texto, pero no el ámbito. Porque el ámbito se añadió solo a `designerKey`, `Stage` y el portapapeles. `ShapeKnots.tsx:40`, `PathNodes.tsx:75`, `MultiPathNodes.tsx:36` (en `src/components/designer/`) y `useCursorPreview.ts` (en `src/engine/design/`). Revisado 2026-10-16.
- [ ] **Textos de operación escritos para el agente.** El tooltip de los menús de operación (`867c426`) muestra `description` de `ops.ts`, que también lee el agente. Hay descripciones con nombres de parámetros internos: `join_clips` (`params.music`, `params.loudness`), la operación de filtros/efectos (`params.effect`, `params.amount`), y `reference_sheet` y `contact_sheet` con nombres internos. Hace falta un texto de usuario aparte, sin tocar el que lee el agente. `src/engine/ops.ts` (`join_clips` ~331, fx ~430, `reference_sheet` ~209, `contact_sheet` ~302). **2026-10-16**, hallazgo del usuario.

## Diseño sin decidir o sin hacer

- [ ] **Studio en ancho estrecho (≤760 px): el tablero se oculta y no hay modo apilado.** Porque el panel apilado de Create no tiene equivalente en Studio. `src/styles/studio.css:31`.
- [ ] **Pestaña Projects de Home sin definir.** Se muestra como «soon»; falta decidir qué es un proyecto. `HomeView.tsx` (`TABS`).
- [ ] **Tools: las teselas del selector de entrada no tienen el icono de tipo de respaldo** (`KindBackdrop`) cuando falta el archivo, como sí tienen el tablero y el chat de Studio. `src/components/space/ToolsPanel.tsx` (no usa `KindBackdrop`).
- [ ] **La tarjeta de Studio en Home puede verse vacía** (sin miniatura ni resumen más que el recuento). `HomeView.tsx` (tarjeta `studio`). Pendiente de decidir qué mostrar.
- [ ] **Idea del usuario: herramientas ancladas (pinned) en Tools y Home.** Sin diseño; la lista actual es todas las operaciones de `ops.ts`.
- [ ] **Designer incrustado: lo que no trae a propósito** (pincel raster, relleno, selección de píxeles, regla, cuentagotas, crear diseños desde el estado vacío más allá de File → New, importar desde el chat). Se añade de uno en uno si el usuario lo pide; el filtro es `EMBEDDED_TOOLS` en `EmbeddedDesignerBar.tsx`.
- [ ] **«Add files» del compositor con Studio y Designer abierto** lanza `ogs:upload`, que solo escucha el Designer completo; el incrustado no lo recoge. `ComposerOptions.tsx:33`.
- [ ] **Grid/List del tablero y el cierre automático no persisten entre recargas.** Grid/List es estado local de `SpaceBoard` (`SpaceBoard.tsx:31`); el «ya abierto en esta sesión» vive en memoria (`studioBoard.ts:48`), así que una recarga puede abrir el tablero una vez más. Decidir si se guarda (en `ogs:studio-board`, por ejemplo) o se deja así. **2026-10-16**.
- [ ] **Acciones de varias salidas: «un error al seleccionar varias»** (reportado por el usuario). **No reproducido** en tests. Solo hay un arreglo especulativo: la fila de acciones envuelve (`1033a0d`). Falta el caso exacto (qué botón, cuántas imágenes, qué pasó) o una captura. `StudioGeneration.tsx`, `studio.css`. **2026-10-16**.

## Sin ver en navegador (solo código y tests)

- [ ] **Sin tests de interacción real sobre los canvases incrustados.** jsdom con canvas simulado cubre render, popovers, foco y teclas, no arrastrar, mover ni ReactFlow con nodos reales; la captura de Nodes tenía el grafo vacío. `tests/studio-layout.test.ts`, `tests/studio-designer.test.ts`.
- [ ] **Done y Ongoing de Studio con trabajo en curso real** (plegado automático, filas) sin recorrido archivado. El usuario lo ha usado en su propia sesión (2026-10-16), pero no hay captura del sandbox. `boardModel.ts:55` (`doneExpanded`).
- [ ] **Go → Create y el aviso de adjunto no admitido** no se han visto; solo el mapeo puro está probado. `actionGo.ts`, `tests/action-go.test.ts`.
- [ ] **Teclado y portapapeles reales dentro del tablero** (Ctrl+Z, Ctrl+V de una imagen, no actuar desde el chat) no se probaron en un navegador; solo con eventos simulados.
- [ ] **`open_board` y `continue_in_*` con un modelo real del agente.** El test usa un LLM simulado; falta ver al agente elegir el tablero por sí solo. Además, `continue_in_canvas`, `continue_in_designer` y `continue_in_chat` desde Studio abren el tablero en esa pestaña (`e618fae`): **bajo pruebas**; el usuario lo dejó así por ahora («Aún está bajo pruebas, pero lo dejaremos así por los momentos»). Cuesta dinero: ver [la lista de pruebas](gui-cohesion-pruebas.md). `agentCanvas.ts` (`moveToCanvas`), `runtime.ts`.
- [ ] **Importar imágenes del chat al Designer incrustado** salió con 0 capas en el sandbox porque faltaban los archivos de los activos; con activos reales, sin ver.
- [ ] **Pasos 1 a 3 de la interfaz** (tokens, Home, barra, Create, Tools): los tests cubren el modelo y el render; un recorrido visual completo no está archivado.
- [ ] **Tooltip de la barra lateral que se solapa con el panel flotante o con el título de Home** (aviso del usuario). No reproducido; `data-tip` se oculta con el panel abierto (`SidebarNav.tsx:71`). `sidebar-nav.css`, `shell.css`.
- [ ] **Selector de sesiones de la barra superior** (buscar, selección múltiple, borrado de las marcadas, «+» arriba; `3985e31`). Probado solo con `tests/session-switcher.test.ts`; sin ver en navegador.

## Verificar fuera del código

- Pasó a [B1 de pendientes-agente](pendientes-agente.md): posible cobro de $0.068 por una generación interrumpida (2026-10-16).

## Para fusionar

- Cerrado el 2026-10-22: `task/gui-cohesion` es ancestro de esta línea ([cerrados](pendientes-cerrados.md)).

## Prueba GUI 2026-10-16 (pendientes de aprobación)

- **E.** Pasó a [A1 de pendientes-agente](pendientes-agente.md), junto al caso nuevo del 2026-10-22 (misma tarjeta repetida).
- **F. (alto, 2026-10-16) Tarjeta «Plan … Revised» enorme para cambios pequeños.** `src/components/chat/PlanCard.tsx:153`. Propuesta: variante compacta cuando `item.revised` y hay un paso: «Cambio: título», coste y botones, sin lista de pasos ni la palabra «Plan».
- [ ] **Recortes ocultos del catálogo, lo que queda.** Hecho 2026-10-16: topes 200/400, filtro `tools` del Director, vídeo NanoGPT sin flags (`nano:v3:videos`, `nanoVideoInputs`). Queda: la lista blanca `NANO_3D_MODELS` (`nanogpt.ts` ~296) oculta a propósito los demás modelos 3D del catálogo; la de audio es decisión documentada y no se toca.

## Home rediseñado y persona entusiasta (2026-10-17, [042](history/042-2026-10-W42.md))

- [ ] **Miniaturas de Spaces en Home: son marcadores de posición.** Faltan contenido real. `HomeView.tsx`, `home.css`.
- [ ] **Ancho de 390 px:** la barra superior se trunca, las pestañas pasan a dos filas y la píldora de «Connected» no tiene hover en táctil. `topbar-home.css`, `home.css`.
- [ ] **Attach en la barra de Home sin restricciones por modelo.** Acepta lo que acepta el compositor; no avisa de adjuntos no admitidos. `HomeBar.tsx`.
- [ ] **Sin ejercitar a mano:** autoplay del carrusel y «+ New canvas / New design». Solo tests (`home-hero.test.ts`).
- [ ] **Un Space abierto no se restaura con la píldora de volver.** Vuelve al espacio de trabajo y la sesión, no al Space. `TopBar.tsx`.
- [ ] **Cifras de modelos en Apps:** son familias de los proveedores conectados, locales incluidos; no modelos individuales. Decidir si se explica en la interfaz.
- [ ] **Plan de 4 bloques de la persona entusiasta** (propuesta, nada implementado; orden propuesto 1, 4, 2, 3):
  - Bloque 1, primer uso: tarjeta «Paste your API key» con prueba barata de la clave, errores en lenguaje claro, que el agente pase al proveedor de la clave guardada, y comprobar en el sandbox un posible callejón con el planificador local.
  - Bloque 4, coste visible: estimado, máximo y cobrado por separado, validar referencias antes de enviar, evitar duplicados por doble clic, menos jerga, aviso de cambio de modelo por defecto.
  - Bloque 2, comparar modelos: etiqueta «New», «Try in another model», mismo prompt en N modelos con tope, vista lado a lado, recomendaciones por tarea.
  - Bloque 3, operaciones en contexto: Upscale, Relight y Angle en la tarjeta del resultado (`suggestedOps()`), sin recargar la tarjeta para el usuario profesional.
- [ ] **Cola de agentes («cuando X termine, haz Y»), acordada el 2026-10-16, sin empezar.** Debe proponer arreglos ante fallo o coste. ¿Antes o después de los bloques? Pregunta abierta.
- [ ] **Evidencia de Reddit incompleta** (bloqueado; Manus parcial): faltan comparar, iterar, descubrir operaciones, abandono y jerga.

## Tarjetas del chat, guarda de esquema y borrador (2026-10-18, [042](history/042-2026-10-W42.md) sección 6)

Revisados los pendientes anteriores: estos commits no cierran ninguno. «F. Tarjeta Plan … Revised» sigue abierto: C7b no añadió la variante compacta.

- [ ] **C7b: Editar al pasar el ratón** sobre prompts, variaciones y estilo sin ver en navegador. `PlanParts.tsx`, `chat-cards.css`.
- [ ] **C7b: estados hecho y fallido de las filas** sin ver en navegador. `PlanCard.tsx`, `chat-cards.css`.
- [ ] **C7b en la app real.** La única prueba visual es una vista previa del sandbox con datos falsos. Un plan real cuesta dinero: pedir coste máximo y aprobación antes ([AGENTS.md](../AGENTS.md)).
- [ ] **Búsqueda de modelos y `confirm_settings` no marcan los modelos con esquema derivado.** El plan y los nodos sí. Sin test. [guarda](features/guarda-esquema.md).
- [ ] **Reintentar un fallo mientras el esquema sigue derivado.** La guarda lo rechaza en `jobs.ts`, pero falta una prueba del botón de la tarjeta. `RecoveryActions.tsx`.
- [ ] **Borrador de la barra de Home en el navegador.** Solo pruebas con `HomeView` (tabs, envío, ocupado).
- [ ] **Ongoing con salidas clicables** (`9c2add7`) sin ver. Puede cubrir parte de «un error al seleccionar varias», sin reproducir. `SpaceBoard.tsx`.

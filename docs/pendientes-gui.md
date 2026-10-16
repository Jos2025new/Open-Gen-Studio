# Pendientes de la interfaz por espacios (`task/gui-cohesion`)

Lista viva de lo que quedó sin hacer o sin ver tras [039](history/039-2026-10-W42.md), con su porqué y dónde mirar. Formato: casilla, asunto, porqué, lugar. Al cerrar uno, marca `[x]` con fecha y evidencia. La rama no está fusionada (2026-10-16); el resto de pendientes del proyecto está en [pendientes.md](pendientes.md).

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

- [ ] **Cobro posible de $0.068 por una generación interrumpida.** Una generación quedó «Interrupted by a page reload» mientras se editaba código en el worktree, con el servidor de desarrollo de la carpeta del worktree. No se ha comprobado si el proveedor cobró. Comprobar en el panel del proveedor (Spending o la cuenta) antes de dar la cuenta por buena. Lección ya anotada en [039](history/039-2026-10-W42.md): no lanzar generaciones de pago desde ese servidor mientras se edita.

## Para fusionar

- [ ] Fusión de `task/gui-cohesion` (1658e00 y, sobre él, `3985e31..e618fae`) en la rama raíz: decide el usuario tras probar. Regla de conflictos: gana lo más nuevo ([fusión](fusion-agent-forcing.md)).

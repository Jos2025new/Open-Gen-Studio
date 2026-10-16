# Pendientes de la interfaz por espacios (`task/gui-cohesion`)

Lista viva de lo que quedó sin hacer o sin ver tras [039](history/039-2026-10-W42.md), con su porqué y dónde mirar. Formato: casilla, asunto, porqué, lugar. Al cerrar uno, marca `[x]` con fecha y evidencia. La rama no está fusionada (2026-10-16); el resto de pendientes del proyecto está en [pendientes.md](pendientes.md).

## Código sin arreglar (hallados, no introducidos)

- [ ] **Borrar capas con el teclado y teclas de herramienta (V, H, B, E…) nunca se ejecutan.** El bloque de `deleteLayers` y la búsqueda en `DESIGN_TOOL_KEYS` están anidados dentro de la rama de las flechas. Pasa también en el Designer completo; el código se movió tal cual. Decisión del usuario: no arreglar todavía. `src/components/designer/designerKeys.ts:87` (borrar) y `:94` (teclas de herramienta). **2026-10-15**, código.
- [ ] **Edición de nodos de trazados con escuchas de `window` no acotadas al tablero.** Escape y atajos de nodos actúan aunque el foco esté en el chat si hay un trazado en edición; ya ignoran campos de texto, pero no el ámbito. Porque el ámbito se añadió solo a `designerKey`, `Stage` y el portapapeles. `ShapeKnots.tsx:40`, `PathNodes.tsx:75`, `MultiPathNodes.tsx:36`, `useCursorPreview.ts:14`.

## Diseño sin decidir o sin hacer

- [ ] **Studio en ancho estrecho (≤760 px): el tablero se oculta y no hay modo apilado.** Porque el panel apilado de Create no tiene equivalente en Studio. `src/styles/studio.css:32`.
- [ ] **Pestaña Projects de Home sin definir.** Se muestra como «soon»; falta decidir qué es un proyecto. `HomeView.tsx:44`.
- [ ] **Tools: las teselas del selector de entrada no tienen el icono de tipo de respaldo** (`KindBackdrop`) cuando falta el archivo, como sí tienen el tablero y el chat de Studio. `src/components/space/ToolsPanel.tsx:119`.
- [ ] **La tarjeta de Studio en Home puede verse vacía** (sin miniatura ni resumen más que el recuento). `HomeView.tsx:67`. Pendiente de decidir qué mostrar.
- [ ] **Idea del usuario: herramientas ancladas (pinned) en Tools y Home.** Sin diseño; la lista actual es todas las operaciones de `ops.ts`.
- [ ] **Designer incrustado: lo que no trae a propósito** (pincel raster, relleno, selección de píxeles, regla, cuentagotas, crear diseños desde el estado vacío más allá de File → New, importar desde el chat). Se añade de uno en uno si el usuario lo pide; el filtro es `EMBEDDED_TOOLS` en `EmbeddedDesignerBar.tsx`.
- [ ] **«Add files» del compositor con Studio y Designer abierto** lanza `ogs:upload`, que solo escucha el Designer completo; el incrustado no lo recoge. `ComposerOptions.tsx:33`.

## Sin ver en navegador (solo código y tests)

- [ ] **Sin tests de interacción real sobre los canvases incrustados.** jsdom con canvas simulado cubre render, popovers, foco y teclas, no arrastrar, mover ni ReactFlow con nodos reales; la captura de Nodes tenía el grafo vacío. `tests/studio-layout.test.ts`, `tests/studio-designer.test.ts`.
- [ ] **Done y Ongoing de Studio con trabajo en curso real** (plegado automático, filas) no se han visto. `boardModel.ts:55` (`doneExpanded`).
- [ ] **Go → Create y el aviso de adjunto no admitido** no se han visto; solo el mapeo puro está probado. `actionGo.ts`, `tests/action-go.test.ts`.
- [ ] **Teclado y portapapeles reales dentro del tablero** (Ctrl+Z, Ctrl+V de una imagen, no actuar desde el chat) no se probaron en un navegador; solo con eventos simulados.
- [ ] **`open_board` con un modelo real del agente.** El test usa un LLM simulado; falta ver al agente elegirlo por sí solo (cuesta dinero: ver [la lista de pruebas](gui-cohesion-pruebas.md)).
- [ ] **Importar imágenes del chat al Designer incrustado** salió con 0 capas en el sandbox porque faltaban los archivos de los activos; con activos reales, sin ver.
- [ ] **Pasos 1 a 3 de la interfaz** (tokens, Home, barra, Create, Tools): los tests cubren el modelo y el render; un recorrido visual completo no está archivado.
- [ ] **Tooltip de la barra lateral que se solapa con el panel flotante o con el título de Home** (aviso del usuario). No reproducido; `data-tip` se oculta con el panel abierto (`SidebarNav.tsx:71`). `sidebar-nav.css`, `shell.css`.

## Para fusionar

- [ ] Fusión de `task/gui-cohesion` (1658e00) en la rama raíz: decide el usuario tras probar. Regla de conflictos: gana lo más nuevo ([fusión](fusion-agent-forcing.md)).

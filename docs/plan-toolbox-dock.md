# Plan: toolbox del Designer por flujo de trabajo

2026-10-23. Pasada 1 implementada en la rama nueva solicitada por el usuario. Aprobó el dock real, las variantes y el selector de modo; pidió no crear otra maqueta ni hacer las pasadas 2/3 o rediseños. Diseño de referencia: [propuesta](propuesta-toolbox-dock.md). La maqueta existente [toolbox-dock.html](mockups/toolbox-dock.html) sirvió solo como referencia de interacción. Datos de cada control: [inventario](inventario-herramientas-designer.md).

## 1. Qué se propone

El toolbox se ordena por el bucle de trabajo, no por el tipo de herramienta. Lo que suele hacerse justo después de algo vive dentro de ese algo. Hay dos toolbox cortos, uno por modo.

| Modo | Toolbox | Variantes (en la fila de arriba) |
|---|---|---|
| **Drawing** (pintar) | + · Brush · Eraser · Color · Blur · Ruler · Text \| Layers · Settings | Brush: Brush, Pencil, Airbrush, Sculpt○. Color: Fill, Gradient, Magic wand, Lasso, Rect. Blur○ (dedo). Ruler: recta, elipse, perspectiva y Snap |
| **Design** (diseñar) | + · Edit · Shapes · Pen · Text · Layout \| Layers · Settings | Edit: Edit, Nodes, Align, Transform, Order. Shapes: las 9 formas actuales. Pen: Lineart, Curve, Bezier pen○, Cutter○. Layout: Sizes, Grid○, Guides○, Templates○ |

○ = no existe aún: va en gris como «Soon», con un tooltip que lo explica.

La interacción se probó en la maqueta. Tiene tres estados:

- Al pulsar una herramienta se abre su fila de variantes, plegada.
- Al pulsar una variante se despliega la tarjeta de ajustes.
- La flecha pliega la tarjeta.
- Si se vuelve a pulsar la herramienta activa, se cierra todo.
- Escape baja un nivel cada vez.

**La tarjeta**:
- Muestra los controles reales, en dos columnas: la cabecera y las pestañas en cápsula.
- Mide lo que su pestaña más alta, así que no salta al cambiar de pestaña.
- El tirador fija la altura máxima. Por encima, hace scroll por dentro.
- Toolbox, fila y tarjeta tienen el mismo ancho.

En Edit, la tarjeta sigue a la selección:
- con un objeto seleccionado: su forma, Transform y Align;
- con 2 o más: Align, Distribute, Boolean○ y Form builder○.

## 2. Por qué así (investigación, solo como referencia)

- **Pintar va por etapas:** boceto → línea → planos → sombras ([Revoy, Krita](https://davidrevoy.com/article949/overview-of-my-krita-digital-painting-workflow-end-2022), [Krita, flujos comunes](https://docs.krita.org/en/tutorials/common_workflows.html)). Por eso el toolbox de pintar lleva pocos iconos.
- **La varita se usa justo antes de rellenar** al colorear por planos ([Clip Studio, flatting](https://tips.clip-studio.com/en-us/articles/2834)). Por eso la selección va dentro de Color.
- **Photoshop pone en el mismo hueco** Degradado+Bote, Desenfocar/Dedo, Pincel/Lápiz, los borradores y todas las formas ([referencia](https://photoshopessentials.com/?p=18853), de terceros). Por eso existen Color, Blur, y Pencil como variante de Brush. Su barra contextual ofrece rellenar después de seleccionar ([Adobe](https://helpx.adobe.com/photoshop/using/contextual-task-bar.html); solo se pudo leer el resumen del buscador).
- **Illustrator:** el Borrador y el Cuchillo comparten hueco, y el bote de Pintura interactiva va con Shape Builder ([Adobe](https://helpx.adobe.com/sk/illustrator/desktop/manage-objects/edit-objects/cut-objects.html), [Adobe](https://helpx.adobe.com/ae_en/illustrator/desktop/paint-and-fill/learn-painting-basics/paint-with-the-live-paint-bucket-tool.html)). Combinar es Pathfinder o Shape Builder ([Tuts+](https://design.tutsplus.com/tutorials/illustrator-in-60-seconds-how-to-use-the-pathfinder-tool--cms-25572)). Por eso combinar va en Edit cuando hay varios objetos seleccionados, y Cutter va con Pen.
- **Affinity cambia la barra y los paneles según el modo** («personas»), y su barra contextual sigue a la selección ([Affinity](https://affinity.help/designer2/en-US.lproj/pages/Workspace/interface.html)). Por eso hay dos toolbox por modo.
- **SAI 2** trata las reglas de perspectiva como objetos de capa ([SAI 2](https://painttoolsai.readthedocs.io/en/latest/)). Por eso Ruler es una familia propia.
- **Sin verificar:** la lista completa de SAI; el orden y la barra contextual de Illustrator; si se empieza a pintar con un degradado. Esto último viene de la experiencia del usuario.

## 3. Cómo se lleva a la app

**Principio:** el dock monta los componentes reales (`ToolSettings`, `BrushSettings`, `InlineControls`, `AlignControls`, `SnapControl`, `CanvasSize`). No se dibuja ningún control nuevo, igual que en la maqueta.

**El modo ya existe:** `paintModeOf(doc)` en `src/engine/design/paintMode.ts` ([ADR 0016]). El toolbox lo lee y no cambia nada del documento ni de su persistencia.

**Qué se toca:**
- Archivos nuevos:
  - `src/components/designer/toolboxModel.ts`: datos puros (familias por modo, variantes, Soon) y el reductor de los tres estados.
  - `src/components/designer/ToolDock.tsx` y `src/styles/tool-dock.css`.
- Montaje en los dos sitios donde hoy está el rail:
  - [Composer.tsx:444](../src/components/composer/Composer.tsx), el dock por defecto;
  - `ToolPalette.tsx`, la paleta flotante.
  `ToolDock` sustituye en ambos a `ToolRail` + `ContextStrip`.
- **Interruptor Drawing/Design siempre visible:** se monta `PaintModeToggle`, el componente real, en el toolbox de los dos modos, junto a Layers. Hoy solo aparece dentro de los ajustes del pincel ([ToolSettings.tsx:265](../src/components/designer/ToolSettings.tsx)): si el toolbox de Design ocultara Brush, no habría forma de volver a Drawing.
- **Atajos:** en [designerKeys.ts:78](../src/components/designer/designerKeys.ts) las teclas de herramienta y Delete están dentro de la rama de las flechas, así que nunca se ejecutan. Se sacan de esa rama. Cada tecla pone su herramienta aunque no pertenezca al modo visible, y nunca cambia Drawing/Design. Si la herramienta es del otro modo, su familia aparece como **visitante**: un icono más al final del toolbox, tras un separador, con su fila y su tarjeta normales. Desaparece al elegir una herramienta del modo.
- **Tests:** el inventario se comprueba sobre el modelo nuevo: cada herramienta de `TOOL_NAMES` (también las que no tienen atajo, como Polygon, Star o Curve) debe estar en algún modo, igual que en el test actual, y cada atajo de `DESIGN_TOOL_KEYS` debe funcionar, incluido el caso visitante sin cambiar el modo, con eventos de teclado reales. Las pruebas de interacción montan `ToolDock`. `RAIL`, `railTools` y sus tests se retiran cuando ya nadie monte `ToolRail`.

**Qué no se toca:**
- `data/`, la persistencia protegida, los temas y los tokens;
- el motor del pincel y el de las formas;
- nada de `designerKeys.ts` fuera de sacar esas ramas.

## 4. Alcance y límites

La base ya existe: los controles reales, el modo de pintura, el rail y la maqueta probada. Son tres pasadas; cada una se entrega y se puede revertir sola.

**Pasada 1 (implementada):**
- `ToolDock` con los dos toolbox según el modo, la fila de variantes y los tres estados.
- La tarjeta reutiliza `ToolSettings`; la fila de familia incluye Layers y `PaintModeToggle`. Las variantes «Soon» se muestran deshabilitadas con una explicación.
- La herramienta real se selecciona como hoy (`select(id)` de `ToolRail`).
- `Composer` y la paleta flotante usan el mismo `ToolDock`; `+` sigue siendo el control real del compositor.
- El inventario cubre todas las herramientas actuales y los atajos del otro modo aparecen como familia visitante sin cambiar el modo guardado.

La tarjeta usa los ajustes actuales completos. Las pestañas por grupo, los ajustes que reaccionan a selección múltiple y «Fill» contextual no forman parte de esta entrega.

**Fuera de esta autorización:**
- Pestañas en cápsula. Un archivo `toolGroups.ts` reparte los controles por pestaña; la maqueta los reconoce por su etiqueta. `ToolSettings` recibe un `group?`.
- Todas las pestañas se pintan en la misma celda; las ocultas llevan `inert` y `visibility:hidden`.
- La tarjeta de Edit sigue a la selección: con 2 o más objetos, Align y Distribute.
- Fill aparece delante después de seleccionar.

**Después (cada una con su ADR):**
- herramientas nuevas: Blur, Sculpt, Bezier pen, Cutter, Grid, Guides, Templates, borrador vector, Text y Layers avanzados, ajustes del toolbox;
- pasar sola a Edit después de crear una forma.

## 5. Reparto y evidencia (pasada 1)

Dos agentes, cada uno en su propio worktree (`git worktree add ../ogs-<t> -b task/<t>`) y solo con sus archivos. Nadie fusiona.

| Agente | Archivos (exclusivos) | Entrega |
|---|---|---|
| A | `toolboxModel.ts`, `ToolDock.tsx`, `src/styles/tool-dock.css`, `designerKeys.ts` y sus tests | Modelo, dock, selector de modo y arreglo de atajos; verificado por A con typecheck y sus 7 tests |
| B | `designerKeys.ts`, `tests/designer-keys.test.ts` | Arreglo de teclas de herramientas y Delete; integrado en el commit `e2617a2` |
| C | `Composer.tsx`, `ToolPalette.tsx`, dos tests existentes, `scripts/map-contracts.mjs`, `docs/` | Montaje compartido, migración de tests, contrato y documentación breve; ejecuta `npm run test:related` |
| Coordinación | Sandbox, suite completa y capturas | La evidencia visual de ambas ubicaciones y modos queda pendiente de la comprobación del coordinador; este worktree no arranca el sandbox |

El usuario autorizó la implementación real en una rama nueva. La aprobación cubre esta pasada, no las funciones pendientes enumeradas arriba. La referencia visual y el modelo de interacción están implementados con controles de la app; el resultado visual real y `npm test` los confirma el coordinador.

## 6. Riesgos para el auditor

Segunda auditoría: dos ajustes (inventario sobre `TOOL_NAMES` y atajo del otro modo como visitante), corregidos arriba.
Primera auditoría (GPT, 2026-10-23): cuatro hallazgos, todos verificados en el código y corregidos arriba (montaje en Composer, interruptor de modo, atajos, tests sobre el rail viejo).


- **Identidad visual:** aprobada por el usuario para esta implementación en rama nueva; la tarjeta usa los tokens existentes del Designer.
- **Modo ↔ toolbox:** el selector real `PaintModeToggle` está siempre visible y el toolbox deriva del modo del documento.
- **Atajos:** resuelto sacando las ramas de `designerKeys.ts`; se comprueba con teclas reales.
- **Accesibilidad:**
  - `role="toolbar"` con flechas;
  - pestañas ocultas con `inert`;
  - el tirador se maneja con el teclado;
  - las «Soon» llevan `aria-disabled` y un tooltip.
- **Rendimiento:** la tarjeta monta solo la herramienta activa; las pestañas, solo las de esa herramienta.

[ADR 0016]: decisions/0016-dibujo-y-diseno.md

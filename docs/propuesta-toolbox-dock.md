# Propuesta: toolbox del Designer como dock con barra contextual

2026-10-23, sin implementar. Origen: prueba de concepto del usuario (capturas móviles). Se adopta su **simpleza y comportamiento**, no su estética: colores, formas y sombras salen de los temas actuales ([propuesta-temas.md](propuesta-temas.md)). Es trabajo de GUI y accesibilidad; no se crean herramientas nuevas.

## Principios (de la prueba de concepto)

1. **Una sola zona de control.** Todo sale del dock y vuelve a él.
2. **Tres profundidades, una abierta a la vez:** botón de familia → tira de variantes → panel completo (▲).
3. **Barra contextual única.** El mismo sitio cambia de contenido: sin selección, ajustes de la herramienta; con selección, acciones sobre el objeto. No se abre otra superficie para lo frecuente.
4. **Siempre sabes dónde estás:** una píldora «Modo · Herramienta».
5. **Lo frecuente a un toque, lo raro detrás de ▲ o de General.**
6. **Pocas palabras:** etiquetas cortas, atajo visible en el chip.
7. **Lo que no existe se ve en gris con «Pronto»**, deshabilitado, con el motivo en el tooltip; nunca un botón que no hace nada sin avisar.

Descartado por el usuario: el contador `n/m` sobre el botón de familia.

## Familias del dock (con lo que ya existe)

Las variantes son herramientas emparentadas; una herramienta distinta es otra familia.

| Familia | Variantes (existentes) | Pronto |
|---|---|---|
| Mover | Editar/mover V, Pan H | — |
| Selección | Rect, Lazo, Varita (M) | — |
| Pintar | Pincel B, Lineart P | Lápiz, Marcador |
| Borrador | Borrador E | — |
| Relleno | Relleno G, Degradado U | — |
| Formas | Rectángulo R, Elipse O, Polígono, Estrella, Sector, Arco, Cuerda | Booleanas |
| Líneas | Línea L, Curva, Flecha | Pluma (vector) |
| Texto | Texto T | — |
| Medir | Regla K, Cuentagotas I | — |
| General (⚙) | ver abajo | — |

Hoy esto vive en `ToolRail.tsx` (familias y flyouts ya existen con `role="toolbar"`/`group`); el cambio es de presentación: flyout → tira de variantes encima del dock.

## Barra contextual (sustituye a ContextStrip)

Un solo componente en el mismo sitio, con contenido según estado:

- **Sin selección:** ajustes rápidos de la herramienta (los de `ToolSettings` en modo compacto: tamaño, opacidad, color).
- **Con objeto/capa seleccionada:** Duplicar, Delante, Detrás, Transformar, Alinear, Borrar (hoy repartidos entre la fila de capa, popovers y solo teclado: Borrar pasa a tener botón).
- **Texto o forma seleccionada / edición de nodos:** lo que ya muestra `ContextStrip.tsx:72-80`.
- **▲ abre el panel completo** de la herramienta: la versión entera de `ToolSettings` con vista previa (BrushSettings ya tiene una; se extiende a formas y texto).

Transformar y Alinear dejan la barra superior y sus popovers: entran en la barra contextual cuando hay selección.

## Panel General (⚙, último botón del dock)

- Workspace activo y cambio de workspace (hoy en el shell).
- Ajustes, Preferencias, Atajos (atajos: **Pronto** si no hay pantalla de atajos).
- Documento: nuevo, importar, tamaño de lienzo, guardar en galería, exportar (sale de la barra superior).
- Paneles: Capas, Efectos, Historial (**Pronto**: hoy solo hay Undo/Redo).

## Lo que queda fuera del dock

- Arriba: píldora de estado (izquierda) y Deshacer/Rehacer como iconos (derecha). Nada más.
- Panel derecho de capas: se conserva, plegable; ya no aloja la pestaña Tool (pasa al ▲ del dock).

## Accesibilidad

- Dock y tiras: roving tabindex con flechas dentro de cada `toolbar` (hoy no existe).
- La píldora de estado es `role="status"` con `aria-live="polite"`.
- Escape cierra el nivel abierto y devuelve el foco al botón que lo abrió (como `Popover.tsx:108`).
- «Pronto»: `aria-disabled="true"` + texto accesible, enfocable para leer el motivo.
- Objetivos táctiles ≥ 44 px; atajos visibles también en el nombre accesible.

## Plan por pasos (cada uno con `npm run test:related` y prueba en sandbox)

1. Píldora de estado + Deshacer/Rehacer en iconos.
2. Dock con familias y tira de variantes (desde `ToolRail`), roving focus.
3. Barra contextual única con estados (fusionar ContextStrip + acciones de selección).
4. Panel completo ▲ con vista previa; retirar la pestaña Tool del panel derecho.
5. Panel General y mover acciones de la barra superior.
6. Huecos «Pronto» y revisión de accesibilidad.

## Decisiones pendientes del usuario

- Dock abajo también en escritorio, o rail lateral con el mismo comportamiento.
- Qué entra en «Pronto» (lista de arriba es sugerencia).
- Si el cambio de workspace se duplica en General o solo se enlaza.

## Revisión 2026-10-23: lo acordado tras las maquetas

Sustituye a las tablas de arriba donde choquen. Datos de cada control: [inventario verificado](inventario-herramientas-designer.md). Maqueta: [toolbox-dock.html](mockups/toolbox-dock.html).

- **Toolbox (11 iconos):** + · Puntero · Layout · Shapes · Bezier · Brocha · Borrar · Texto · Reglas | Capas · Settings.
- **Variantes:** fila de iconos encima de la tarjeta, solo si la herramienta tiene variantes; el nombre y la tecla, al pasar el ratón. Puntero: Edit, Pan, Nodes, Align, Boolean y Form Builder («Pronto»). Layout: Sizes, y Templates, Grids y Guides («Pronto»). Shapes: las siete formas más Line y Arrow. Bezier: Lineart y Curve. Brocha: Brush, Fill, Gradient y Select.
- **Tres estados (acordado 2026-10-23):**
  - Pulsar una herramienta del toolbox abre su fila de variantes, plegada (sin tarjeta).
  - Pulsar una variante despliega la tarjeta.
  - La flecha de la fila pliega y despliega.
  - Volver a pulsar la herramienta activa cierra todo, y otra pulsación la abre plegada.
  - Escape baja un nivel: abierta → plegada → cerrada.
  - Las herramientas sin variantes muestran una fila con solo su icono, para que funcione igual.
- **La tarjeta reutiliza los controles reales** (`InlineControls`, con la maquetación de la pestaña Tool, `.sidebar-tool-settings`). No se dibujan controles nuevos.
- **Cabecera:** la vista previa más lo que hoy enseña la versión compacta.
- **Grupos:** si una herramienta tiene más de un grupo, van en una fila de pestañas (`segmented`), y la tarjeta cambia de contenido sin crecer. Si tiene un solo grupo, va en una sola fila desplegable. Cada pestaña lleva entre 4 y 6 controles. Brush: Tip (Tip, Hardness, Texture, Mirror) · Stroke (tapers, Stabilize, Smoothing) · Pressure (Simulate pressure y presión → tamaño/densidad) · Blend (Blend, Keep opacity). `Size presets` va en la cabecera, junto a Size. `Advanced settings` desaparece, porque las pestañas ya ocultan lo avanzado.
- **Fill, Gradient y Text** caben enteros en la cabecera, sin pestañas.
- **Cuentagotas:** Alt-clic, como hoy. Falta decidir si va un botón dentro del selector de color.
- **Pendiente:** Settings tiene pocos ajustes (Tool help line, Dock); quizá le baste un popover en vez de una tarjeta.

### Maqueta con el HTML real (2026-10-23, tarde)

- Los controles ya no se dibujan: son el HTML de la pestaña Tool, del menú «+», de Canvas size y de Snap, capturado del sandbox y sin tocar. Los iconos salen del mismo paquete lucide. Lo único nuevo es el contenedor: la fila de variantes, la tarjeta (con el aspecto de `.context-strip`), las dos columnas, las pestañas y el tirador. Al implementarla, la tarjeta monta los mismos componentes (`ToolSettings`, `InlineControls`), así que el resultado coincide con la maqueta.
- La tarjeta tiene dos columnas del ancho de la barra lateral. A la izquierda va la cabecera; a la derecha, las pestañas en cápsula. Sin pestañas, los controles se reparten en dos columnas.
- Su altura es la de la pestaña más alta de la herramienta, así que cambiar de pestaña no la mueve. El tirador fija la altura máxima, y por encima de ella hay scroll interno.
- La tarjeta, la fila de variantes y el toolbox tienen el mismo ancho. Los iconos del toolbox se reparten a lo largo.
- `Advanced settings` desaparece: sus controles van en la pestaña Pressure.
- Settings sale como «Pronto»: no hay ajustes del toolbox en la app que copiar.
- Pan enseña su aviso real; Nodes no tiene ajustes propios y no abre tarjeta.

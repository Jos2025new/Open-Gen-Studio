# Plan: controles coherentes y Properties en el Designer

Fecha: 2026-10-05. Estado: **propuesto, versión 2**. Sin código de producto: solo análisis y plan.
Rama: `task/gui-proposal` en el worktree `../ogs-gui-proposal`. No fusionado.

Esta versión **sustituye** a la primera tras la revisión externa. Los cambios y su motivo están al final, en «Qué cambió y por qué». La decisión que lo resume es `docs/decisions/0005-controles-coherentes-designer.md`.

## Qué cambió respecto a la versión anterior

| # | Revisión externa | Cambio aplicado |
| --- | --- | --- |
| 1 | Un control de herramienta y una propiedad de capa no son lo mismo: `brush.opacity` frente a `layer.opacity` | Sustituido «una casa por control» por **presentación consistente, alcance visible**. Ninguna fase fusiona estados ni cambia qué objeto modifica un control. |
| 2 | Booleanas y estilos guardados no son trabajo de presentación | U5 y U6 **retiradas** del plan y trasladadas a «Trabajos futuros». |
| 3 | El resultado visual estaba poco definido y el título prometía los tres lienzos | Título acotado al Designer, con la evidencia de por qué. Añadida una **especificación visual** con medidas reales. |
| 4 | La ausencia de `data-testid` no demuestra ausencia de pruebas de interfaz | U0 **reducida** a dos casos concretos de desambiguación y a pruebas de comportamiento por fase. Sin helper transversal. |
| 5 | La barra flotante se contradecía a sí misma y no se habían comparado alternativas | V4 pasa a ser **decisión abierta**, con las alternativas y sus criterios, no una recomendación. |
| 6 | APCA y WCAG son criterios distintos y se confundían | Cada uso declara su criterio. Los datos corregidos están abajo. |
| 7 | Una tabla de `dk-color` no permite evaluar colores arbitrarios en caliente | Separado: `dk-color` audita el tema; el aviso en vivo usa luminancia relativa y se limita a la interfaz, no al contenido diseñado. |
| 8 | Las garantías de reversión confundían código, preferencias y contenido | Tres mecanismos separados, con lo que cada uno restaura y lo que no. |

## Objetivo y restricción

**Objetivo.** En el Designer, que el mismo control se vea y se comporte igual en todas partes, que quede claro **a qué objeto** modifica, y que los ajustes que el documento ya guarda se puedan volver a ver y editar.

**Alcance.** Solo el Designer. El compositor y la barra superior se tocan solo cuando son el sitio donde vive un control del Designer.

**Restricciones que no se cruzan** (de `AGENTS.md` y `HANDOFF.md`):

- **No añadir latencia ni carga al modelo del agente.** Cero llamadas nuevas al LLM, cero caracteres nuevos en el prompt del sistema, cero proveedores nuevos.
- **No tocar datos.** `data/` real, serialización, `baseAt`, copias, rechazo de pérdida masiva y rechazo de escrituras automatizadas intactos ([0001](docs/decisions/0001-proteger-datos.md)). Pruebas de app solo con `npm run dev:sandbox` (puerto 5183, `.sandbox/data`).
- **Sin `confirm()` nativo** ([0002](docs/decisions/0002-confirmaciones-de-la-app.md)); sin proveedor de pago sin coste máximo aprobado ([0004](docs/decisions/0004-coste-maximo.md)).
- **Ningún archivo por encima de 30 KB.**

## Por qué el título ya no promete los tres lienzos

La primera versión se llamaba «interfaz unificada entre chat, nodos y designer». Medido en la revisión `6c58cb2`:

- `[código]` `type="color"` aparece 10 veces en `src/components`: **7 en Designer**, 2 en compositor, 1 en assets, y **0 en chat y 0 en nodos**.
- `[código]` `<select>`: 6 en Designer, 2 en compositor, 2 en `ui`, 1 en shell, **0 en chat y 0 en nodos**.
- `[código]` Los nodos no tienen panel acoplado: `src/components/node/` no contiene ningún `panel-tabs` ni `aside`; todos sus controles viven en la tarjeta ([nodes.tsx](../../src/components/node/nodes.tsx)).

Conclusión: el defecto de duplicación de color y de selectores **es del Designer**. En chat y nodos no hay una versión del mismo problema que esta propuesta resuelva. Prometer los tres lienzos sería título sin contenido. La capa que sí es transversal son los **tokens** y las **primitivas de control**, que se consumen en compositor y shell; V1 y V3 las tocan, pero el resultado útil está en el Designer.

Si más adelante se quiere chat y nodos, hace falta su propio diagnóstico, no este plan.

## Cómo se lee la evidencia

`[código]` lectura con archivo y línea. `[visual]` prueba en el sandbox el 2026-10-05. `[medido]` salida de una herramienta, con el comando. `[referencia]` una imagen de la carpeta del usuario: dirección de diseño, no prueba. `[hipótesis]` decisión de diseño sin medir.

## Evidencia

### Lo que ya existe y no se rehace

- `[código]` Rail vertical de herramientas con grupos, flyouts y atajos: [ToolRail.tsx](../../src/components/designer/ToolRail.tsx). Ancho 46 px, separación 6 px; en pantallas estrechas ya rota a horizontal (`designer.css`).
- `[código]` Panel derecho con pestañas ancladas tipo Inkscape, `Layers` y `Properties`, con la pestaña recordada ([LayersPanel.tsx](../../src/components/designer/LayersPanel.tsx)). Ancho por defecto 260 px, entre 200 y 520 px, redimensionable.
- `[código]` Properties ya edita nombre, opacidad, modo de fusión, geometría, texto, trazos y formas.
- `[código]` Ajustes por herramienta con `InlineSlider`, `InlineSelect` e `InlineColor`: [ToolSettings.tsx](../../src/components/designer/ToolSettings.tsx), en la barra superior, con `max-width: min(48vw, 760px)` y desplazamiento horizontal.
- `[código]` `InlineColor` ya es un picker con hex, swatches recientes y guardados, guardar y quitar con botón derecho, todo con nombre accesible ([ToolSettings.tsx](../../src/components/designer/ToolSettings.tsx)).
- `[código]` Pincel con texturas, estabilizador y simetría; exporta SVG con texto editable más PDF, PNG y JPG.

### Defectos verificados que este plan corrige

1. **El alcance de un control no se ve.** `InlineSlider` pinta `aria-label="Opacity"` ([ToolSettings.tsx](../../src/components/designer/ToolSettings.tsx)) y Properties pinta también `aria-label="Opacity"` ([LayersPanel.tsx](../../src/components/designer/LayersPanel.tsx)). Con el pincel activo y una capa seleccionada, dos controles llamados igual están visibles a la vez y el usuario no puede saber cuál va a cambiar: el de la barra escribe en `brush.opacity`, el del panel en `layer.opacity`. Es un defecto de información, no de función.
2. **Tres interfaces de color.** `InlineColor` (popover con swatches) para pincel y texto; `<input type="color">` nativo para formas en la barra (`ToolSettings.tsx`) y para texto y formas en Properties. Mismo gesto, tres aspectos.
3. **Ajustes invisibles después de fijarlos.** La herramienta Texto ofrece interlineado y espaciado; [types.ts](../../src/engine/types.ts) los guarda en `TextStyle` y [render.ts](../../src/engine/design/render.ts) los respeta al dibujar y al exportar. Properties de una capa de texto solo enseña Font, Size, Weight, Color y Alignment. El valor se guarda y no se vuelve a ver.
4. **Contraste: el criterio depende del uso.** `[medido]`
   - `--text-3` `#8e8e98` sobre `--surface-3` `#28282d`: `dk-color contrast` da **4,52:1, normal = AA**, y APCA **Lc −38,4 «non-text / disabled only»**. Pasa WCAG para texto normal y falla el umbral APCA. No es un incumplimiento de WCAG.
   - `--text-4` `#61616a`: sobre `--bg` **3,23:1** (AA solo para texto grande; cumple 3:1 para componentes); sobre `--surface-3` **2,39:1**, que falla ambos criterios.
   - `[código]` Los usos reales de `--text-4` son: `.topbar-sep` (glifo separador), `.pool-dot` (punto de 6 px), `.ml-variant-dot::before` (punto de 5 px), `.set-more:hover` (borde) y `.nc-generating-detail` (texto de 10 px en la tarjeta de nodo). **Solo el último es texto**; los otros cuatro son elementos no textuales, donde rige WCAG 1.4.11 con umbral 3:1, no 4,5:1.
   - Conclusión corregida: el problema real es (a) `.nc-generating-detail` como texto de 10 px por debajo de 4,5:1, y (b) los elementos no textuales con `--text-4` cuando caen sobre `--surface-3`.
5. **La barra superior de herramientas puede desbordarse.** `max-width: min(48vw, 760px)` con desplazamiento horizontal: con muchas herramientas, controles quedan ocultos tras una barra que hay que desplazar. today no hay prueba de que esto ocurra en la práctica; es un riesgo de capacidad, no un defecto comprobado.

### Verificación de la revisión externa sobre las pruebas

`[código]` `tests-e2e/designer-monkey.spec.ts` (220 líneas) usa **roles y nombres accesibles** como estrategia principal: 11 `getByRole('button')`, 3 `getByRole('spinbutton')`, 3 `getByRole('radio')`, 1 `getByRole('dialog')`, 1 `getByRole('complementary')`. Solo tres localizadores por clase: `.layer-select` (3) y `.stage-canvas` (2). Por tanto la afirmación de la versión 1 («sin ganchos no hay red») era **incorrecta**.

Lo que sí falta, y justifica la parte que se conserva de U0:

- **Colisión real de nombres:** `getByLabel('Opacity')` es ambiguo cuando coinciden barra y panel. Se resuelve con la distintiva de alcance de V1, no con un helper general.
- **Colisión posible de swatches:** `InlineColor` nombra cada swatch con su hex (`aria-label={c}`); un color presente a la vez en recientes y guardados produce dos botones con el mismo nombre.

## Regla de alcance: presentación consistente, alcance visible

Sustituye a «una casa por control».

1. **Un componente, muchos sitios.** Color, opacidad, rango y selección se pintan con el mismo componente en barra y panel.
2. **Estados separados.** Un control de herramienta sigue escribiendo en el estado de la herramienta; una propiedad de capa sigue escribiendo en la capa. **Ninguna fase fusiona, traslada ni elimina ninguno de los dos accesos.**
3. **El alcance se declara.** La barra se rotula con la herramienta activa; Properties, con la capa seleccionada. Cuando ambos están activos, los dos rótulos conviven sin ambigüedad.
4. **La distinción se reinforces visualmente** con el mismo patrón en las tres zonas: rótulo de alcance en versalitas, separador y posición.

`[hipótesis]` La forma exacta de la distintiva (rótulo, chip o borde) es una decisión de diseño pendiente de prueba visual.

## Delimitadores transversales

Los mismos siete que fija la decisión 0005. Ninguna fase puede cruzarlos; si una lo necesita, se para y se pregunta.

- **D1** — El modelo de datos no cambia de forma. `DesignDoc`, `Layer`, `TextStyle` y `Session` siguen igual; todo campo nuevo, si lo hubiera, sería opcional con el valor actual por defecto.
- **D2** — Persistencia intacta: serialización, `baseAt`, copias, rechazo de pérdida masiva y rechazo de escrituras automatizadas ([0001](docs/decisions/0001-proteger-datos.md)).
- **D3** — Coste del agente: cero llamadas nuevas al LLM, cero caracteres nuevos en el prompt del sistema, cero proveedores nuevos.
- **D4** — Sin `confirm()` nativo ([0002](docs/decisions/0002-confirmaciones-de-la-app.md)).
- **D5** — Accesibilidad existente: ningún `role` ni nombre accesible se elimina; los ambiguos se desambiguan.
- **D6** — Los atajos de [src/engine/shortcuts.ts](src/engine/shortcuts.ts) no se reasignan.
- **D7** — Las pruebas de app se hacen solo en el sandbox ([0003](docs/decisions/0003-pruebas-en-sandbox.md)).

## Especificación visual

Medidas verificadas del estado actual (`designer.css`, `LayersPanel.tsx`):

| Zona | Hoy | Medida |
| --- | --- | --- |
| Barra lateral de la app | fija | 56 px |
| Barra superior | fija | 48 px |
| Rail de herramientas | vertical, fondo propio, borde derecho | 46 px, separación 6 px |
| Ajustes de herramienta | dentro de la barra superior | `min(48vw, 760px)`, con desplazamiento |
| Panel derecho | acoplado, 2 pestañas | 260 px (200–520 px) |
| Zoom | dentro del rail, abajo | valor de 10 px, ancho mínimo 35 px |
| Compositor | centrado bajo el lienzo | `--surface-2`, radio `--radius-l`, 12 px de relleno |

Reparto propuesto, con lo que gana el usuario:

| Cambio | Qué gana | Cómo se comprueba |
| --- | --- | --- |
| **Distintiva de alcance** en barra y panel | Saber en un vistazo si el ajuste afecta a la herramienta o a la capa. Hoy no se puede saber. | Prueba de comportamiento: dos ajustes con el mismo nombre y distinto destino; captura antes/después. |
| **Ajustes de herramienta fuera de la barra superior** a una banda propia bajo el rail o bajo la barra | Los controles dejan de competir con el título, el compositor y el zoom por el ancho. Hoy `min(48vw, 760px)` obliga a desplazar. | Conteo de controles visibles sin desplazamiento con las once herramientas activas. |
| **Properties agrupada** en Apariencia / Geometría / Texto, mismo orden para los tres tipos de capa | Menos carga cognitiva: sabes dónde está un ajuste sin recorrer una lista que crece por tipo. | Recorrido de las tres pestañas con el guion de la fase. |
| **Interlineado y espaciado visibles** en la capa de texto | Un ajuste que hoy se fija y se pierde recupera su reversibilidad. | Test de ida y vuelta del valor y presencia en el SVG exportado. |
| **Color en un solo componente** | Se elimina la sorpresa de aspect DIFFERENTE según el objeto. | Test de que todas las entradas de color usan el mismo componente. |
| **Composición del rail** | El rail tiene hoy herramienta, separador, zoom y ajuste de zoom en la misma columna de 46 px. Subir el zoom a una fila propia con el resto de la vista deja el rail solo para herramientas. | Captura antes/después; el rail no crece en número de filas. |

Lo que **no** se propone cambiar: ancho del panel, posición del compositor, rejilla del lienzo, atajos.

## Fases

Cada fase es un commit con su prueba de comportamiento.

### V1. Alcance visible y color único

**Dónde.** `ToolSettings.tsx`, `LayersPanel.tsx`, nuevo `src/components/ui/ColorField.tsx`.

**Qué.** (a) Distintiva de alcance en la barra de ajustes y en Properties, según la regla de alcance. (b) Las siete entradas nativas de `type="color"` del Designer pasan a usar el mismo componente que ya existe (`InlineColor`), sin cambiar su almacenamiento de swatches. (c) La distintiva renombra los dos `aria-label="Opacity"` para que dejen de colisionar, conservando el nombre accesible por defecto cuando solo hay un alcance visible.

**Qué mejora de UX, exactamente.** Se acaba la pregunta «¿esto cambia el pincel o la capa?». Y elegir color deja de verse distinto según el objeto.

**Prueba.** Comportamiento: con pincel activo y capa seleccionada, cambiar el color desde el panel no altera el color del pincel y cambiarlo desde la barra no altera la capa. Un test de DOM que falle si hay dos elementos con el mismo nombre accesible de alcance.

**Delimitadores.** No se fusionan estados. `store.ui.swatches` no cambia de forma. Ningún `role` ni nombre accesible existente se elimina: solo se desambigua.

**Riesgo y reversión.** Medio: toca superficies que el monkey recorre. Mitigación: el monkey usa roles, y los roles no cambian; se verifica con `npm run stress` antes de dar la fase por hecha.

### V2. Properties completa y ordenada

**Dónde.** `LayersPanel.tsx`, `src/components/designer/LayerGeometry.tsx`.

**Qué.** (a) Exponer interlineado y espaciado en la capa de texto, que el modelo ya guarda. (b) Agrupar en Apariencia / Geometría / Texto con orden estable para los tres tipos de capa. (c) Igualar la presentación de opacidad y color con la barra usando los componentes de V1.

**Qué mejora de UX, exactamente.** Lo que se ajusta al escribir un texto se puede volver a encontrar y cambiar. Y la lista deja de crecer de forma distinta según el tipo de capa.

**Prueba.** Comportamiento: editar interlineado y espaciado, comprobar que sobreviven a guardado y recarga y que aparecen en el SVG exportado (extender [design-export.test.ts](../../tests/design-export.test.ts)). Más un test de que los tres tipos de capa exponen los mismos grupos en el mismo orden.

**Delimitadores.** No se añade ningún campo a `TextStyle`: ya están ([types.ts](../../src/engine/types.ts)). Sin cambio de formato.

### V3. Legibilidad con criterio declarado

**Dónde.** `tokens.css` y los cuatro estilos que usan `--text-4`.

**Qué.** (a) Declarar el criterio por uso: **texto** → WCAG 2.2 AA 4,5:1; **elemento no textual** → WCAG 1.4.11 3:1. (b) Corregir los dos casos reales: `.nc-generating-detail` sube de nivel de token para llegar a 4,5:1 sobre la superficie de la tarjeta, y los elementos no textuales con `--text-4` dejan de caer sobre `--surface-3`. (c) Guardar en la fila de `TRAZABILIDAD.md` la salida de `dk-color audit` del tema resultante.

**Qué mejora de UX, exactamente.** Se arregla texto que hoy es difícil de leer, sin subir el contraste global más de lo necesario y sin declarar AICHO que el tema entero incumple.

**Prueba.** `dk-color audit` sobre la paleta final, con la salida archivada. Test que comprueba que la misma combinación cumple el umbral **de su uso**, no uno único para todo.

**Delimitadores.** El acento `#d8ff3a` no cambia (15,87:1, Lc −96,9). Los tokens no se renombran.

### V4. Redistribución contextual: decisión abierta, no recomendada

**Dónde.** `designer.css`, `ToolRail.tsx`, `Stage.tsx`.

**La contradicción de la versión 1, resuelta.** La versión 1 decía «la barra cambia dónde aparecen los controles» y «no se elimina ninguna barra» sin decir cuál de las dos cosas era. Aquí se comparan tres alternativas y **no se elige ninguna todavía**:

| Alternativa | A favor | En contra |
| --- | --- | --- |
| **A. Banda fija bajo la barra de ajustes**, sin nada flotante | Predecible; no tapa el lienzo; el foco de teclado no se mueve; no hay movimiento al seleccionar | Aleja el control del objeto cuando se edita lejos del centro |
| **B. Barra flotante que sigue a la selección** | máxima proximidad | Tapa el lienzo, introduce movimiento, complica el foco de teclado y la vista estrecha; hay que definir qué pasa sin selección y cómo convive con el compositor y el zoom |
| **C. Solo\\(s\\) cambios de V1 y V2**, sin tocar la barra | Menor riesgo; el desbordamiento de `48vw` es un riesgo de capacidad, no un defecto probado | Si el desbordamiento llega a ocurrir, los controles quedan ocultos |

**Lo que hay que decidir antes.** Qué controles salen de la barra superior y cuáles se quedan. Dónde se sitúa la contextual sin selección. Qué significa «el compositor está abierto» (montado no es lo mismo que visible: el compositor se monta en los tres espacios de trabajo, así que «montado» no sirve como criterio). Cómo se comporta por debajo de un ancho mínimo.

**Cómo se decide.** Con el guion de la fase sobre las once herramientas y con el sandbox, no por argumento.

**Recomendación provisional.** Empezar por C. Si al medir aparece el desbordamiento, A antes que B: la proximidad es-planta, no requisito.

## Pruebas: qué se prueba y con qué

Cada fase lleva una prueba de comportamiento del cambio que hace. No hay infraestructura general.

- **V1.** Dos ajustes con el mismo nombre y distinto destino; el DOM no admite dos nombres de alcance iguales.
- **V2.** Ida y vuelta del valor y salida en SVG.
- **V3.** `dk-color audit` con el umbral del uso.
- **V4.** Solo si se elige A o B: guion manual en sandbox sobre las once herramientas.

Lo que **no** se automatiza: nitidez y contraste en navegadores que no son el de la máquina. Lo verifica el usuario.

## Contrato de trazabilidad

- **Identidad estable.** `V1` a `V4`, sin renumerar. El asunto de cada commit cita el identificador.
- **Anclas mínimas.** Solo donde hoy hay colisión real: los dos rótulos de alcance de V1 y, si aparece, el nombre duplicado de swatch. Nada más.
- **Documento de verdad.** Una fila en [designer.md](../../docs/features/designer.md) por comportamiento nuevo, con código y test, o la marca «sin test».
- **Registro.** Una fila en `TRAZABILIDAD.md` por commit, con las seis columnas existentes.
- **Auditoría.** Ante una queja: `git log --grep="V1"` da el commit; `git revert` lo deshace. Como ninguna fase cambia el modelo de datos, un documento ya guardado sigue siendo válido tras revertir (ver «Reversión»).

## Reversión: tres mecanismos distintos

La versión 1-los mezclaba. No son lo mismo:

| Mecanismo | Qué restaura | Qué **no** restaura |
| --- | --- | --- |
| **Revertir código** (`git revert`) | El comportamiento y el aspecto de la aplicación | Nada de lo que el usuario ya guardó en sus documentos, ni sus preferencias |
| **Recuperar una preferencia** (tema, ajustes de interfaz) | Solo si el cambio no altera su forma almacenada | Si una fase cambia el esquema de una preferencia guardada, revertir el código **no** reescribe lo ya guardado; queda obsoleto hasta una migración, que necesita aprobación aparte |
| **Recuperar contenido** (documentos y Designs) | Nada por revert | Solo una migración o una copia, y ambas están prohibidas sin aprobación explícita ([0001](docs/decisions/0001-proteger-datos.md)) |

**Garantía que sí se puede dar.** V1, V2 y V3 no cambian el modelo de datos ni el formato. Si una de ellas se revierte, los documentos existentes siguen siendo válidos y se abren igual. Eso es una garantía estructural, no una prueba.

**Lo que no se puede garantizar.** Si V1 llegara a cambiar qué escribe un control, los documentos ya guardados con el otro alcance quedarían inconsistentes. Por eso V1 **no** cambia destinos: esa es la razón de la regla de alcance.

## Riesgos

| Riesgo | Fase | Probabilidad | Impacto | Mitigación | Reversión |
| --- | --- | --- | --- | --- | --- |
| Romper el monkey al tocar superficies del Designer | V1, V2 | media | alto | `npm run stress` antes de cerrar cada fase; los roles no cambian | revertir el commit |
| Colisión de nombres accesibles en otro punto no previsto | V1 | baja | medio | El test de DOM falla ante cualquier duplicado de alcance | revertir |
| Subir contraste y romper la jerarquía visual | V3 | media | medio | Solo los dos casos reales; el resto no se toca | revertir |
| Barra flotante que tapa el lienzo o rompe el foco | V4 | alta si se elige B | alto | Empezar por C; A antes que B | no montar el componente |
| El plan crece sin terminar | todas | media | medio | Cada fase es un commit completo y verificable | — |

## Verificación

- **Automática.** `npm test` (salvaguardas, `check-docs`, suite) y `npm run typecheck`, en verde antes de cerrar cada fase.
- **Con `dk-*`.** `dk-color` en V3. No se reimplementa el cálculo de contraste: `AGENTS.md` obliga a usar `dk-*` cuando cubre la operación.
- **Manual, solo sandbox.** Guion por fase en el puerto 5183 con `.sandbox/data`, parando el sandbox al terminar. Nunca contra la app real.
- **Sin verificar aquí y quién lo verifica.** Contraste y nitidez en otros navegadores: el usuario. Salida a proveedores: solo con permiso y coste máximo.

## Decisiones pendientes del usuario

1. ¿V4 se hace, y con qué alternativa (A, B o C)?
2. ¿La distintiva de alcance es rótulo, chip o borde? Y ¿se aplica también al compositor?
3. ¿El rail se queda solo con herramientas, con el zoom en otra fila, o como está?
4. ¿Se conserva `--text-4` para elementos no textuales con su umbral de 3:1, o se elimina ese nivel?

## Trabajos futuros (fuera de este plan)

Se conservan aquí para que no condicionen la aceptación del rediseño.

- **Operaciones booleanas de formas.** Estado real, verificado: las booleanas **raster** ya existen — la herramienta de selección tiene modos New, Add y Subtract ([ToolSettings.tsx](../../src/components/designer/ToolSettings.tsx)) — y las capas tienen modo de fusión. Lo que **no** existe son las booleanas vectoriales entre formas, que requieren geometría nueva, exportación y deshacer. Es un proyecto de motor, no de presentación.
- **Estilos guardados reutilizables.** Ya existe la parte que más costaría: los colores guardados viven en `store.ui.swatches` con guardar y quitar, y ya son globales a la aplicación. Lo que falta es guardar palettes completas y ajustes de texto. Es una función de biblioteca con decisiones de almacenamiento; no es un rediseño.
- **Chat y nodos.** Requieren su propio diagnóstico. En nodos, el punto de partida es que no hay panel acoplado y todo vive en la tarjeta.
- **Editor de vídeo con timeline y render 3D con materiales.** Proyectos enteros; no fases.
- **Menú radial de herramientas** y **componentes paramétricos**. Aportan aceleración y consistencia respectivamente, cuando el Designer esté estable.

## Fuera de alcance

Cambios en el modelo de datos, en la serialización o en la persistencia. Cambios en el agente, en el prompt del sistema o en la selección de modelos. Cualquier proveedor nuevo. La interfaz del compositor más allá de alojar un control del Designer.
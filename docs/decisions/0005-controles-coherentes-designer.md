# 0005 — Controles coherentes y Properties en el Designer

## Estado

Propuesto

## Fecha

2026-10-05

## Contexto

Una revisión externa de la primera versión de esta propuesta, contrastada con el código de la revisión `6c58cb2`, pidió acotar el alcance y corregir cinco afirmaciones. El detalle completo, con la evidencia, está en `PLAN_INTERFAZ_UNIFICADA.md` (versión 2).

**Lo que se mantiene, verificado en el código.** El Designer tiene ya todo lo difícil: pestañas acopladas tipo Inkscape con `Layers` y `Properties` ([LayersPanel.tsx](../../src/components/designer/LayersPanel.tsx)), un picker de color con hex y swatches guardados ([ToolSettings.tsx](../../src/components/designer/ToolSettings.tsx)), un motor de pincel con texturas y un exportador que respeta el texto editable.

**Defecto 1: el alcance no es visible.** La barra de ajustes pinta `aria-label="Opacity"` ([ToolSettings.tsx](../../src/components/designer/ToolSettings.tsx)) y Properties pinta también `aria-label="Opacity"` ([LayersPanel.tsx](../../src/components/designer/LayersPanel.tsx)). Escriben en estados distintos (`brush.opacity` y `layer.opacity`), pero con ambos visibles el usuario no puede saber cuál va a cambiar. Además el nombre duplicado rompe `getByLabel` en prueba.

**Defecto 2: tres interfaces de color.** `InlineColor` para pincel y texto, y `<input type="color">` nativo para formas en la barra y para texto y formas en Properties. Siete entradas nativas en el Designer.

**Defecto 3: ajustes invisibles.** La herramienta Texto ofrece interlineado y espaciado; [types.ts](../../src/engine/types.ts) los guarda en `TextStyle` y [render.ts](../../src/engine/design/render.ts) los respeta, pero Properties solo muestra Font, Size, Weight, Color y Alignment.

**Defecto 4: contraste, con el criterio mal atribuido.** `dk-color contrast "#8e8e98" "#28282d"` da 4,52:1 y clasifica el par como AA para texto normal, con APCA Lc −38,4 marcado como «non-text / disabled only». La primera versión presentó el resultado APCA como si fuera un incumplimiento de WCAG: es falso. `--text-4` sí baja de 4,5:1, pero sus usos reales son cuatro elementos no textuales (separador, punto de 6 px, punto de 5 px y borde) y un texto de 10 px, de modo que el único incumplimiento de texto es `.nc-generating-detail` y los no textuales tienen su propio umbral de 3:1.

**Defecto 5: la afirmación sobre pruebas era falsa.** La versión 1 dijo que no había red de interfaz por no existir `data-testid`. Es falso: [designer-monkey.spec.ts](../../tests-e2e/designer-monkey.spec.ts) usa roles y nombres accesibles como estrategia principal y solo tres localizadores por clase.

**Alcance.** El defecto de duplicación de color y de selectores es del Designer: hay 7 de las 10 entradas `type="color"` en el Designer y **0 en chat y 0 en nodos**, y los nodos no tienen panel acoplado. Prometer los tres lienzos era título sin contenido.

## Decisión

Adoptar cuatro fases, cada una en su commit y con su prueba de comportamiento, y una regla de alcance que sustituya a «una casa por control».

**Regla de alcance.** Un componente, muchos sitios; estados separados; el alcance se declara y se distingue visualmente. **Ninguna fase fusiona, traslada ni elimina ninguno de los dos accesos**, ni cambia qué objeto modifica un control.

**Fases.** **V1** distintiva de alcance y color en un solo componente; **V2** Properties agrupada y con interlineado y espaciado visibles; **V3** legibilidad con el criterio declarado por uso; **V4** redistribución contextual, que queda como **decisión abierta** entre tres alternativas y no como recomendación.

**Delimitadores.** **D1** el modelo de datos no cambia de forma; **D2** serialización, `baseAt`, copias y rechazos intactos ([0001](0001-proteger-datos.md)); **D3** cero llamadas nuevas al LLM y cero caracteres nuevos en el prompt del sistema; **D4** sin `confirm()` nativo ([0002](0002-confirmaciones-de-la-app.md)); **D5** ningún `role` ni nombre accesible existente se elimina, solo se desambigua; **D6** los atajos de [shortcuts.ts](../../src/engine/shortcuts.ts) no se reasignan; **D7** las pruebas de app se hacen solo en el sandbox ([0003](0003-pruebas-en-sandbox.md)).

**Fuera del plan.** Las operaciones booleanas y los estilos guardables se trasladan a «trabajos futuros» con su estado real verificado: las booleanas raster ya existen (New, Add, Subtract) y los colores guardados ya viven en `store.ui.swatches`; lo que falta son booleanas vectoriales y paletas completas, y ambas son funciones nuevas.

**Trazabilidad.** Identificadores `V1` a `V4` en el asunto de cada commit, anclas mínimas solo donde hay colisión real, una fila por comportamiento en [designer.md](../features/designer.md) y una fila por commit en `TRAZABILIDAD.md`.

**Reversión.** Tres mecanismos distintos: revertir código, recuperar una preferencia y recuperar contenido. V1 a V3 no cambian el modelo de datos, así que un documento ya guardado sigue siendo válido tras revertir; eso es una garantía estructural. Revertir **no** reescribe documentos ya guardados ni preferencias, y recuperar contenido exigiría una migración, prohibida sin aprobación.

## Alternativas

**Unificarappearing y destino.** rechazado: `brush.opacity` y `layer.opacity` no son el mismo objeto. Fusionarlos rompería el comportamiento actual y dejaría documentos inconsistentes. Se unifica la presentación, no el destino.

**Mantener el título de los tres lienzos.** rechazado: medido, el defecto no existe en chat ni en nodos. Un título debe describir lo que el plan resuelve.

**Barra contextual flotante siguiendo la selección.** aplazado a V4 como alternativa B, sin recomendar: tapa el lienzo, introduce movimiento y complica el foco. La recomendación provisional es no mover nada hasta que el desbordamiento de la barra (`min(48vw, 760px)` con desplazamiento) se compruebe en la práctica; si aparece, se prefiere una banda fija a una flotante.

**Añadir un helper general de identificadores de prueba.** rechazado: el monkey ya se apoya en roles y nombres. Solo hay dos colisiones reales, y las resuelve la propia distintiva de alcance.

**Un aviso de contraste en vivo sobre el contenido diseñado.** aplazado: con imágenes, transparencias y varias capas no hay un fondo definido que evaluar. La versión propuesta limita el aviso a la interfaz; evaluar el contenido exigiría leer el lienzo aplanado, que es otra función.

## Consecuencias

El usuario puede saber, antes de mover un control, si va a afectar a la herramienta o a la capa. Los ajustes de texto dejan de fijarse a ciegas. El color deja de verse distinto según el objeto.

Coste: `Stage.tsx` (1470 líneas) y `ToolSettings.tsx` (328) crecen; la regla de 30 KB obliga a comprobar el tamaño en cada fase.

Riesgos asumidos: tocar superficies que el monkey recorre; subir contraste y alterar la jerarquía visual; y en V4, una capa flotante que tape el lienzo.

Lo que este documento **no** autoriza: escribir código. La decisión pasa a Aceptado cuando el usuario responda las cuatro cuestiones pendientes del plan.
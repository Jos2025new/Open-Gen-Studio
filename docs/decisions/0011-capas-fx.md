# 0011 — Capas de filtros y efectos no destructivos (FX)

## Estado

Aceptado

## Fecha

2026-10-08

## Contexto

El usuario pidió investigar cómo Inkscape y GIMP aplican filtros por capa y llevar esa lógica a Open Gen Studio. La investigación (Inkscape master `51a851e`, CMake 1.5.0-dev; GIMP master `1ef535b`, meson 3.3.1) dejó tres hechos útiles:

- **Inkscape** guarda el filtro como un elemento `<filter>` del documento y lo referencia por CSS desde el objeto (`src/ui/widget/object-composite-settings.cpp:115`). El modo de fusión es CSS `mix-blend-mode` (`src/filter-chemistry.cpp:551-580`). Las primitivas trabajan en linearRGB por defecto (`src/display/nr-filter-primitive.cpp:176-179`), pero 212 de los 213 presets de `share/filters/filters.svg` fijan `color-interpolation-filters:sRGB`. El panel de capas no tiene control de filtros (Launchpad 512834 sigue abierto).
- **GIMP** guarda una pila ordenada de filtros por drawable y la evalúa de abajo arriba, solo con los activos (`app/core/gimpfilterstack.c:188`). La pila se reordena (`:149`), se fusiona en los píxeles (`gimpdrawable-filters.c:274`) y la comparten capas de texto (`app/text/gimptextlayer.c:148`) y grupos (`gimpgrouplayer.c:187`).
- **Nuestro Designer** compone las capas en orden con `drawLayer` (`src/engine/design/render.ts`); las carpetas solo agrupan, no componen. Las capas se guardan enteras dentro de `sessions` (`src/store/store.ts:301-316`).

Después el usuario fijó el modelo (2026-10-08):

| El usuario ve | Por debajo |
| --- | --- |
| Capa de filtros | Capa FX no destructiva con varias operaciones de color y tono, editables. |
| Filtro (acción) | La misma capa con una sola operación y sus valores predefinidos. |
| Capa de efectos | Capa FX no destructiva con efectos de luz y forma (glow, destello, sombra). |
| Efecto (acción) | La misma capa con un solo efecto predefinido. |

Respuestas del usuario: el alcance de la capa es configurable (solo la capa de debajo o todo lo de debajo); un filtro es hue, saturación, etc. y un efecto es glow o lens flare; el filtro «a secas» aparece en el menú de operaciones que ya existe, junto a las operaciones de capa del Designer y como nodo en Nodes, con un solo contrato; el agente aplica las operaciones directamente, con deshacer. Al pedir «aplícalo de una vez» aprobó las decisiones de esta página, incluido el campo nuevo en el formato guardado.

## Decisión

### D1 · Un solo registro de operaciones FX

`src/engine/fx/defs.ts` define cada operación una vez: tipo (filtro o efecto), parámetros con rango y valor por defecto, su equivalente en canvas y su primitiva SVG si existe. Lo usan el Designer, la operación `fx` de assets y nodos, y la herramienta del agente.

- **Filtros:** brillo, contraste, saturación, tono, escala de grises, sepia, invertir y desenfoque.
- **Efectos:** glow, sombra paralela y destello (lens flare).

### D2 · La capa FX es un tipo de capa

`FxLayer` (`type: 'fx'`) entra en la unión `Layer`. Guarda `group` (filter o effect), `scope`, `ops` (lista ordenada de `{ id, kind, enabled, params }`) y `simple` (se creó como filtro o efecto «a secas»). Hereda visibilidad, bloqueo, opacidad, modo de fusión y carpeta. No tiene geometría: no se selecciona en el lienzo ni se transforma.

### D3 · Alcance configurable

- `below`: filtra todo lo que hay debajo en el documento (como la *filter layer* de Krita o una capa de ajuste). Las carpetas no componen, así que no limitan el alcance.
- `layer`: filtra solo la capa normal más cercana por debajo, como una máscara de recorte. Varias capas `layer` seguidas se acumulan sobre la misma capa. Si entre ellas hay una capa `below`, la capa `layer` no actúa.

La opacidad de la capa FX mezcla el resultado con el original; con un modo de fusión distinto de normal, el resultado se pinta encima con ese modo.

### D4 · Render

`drawDoc` compone en un lienzo fuera de pantalla solo si hay capas FX visibles; si no, el camino de render no cambia. La resolución del lienzo sigue al zoom de la vista (con un tope de 16 Mpx). Cada operación es un pase de canvas (`ctx.filter`, `screen`, gradientes): no hay bucles de píxeles en JavaScript.

### D5 · Exportación SVG

Cada capa FX se escribe como `<filter color-interpolation-filters="sRGB">` en `<defs>`:

- `below`: el contenido anterior se envuelve en `<g filter>`.
- `layer`: la capa destino se envuelve en `<g filter>`.

El radio de la sombra se divide entre dos al pasar a `feDropShadow`, como define la especificación de CSS `drop-shadow()`. El destello no tiene primitiva SVG: la exportación lo omite y avisa. Con opacidad menor que 1 o modo de fusión distinto de normal, el SVG pinta una copia filtrada encima del original; en bordes semitransparentes no coincide exactamente con el canvas.

### D6 · Tres presentaciones, un contrato

- **Designer:** menú «FX» junto a Operaciones, con «Nueva capa de filtros», «Nueva capa de efectos» y cada filtro y efecto a secas. Doble clic en la fila de una capa FX abre su editor: activar, desactivar, reordenar, borrar operaciones y ajustar parámetros, alcance y opacidad.
- **Assets y Nodes:** la operación local `fx` (gratis, en el navegador) aplica el mismo registro a una imagen y crea una imagen nueva; el original no cambia. El formulario muestra la operación y su parámetro principal; los demás parámetros se pueden pasar en `params` (agente y nodos).
- **Agente:** la herramienta `designer_fx` recibe una lista de comandos (`add`, `set`, `add_op`, `set_op`, `move_op`, `remove_op`, `delete`) que la app ejecuta en orden con las mismas acciones del panel. Toda la lista es un solo paso de deshacer.

### D7 · Fases

1. **Esta rama:** D1 a D6 y sus tests.
2. **Siguiente:** máscaras de capa no destructivas (buffer alfa propio con copy-on-write, como la base de pintura) y decidir si se unifican con `pixelMask`.
3. **Después:** carpetas que componen (alcance limitado a la carpeta y FX sobre carpetas), aplanar una capa FX en píxeles, y niveles o curvas con un Worker.

## Alternativas

- **Lista `effects` dentro de cada capa (modelo GIMP).** Descartada: no da el alcance «todo lo de debajo» que pidió el usuario y obliga a cambiar cada tipo de capa.
- **Implementación separada para filtros a secas.** Descartada: dos caminos que divergen. Un filtro a secas es una capa FX con `simple: true`.
- **Filtros con píxeles en JavaScript.** Aplazado a la fase 3: más lento y sin equivalente SVG.
- **Exportar todo con efectos como PNG.** Descartado: pierde la edición en Inkscape cuando existe primitiva SVG.

## Consecuencias

- El formato guardado gana un tipo de capa. Una versión anterior de la app no conoce `fx`: lo dibujaría como texto vacío y podría fallar al abrir el documento. No se ha probado.
- `types.ts`, `tools.ts`, `context.ts`, `runtime.ts` y `jobs.ts` ya superan 30 KB: los cambios en ellos se compensan para no crecer ([ADR 0008](0008-limite-de-tamano-en-codigo.md)).
- El historial del Designer vive en memoria: lo que hace el agente se deshace durante la sesión, no después de recargar.
- El rendimiento con lienzos grandes y muchas capas FX no se ha medido. `ctx.filter` necesita Chrome, Edge, Firefox o Safari 18+.

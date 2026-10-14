# Importar SVG de Inkscape

El Designer importa `.svg` (botón «Import image») como un diseño nuevo; el área de nodos lo toma como una imagen PNG aplanada (mismo saneado). Código en `src/engine/design/svgImport/`. Prueba con un SVG de Inkscape escrito a mano: [tests/fixtures/inkscape-sample.svg](../tests/fixtures/inkscape-sample.svg) en [svg-import.test.ts](../tests/svg-import.test.ts); resvg real, en [svg-import-resvg.test.ts](../tests/svg-import-resvg.test.ts). Nunca se probó en un navegador real (regla del puerto 5183): la ruta de rasterizado por navegador (`new Image()`) solo está comprobada con un doble.

## Orden

1. **Saneado** (`sanitize.ts`, DOMParser `image/svg+xml`): se eliminan `script`, `foreignObject`, `iframe`, `object`, `embed`, audio/vídeo, animaciones (`animate*`, `set`), atributos `on*`, valores `javascript:`, todo `href`/`xlink:href`/`url()` que no sea `#id` o `data:image/…`, `@import` y `@font-face`. Se rechazan entidades (`<!ENTITY`), archivos de más de 25 MB y de más de 200 000 elementos. El aviso dice qué se quitó.
2. **Recorrido** (`structure.ts`, `styles.ts`, `transforms.ts`): estilos de atributos, `style=""` y `<style>` (selectores de etiqueta, clase, id y compuestos; los de descendiente se ignoran y se avisa), herencia, matrices compuestas, `viewBox` y unidades (mm, in…). Un SVG de más de 8192 px por lado se reduce.
3. **Formas** (`shapes.ts`, `pathData.ts`) o **rasterizado** (`rasterize.ts`), en orden de pintado.

## Qué se conserva

| SVG | OGS |
| --- | --- |
| `<g inkscape:groupmode="layer" inkscape:label>` y `<g>` | Carpeta con ese nombre (id si no hay etiqueta). Anidadas: «Padre / Hijo». Una carpeta interrumpida por otra vuelve como «Nombre (2)» |
| `display:none` | Capa oculta |
| `sodipodi:insensitive` | Capa bloqueada |
| `opacity` de grupo | Se multiplica en la opacidad de las capas del grupo |
| `opacity` o `mix-blend-mode` de una forma | Esa forma va en su propia capa con esa opacidad y mezcla |
| Formas consecutivas del mismo contenedor y con los mismos ajustes | Una capa vectorial |
| rect (x, y, w, h, rx, ry), circle, ellipse, line, polyline, polygon | Rectángulo, elipse, línea o trazado editable |
| path | Trazado con `d` completo (relativos, H, V, S, T y arcos pasan a M L C Q Z; los arcos, a Béziers). Más de 20 000 caracteres: se rasteriza |
| fill, stroke, stroke-width, linejoin, linecap, miterlimit, dasharray y dashoffset (en anchos de trazo), paint-order | Los mismos campos de la forma. Sin valor, SVG usa unión inglete y punta recta (no las de OGS) y se escriben así |
| fill-opacity, stroke-opacity (y el alfa de rgba) | `fillOpacity`, `strokeOpacity` |
| fill-rule evenodd | `fillRule: 'evenodd'` |
| `filter` con un solo `feGaussianBlur` (σ igual en x e y) | `blur` (σ), como indica [inkscape-formas.md](inkscape-formas.md) |
| transform | Escala y traslación van a la geometría; giro e inclinación de rect y elipse, a `rot`; en trazados, a los puntos |
| `linearGradient` o `radialGradient` con `gradientUnits="userSpaceOnUse"`, `spreadMethod` pad (o ausente), paradas propias o heredadas por `xlink:href`, `gradientTransform` afín y foco sin mover | Degradado editable en coordenadas de página (`fillGradient`, `strokeGradient`; [gradients.ts](../src/engine/design/svgImport/gradients.ts)). Radial con `gradientTransform` no uniforme o con foco movido: se rasteriza |
| `use` y `symbol` dentro del documento | Se expanden en su sitio (con `x`, `y`, `viewBox`) |

## Qué se rasteriza

Solo ese elemento, con su estilo heredado, en su caja ya transformada, como capa de píxeles en su posición y orden: relleno o trazo con **gradiente** no convertible (`objectBoundingBox`, `spreadMethod` reflect o repeat, foco movido, `gradientTransform` que sesga un radial) o **pattern**, **texto** (`text`, `flowRoot`), **clip-path**, **mask**, **filtros** que no sean un desenfoque simple, **markers**, **image**, trazados de más de 20 000 caracteres. Un `<g>` con filtro, clip-path o máscara se rasteriza entero. Motor: resvg-wasm (MPL-2.0, carga diferida) y, para texto o si falla tras tres intentos, el navegador con el SVG saneado del elemento. resvg no trae fuentes, por eso el texto va por el navegador.

## Limitaciones

- Texto y demás dejan de ser editables (píxeles a escala 1 de la página; tope de 16 Mpx por elemento).
- La opacidad de grupo se multiplica por capa: con formas superpuestas dentro de un grupo difiere de SVG.
- Las puntas de flecha (`marker-start`, `marker-end`) se rasterizan al importar: el importador no las lee todavía.
- El grosor de trazo con escala no uniforme usa la escala media (el modelo no lo distingue).
- El `<svg>` anidado no recorta a su viewport.
- Cada SVG crea un diseño nuevo; el diseño actual no se toca.

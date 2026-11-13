# Intercambio SVG (2026-11-10)

Un solo modelo para exportar e importar: lo que OGS escribe, OGS lo lee igual. Sin commit todavía. Código:
[export.ts](../src/engine/design/export.ts), [objectGroupTree.ts](../src/engine/design/objectGroupTree.ts),
[svgImport/](../src/engine/design/svgImport/structure.ts). Qué se lee de cada elemento:
[importar SVG](inkscape-importacion.md).

## Contrato

[svg-round-trip.test.ts](../tests/svg-round-trip.test.ts): exportar, importar y comparar el documento entero; un segundo
viaje no cambia nada; la imagen (resvg) es igual al píxel, con tolerancia de 1 por canal.

| OGS | SVG | Vuelve |
|---|---|---|
| Capa | `<g inkscape:groupmode="layer" inkscape:label>` | Sí |
| Carpeta de capas | Capa de Inkscape con subcapas | Sí |
| Grupo de objetos (anidado) | `<g inkscape:label>` anidado | Sí |
| Nombre de forma o grupo | `inkscape:label` | Sí |
| Oculto (capa, grupo, forma) | `display:none` | Sí |
| Bloqueado (capa, grupo, forma) | `sodipodi:insensitive="true"` | Sí |
| Opacidad y mezcla de capa o grupo | `opacity`, `mix-blend-mode` | Sí |
| Orden de pintado | Orden del documento | Sí |
| Rectángulo (esquinas, giro), elipse, línea, trazado | `rect`, `ellipse`, `line`, `path` | Sí |
| Relleno, trazo, opacidades, unión, punta, inglete, rayas, regla par-impar, trazo bajo el relleno | Atributos de presentación | Sí |
| Gradiente lineal y radial | `linearGradient`, `radialGradient` | Sí |
| Desenfoque de forma | `filter` con `feGaussianBlur` | Sí |
| Trazo interior o exterior | Relleno más trazo doble recortado; `data-ogs="stroke-inside"` u `outside` en el `<g>` | Sí |
| Puntas de flecha | `<marker data-ogs="tipo">` | Sí |
| Rectángulo con rayas; esquinas suaves | `path` | Como trazado (misma imagen) |
| Primitiva paramétrica (estrella…) | `path` con atributos de Inkscape | Como trazado; pierde los parámetros |
| Texto | `<text>` o trazados | Como imagen |
| Capa de píxeles | `<image>` | Como imagen |
| Líneas de Lineart | Trazado relleno del contorno | Como trazado |
| Máscara de píxeles, FX | `mask` (`mask-type="alpha"`), `filter`; destello de lente: imagen de lo que cubre, a 2×, con aviso | Como imagen |

`data-ogs` no guarda datos: solo dice cómo leer la estructura estándar que lo acompaña. Si otro programa la cambia, el
importador la lee como cualquier SVG. `minify` y PDF dejan fuera lo oculto y los atributos de editor.

**Cambio visible:** el SVG normal ahora incluye lo oculto (como Inkscape e Illustrator). Antes se omitía.

## Otros programas

[svg-import-apps.test.ts](../tests/svg-import-apps.test.ts) con muestras pequeñas en `tests/fixtures/`. **Las muestras
están escritas a mano según las convenciones de cada programa; no son archivos exportados por ellos.** Falta
contrastarlas con exportaciones reales.

| Programa | Qué se lee | Resultado de la muestra |
|---|---|---|
| Inkscape | Capas, subcapas, etiquetas, oculto, bloqueado | Capas y grupos; gradiente no convertible y texto, imagen |
| Illustrator | `<g data-name>` sobre la página es capa, también bajo el `<g>` que aísla la mezcla; clases de `<style>` | 2 capas, grupos anidados, 7 formas editables, 0 imágenes |
| Figma | `fill="none"` heredado de la raíz; el recorte del marco no corta; `id` como nombre | 1 capa con marco y grupos; la sombra (filtro), imagen |
| Canva | Recorte rectangular hecho con `path`; envoltorios vacíos | Forma editable si el recorte no corta; imagen si corta |

Sin comprobar: una capa de Illustrator cuyo nombre coincide con su `id` no lleva `data-name` y entraría como grupo.

## PDF (2026-11-11)

El PDF sale del mismo SVG. svg2pdf.js 2.8 dibuja trazados, texto, imágenes, recortes y degradados opacos; lo que no
sabe escribir lo añade [pdfLook.ts](../src/engine/design/pdfLook.ts) con transparencia estándar de PDF 1.4:

| OGS | Antes (píxeles distintos) | Ahora en el PDF |
|---|---|---|
| Opacidad de capa o grupo | Repartida a cada forma (3,75 %) | Grupo de transparencia aislado (`/Group /S /Transparency`) pintado una vez con `/ca /CA` |
| 16 modos de mezcla | No se escribían (15–26 %) | `/BM` en el estado con que se pinta el grupo |
| Máscara de píxeles; trazo exterior | No se escribían (27 %; 7 %) | `/SMask` por alfa o por luminosidad |
| Degradado con transparencia | Opaco (51 %) | El degradado opaco bajo una máscara de luminosidad con su alfa |
| Puntas de flecha | Desaparecían (el marcador se cortaba a su caja) | La caja del `<marker>` contiene la punta entera; también mejora el SVG |
| Desenfoque de forma, FX | No se escribían (6–100 %) | Imagen de lo que cubren, en su sitio y dentro de su grupo, con aviso. La forma desenfocada va sola y recortada a su alcance; a 300 ppp en página de imprenta, nunca menos de 2× |
| Relleno, trazo, recorte, trazo interior, rayas, giro, imagen, texto | Bien (0–0,2 %) | Igual; un documento sin lo de arriba se escribe como antes |

**Contrato:** [pdf-look.test.ts](../tests/pdf-look.test.ts) exporta 22 casos, los dibuja con poppler (`pdftoppm`) y con
Ghostscript y los compara con el SVG del documento dibujado por resvg: como mucho 0,5 % de píxeles distintos (2 % en
Ghostscript y en las imágenes de efectos, por el suavizado de bordes). `PDF_OUT=carpeta` guarda los PDF para abrirlos.

**Dos caminos medidos.** Elegido: un pase propio sobre jsPDF, por sus eventos públicos (13 KB de código, sin
dependencias; 300 grupos en 0,8 s). Descartado: retocar el PDF con pdf-lib, que necesita el mismo pase y añade 614 KB
(253 KB comprimido) y 86 ms por archivo; el pdf-lib original no se publica desde 2021 (hay una bifurcación mantenida).

**Sin comprobar:** en la app (sandbox) con la imagen hecha por el canvas real; Acrobat, Chrome y Firefox; texto con
fuente incrustada dentro de un grupo (medido una vez: misma posición, 1–2 % por el suavizado de las letras).
resvg no gira el marcador inicial (`auto-start-reverse`); el PDF y el canvas sí.

## Árbol de grupos

[objectTreeNormalize.ts](../src/engine/design/objectTreeNormalize.ts) repone el árbol sin cambiar lo dibujado: referencias
a grupos que no existen, ciclos, grupos vacíos y grupos partidos (siguen como copia con su nombre y aspecto). Corre al
importar, al añadir o seleccionar un documento y tras una booleana. Las piezas nuevas de una booleana quedan en el
grupo de la forma más alta. No corre sobre el documento ya abierto al arrancar hasta que se vuelve a seleccionar.

## Pendiente de decisión

- Imagen o texto dentro de un grupo lo parten al importar: ver
  [imagen y texto como objetos](propuesta-imagen-texto-como-objetos.md).
- Que `rect` con rayas, esquinas suaves y primitivas vuelvan como tales.

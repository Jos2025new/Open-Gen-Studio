# Base para PSD, AI, EPS y CorelDRAW (2026-11-10, solo diseño)

Nada de esto está implementado. Compara el modelo interno de OGS con el de cuatro formatos y propone los ajustes
mínimos de estructura que harían sencillo un importador o exportador futuro. Sin capas de abstracción: un conjunto
de campos opcionales compartido y una regla.

## Fuentes y su fiabilidad

**Leído en esta sesión (verificado):** [especificación de PSD de Adobe](https://www.adobe.com/devnet-apps/photoshop/fileformatashtml/)
(primeros 100 KB), [constantes de psd-tools](https://psd-tools.readthedocs.io/en/latest/reference/psd_tools.constants.html),
[W3C Compositing 1](https://www.w3.org/TR/compositing-1/), [MDN mix-blend-mode](https://developer.mozilla.org/en-US/docs/Web/CSS/mix-blend-mode),
[README de ag-psd](https://github.com/Agamnentzar/ag-psd), [soporte PDF de Inkscape](https://wiki.inkscape.org/wiki/Current_PDF_Support)
(marcado como anticuado por ellos), [README de libcdr](https://github.com/LibreOffice/libcdr).

**Segunda pasada (2026-11-11, subagente Haiku; fuentes de implementación, no el texto de las normas):**
[evaluator.js de pdf.js](https://raw.githubusercontent.com/mozilla/pdf.js/master/src/core/evaluator.js),
[PDOCConfig de Adobe](https://opensource.adobe.com/dc-acrobat-sdk-docs/pdflsdk/apireference/PD_Layer/PDOCConfig.html),
[erratas de ISO 32000-2 §14.5](https://pdf-issues.pdfa.org/32000-2-2020/clause14.html),
[EPS en la Library of Congress](https://loc.gov/preservation/digital/formats/fdd/fdd000246.shtml),
PRONOM ([EPS](https://pronom.nationalarchives.gov.uk/fmt/124), [AI](https://pronom.nationalarchives.gov.uk/fmt/559), [CDR X6](https://pronom.nationalarchives.gov.uk/fmt/1925)),
[eps_input.inx](https://gitlab.com/inkscape/extensions/-/raw/master/eps_input.inx) y
[cdr-input.cpp](https://gitlab.com/inkscape/inkscape/-/raw/master/src/extension/internal/cdr-input.cpp) de Inkscape, y el
código de libcdr (`CDRDocument.cpp`, `CDRParser.cpp`, `CDRContentCollector.cpp`).

| Pasa a verificado | Fuente |
|---|---|
| PDF: `/BM` (16 nombres), `/ca` `/CA`, `/Group /S /Transparency` con `/I` `/K` `/CS`, `/SMask` (`/G`, `/S`, `/BC`, `/TR`), recorte `W` y `W*` | pdf.js los lee; además poppler y Ghostscript dibujan bien los que escribe OGS ([pdf-look.test.ts](../tests/pdf-look.test.ts)) |
| PDF: capas como contenido opcional, con orden de panel, visible y **bloqueado** (`/Locked`) | Adobe PDOCConfig |
| PDF: datos privados de aplicación en `PieceInfo` | ISO 32000-2 §14.5 |
| EPS: cabecera `%!PS-Adobe-3.0 EPSF-3.0` y caja obligatorias; cabecera binaria `C5D0D3C6` con vista previa; sin capas ni transparencia | LoC, PRONOM |
| EPS en Inkscape: `ps2pdf` y después su importador de PDF | eps_input.inx |
| CDR: contenedor RIFF con versión; desde X4/X6, ZIP con `content/riffData.cdr` o `content/root.dat` | libcdr, PRONOM |
| CDR: páginas (`page`), capas (`layr`, visibles por `flgs`), grupos (`grp`), relleno y contorno (`fild`, `outl`), opacidad, degradados, texto, mapas de bits, recorte | libcdr |
| CDR en Inkscape: por libcdr (su filtro anuncia versiones 7 a X4) | cdr-input.cpp |

**Sigue inferido:** que Illustrator use contenido opcional para sus capas y qué guarda en sus datos privados (PRONOM
describe `AIPrivateData` como marca de cabecera, no como entrada de `PieceInfo`: mi cadena anterior queda sin
confirmar); `%AI5_BeginLayer`; degradados y recorte de PostScript nivel 3; PowerClip, modos de mezcla, lentes y sombras
de CDR (no aparecen en lo leído de libcdr). No se pudo abrir: ISO 32000-1, el manual de PostScript, la norma EPS 5002
ni la de Illustrator.

## Comparación

V = verificado, I = inferido.

| Concepto | OGS hoy | PSD | AI (parte PDF) | EPS | CDR |
|---|---|---|---|---|---|
| Capas | Lista de abajo arriba | Registros de capa (V); de abajo arriba (I) | Contenido opcional de PDF (V); que AI lo use (I) | No hay (V) | Por página (V) |
| Grupos de capas | Carpetas planas, sin aspecto | `lsct`: carpeta abierta, cerrada y cierre; anidan (V) | Subcapas anidadas (I) | No | Sí (I) |
| Grupos de objetos | Anidados, con opacidad y mezcla | No aplica | Grupo de transparencia de PDF (V) | No | Sí (V) |
| Oculto, bloqueado, nombre | En capa, grupo y forma | Bit visible, nombre Unicode (V); bloqueo `lspf` (V secundaria) | Visible y bloqueado existen en PDF (V); que AI los escriba ahí (I) | No | Visible (V); bloqueo (I) |
| Modos de mezcla | Los 16 de CSS | 27 claves (V): los 16, más 11 sin equivalente | Los mismos 16 de PDF (V) | Ninguno (V) | Conjunto propio (I) |
| Grupo que no aísla | Carpeta, y grupo sin aspecto | `pass` (V) | Grupo sin `/I` (V) | — | — |
| Máscara de píxeles | Solo en capa vectorial (`pixelMask`) | En cualquier capa o grupo (V) | Máscara suave `/SMask`, alfa o luminosidad (V) | No | Lente (I) |
| Recorte vectorial | No hay: al importar se rasteriza | Máscara vectorial `vmsk` (V); capa recortada a la de abajo (V) | Recorte `W` (V) | `clip` (I) | Recorte (V); PowerClip (I) |
| Efectos | Capas FX: lista ordenada de operaciones, sobre una capa o sobre lo de debajo | `lfx2`: sombra, brillos, bisel, satinado, superposiciones, trazo (claves V, contenido I) | Apariencia en datos privados; aplanada en el PDF (I) | Ninguno | Por objeto (I) |
| Rellenos y trazos | Uno y uno | Uno y uno (I) | Varios, ordenados, en datos privados; duplicados en el PDF (I) | Uno y uno | Uno y uno (I) |
| Alineación de trazo | Interior, centro, exterior | En `vstk` (I) | Solo en datos privados (I) | No | Sí (I) |
| Texto | Capa con un estilo | `TySh` con tramos de estilo (clave V) | Texto PDF más datos privados (I) | Fuentes o contornos (I) | Artístico y de párrafo (I) |
| Páginas | Un lienzo por diseño; varios diseños por sesión | Un lienzo | Mesas de trabajo (I) | Una caja | Páginas (I) |
| Color | sRGB de 8 bits | RGB, CMYK, Lab…; 8, 16 y 32 bits (V) | RGB, CMYK, tintas planas (I) | Igual (I) | CMYK, RGB, Lab, planas (I) |

Modos de PSD sin equivalente en los 16 (comparando las dos listas verificadas): disolver, subexposición lineal, color
más oscuro, sobreexposición lineal, color más claro, luz intensa, luz lineal, luz focal, mezcla definida, restar y
dividir.

## Qué ya encaja

- **Modos de mezcla:** los 16 de OGS son los de CSS, SVG, PDF y AI, uno a uno. No se amplía la lista: los 11 de PSD
  se importarían al más cercano con aviso, igual que hacen los demás programas.
- **Efectos como datos ordenados:** las capas FX ya lo son. Importar un efecto de PSD es añadir una operación nueva,
  no cambiar la estructura.
- **Orden, visibilidad, bloqueo y nombres:** iguales en todos.
- **Varios rellenos o trazos:** el importador duplica la forma dentro de un grupo, que es lo que ya trae el PDF de AI.
- **Páginas:** una mesa o página es un diseño de la sesión.

## Un contenedor común (recomendación, 2026-11-11; sin implementar)

Pregunta del usuario: cuál es el mecanismo más versátil y estándar, en lugar de dos ajustes sueltos. Respuesta: **sí,
un solo conjunto de campos de composición compartido por capa, carpeta y grupo de objetos**, sin fusionar los tipos.
Es el modelo de los cuatro estándares: `<g>` de SVG, grupo de transparencia de PDF, grupo de PSD y capa o subcapa de AI.

| Campo | SVG | PDF | PSD | Hoy en OGS |
|---|---|---|---|---|
| `opacity` | `opacity` | `/ca /CA` sobre el grupo | Opacidad | Capa y grupo; carpeta no |
| `blend` (los 16) | `mix-blend-mode` | `/BM` | Clave de mezcla | Capa y grupo; carpeta no |
| `isolate` | `isolation:isolate` | `/I` | Lo contrario de `pass` | Implícito: aísla quien tiene opacidad o mezcla |
| `clip`: formas, borde duro | `clipPath` | `W` | Máscara vectorial | No existe: al importar se rasteriza |
| `mask`: píxeles o formas; alfa o luminosidad | `mask` | `/SMask` | Máscara de capa; capa recortada a la de abajo | Solo píxeles por alfa y solo en capa vectorial |

Tres matices sobre la propuesta recibida:

1. **Aislamiento: un solo indicador opcional, no tres estados.** La regla actual queda como valor por defecto (aísla
   quien tiene opacidad, mezcla o máscara) y `isolate` solo sirve para aislar sin cambiar el aspecto. «Sin aislar pero
   con opacidad» (el `pass` de PSD al 50 %) no lo pueden dibujar ni CSS ni SVG, y en el canvas cuesta una copia entera
   del fondo por grupo: se importaría aislado, con aviso.
2. **`clip` y `mask` separados**, no uno solo como proponía antes. Todos los formatos los distinguen, y el recorte es
   exacto y barato en los tres destinos (`W`, `clipPath`, `ctx.clip`); como máscara obligaría a un grupo y una máscara
   suave por cada recorte.
3. **Nombre, visible y bloqueado quedan fuera del conjunto.** Unificarlos (`visible` en capas, `hidden` en grupos y
   formas) exige migrar todos los documentos y no aporta nada a ningún formato.

**Qué se gana.** PDF: nada más que hacer; [pdfLook.ts](../src/engine/design/pdfLook.ts) ya escribe opacidad, mezcla,
máscara por alfa y por luminosidad y recorte de cualquier `<g>`, medido con poppler y Ghostscript. SVG: los grupos
recortados y enmascarados de Illustrator, Figma y Canva dejarían de entrar como imagen, y las carpetas guardarían su
aspecto en la ida y vuelta. PSD: carpetas con opacidad, mezcla y máscara, máscara vectorial y capas recortadas tendrían
dónde ir; hoy no lo tienen.

**Coste, por partes independientes** (medido en el código: `pixelMask` se lee en 17 archivos y 50 sitios, la mezcla en
19 y 62, las carpetas en 5 y 12):

| Parte | Toca | Riesgo |
|---|---|---|
| A. Tipo compartido, sin comportamiento | Un archivo nuevo; `types.ts` no crece | Ninguno, pero solo tiene sentido junto con B o C |
| B. Carpetas con opacidad, mezcla, `isolate` y anidación (`parentId`) | Dibujo (hoy la carpeta no compone), plan de FX, exportar e importar SVG, fila de carpeta en el panel | Medio: el dibujo y los FX dentro de una carpeta |
| C. `clip` vectorial en capa, carpeta y grupo | Dibujo, selección por clic, cajas, exportar e importar SVG | Medio; es lo que más mejora la importación |
| D. `mask` general (formas, luminosidad; en carpeta y grupo) | Los 17 archivos de `pixelMask` | Alto: renombrar `pixelMask` es migrar datos guardados |

Recomiendo A + B + C en ese orden y dejar D para cuando un importador lo pida, conservando `pixelMask` con su nombre:
así no hay migración. Cada parte con su prueba de píxeles y su ida y vuelta por SVG.

## Qué no conviene hacer

- Guardar datos crudos del formato de origen en cada objeto «para la vuelta»: quedan viejos en cuanto se edita.
- Un modelo intermedio entre OGS y cada formato. SVG ya hace de punto de paso para todo lo vectorial.
- Texto con tramos de estilo antes de decidir [imagen y texto como objetos](propuesta-imagen-texto-como-objetos.md).
- CMYK o 16 bits: se convierte a sRGB de 8 bits al importar y se avisa.

## Camino por formato (inferido)

| Formato | Vía | Qué llegaría |
|---|---|---|
| PSD | Lectura directa en el navegador (ag-psd lee y escribe capas, grupos, máscaras, mezcla y texto básico, V) | Capas, carpetas, máscaras; efectos y texto con estilos, como imagen con aviso |
| AI | Su parte PDF, y de ahí al mismo recorrido que SVG | Formas, grupos, capas; sin la apariencia viva |
| EPS | Convertir a PDF con Ghostscript (lo que hace Inkscape, V secundaria); no hay vía en el navegador | Lo mismo que AI, sin transparencia |
| CDR | libcdr a SVG, fuera del navegador | Lo que lea el importador de SVG |

AI, EPS y CDR acaban en el importador de SVG o en uno de PDF muy parecido: por eso el contrato de
[intercambio SVG](intercambio-svg.md) es la base, y solo PSD necesita un mapeo propio.

## Decisiones del usuario

- Aprobar o no el contenedor común y qué partes (A–D); B y C cambian el modelo guardado solo con campos opcionales.
- Si D llega algún día: renombrar `pixelMask` (migración, con permiso expreso) o dejarlo como está.
- EPS y CDR exigen una herramienta local fuera del navegador: decidir si entra en el alcance.

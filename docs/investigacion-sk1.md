# Investigación: sK1 2.0rc5 para el Designer de OGS

Investigación de solo lectura del 2026-10-13. Código revisado: `/home/samuel/Descargas/sk1-2.0rc5` (editor vectorial en Python con Cairo, Pango, LittleCMS y UniConvertor 2). Todas las rutas de sK1 son relativas a `src/`. El paquete no se ejecutó, no se compiló y no se instaló; se leyó con `cat`, `grep` y `find`. Estado de OGS según sus docs (`features/designer.md`, `inkscape-formas.md`, `inkscape-importacion.md`, `render-estado.md`); no se revisó el código de OGS en esta pasada.

## Resumen y licencia

- **Licencia.** El archivo `LICENSE` de sK1 es GPL v3. Algunos archivos llevan cabecera AGPL (por ejemplo `uc2/libgeom/contour.py:6`). Ninguna idea de este documento requiere copiar código. Solo se describen algoritmos, fórmulas y decisiones de diseño, con referencia a archivo y línea.
- **Veredicto general.** sK1 es un editor de escritorio maduro, pero de 2010 a 2015 en su arquitectura: modelo propio, Python 2 heredado y la lógica de geometría en Python puro con una capa `libcairo`. Su valor para OGS está en **modelos de datos y fórmulas** (degradados, tipos de nodo, primitivas, booleanas, páginas, color), no en su código.
- **Lo que OGS ya tiene y sK1 no:** caché raster por zonas sucias, pintura en worker, FX no destructivos, saneado y rasterizado selectivo al importar SVG, y límites de memoria medidos. Esta investigación no propone cambiar esas partes.

## Tabla por tema

Dificultad: B (baja), M (media), A (alta), MA (muy alta). Valor para el usuario: B, M o A.

### 1. Primitivas y conversión a curvas

| Qué | Cómo lo hace sK1 | OGS hoy | ¿Conviene? | Dif. | Valor |
| --- | --- | --- | --- | --- | --- |
| Rectángulo redondeado | Se construye directamente en cuatro esquinas de Bézier cúbica. El radio es `min(w, h)/2 × fracción` por esquina, así que cada esquina tiene su propio radio y el límite es la mitad del lado menor (`uc2/libgeom/objs.py:45-115`). Las dos curvas por esquina usan el factor 0,4478 (`uc2/sk2const.py:61`), que equivale a 1 − 0,4478 = 0,5522 medido desde el extremo: la misma aproximación de círculo que usa OGS. | Rectángulo con `rx`/`ry` y tiradores, al estilo de Inkscape (`inkscape-formas.md`). | Parcial: la matemática ya coincide; sK1 aporta el radio por esquina como lista de cuatro. | B | M |
| Elipse, sector, arco, cuerda | Un círculo se parte en cuatro arcos de Bézier. Para ángulos arbitrarios, el arco se corta con subdivisión de De Casteljau en el punto exacto (`objs.py:117-222`). Según el tipo de arco se cierra en el centro (sector), en la cuerda (cuerda) o queda abierto (arco) (`objs.py:224-246`). | Elipse y rectángulo. Sin sector, arco ni cuerda documentados. | Sí. | M | A |
| Polígono y estrella | Un solo generador: N vértices a radio `coef1` y N puntos medios a radio `coef2 · cos(π/N)`, rotados por dos ángulos (`objs.py:249-277`). Estrella = radio interior distinto del exterior; polígono = radio interior igual al exterior. | Polígono solo como trazado importado. | Sí. | B | M |

### 2. Operaciones de trazado

| Qué | Cómo lo hace sK1 | OGS hoy | ¿Conviene? | Dif. | Valor |
| --- | --- | --- | --- | --- | --- |
| Unir, restar, intersección, exclusión | Intersecta curvas por aproximación poligonal (`uc2/libgeom/shaping.py:557-620`), reconecta los trozos por sus extremos (`shaping.py:751-810`) y clasifica cada trozo como dentro o fuera del otro objeto según la regla (`INTERSECT`, `FUSION`, `CUTTING`). La exclusión (XOR) se obtiene como unión más intersección (`shaping.py:825-831`), sin cálculo propio; depende de la regla de relleno. El plugin de UI tiene cuatro modos (`sk1/share/pd_plugins/shaping/__init__.py:40-43`). | Sin booleanas. Hay máscaras alfa de regiones vectoriales (`docs/features/designer.md`). | Sí, pero con cautela: la idea es sencilla y los casos límite son el trabajo. | A | A |
| Simplificar | No se encontró una función de simplificación de nodos en el núcleo; solo aparece en importadores (`formats/fig`, `formats/plt`). | No verificado. | No prioritario. | — | B |
| Invertir dirección | Invierte cada subtrazado (`uc2/libgeom/bezier_ops.py:80-115`); el editor tiene «invertir todo» y «invertir subtrazados» (`sk1/document/controllers/editor_bezier.py:832-880`). | No verificado. | Sí, si no existe. | B | B |
| Unir nodos | `join_nodes` en `editor_bezier.py:716`. | No verificado. | Sí. | M | M |
| Cerrar o abrir | Un flag `CURVE_CLOSED`/`CURVE_OPENED` por subtrazado (`sk2const.py:45`). | No verificado. | Sí. | B | M |
| Tipos de nodo | Seis tipos: esquina (0), suave (1), suave de un lado (2), suave en ambos (3), simétrico (4) y simétrico-suave (6) (`sk2const.py:48-54`). Se aplican sobre la selección (`editor_bezier.py:823-831`). Un nodo es «suave» si sus dos tiradores son colineales y «simétrico» si además miden lo mismo (`editor_bezier.py:1119-1150`). | Nodos en trazados: no documentados (el doc `nodes.md` trata el grafo de nodos del flujo, no los de vector). | Sí. | M | A |
| Combinar y separar | `combine_selected` y `break_apart_selected` en `sk1/document/api.py:1681-1740`: combinar convierte varios objetos en un solo trazo con varios subtrazados; separar lo deshace. | No verificado. | Sí. | M | M |

### 3. Relleno

| Qué | Cómo lo hace sK1 | OGS hoy | ¿Conviene? | Dif. | Valor |
| --- | --- | --- | --- | --- | --- |
| Degradado lineal | Modelo: lista de paradas `(offset, color)` (`uc2/formats/sk1/model.py:451-473`), dirección `(x, y)` y borde (`model.py:479-499`). | No hay degradados nativos. Los degradados importados se rasterizan (`inkscape-importacion.md`). | Sí, es el hueco más visible. | M | A |
| Degradado radial | Mismo modelo con centro y borde (`model.py:501-520`). | No. | Sí. | M | A |
| Degradado cónico | Centro y dirección (`model.py:522-543`). | No. | Parcial (menos frecuente). | M | M |
| Render | Cairo `LinearGradient`/`RadialGradient` con `add_color_stop_rgba` y modo de extensión (`uc2/formats/sk2/crenderer.py:281-304`). En Canvas2D es equivalente con `createLinearGradient` y `addColorStop`. | — | — | B | — |
| Tiradores en lienzo | Los vectores de degradado se dibujan y se arrastran (`sk1/document/renderer.py:346-363`). Invertir degradado en `sk1/pwidgets/gradientctrls.py:440`. | No. | Sí. | M | A |
| Patrones | Tramas (`HatchingPattern`, `model.py:545-578`) y mosaicos de imagen (`ImageTilePattern`, `model.py:580+`). | No. | No prioritario. | M | B |

### 4. Trazo

| Qué | Cómo lo hace sK1 | OGS hoy | ¿Conviene? | Dif. | Valor |
| --- | --- | --- | --- | --- | --- |
| Unión, terminación, guiones, orden de pintado | Campos del trazo (`sk2const.py:131`, `crenderer.py:358-362`): dash, cap, join, miter. | Sí: unión, punta, guiones en anchos de trazo y `paint-order` (`inkscape-formas.md`). | Ya. | — | — |
| Flechas | Catálogo de flechas como trazados (`uc2/formats/sk2/arrows.py:21`), cacheado como trazado de Cairo (`arrows.py:220-231`). Se referencia por índice o por trazado propio. | No documentadas. | Sí, si el usuario las pide. | B | M |
| Trazo escalable | Una bandera por trazo (`sk1/dialogs/strokedlg.py:180`, `201`): si está activa, el ancho escala con el objeto. | Escala con el objeto según el modelo de «escala media» (`inkscape-importacion.md`). | Parcial. | B | B |
| Trazo a curva | Convierte el trazo en un contorno cerrado: uniones (`contour.py:193-264`), terminaciones (`contour.py:265-306`), y el desplazamiento por aproximación recursiva (`contour.py:116-181`) y el contorno final (`contour.py:393-482`). | No documentado. | Sí para exportar a imprenta. | A | M |

### 5. Texto

| Qué | Cómo lo hace sK1 | OGS hoy | ¿Conviene? | Dif. | Valor |
| --- | --- | --- | --- | --- | --- |
| Multilenguaje y RTL | Pango crea el diseño (`uc2/libpango/core.py:58-94`). Para RTL, detecta regiones bidi y reordena clusters (`uc2/libpango/paths.py:91-190`). | El texto va por el navegador; las fuentes del sistema no entran en el canvas. | Sí, la idea de regiones bidi sin copiar código. | A | M |
| Texto a curvas | Recorre los glifos de Pango y devuelve trazados de Cairo (`uc2/libpango/paths.py:204-290`, `get_text_paths` en `291`). Caché de glifos por fuente y carácter (`core.py:45-56`). | Texto editable. El SVG importado rasteriza el texto (`inkscape-importacion.md`). | Sí, para imprenta y para convertir. | M | M |
| Texto en trazado | Coloca cada glifo a lo largo de un trazado aplanado (`uc2/libgeom/text_on_path.py:31-50`, `51`). Plugin en `sk1/share/pd_plugins/text_on_path/__init__.py`. | No. | Parcial. | M | M |

### 6. Color

| Qué | Cómo lo hace sK1 | OGS hoy | ¿Conviene? | Dif. | Valor |
| --- | --- | --- | --- | --- | --- |
| Modelos | Gris, RGB, CMYK, LAB, SPOT y registro (`uc2/uc2const.py:548-581`). Colores de referencia en `sk2const.py:126-129`. | RGB y alfa. Sin CMYK, LAB, SPOT ni ICC en los docs del Designer. | Parcial: SPOT y CMYK solo para exportación. | M | A (imprenta) |
| Gestión con LittleCMS | Envoltorio de C (`uc2/cms/libcms.py:331-416`) con transformaciones, pruebas de impresión (`libcms.py:359-395`) y transformación de bitmaps (`libcms.py:416`). Perfiles sRGB, CMYK, LAB, gris y pantalla empaquetados como recursos (`uc2/cms/*_profile_rc.py`). El manager de la app marca la prueba de impresión y la de spot (`sk1/app_cms.py` y `uc2/app_cms.py:27-78`). | No. | Parcial en navegador (ver «Lo no verificado»). | MA | A |
| Compilación de LittleCMS | Se compila como `_cms` con `lcms2` (`utils/native_mods.py:63-80`). | — | — | — | — |
| Emulación de impresora | Hay controladores CUPS, MSW y PDF (`sk1/printing/`). No se revisó a fondo el perfil de emulación. | No. | No prioritario en el navegador. | A | B |

### 7. Estructura

| Qué | Cómo lo hace sK1 | OGS hoy | ¿Conviene? | Dif. | Valor |
| --- | --- | --- | --- | --- | --- |
| Páginas de distinto tamaño | Cada página guarda su formato `[nombre, (ancho, alto), orientación]` (`uc2/formats/sk2/sk2_model.py:188-200`). Hay una lista de `Pages` (`sk2_model.py:151`). | Un lienzo por diseño. | Sí, si el usuario lo pide. | M | M |
| Capas y grupos | Capa (`sk2_model.py:228`), capa guía (`276`), capa de rejilla (`299`), grupo de capas (`324`), grupo (`407`) y contenedor (`484`). | Capas y carpetas, con anidado «Padre / Hijo» (`inkscape-importacion.md`). | Ya. | — | — |
| Máscara de recorte | El contenedor recorta con `ctx.clip()` (`uc2/formats/sk2/crenderer.py:128-147`). | Máscaras alfa de región vectorial, sin recorte por trazado. | Sí, para recorte. | M | M |

### 8. Importación, exportación y preimpresión

| Qué | Cómo lo hace sK1 | OGS hoy | ¿Conviene? | Dif. | Valor |
| --- | --- | --- | --- | --- | --- |
| Formatos | UniConvertor 2: `cdr` (1 902 líneas), `cdrz` (438), `ccx` (66), `xar` (4 430), `cmx` (2 920), `wmf` (1 794), `svg` (2 403), `pdf` (706, solo exportación con reportlab), `cgm` (2 146), `plt` (566), `dst` (1 196), `png`, `aco`, `ase`, `gpl`, `scribus_pal`, `edr_pal`, `cpl`. No hay AI ni EPS en `formats/`. | SVG (importa y exporta), PNG y JPG. Sin PDF. | Ver nota de abajo. | — | — |
| Parsers pequeños | `ccx` (66 líneas) y `cdrz` (un contenedor comprimido) son los más pequeños. `plt` y `dst` son de corte y bordado. | — | Estudiar solo la estructura del contenedor. | M | B |
| PDF de preimpresión | `formats/pdf/pdfgen.py` escribe con reportlab. Los colores spot se emiten como separación con `CMYKColorSep` (`pdfgen.py:247-262`); el uso de spot es opción (`pdfgen.py:100`). No se encontró sangrado ni marcas de corte fuera de `xar_const` (grep). | Sin PDF. | Parcial: sangrado y marcas son trabajo nuevo en cualquier caso. | A | M |

### 9. Rendimiento

| Qué | Cómo lo hace sK1 | OGS hoy | ¿Conviene? | Dif. | Valor |
| --- | --- | --- | --- | --- | --- |
| Caché | Cada objeto guarda su caja (`cache_bbox`) y el trazado en Cairo (`uc2/libcairo`, `cwrap.py:21-30`). Caché de glifos y de flechas. | OGS ya tiene zonas sucias por id y cajas por versión (`render-estado.md`). | OGS va por delante. | — | — |
| Repintado | Hay un repintado parcial de la selección (`sk1/document/canvas.py:439-460`, `renderer.py:330-341`) y un repintado completo del documento en el resto de casos (`renderer.py:120`). No se encontró recorte por región sucia en `crenderer.py:106-192`. | OGS recorta por región sucia y tiene pintura en worker. | No. | — | — |

### 10. Herramientas de precisión

| Qué | Cómo lo hace sK1 | OGS hoy | ¿Conviene? | Dif. | Valor |
| --- | --- | --- | --- | --- | --- |
| Ajuste (snap) | Gestor de ajuste a rejilla, guías, objetos y página (`sk1/document/snapping.py:27-256`). Calcula la rejilla según la vista (`snapping.py:116-155`). | No aparece en `features/designer.md`. | Sí. | M | A |
| Guías y reglas | Guías como controlador (`sk1/document/controllers/guide_ctrl.py`) y regla (`sk1/document/ruler.py`). Rejilla en el repintado (`renderer.py:230-330`). | No documentadas. | Sí. | M | A |
| Transformación numérica | Posición y tamaño por coordenadas (`sk1/context/position.py:50-70`), y parámetros de rectángulo, elipse, polígono y arco en su contexto (`sk1/context/rect.py`, `circle.py`, `polygon.py`). | Campos numéricos en ADR 0013. | Parcial. | B | M |
| Alinear y distribuir | No se encontró la función en `sk1/` ni `uc2/` (grep de `align` y `distribut`). | No documentado. | No hay referencia aquí. | — | — |

## Las 8 ideas más valiosas para OGS

Ordenadas por valor para el usuario y, a igualdad, por esfuerzo (menor primero).

1. **Ajuste a rejilla, guías y objetos.** Valor alto, esfuerzo medio. Referencia: `sk1/document/snapping.py:27-256`, `sk1/document/controllers/guide_ctrl.py`. OGS no lo documenta y es la base de cualquier edición precisa.
2. **Degradados lineales y radiales con paradas y alfa.** Valor alto, esfuerzo medio. Referencia: `uc2/formats/sk1/model.py:451-520`, render en `uc2/formats/sk2/crenderer.py:281-304`, tiradores en `sk1/document/renderer.py:346`. Ya hay Canvas2D y SVG de destino; el modelo de datos es el único trabajo de diseño.
3. **Primitivas paramétricas: polígono y estrella, sector, arco y cuerda.** Valor medio-alto, esfuerzo bajo. Referencia: `uc2/libgeom/objs.py:224-277`. Cada forma es una fórmula con su conversión a Bézier.
4. **Tipos de nodo de seis estados.** Valor alto, esfuerzo medio. Referencia: `uc2/sk2const.py:48-54`, `sk1/document/controllers/editor_bezier.py:802-831` y `1119-1150`. Conviene definirlo antes de editar trazos de forma libre.
5. **Flechas como catálogo y trazo escalable.** Valor medio, esfuerzo bajo. Referencia: `uc2/formats/sk2/arrows.py:21-231`, `sk1/dialogs/strokedlg.py:180`.
6. **Páginas con formato propio por página.** Valor medio, esfuerzo medio. Referencia: `uc2/formats/sk2/sk2_model.py:151-200`. Útil para exportar varias piezas de tamaños distintos.
7. **Texto a curvas.** Valor medio, esfuerzo medio. Referencia: `uc2/libpango/paths.py:291` y `core.py:58-94`. Permite convertir el texto a trazado para exportar sin fuentes.
8. **Booleanas por intersección de curvas (unir, restar, intersección).** Valor alto, esfuerzo alto. Referencia: `uc2/libgeom/shaping.py:557-831`, modos en `sk1/share/pd_plugins/shaping/__init__.py:40-43`. Es la idea más costosa, por la robustez de los casos límite; conviene hacerla después de los tipos de nodo.

Descartadas por el orden (valor menor o ya cubiertas en OGS): gestión de color completa, PDF de preimpresión con sangrado, trazo a curva, texto en trazado y recorte por trazado. Quedan como ideas posteriores.

## Qué exigiría copiar código GPL (descartado)

- **Parsers de UniConvertor** (`uc2/formats/cdr`, `xar`, `cmx`, `wmf`, `cgm`). Son binarios, largos y acoplados a su modelo. Para escribir un lector propio se necesitaría la especificación del formato, no su código; la descripción de la estructura del contenedor de `cdrz` no requiere copiar.
- **Booleanas** (`shaping.py`) y **trazo a curva** (`contour.py`). Su lógica de reconexión y su desplazamiento recursivo solo funcionan con sus clases `CurveObject`/`PathObject`. Reimplementar desde la idea es viable; copiar, no.
- **Envoltorio de LittleCMS** (`uc2/cms/libcms.py` y `_cms2.c`). Es código GPL y el binding a C no sirve en el navegador. LittleCMS se usaría directamente, no el wrapper de sK1.
- **Conjunto de plantillas y perfiles ICC empaquetados** (`uc2/cms/*_profile_rc.py`). Son recursos de sK1; si se quieren perfiles, deben venir de otra fuente con su propia licencia.

## Lo no verificado

- **Ejecución.** Nada de sK1 se ejecutó. Los comportamientos (booleanas, degradados, texto) se deducen del código y pueden diferir en tiempo de ejecución.
- **Licencia de LittleCMS.** Por conocimiento general, LittleCMS se distribuye con licencia MIT, y compilarlo a WebAssembly es técnicamente viable. No se comprobó en este repositorio ni se compiló nada. Si se usa, hay que verificar la licencia del paquete concreto y su peso.
- **Cabeceras AGPL frente a GPL v3.** Algunos archivos dicen AGPL y el `LICENSE` dice GPL v3. No se resolvió la contradicción; para OGS basta con no copiar.
- **Estado de OGS.** Se usó solo lo que dicen sus docs. No se revisó su código ni se probó en navegador. Las casillas «No verificado» de la tabla son huecos de documentación, no confirmaciones de ausencia.
- **Rendimiento.** No se midió nada en sK1. La afirmación de que sK1 repinta el documento entero fuera de la selección se basa en la lectura de `canvas.py` y `renderer.py`.
- **Alinear y distribuir.** No se encontró la función con grep; puede estar bajo otro nombre.
- **Emulación de impresora.** No se revisó a fondo el perfil de prueba; solo que existe el soporte.
- **Parsers pequeños.** `ccx`, `cdrz` y `pdf` se describen por tamaño y estructura; no se leyó su lógica completa.

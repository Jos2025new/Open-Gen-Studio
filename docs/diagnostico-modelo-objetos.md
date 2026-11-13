# Diagnóstico: modelo de objetos vectoriales (2026-11-10)

Diagnóstico. Hechos después, sin commit: el punto 1 (ver «Rendimiento») y los puntos 2 y 3 ([intercambio SVG](intercambio-svg.md)). Medido en `task/export` con los cambios de objetos, grupos y
orden de apilado sin commit. Las sondas eran temporales y se borraron; los tiempos son de una sola pasada en vitest con
la máquina cargada (carga ~3): valen como orden de magnitud, no como cifra exacta.

## Resumen

1. **Rendimiento: fallo grave con grupos.** El coste crece con formas × grupos, y en varias operaciones al cuadrado.
2. **Importar lo que exportamos no funciona.** Nuestro propio SVG vuelve como una sola imagen.
3. **Importación y exportación usan modelos distintos.** Aun sin el punto 2, los grupos no vuelven como grupos.
4. El resto (invariantes, huecos de interfaz) es menor y se lista al final.

## 1. Rendimiento

Capa de prueba: rectángulos en grupos de 5, dentro de grupos de 4 grupos (2 niveles). «Plano» = sin grupos.

| Operación | 1000 plano | 200 agrupado | 1000 agrupado | 4000 agrupado |
|---|---|---|---|---|
| `layerObjects` (cajas de la capa) | 1 ms | 8 ms | 26–44 ms | 438 ms |
| `objectAt` (qué hay bajo el clic) | 2–3 ms | 4–8 ms | 49–84 ms | 1371 ms |
| `expandPicks` de 200 ids (marco) | 2 ms | 305 ms | 4979 ms | no medido |
| `validPicks` con todo elegido (tras **cada** cambio y cada deshacer) | 14 ms | 238 ms | 25 786 ms | no medido |
| `groupShapes` de 10 formas (Ctrl+G) | 1 ms | 146 ms | 12 604 ms | no medido |

Causa, una sola: `groupChain` ([objectGroupTree.ts](../src/engine/design/objectGroupTree.ts)) construye un `Map` de
todos los grupos **en cada llamada**, y `inGroup`, `shapeIs`, `pickable` y `clickPick` lo llaman por forma. `clickPick`
recorre todas las formas, y `validPicks`/`expandPicks` lo llaman por id elegido: formas × formas × grupos. El `Map` por
llamada ya estaba en el commit 48764560; los cambios de esta rama (ocultar/bloquear, poda de la selección) lo pusieron
en el camino de cada cambio del documento.

Prototipo de la misma respuesta de `validPicks` con un índice por capa construido una vez (padre de cada grupo, grupo
exterior de cada forma, miembros por grupo exterior, formas elegibles): **6 ms con 1000, 18 ms con 4000, 59 ms con
20 000** formas agrupadas. Es decir, lineal.

**Arreglado el 2026-11-10** (sin commit): índice por capa en `objectGroupTree.ts`; con 4000 formas agrupadas todas las
operaciones de la tabla quedan entre 3 y 31 ms. Presupuesto en
[object-groups-budget.test.ts](../tests/object-groups-budget.test.ts).

No hace falta índice espacial todavía: sin grupos, 1000 formas se resuelven en 2–3 ms con el recorrido de cajas actual.
tldraw usa un R-tree (RBush) y Flatbush es más rápido para datos estáticos, pero aquí el cuello no es la búsqueda
espacial; se decide con otra medición después de arreglar el índice de grupos.

## 2. Ida y vuelta de nuestro propio SVG

Documento de prueba: una capa «Art» con el grupo «Outer» (opacidad 0,5, multiplicar) que contiene el grupo «Logo»
(2 formas) y la forma «Blue»; fuera, una forma oculta y una bloqueada con nombre. Exportado con `docToSvg` e importado
con `importSvg`:

- **Resultado: 1 capa de píxeles, 0 formas editables** (informe: `rasterized: 1, reasons: clip-path`). La exportación
  envuelve todo en `<g clip-path="url(#page)">` ([export.ts:243](../src/engine/design/export.ts)) y la importación
  rasteriza cualquier cosa con recorte.

Quitando ese envoltorio a mano, para ver el resto:

| Exportado | Al reimportar |
|---|---|
| 1 capa, 2 grupos anidados | 3 capas y 3 carpetas («Group / Art / Outer / Logo»…); ningún `objectGroups` |
| Opacidad 0,5 en el grupo «Outer» | 0,5 en cada capa por separado: donde se solapan «Logo» y «Blue» el resultado cambia |
| Mezcla multiplicar en el grupo | `normal` |
| Forma oculta | no existe (la exportación la omite) |
| Forma bloqueada | desbloqueada (no se escribe `sodipodi:insensitive`) |
| Nombre de forma (`inkscape:label`) | pasa a ser nombre de capa |

La importación ([svgImport/structure.ts](../src/engine/design/svgImport/structure.ts)) convierte cada `<g>` en carpeta
de capas y parte las formas en capas; es anterior a los grupos de objetos y nunca los crea. El texto vivo vuelve como
imagen (ya conocido).

## 3. Estándares

- W3C Compositing 1 (<https://www.w3.org/TR/compositing-1/>): opacidad y mezcla aíslan el grupo. El pintor
  ([groupPaint.ts](../src/engine/design/groupPaint.ts)) y el SVG exportado lo cumplen (comparado con resvg, ≤ 1 por
  canal). La importación no: reparte la opacidad entre los hijos.
- Inkscape: oculto = `display:none`, bloqueado = `sodipodi:insensitive="true"`, capa = `inkscape:groupmode="layer"`.
  Escribimos lo tercero y `inkscape:label`; no lo primero ni lo segundo.
- Sin comprobar: PNG y PDF con opacidad o mezcla de grupo (jsPDF/svg2pdf.js), y qué hacen Inkscape e Illustrator al
  abrir nuestro `mix-blend-mode`.

## 4. Menores

- Nada valida al cargar que los miembros de un grupo sean contiguos ni que `parentId` no tenga ciclos. Las booleanas
  ([shapeBuilder.ts](../src/engine/design/shapeBuilder.ts)) insertan las piezas nuevas en el sitio de la entrada más
  alta sin mirar su `groupId`; no comprobé caso por caso si pueden romper la contigüidad.
- Desagrupar pierde la opacidad y mezcla del grupo; no hay control para cambiarlas (solo aparecen al agrupar entre capas).
- Las líneas de Lineart quedan fuera del árbol: siempre encima y sin grupo.

## Qué propongo, en orden

1. **Índice de grupos por capa**, cacheado por identidad de la capa como ya hace `shownLayer`. Un solo módulo;
   `groupChain`, `inGroup`, `shapeIs`, `clickPick`, `validPicks`, `expandPicks`, `groupShapes` y `layerObjects` leen de
   él. Sin estructuras nuevas en el documento ni migración. Con una prueba de presupuesto de tiempo en `npm test`.
2. **Un solo modelo para importar y exportar.** Capa de Inkscape → capa; cualquier otro `<g>` → grupo de objetos con su
   opacidad y mezcla; el recorte de página propio (y un recorte rectangular igual a la página) se reconoce y no
   rasteriza; oculto y bloqueado se escriben y se leen al modo de Inkscape. Contrato: prueba de ida y vuelta
   (exportar → importar → exportar) con igualdad de estructura y de píxeles.
3. **Una función que normaliza el árbol** (contigüidad, ciclos, grupos vacíos) al cargar y al importar, y la misma
   comprobación en las pruebas de cada operación que mueve formas.
4. Volver a medir; solo entonces decidir índice espacial, caché de cajas y los menores.

El 1 es un arreglo acotado. El 2 cambia la importación (carpetas → grupos): conviene decidirlo antes de escribirlo.

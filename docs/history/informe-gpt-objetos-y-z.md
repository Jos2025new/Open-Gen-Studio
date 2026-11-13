# Informe parcial: objetos y profundidad

Base: `task/export`, `72c6730b`. Cambios sin commit. Este informe distingue lo implementado de lo pendiente; el encargo aún no está completo.

## Objetos de capa completa

Imagen, texto y pintura sin trazos se presentan como un objeto con el ID de su capa. El panel los enumera; selección, movimiento, giro, borrado y área de exportación usan ese ID. El modo Capa conserva su selección. Archivos: `src/engine/design/objectOps.ts`, `multiObjectOps.ts`, `affine.ts`, `marqueePick.ts`, `exportJob.ts`, `paintMode.ts`; `src/components/designer/LayerObjects.tsx`, `stageObjMove.ts`, `StageEditMarquee.ts`, `Stage.tsx`, `ToolSettings.tsx`.

La exportación ignora IDs obsoletos. Los raster completos participan en el ajuste a guías; los trazos individuales siguen excluidos. Si una imagen ya tiene trazos editables, se conserva su selección individual; falta ofrecer además la imagen completa como objeto sin ocultar esos trazos. Al borrar el último trazo de pintura, la recomposición se decide según la capa original. En un borrado mixto, el historial se registra antes de recomponer. No se comprobó con píxeles reales el deshacer de un borrado mixto.

## Tiradores y grupos

`stageSprites.ts` resalta el tirador bajo el puntero con el acento del tema y mantiene su trayectoria; `Stage.tsx` conserva qué tirador está bajo el ratón. En un grupo de formas, el primer doble clic selecciona la forma y el siguiente entra en edición; un clic fuera limpia la selección. La ruta de curva y texto permanece en su orden anterior. No se ha probado visualmente ni en navegador.

## Pendiente: panel y profundidad

El punto 4 no está implementado: faltan nombre, ocultar, bloquear y reordenar objetos, atributos `name`, `hidden`, `locked`, `z`, proyección única y modo de orden Lista. Tampoco se añadieron sus pruebas. No se implementaron los puntos 5 y 6.

## Investigación: PDF por capas

Lectura del código local y dependencias: la ruta actual usa jsPDF y svg2pdf.js, y no se encontró una API de Optional Content Groups (OCG) en las distribuciones instaladas. No se demostró que sea imposible hacerlo mediante internals o una extensión. Los grupos opcionales requieren estructura PDF adicional; [PyMuPDF documenta una API OCG](https://pymupdf.readthedocs.io/en/latest/recipes-optional-content.html), pero usarla supondría añadir otra tecnología y no se integró ni probó. Recomendación: tratarlo como trabajo separado y comprobar en varios lectores la visibilidad y edición de las capas antes de elegir implementación.

## Comprobaciones

- Lectura: instrucciones, propuesta, mapa de contratos y notas pertinentes de Designer.
- Pruebas dirigidas: seis archivos, 34 pruebas aprobadas; en la última ejecución, seis archivos y 30 pruebas aprobadas, incluidos los casos de último trazo, ajuste a guías y selección con Auto desactivado. Las pruebas usan simulaciones de canvas y no demuestran píxeles reales.
- Tipos: `npx tsc --noEmit --incremental false -p tsconfig.json` aprobó después de las últimas correcciones.
- Las ejecuciones amplias de pruebas relacionadas se interrumpieron para priorizar la cuota disponible; no se consideran aprobadas. `scripts/test-related.mjs` fija dos trabajadores, así que se usó `vitest related --run --maxWorkers=1` para respetar el límite solicitado.
- `npm test -- --maxWorkers=1` pasó tipos, salvaguardas, documentación y tamaños, pero se detuvo porque el mapa estaba desactualizado; se generó y comprobó el mapa. La suite Vitest ejecutada por separado terminó con 3.505 pruebas aprobadas, cinco omitidas y dos fallos en 523 archivos. Después se corrigieron ambos fallos y pasaron las 30 pruebas dirigidas; no se repitió la suite completa, por lo que no hay resultado completo para la última versión.
- No se usó sandbox ni navegador, ni se tocó `data/`. No hay verificación visual ni de píxeles reales.

## Seguimiento: modo Dibujo y aviso

El ADR 0016 permite seleccionar trazos ya editables incluso en Dibujo; los trazos nuevos en ese modo se pintan directamente en píxeles. Se eliminó `strokeObjectsAvailable`, que siempre devolvía verdadero, y sus llamadas. El aviso del botón indica elegir Layer; se actualizó la prueba. Resultado: `npm test -- --maxWorkers=1` pasó; 3.505 pruebas aprobadas y cinco omitidas en 523 archivos (821,44 s).

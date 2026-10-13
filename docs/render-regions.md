# Regiones retenidas del Designer

La página retenida compara el último cuadro visible con el siguiente. Una escritura raster localizada puede recomponer el área de píxeles tocada, transformada desde el buffer a la página y ampliada por el alcance de sus FX. El rectángulo dirty describe el cambio pendiente; la caja total de la capa conserva el área necesaria para moverla, ocultarla o cambiar sus filtros.

El camino de pintura regional solo se usa cuando fuente, geometría, opacidad, mezcla y propiedades FX coinciden y cambian las versiones de píxeles. Si también cambió alguna propiedad de render, el plan une la caja anterior, la nueva y el dirty actual/anterior. Las escrituras desconocidas usan el área completa; una región que cubre más de la mitad de la página vuelve a cuadro completo.

Los límites raster se guardan por ID de capa y versión del buffer. Durante una escritura pendiente se reutiliza la última caja medida, sin leer de nuevo todos los píxeles en cada movimiento; el dirty se conserva aparte, de modo que una ocultación o un movimiento sigue usando la caja total. Si aún no hay una caja medida, se usa la colocación completa hasta poder medirla. El dirty de un buffer base se consume, pero no se trata como píxeles visibles: su versión todavía invalida la caja total segura; la inicialización de una base idéntica no convierte el siguiente trazo en un dirty de página completa. Para la composición, el límite incluye cualquier alpha distinto de cero; la caja de selección mantiene su umbral histórico de alpha mayor que 8.

El banco de paridad informa el plan de cada operación, el motivo de cada cuadro completo y la cuenta por tipo de operación. La secuencia determinista de 200 cambios debe coincidir exactamente con una composición completa. Esto valida la composición en CPU del banco; no sustituye las mediciones visuales del sandbox ni afirma equivalencia de GPU.

## Pasos estables del planificador

El memo retenido conserva una entrada por capa normal, incluso oculta o con opacidad cero, y una por FX de alcance `below`, incluso inactivo. Los FX de alcance `layer` se agrupan con su capa objetivo aunque estén inactivos, siguiendo la misma regla de adyacencia de `fxPlan`; sus cajas y márgenes locales determinan la invalidación. Así, mostrar una capa, activar un efecto o cambiar su orden compara cajas antiguas/nuevas en vez de cambiar el número de pasos y forzar un cuadro completo.

La lista estable solo existe para comparar cuadros. `fxPlan` sigue produciendo los pasos activos originales que recibe `composeFx`; las reglas compartidas de canvas, SVG y exportación no cambian. Los flags de carpeta ya aplicados a cada miembro entran por sus valores `visible` habituales, así que ocultar una carpeta une las áreas de sus capas y FX sin crear otra regla de composición.

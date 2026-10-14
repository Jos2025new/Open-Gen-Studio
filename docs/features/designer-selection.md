# Selección en Edit

Edit → Object trabaja con trazos y formas de la capa activa; Edit → Layer trabaja con capas. Son conjuntos distintos, así que Align permanece desactivado en Object si solo hay filas de capas elegidas: cambia a Layer para alinear esas capas. El tooltip de Align explica el cambio.

Arrastrar desde espacio vacío en Edit selecciona según el modo visible: objetos de la capa activa o capas visibles compatibles. En ambas direcciones solo selecciona cajas completamente contenidas; Shift añade y Alt quita, como en la selección raster de OGS. La selección raster conserva su herramienta y su estado separados. Las capas bloqueadas pueden entrar en la selección, pero sus operaciones siguen protegidas.

La geometría del marquee está probada en [marquee.test.ts](../../tests/marquee.test.ts); la ruta de clicks/selección preexistente, en [layer-click-replaces.test.ts](../../tests/layer-click-replaces.test.ts). El E2E [edit-marquee.spec.ts](../../tests-e2e/edit-marquee.spec.ts) ejercitó el gesto en Object y Layer, y Align operó sobre cada conjunto.

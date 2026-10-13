# Cuota provisional de trazos raster

Las capas pintadas mantienen trazos editables hasta llegar a uno de dos topes iniciales: 64 trazos o 8192 segmentos. Son valores provisionales, no el resultado de la medición de cierre del plan de fluidez. El tope de segmentos evita que unos pocos gestos muy largos acumulen una lista de puntos grande; 8192 equivale aproximadamente a 64 trazos de 128 segmentos.

Al terminar el gesto que alcanza cualquiera de los topes, la capa conserva el lienzo exacto que Stage ya pintó, elimina la lista de trazos editables y queda marcada como modo píxel. Ese gesto y el aplanado comparten un único paso de deshacer. Los gestos siguientes modifican directamente los píxeles y no vuelven a iniciar una cuota en esa capa. Una capa raster nueva comienza con la cuota limpia.

El contador de Capas muestra ambos usos y avisa desde el 80 %. Una capa que ya existía al alcanzar o superar los topes no se convierte al abrirla: el primer intento de pintarla pide confirmación en el panel; Continuar autoriza solo el siguiente gesto y Cancelar no cambia la capa ni el historial. El límite se puede desactivar por capa mediante otra confirmación cancelable; el ajuste es undoable y la interfaz advierte que los datos de trazos seguirán creciendo. Un aplanado ya hecho no vuelve a trazos editables.

Los campos `paintFlattened` y `paintLimitDisabled` son opcionales. Los documentos anteriores conservan su forma y se cargan sin conversión. La copia normal de una capa conserva ambos campos y sus píxeles. El contrato y las pruebas están en [map.md](map.md) y [raster-limit.test.ts](../tests/raster-limit.test.ts); la verificación visual en el sandbox aún debe completarse para cerrar la etapa 3 del [plan de fluidez](plan-fluidez.md).

# Rendimiento raster y deshacer — 2026-10-11

Medición antes de optimizar, siguiendo [el protocolo](depuracion.md#protocolo). Solo sandbox 5183, una pestaña, pruebas secuenciales. Evidencia local: `/tmp/ogs-raster-performance/`, `/tmp/ogs-raster-baseline.log` y `/tmp/ogs-raster-final.log`.

## Casos y resultados

Cada trazo contiene 96 segmentos. Tres movimientos, deshacer y rehacer por caso; 24 recomposiciones medidas por caso. Chromium, viewport 1500×940, DPR 1; zoom 58,54 % en 1080p y 29,27 % en 4K. Cifras en milisegundos, medianas antes → después.

| Documento / trazos existentes / elegidos | Recomponer | Deshacer visible | Rehacer visible |
| --- | --- | --- | --- |
| 1080p / 1 / 1 | 13,05 → 11,95 | 226,5 → 147,4 | 235,1 → 179,1 |
| 1080p / 10 / 10 | 47,8 → 10,3 | 202,9 → 184,4 | 147,1 → 134,1 |
| 1080p / 50 / 50 | 213,45 → 9,95 | 292,6 → 124,1 | 188,0 → 194,9 |
| 1080p / 50 / 1 | 235,45 → 9,1 | 161,1 → 95,3 | 149,8 → 86,0 |
| 4K / 50 / 1 | 793,65 → 49,6 | 647,5 → 287,8 | 425,9 → 212,8 |

Capturar/restaurar historial cuesta aproximadamente 0–0,2 ms, sin copiar píxeles: deshacer ya restaura referencias y no llama a composeRaster. La copia que precede la recomposición cuesta 8,4–9,4 ms en 1080p y 34,45 → 40,05 ms en 4K; está incluida en recomponer, no se suma. No se eliminó porque conserva la separación entre buffers editados y guardados.

Con 50 trazos existentes, pintar tres trazos largos produjo 243 muestras de raster.live: mediana 0,4 → 0,4 ms. No era el cuello de botella. Las tareas largas observadas en ese caso sumaron 7943 → 4984 ms, máximo 1750 → 980 ms. Su entrega puede ocurrir después del trabajo causante y el registro incluye comprobaciones y guardado: no se atribuyen todas a pintar. render.frame mide comandos CPU (~0,1 ms), no espera de GPU.

## Cambios mínimos

- Se reutiliza la cobertura de trazos cuya geometría no cambia. Caché limitada a 128 entradas y 16 millones de píxeles; posición, opacidad, borrado y mezcla se siguen aplicando al componer. Cambiar segmentos, punta o color reconstruye la cobertura.
- paintedBox lee las dimensiones del canvas una vez, en lugar de acceder a sus propiedades nativas por cada píxel. Conserva el mismo recorrido y umbral.
- rasterStrokeBox conserva los límites locales de segmentos inmutables en un WeakMap; aplica después traslación y escala actuales. Una geometría nueva vuelve a calcularse.

Un perfil de seis operaciones deshacer/rehacer encontró tiempo muestreado de paintedBox de 599,57 → 139,57 ms y de rasterStrokeBox de 270,3 → 4,18 ms. Son perfiles sujetos a planificación del sistema, no tiempos aislados garantizados.

No se cambian serialización, baseAt, historial, buffers guardados ni protecciones del almacén.

## Exactitud y regresiones

[La prueba raster](../tests-e2e/raster-performance.spec.ts) compara todos los canales RGBA antes, después de mover, después de deshacer y después de rehacer. Los cinco casos, con tres repeticiones cada uno, dan cero canales diferentes y diferencia máxima cero en las 30 restauraciones, antes y después de optimizar.

Otro caso incluye textura, presión, mezcla, borrador, opacidad conservada y traslación fraccionaria: compara la caché con una recomposición fresca y verifica el buffer persistido. Resultado: cero diferencias, buffer guardado, 12 canvases creados frente a 62 sin la optimización; el control negativo falla. Las pruebas unitarias de dimensiones y geometría también fallan con las implementaciones anteriores.

## Límites

Máquina con presión de memoria y otros procesos activos: no se promete una latencia universal. Rehacer 50 trazos seleccionados no mejoró en esta muestra. Las lecturas de píxeles de verificación ocurren fuera de los marcadores, pero fuerzan sincronización gráfica. No probado: documento original del usuario, su navegador/GPU, una sesión de horas ni documentos mayores de 4K. Sigue pendiente reducir la copia completa si una nueva medición y un diseño seguro lo justifican.

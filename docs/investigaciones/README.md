# Investigaciones con scripts reproducibles

Cada carpeta guarda lo necesario para repetir una medición: scripts, resultados en JSON y hojas de comparación reducidas. Las imágenes de referencia descargadas o enviadas por el usuario **no se versionan**.

## Grafito 2026-11

Soporte de [0028](../decisions/0028-lapiz-grafito.md) y del registro [058](../history/058-2026-11-W45.md).

- [Investigación: fallas medidas, fuentes leídas y no leídas, rondas, métricas que engañaron y rendimiento](grafito-2026-11/investigacion.md).

### Scripts (cadena de ajuste en Python)

Orden de ejecución: v5, fit5 a fit11, cada uno con `exec` del anterior, desde una carpeta de trabajo con `refs/user/grid.png` (lámina de 12 grados, no versionada). Necesitan numpy y ImageMagick.

- [v5.py](grafito-2026-11/scripts/v5.py), [stateless.py](grafito-2026-11/scripts/stateless.py) y [sweep.py](grafito-2026-11/scripts/sweep.py): prototipo sin estado y barrido de 800 configuraciones.
- [fit5.py](grafito-2026-11/scripts/fit5.py), [fit6.py](grafito-2026-11/scripts/fit6.py), [fit7.py](grafito-2026-11/scripts/fit7.py), [fit8.py](grafito-2026-11/scripts/fit8.py) (elegida), [fit9.py](grafito-2026-11/scripts/fit9.py), [fit10.py](grafito-2026-11/scripts/fit10.py) y [fit11.py](grafito-2026-11/scripts/fit11.py) (las dos últimas, descartadas).
- [lstar.py](grafito-2026-11/scripts/lstar.py) y [psd.py](grafito-2026-11/scripts/psd.py): L* y espectro radial del papel.

### Resultados de los ajustes (JSON)

- [fit5.json](grafito-2026-11/scripts/fit5.json), [fit6.json](grafito-2026-11/scripts/fit6.json), [fit8.json](grafito-2026-11/scripts/fit8.json) (parámetros portados a `LEAD_FITS`), [fit9.json](grafito-2026-11/scripts/fit9.json), [fit10.json](grafito-2026-11/scripts/fit10.json) y [fit11.json](grafito-2026-11/scripts/fit11.json).

### Scripts del motor real (Node y Chrome)

Necesitan el motor empaquetado con rolldown a partir de los puntos de entrada (`engine.mjs`, `engine.iife.js` y `lead.mjs` no se versionan).

- [entry.ts](grafito-2026-11/scripts/entry.ts) y [entrylead.ts](grafito-2026-11/scripts/entrylead.ts): puntos de entrada del paquete.
- [measure.mjs](grafito-2026-11/scripts/measure.mjs): fallas del motor anterior (sensibilidad de los ajustes).
- [hatch.mjs](grafito-2026-11/scripts/hatch.mjs): rayado de muestra con el motor en JavaScript.
- [bench.js](grafito-2026-11/scripts/bench.js) y [bench2.js](grafito-2026-11/scripts/bench2.js): tiempos en Chrome.
- [ab/ab.mjs](grafito-2026-11/scripts/ab/ab.mjs), [ab/rub.mjs](grafito-2026-11/scripts/ab/rub.mjs) y [ab/all.ts](grafito-2026-11/scripts/ab/all.ts): comparación de las tres versiones de `brushLead.ts` (`477a3ebb`, `87fd100c`, `11fc968e`). Faltan las copias de cada versión: salen de `git show <hash>:src/engine/design/brushLead.ts`.

### Hojas de comparación

Reducidas a JPEG de menos de 30 KB (originales PNG de 12 a 440 KB).

- [fit8.jpg](grafito-2026-11/hojas/fit8.jpg): lámina real arriba y modelo fit8 abajo.
- [js_vs.jpg](grafito-2026-11/hojas/js_vs.jpg): lámina real y, debajo, el modelo y el motor en JavaScript (orden de las dos filas inferiores sin verificar en la hoja).
- [chk.jpg](grafito-2026-11/hojas/chk.jpg) y [chk2.jpg](grafito-2026-11/hojas/chk2.jpg): líneas en Chrome real con 1, 3 y 12 pasadas, y con 1 a 30 pasadas (2H, 2B y 6B).
- [ab.jpg](grafito-2026-11/hojas/ab.jpg): rayado en zigzag, columnas `477a3ebb` (la que gustó), `87fd100c` (rechazada) y `11fc968e` (recalibrada); filas 2H, 2B y 6B.

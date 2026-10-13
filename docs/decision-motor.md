# Decisión del motor de render (Tarea 2): estado y bloqueos

Fecha: 2026-10-12. Estado: **sin decisión final; aplazada por decisión del usuario** (Canvas2D con composición retenida primero, motor después; ver [render-estado.md](render-estado.md), cronología). La comparación está a medias y no cumple su criterio de aceptación (equivalencia de píxeles y medida bajo el tope de 1800 MB). Este documento registra lo medido, lo que falta y por qué. Enlazado desde [arquitectura-render.md](arquitectura-render.md), sección 4.

## Qué se construyó (en `bench/engines/`, solo banco)

- `scene.ts`: modelo compartido del documento profesional. Cada capa raster guarda una base aplanada (los trazos anteriores al límite, dibujados por el `drawRasterStroke` de OGS) y **64 trazos editables**. La capa de 300 trazos tiene 236 aplanados y 64 editables (`limit.ts`, con test).
- `canvas2d.ts`: motor OGS real (`drawDoc`, `composeRaster`, `setBuffer`), con la clase `stage-canvas` para la caché de FX del editor.
- `webgl2.ts`: motor WebGL2 propio. Capas como texturas con «over» premultiplicado, trazos con punta como point sprites, FX blur, colour matrix (saturación, tono), niveles y curvas (tabla de 33 pasos), sombra y brillo. No reproduce los modos de fusión distintos de normal y multiply (el documento usa normal), y las curvas son lineales por tramos, no la spline monótona de OGS.
- `canvaskit.ts`: CanvasKit 0.42 (`canvaskit-wasm`, devDependency usada solo por `bench/`). Imágenes por capa, trazos como paths redondeados (sin dureza de punta), filtros de imagen para blur y sombra, filtros de color para saturación y tono; niveles y curvas aproximados por una sola función lineal (0.42 no tiene filtro de tabla ni runtime effects); brillo como blur en pantalla.
- `harness.ts`: cinco gestos (pintar, mover trazo limitado, mover capa, ocultar carpeta, FX `below`), 10 eventos y 3 repeticiones por gesto, zoom 0,365 y 1. Cada fotograma se cierra con una sincronización de GPU (lectura de 1 píxel). Liberación de recursos entre repeticiones.
- `browser-scope.sh`, `memory-gate.sh`: servidor y navegador con tope de 1800 MB dentro de una unidad systemd, y espera de memoria ≥ 2,5 GB antes de cada medida.

## Cifras válidas (Canvas2D y WebGL2, sin tope de memoria)

Tiempo por fotograma (mutación → sincronización GPU), p50 y p95, tres repeticiones:

| Motor | Zoom | Pintar | Mover trazo | Mover capa | Ocultar carpeta | FX below |
|---|---|---|---|---|---|---|
| Canvas2D (OGS) | 0,365 | 100–120 ms | 95–112 ms | 105–118 ms | 99–101 ms | 102–103 ms |
| Canvas2D (OGS) | 1 | 132–141 ms | 130–155 ms | 137–188 ms | 135–167 ms | 111–166 ms |
| WebGL2 propio* | 0,365 | 28–59 ms | 35–38 ms | 22–41 ms | 9–19 ms | 22–32 ms |
| WebGL2 propio* | 1 | 108–111 ms | 111–124 ms | 107–132 ms | 59–88 ms | 102–104 ms |

\* WebGL2 **no equivalente**: 42,7 % de los canales difieren más de 2/255 (máximo 239, media 9,3). Estas cifras no cuentan como medida del motor hasta que la diferencia sea ≤ 2/255 en al menos el 99 % de los píxeles. Canvas2D se compara consigo mismo (diferencia 0 por definición).

Ningún motor baja de 8 ms por fotograma en ningún gesto con 10 FX y el documento a 2048². El presupuesto no se cumple con recomposición completa en cada fotograma; la comparación tendría que añadir la composición retenida (caché por capa y por FX), que no está hecha.

## Bloqueos (por qué no hay decisión)

1. **Memoria (hallazgo).** La referencia OGS a resolución completa (la exportación 1:1 del documento profesional) supera 1800 MB de navegador, incluso con un navegador más ligero (un solo proceso renderer, caché de disco mínima). Se cae por OOM dentro de la unidad con tope. Lo mismo ocurre con el set completo de gestos de Canvas2D a zoom 0,365: el pico de memoria llega a 1800 MB. Causa: canvas de 2048² de la base, de la composición, de los FX de página completa y de las cachés del editor de OGS (`fxCache` y `belowFxCache`, de hasta 48 M píxeles cada una). Esto es comportamiento del producto medido, no un fallo del arnés, y se reporta como tal.
2. **Equivalencia de WebGL2.** La prueba de píxeles frente a OGS sigue fallando (ver tabla). Lo corregido hasta ahora: el blending «over» de las capas (estaba en reemplazo). Pendiente: orden y premultiplicado de los FX `below`, curvas (spline monótona de OGS), dureza de punta de los trazos y el multiply de la punta.
3. **CanvasKit sin medida completa.** Corre (con su propia equivalencia parcial: media 7,65 por canal en la muestra) pero la comparación bajo tope requiere la referencia, que no cabe en 1800 MB.
4. **Modo retenido** (composición con caché por capa y por FX, en los tres motores) no construido.

## Recomendación

**No hay recomendación única todavía.** Ninguno de los tres motores está validado en píxeles y medido bajo tope, y ninguno cumple el presupuesto de 8 ms por fotograma en su modo completo. Lo más cercano en tiempo es WebGL2 a zoom 0,365 (9–59 ms), pero sus píxeles no son equivalentes, así que no es una recomendación válida.

Para cerrar la decisión hacen falta, en este orden: (a) aprobación para una referencia de exportación que quepa en el tope (por ejemplo a 0,5 ×, o un paso de referencia con tope mayor, fuera de esta medida) y (b) la equivalencia de píxeles de WebGL2 al 99 % en ±2/255; luego el modo retenido en los tres motores.

## Etapa C (ADR 0014)

Actualizado el 2026-10-13. La Etapa C sí se inició después de esta nota: formato 2 en disco y en navegador (`19a81ce`, `8662a87`), con la vuelta atrás escrita en el ADR. El ADR 0014 está aceptado con implementación parcial. La migración sobre datos reales requiere una aprobación separada del usuario.

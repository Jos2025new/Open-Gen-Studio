# 0015 — Píxeles en mosaicos de 256² con copia al escribir

## Estado

Propuesto

Pendiente de aprobación del usuario. No se implementa en esta etapa: solo se documenta la propuesta y su impacto.

## Fecha

2026-10-13

## Contexto

Hoy cada capa raster de OGS es un lienzo completo (`pxWidth × pxHeight`, `src/engine/design/raster.ts` 336), y `beginEdit` clona el lienzo entero al empezar cada edición (`raster.ts` 335–340). El historial guarda referencias a esos lienzos, así que deshacer un trazo retiene otro lienzo completo. En el documento profesional (2048², 13 capas raster) esto multiplica la memoria por el número de ediciones que quedan en el historial, y el pico supera 1800 MB (`docs/render-baseline.md`, «Causas» y «Etapa A»).

PhotoCraft resuelve el mismo problema con lienzos dispersos de mosaicos de 256² compartidos por `Arc`, copia al escribir por mosaico y un presupuesto del historial en bytes (`investigacion-photocraft.md`, sección 2, con enlaces a `crates/raster/src/lib.rs` y `crates/ops/src/lib.rs`).

## Decisión

1. **Mosaicos de 256×256 para capas raster.** Cada capa guarda un mapa de mosaicos, creados bajo demanda. Un mosaico ausente vale el píxel por defecto de la capa (transparente).
2. **Copia al escribir por mosaico.** `beginEdit` copia solo los mosaicos que la edición va a tocar. El resto se comparte entre el documento actual y el historial.
3. **Deshacer por mosaicos.** Cada paso del historial guarda los mosaicos que cambió y referencias a los que no. Un presupuesto en bytes descarta los pasos más antiguos y conserva siempre el último (contrato del paso 5).
4. **Canvas por mosaico.** Cada mosaico es un `OffscreenCanvas` o un `ImageData` de 256²; la composición de un fotograma solo lee los mosaicos que cruza la región dañada.

## Alternativas

- **Mantener lienzos completos con copia completa (estado actual).** Simple, pero el pico de memoria crece con el documento y con el historial.
- **Lienzos completos con copia al escribir por región (sin mosaicos).** Reduce la copia, pero mantiene el lienzo entero en memoria.
- **Mosaicos de 512² o de tamaño variable.** Menos mosaicos que gestionar, pero cada copia al escribir es más cara. 256² es el tamaño de PhotoCraft y coincide con la región típica de un trazo.
- **Formato de píxel comprimido por mosaico.** Útil para el guardado, no para la edición en caliente; se puede añadir después sin cambiar la estructura.

## Consecuencias

- **Memoria.** El historial pasa de ser proporcional al número de ediciones por el tamaño del lienzo a ser proporcional a los mosaicos tocados. Las capas dispersas (la mayoría de las capas de personaje) ocupan poco más que sus mosaicos con trazos.
- **Guardado.** El guardado de píxeles escribiría solo los mosaicos modificados desde el último guardado (mismo principio que el formato 2 de sesiones, ADR 0014). Requiere un inventario de mosaicos por capa, con una clave lógica y una versión inmutable por mosaico.
- **Migración.** Las capas existentes (lienzo completo en el formato actual, sin mosaicos) se convierten al cargar: cada lienzo se trocea en mosaicos y se conserva una copia íntegra del original antes de cualquier escritura nueva. La conversión no cambia los píxeles: el test de equivalencia del oráculo de paridad (paso 2) debe dar diferencia cero antes y después.
- **Coste de implementación.** Toca el almacenamiento de píxeles (`raster.ts`, `rasterStrokeMask.ts`, `hitAlpha.ts`, `render.ts`), el historial (`history.ts`) y el guardado de capas. Requiere una prueba de paridad completa antes de activarlo.
- **Reversión.** Mientras esté sin aprobar no cambia nada. Si se aprueba, la reversión es la copia íntegra de la migración, como en el ADR 0014.

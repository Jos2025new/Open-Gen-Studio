# Variantes compatibles tras confirmar ajustes

Estado: Implementado. Fecha: 2026-10-06.

## Caso observado y causa

Lectura del sandbox: sesión ses_muxgfuqhvi2qkravfa. La confirmación elegía Nano Banana 2 Edit Developer para imágenes con referencias. El plan incluía dos personajes iniciales desde texto y páginas que referenciaban ambos. Dos respuestas del historial rechazaban esos personajes por falta de refs; la segunda propuesta ya nombraba explícitamente Text-to-Image Developer y fue rechazada otra vez como Edit Developer.

La normalización reemplazaba la variante escrita por el agente con el nombre visible del modelo confirmado cuando cambiaban las entradas. La búsqueda aproximada podía devolver Edit otra vez. El validador protegía correctamente la exigencia de entrada, pero su consejo de cambiar u omitir model era ineficaz porque la confirmación volvía a sobrescribirlo. La línea existía desde ed9a893; no se atribuye a la última modificación de continuidad.

## Corrección y alcance

El [contexto del runtime](../src/engine/agent/runtime.ts) entrega al [normalizador](../src/engine/plan.ts) la resolución existente [lineRoutes](../src/engine/catalog.ts). Cada paso escoge la ruta por sus entradas reales, manteniendo línea, versión y proveedor confirmados. Imagen sin refs usa text; con refs usa edit, o reference si esa es la ruta disponible. Vídeo usa su ruta text, image o reference. No se busca la variante mediante el nombre visible.

Se conservan la validación de entradas, los ajustes confirmados y los límites de aprobación. Sin una variante disponible no se cambia silenciosamente de familia o proveedor. No hay nuevas llamadas de red, LLM ni generaciones auxiliares. No se altera el historial persistido del usuario ni se reanuda automáticamente una petición de pago.

## Evidencia y límites

[confirmed-input-variants.test.ts](../tests/confirmed-input-variants.test.ts) reproduce el fallo con nombres y rutas Nano Banana, usando lineRoutes real y catálogo aislado: antes de corregir, fallaban las fuentes incluso con model text-to-image explícito. Tras corregir se verifican fuentes desde texto, páginas con refs, adaptación inversa y ausencia de un reemplazo silencioso si falta la variante.

Validación: npm run typecheck aprobado; npm test -- --maxWorkers=2 con 747 tests aprobados y 5 omitidos (52,84 s), salvaguardas y documentación aprobadas. git diff --check aprobado.

Son pruebas locales del contrato de normalización, no una prueba de proveedor ni de fidelidad visual. La reducción de tiempo hasta la tarjeta no está medida. La variación de seis a siete páginas observada en la misma sesión es otro problema de alcance y no se corrige en este cambio.

Para verificar en la app: reutilizar la confirmación existente y pedir otra propuesta del mismo plan. Las fuentes deben mostrar Text-to-Image Developer y las páginas Edit Developer, sin agregar refs ficticias ni repetir la tarjeta de ajustes. La llamada del Director y cualquier generación tienen los costes y autorizaciones habituales.

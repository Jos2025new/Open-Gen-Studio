# 0007 — Modos del agente y encaje de parámetros de las operaciones

## Estado

Aceptado

## Fecha

2026-10-07

## Contexto

El agente tiene tres modos (Auto, Guided y Direct). Tras probar el disparo por palabra clave, la app necesitaba decidir qué pasa cuando una petición nombra una operación pero no basta para llenar sus parámetros. Los detalles, los fallos y los commits están en `docs/history/019-2026-10-W41.md`. Esta decisión recoge lo que el usuario aprobó explícitamente.

## Decisión

1. **Tres modos en un desplegable del compositor.** Auto es el valor por defecto. Guided conserva sus rondas. Direct no hace preguntas ni muestra tarjeta de ajustes: usa los modelos del compositor y la aprobación del plan sigue siendo el control del coste.
2. **Imposibilidad frente a ambigüedad.** Un valor que la petición no puede dar es una imposibilidad y se rechaza en todos los modos: un lugar como hoja de personaje, un ángulo ya hecho desde la misma imagen, una hoja pedida para "una imagen por vista". Una ambigüedad pregunta en Auto y Guided. En Direct se usa un valor visible en el plan: el valor por defecto de la operación o el que indique la guía del producto.
3. **Parámetros desde la petición y la imagen.** El normalizador del plan rellena lo que el agente no dio, o dio mal, con el encaje de `fit.ts`. Un valor válido del agente se respeta. El relleno aparece como ajuste del plan.
4. **Hojas de personaje.** El sujeto es personaje, persona u objeto; un lugar se rechaza. Tienen 3 o 4 vistas, y 3 por defecto. "Tres vistas" sin decir hoja es ambiguo: Auto pregunta si quiere hoja o una imagen por vista, y Direct hace la hoja. "Una imagen por vista" nunca es hoja: va a operaciones de ángulo.
5. **Ángulos.** Un paso de ángulo por ángulo. "Múltiples ángulos" sin número: Auto pregunta cuántos y Direct usa 3.
6. **Formato de reencuadre.** "Post" o "feed" de Instagram es 4:5; stories, reels y TikTok son 9:16. "Instagram" a secas es ambiguo: Auto pregunta y Direct usa 9:16, el formato social por defecto de `social.md`.
7. **Upscale.** El factor sale del tamaño objetivo frente al de la imagen (4K desde 1024 px es ×4). Sin tamaño de origen, Auto pregunta y Direct usa ×2.
8. **Cortes.** La cuadrícula 2×3 se corta en seis vistas. Una hoja de turnaround es una fila de 3 o 4 vistas, con la vista frontal como principal.
9. **Modelo y prompting.** Las operaciones sobre un asset heredan el modelo de su origen; no reciben tarjeta de modelo. En Direct, la guía de prompting del modelo que elige el compositor entra con la petición, y la guía de vídeo no se bloquea como "no confirmada". Nunca se escribe un prompt genérico para un modelo.
10. **Orden de llamadas.** `ask_questions` y `confirm_settings` existen solo en Auto y Guided. La línea de orden del prompt lo dice, y la línea de modo de cada petición lo confirma.

## Alternativas

- **Forzar la llamada con `tool_choice`.** No se adopta como mecanismo principal. Fuerza la herramienta, no la operación, y su soporte varía por proveedor (informe de Pydantic AI sobre DeepSeek con razonamiento activado, sin verificar en NanoGPT ni OpenRouter). El normalizador rechaza lo que no encaja sin depender del proveedor.
- **Disparar por palabras sueltas.** Se descartó tras los falsos positivos de "luz", "frame", "voz" y "angle". Los disparadores exigen frases completas o un verbo de pedido.
- **Preguntar siempre también en Direct.** Contradice el modo, que no pregunta.

## Consecuencias

- Direct puede producir planes con un valor por defecto visible que el usuario no eligió. Ese valor aparece como ajuste y el plan sigue pidiendo aprobación.
- El disparo por palabra clave todavía no está conectado al runtime. El normalizador ya aplica el encaje, pero la app no detecta aún la operación ni da al agente la orientación corta. Es el siguiente paso.
- La precisión de los disparadores no está medida contra la intención del usuario: hace falta un conjunto etiquetado por el usuario.
- Pendiente de aprobación: la reversión de la regla "ajustes solo para la petición" (`0006`), el umbral de 0,50 USD (`0006`) y la fusión de las ramas de esta sesión en `task/modelo-general`.
- Sin verificar con generación real: los cortes de cuatro vistas y de 2×3.

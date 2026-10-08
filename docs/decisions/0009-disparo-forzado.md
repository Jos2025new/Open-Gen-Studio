# 0009 — Disparo forzado con suelo, y enmiendas a 0007

## Estado

Propuesto

## Fecha

2026-10-07

## Contexto

Los disparadores por palabra clave (`triggers.ts`) solo existían como dato: el agente elegía las operaciones sin que la app las impusiera. El usuario pidió que el disparo **forzara**, como el gatillo determinista de Gentle-AI. Su enrutado nativo decide a partir del estado, no del texto: el programa lee el estado del cambio en disco y devuelve la única transición válida, y un nivel de riesgo calculado por el código manda; el agente solo puede subirlo.

La revisión de `task/modelo-general` encontró además cinco fallos en lo aprobado en 0007. Los detalles, la evidencia y los commits están en `docs/history/020-2026-10-W41.md`.

## Decisión

1. **Suelo determinista.** Cinco disparadores fuertes fuerzan su operación cuando la petición adjunta la entrada que necesitan: `remove_bg` (imagen), `extract_frame` (vídeo), `angle` (imagen y un ángulo nombrado, no dentro de una hoja), `reference_sheet` (imagen y una hoja nombrada) y `create_voice` (audio). El resto de disparadores sigue siendo información.
2. **Informar, forzar y mostrar.** El agente recibe dos líneas con la petición, detrás del prefijo que cachea el proveedor. El normalizador devuelve un plan que no incluya la operación, con el paso exacto que falta. El plan aceptado dice qué paso pidió la petición y, si hizo falta, que un plan anterior sin él se devolvió. El agente puede añadir pasos, nunca quitar los forzados.
3. **Alcance.** Solo con el agente LLM (el planificador local no puede reintentar) y fuera del lienzo de nodos.
4. **Enmiendas a 0007.**
   - **(1 y 9)** En Direct corre siempre el modelo del compositor, aunque se haya confirmado otro antes en la sesión, y las guías enviadas son las de los modelos que pueden correr.
   - **(2)** Una ambigüedad de intención se pregunta en Auto y Guided aunque el agente haya puesto un valor, una sola vez por petición.
   - **(4)** Un lugar solo se rechaza como sujeto de hoja cuando no se nombra persona ni objeto.
   - **(5)** En Direct, «múltiples ángulos» amplía el paso a tres en el normalizador, sin devolver el plan.
   - **(7)** Un upscale que no alcanza el objetivo con ×4 lo dice, y uno encadenado toma el tamaño de su paso de origen.

## Alternativas

- **Forzar todos los disparadores.** Se rechaza: los débiles («luz», «edita», «grid») tienen falsos positivos conocidos y obligarían a devolver planes correctos.
- **Que el normalizador añada él mismo la operación forzada.** Se rechaza como mecanismo general: sin saber cómo encadena el agente los pasos, una operación añadida por separado podría duplicar trabajo o romper la cadena. Solo se amplía en el caso acotado de los ángulos en Direct.
- **`tool_choice`.** Fuerza la herramienta, no la operación, y su soporte varía según el proveedor (0007).
- **Dejar el disparo como información.** Contradice lo que pidió el usuario.

## Consecuencias

- **Coste de una omisión.** Cuando el agente omite una operación forzada, la petición cuesta una llamada más. La línea del plan la hace visible; la orientación previa la hace rara. En las 8 peticiones del sandbox que llegaron a plan, el agente ya la incluía.
- **Precisión sin medir en tres operaciones.** `remove_bg`, `extract_frame` y `create_voice` no tienen ningún caso en el corpus.
- **Lo que no se fuerza.** Un adjunto de otra petición, o «de ella» refiriéndose a una imagen anterior, no cumple la precondición. En el corpus hubo 4 peticiones de hoja así.
- **Pendiente de aprobación.** La lista de cinco y la línea del plan las aplicó el asistente porque el usuario pidió aplicarlo todo; no las eligió el usuario punto por punto.

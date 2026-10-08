# 0009 — Disparo forzado: las palabras clave dirigen al agente hacia su llamada, y enmiendas a 0007

## Estado

Propuesto

## Fecha

2026-10-07

## Contexto

Los disparadores por palabra clave (`triggers.ts`, uno por cada una de las 19 operaciones) solo existían como dato. El usuario pidió que forzaran. Una primera versión de esta decisión lo interpretó como enrutado determinista (`bc8c505`): un suelo de código que devolvía el plan si faltaba la operación, limitado a 5 disparadores. El usuario lo corrigió: **forzar es dirigir al agente hacia una tool call, no enrutar de forma determinista**, y `tool_choice` se usa solo cuando aplican las palabras clave.

La revisión de `task/modelo-general` encontró además cinco fallos en lo aprobado en 0007. Los detalles, la evidencia y los commits están en `docs/history/020-2026-10-W41.md`.

## Decisión

1. **Puerta por operación, determinista.** Una operación (cualquiera de las 19) se dispara cuando se cumplen tres condiciones:
   - **Está nombrada:** puntuación de palabras asociadas en español e inglés, donde una frase propia vale 1, cada palabra asociada 0,5 y un veto −1; dispara con 1 o más.
   - **Su entrada está adjunta.**
   - **Sus parámetros obligatorios se leen del texto:** el ángulo; el formato; el factor o los «K» según el tamaño de origen; el sujeto de la hoja; el preset de luz; el fotograma; la cuadrícula; dos clips para unir; una muestra de voz de 5 a 30 s.

   `edit` es el comodín: solo dispara si ninguna operación específica cubre la misma imagen. Una ambigüedad se pregunta en Auto y se resuelve en Direct.
2. **Forzar es dirigir.** Las operaciones disparadas llegan al agente en orden (n1, n2…) con sus parámetros, y su primera llamada lleva `tool_choice` con `propose_plan`. Las nombradas que no disparan llegan con su motivo y decide el agente: pregunta o niega la operación. Sin operaciones disparadas, `tool_choice` va en `auto`. Si el proveedor rechaza un `tool_choice` con nombre, se repite una vez con `auto`.
3. **Sin puerta.** No se rechaza ningún plan por no incluir una operación nombrada. El agente escribe los pasos, los prompts y los parámetros, y el plan pasa por el mismo normalizador que cualquier otro.
4. **Alcance.** Fuera del lienzo de nodos.
5. **Enmiendas a 0007.**
   - **(1 y 9)** En Direct corre siempre el modelo del compositor, aunque se haya confirmado otro antes en la sesión, y las guías enviadas son las de los modelos que pueden correr.
   - **(2)** Una ambigüedad de intención se pregunta en Auto y Guided aunque el agente haya puesto un valor, una sola vez por petición.
   - **(4)** Un lugar solo se rechaza como sujeto de hoja cuando no se nombra persona ni objeto.
   - **(5)** En Direct, «múltiples ángulos» amplía el paso a tres en el normalizador, sin devolver el plan.
   - **(7)** Un upscale que no alcanza el objetivo con ×4 lo dice, y uno encadenado toma el tamaño de su paso de origen.

## Alternativas

- **Suelo determinista que devuelve el plan** (primera versión, `bc8c505`). Se rechaza: el usuario pidió dirigir, no enrutar, y cada plan devuelto es una llamada extra.
- **Dirigir solo 5 disparadores fuertes.** Se rechaza: hay un disparador por operación y todos dirigen.
- **Nota sin `tool_choice`.** Se rechaza: el usuario pidió `tool_choice` cuando aplican las palabras clave.
- **`tool_choice` en todas las llamadas de la petición.** Se rechaza: impediría responder a una pregunta, leer una guía o terminar después del plan.

## Consecuencias

- **Primera llamada sin alternativas.** Con palabras clave, la primera llamada no puede ser `read_guide` ni `ask_questions`. Si el plan necesita una pregunta o la tarjeta de ajustes, el normalizador lo dice y la siguiente llamada ya es libre.
- **Falsos positivos acotados.** Con la puerta, «iluminación» en una imagen nueva con referencia ya no dispara `relight` (veto), y «cambia la iluminación» sin un preset no fuerza. Queda el comodín `edit` sobre una imagen adjunta cuando ninguna operación específica encaja.
- **El planificador local (sin clave) usa la misma puerta** para las operaciones de imagen.
- **Soporte de proveedor sin verificar.** No se ha comprobado con proveedores reales que NanoGPT y OpenRouter acepten un `tool_choice` con nombre; el reintento con `auto` cubre el rechazo explícito.

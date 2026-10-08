# Plan: disparo forzado y correcciones de encaje del agente

Fecha: 2026-10-07. Rama: `task/agent-forcing`, creada desde `task/modelo-general` @ `ba46a7c`. Estado: **implementado** (F1 `c1d74be`, F2 `1306849`, F3–F5 `eefe611`, F6 `bc8c505`, corregido después); sin prueba en el sandbox ni con proveedores. Registro: `docs/history/020-2026-10-W41.md`.
Una fase por commit, cada una con su test. `npm test` y `npm run typecheck` en verde al cerrar cada fase. No se fusiona.

## Origen de cada punto

| Origen | Qué se dijo | Dónde |
| --- | --- | --- |
| **Tú** | «Su gatillo es determinista; lo nuestro informa al agente también, mejor dicho lo debería forzar.» | Mensaje sobre Gentle-AI |
| **Tú** | Direct usa los modelos del compositor; un prompt se escribe para el modelo que va a correr, nunca genérico. | ADR 0007 (1 y 9), aceptado |
| **Tú** | Una ambigüedad se pregunta en Auto y Guided; Direct usa el valor por defecto, visible en el plan. «Instagram» a secas, «tres vistas» y «múltiples ángulos» son ambiguos. | ADR 0007 (2, 4, 5 y 6) |
| **Tú** | Sin latencia añadida, sin señales invisibles, fallos rastreables. | Prioridades del proyecto |
| **Tú** | «Aplica todo eso», en una rama a partir de `modelo-general`. | Este encargo |
| **Sesión anterior** | Solo 3 a 5 disparadores fuertes. Lo apliqué primero y lo retiré tras tu corrección. | Texto pegado |
| **Yo** | Fallos (a) a (e) encontrados al revisar `modelo-general`, con prueba o lectura de código. | Revisión |
| **Tú** | Forzar es dirigir al agente hacia una tool call, no un enrutado determinista; `tool_choice` solo cuando aplican las palabras clave. | Corrección de F6 |

## Restricciones

- **ADR 0008.** `plan.ts`, `runtime.ts` y `context.ts` superan los 30 KB y no pueden crecer. Lo nuevo va en módulos propios (`agent/fit.ts`, `agent/requestGuides.ts` y `agent/force.ts`), y se extrae código de esos archivos para que ninguno crezca. `context.ts` no se tocó.
- **Sin llamadas nuevas al LLM** en el caso normal. El prompt del sistema no cambia: la orientación del disparo viaja en el mensaje de la petición, detrás del prefijo que cachea el proveedor.
- Sin proveedores ni gasto. La validación lee `.sandbox/data` (copia del sandbox) en solo lectura, y los resultados detallados quedan fuera del repositorio.

## Fases

### F1. Direct ejecuta el modelo del compositor y recibe su guía — fallo (a)

- **Qué.** En Direct se ignoran los ajustes confirmados antes en la sesión (Auto o Guided), y el modelo del compositor cuenta como elegido por el usuario. La guía que recibe el agente es la de los modelos que pueden correr: el modelo de imagen del compositor y su variante con imagen de entrada, el modelo de vídeo y los modelos por ruta de vídeo que hayas fijado. Se envía una vez por guía. El bloqueo de `read_guide` acepta esas mismas guías.
- **Por qué.** Probado: tras confirmar Seedream en Auto y pasar a Direct, el plan ejecutaba Seedream con la guía de Nano Banana.
- **Prueba.** Ese mismo caso termina ejecutando Nano Banana. Un modelo nombrado por el agente no gana al del compositor, salvo que lo nombres tú.

### F2. Encaje sin rechazos falsos — fallo (b)

- **Qué.** Si la petición nombra una persona o un objeto, ese es el sujeto de la hoja, aunque también nombre un lugar. Solo se rechaza cuando nombra un lugar y nada más. «Una imagen por vista» exige decir «por vista» o «imágenes/vistas separadas», no basta con «separadas».
- **Por qué.** Probado: «la chica que está en la playa», «el chef de la cocina» y «poses separadas» se rechazaban.
- **Prueba.** Esas tres frases encajan, y «hoja de referencia de la ciudad» se sigue rechazando.

### F3. Las ambigüedades se preguntan de verdad, una sola vez — fallo (c)

- **Qué.** En Auto y Guided, una petición ambigua se pregunta aunque el agente haya rellenado un valor válido. También cuando «tres vistas» llega como pasos de ángulo en vez de como hoja. Cuando ya hay respuesta en la petición, no se vuelve a preguntar: vale el valor del agente o, si falta, el de reserva, y se muestra en el plan.
- **Por qué.** Hoy Auto solo pregunta si el agente deja el valor vacío, así que «Instagram» con `4:5` pasaba sin preguntar.
- **Prueba.** «Instagram» con `4:5` del agente pregunta en Auto. Con la respuesta dada, no vuelve a preguntar.

### F4. «Múltiples ángulos» en Direct sin vuelta extra — fallo (d)

- **Qué.** En Direct, un plan con un solo paso de ángulo se amplía en el propio normalizador a tres pasos, cada uno con un ángulo distinto, con una línea en el plan. Dentro de un plan, los pasos de ángulo sobre la misma imagen no repiten ángulo. Auto y Guided siguen preguntando cuántos.
- **Por qué.** Hoy Direct rechazaba el plan y el agente lo volvía a proponer: una llamada extra al LLM que el usuario no ve.
- **Prueba.** Direct: una sola llamada al LLM y tres ángulos distintos.

### F5. Upscale que dice lo que hace — fallo (e)

- **Qué.** Si el objetivo no se alcanza con ×4 (8K desde 1024 px), el plan lo dice. Un upscale encadenado a otro paso toma el tamaño de origen de la resolución de ese paso.
- **Prueba.** «8K» desde 1024 px muestra la nota. «4K» sobre un paso de 1K da ×4 sin preguntar.

### F6. Disparo forzado: dirigir al agente hacia su tool call — tu petición

- **Corrección.** La primera versión (`bc8c505`) era un suelo determinista con 5 disparadores que devolvía el plan. Me corregiste: forzar es dirigir al agente hacia una tool call, no enrutar, y `tool_choice` solo cuando aplican las palabras clave.
- **Qué.** Los 19 disparadores (uno por operación) dirigen. El agente recibe dos líneas con la petición: qué operaciones se nombraron, con su frase, su propósito y la entrada adjunta. La primera llamada de esa petición lleva `tool_choice` con `propose_plan`; las demás van con `auto`. Si el proveedor rechaza el `tool_choice` con nombre, se repite con `auto`. No se rechaza ningún plan por no incluir la operación.
- **Prueba.** Con palabras clave, la primera llamada lleva `tool_choice` con `propose_plan` y la nota; sin ellas, `auto` y sin nota. Un plan sin la operación se acepta. Un rechazo del proveedor se repite con `auto`.

### F7. Validación y documentación

- **Validación.** Los cinco disparadores se pasan por las peticiones de las 18 sesiones del sandbox (solo lectura): aciertos, falsos positivos y precondiciones que faltan.
- **Documentación.** ADR 0009 (dirección con `tool_choice` y enmiendas a 0007), historial 020 y la ficha `features/agente.md`.

## Lo que no se cambia, y por qué

- **Las herramientas por modo.** Direct sigue sin ofrecer `ask_questions` ni `confirm_settings`. Cambiar de modo invalida la caché una vez, pero ofrecerlas y rechazarlas costaría una vuelta en cada intento.

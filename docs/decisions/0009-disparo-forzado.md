# 0009 — Puerta de disparo por operación, comportamiento de los modos y enmiendas a 0007

## Estado

Propuesto

## Fecha

2026-10-07

## Contexto

Los disparadores por palabra clave (`triggers.ts`, uno por operación) solo existían como dato. El usuario pidió que una petición mapeada empujara al agente por la ruta de su operación, y fijó tres escenarios:

1. Una pregunta que no encaja en el mapa sigue el flujo general, sin cambios.
2. Una petición concreta que no encaja en el mapa sigue el flujo general, sin cambios.
3. Una petición que encaja en el mapa: el sistema envía la señal al agente para que siga la ruta de la operación. Nada más.

El mapa existe para no disparar en cualquier petición.

Dos versiones intermedias se retiraron:
- un suelo determinista que devolvía el plan si faltaba la operación (`bc8c505`);
- `tool_choice` enviado al proveedor (`187ca48`, `ae4c86d`), un mecanismo ajeno al harness de la app.

El usuario fijó también cómo se comporta cada modo. La revisión de `task/modelo-general` encontró cinco fallos en 0007. El detalle está en `docs/history/020-2026-10-W41.md`.

## Decisión

1. **Puerta por operación, determinista.** Una operación se dispara cuando se cumplen tres condiciones:
   - **Está nombrada:** puntuación de palabras asociadas en español e inglés; una frase propia vale 1, cada palabra asociada 0,5 y un veto −1; dispara con 1 o más.
   - **Su entrada está adjunta.**
   - **Sus parámetros obligatorios se leen del texto:** el ángulo; el formato; el factor o los «K» según el tamaño de origen; el sujeto de la hoja; el preset de luz; el fotograma; la cuadrícula; dos clips para unir; una muestra de voz de 5 a 30 s.

   `edit` es el comodín: solo dispara si ninguna operación específica cubre la misma imagen.
2. **La señal, y nada más.** Las operaciones disparadas llegan al agente con la petición, en orden (n1, n2…) y con sus parámetros, con la instrucción de seguir esa ruta. No se envía nada al proveedor. Sin disparo, el agente no recibe nada y sigue el flujo general.
3. **Ambigüedades.** Las resuelve el modelo preguntando, una sola vez por petición. Después de una respuesta, o sin rondas libres, la app no le pide volver a preguntar.
4. **Modos.**
   - **Guided:** el modelo pregunta siempre antes del plan, y la app pide confirmar los ajustes en cada petición.
   - **Auto:** el modelo pregunta solo lo esencial y una vez. Los ajustes confirmados se heredan en la sesión. La tarjeta aparece para lo que no se ha aprobado y, como protección contra sobrecargos (0004, 0006), cuando un plan que reutiliza ajustes tiene coste desconocido o superior a 0,50 USD.
   - **Direct:** sin tarjetas de pregunta ni de ajustes. Valores por defecto de la app y modelos del compositor; un modelo que nombra el usuario se usa.
5. **Enmiendas.**
   - **0007 (1 y 9):** en Direct corre siempre el modelo del compositor, aunque antes se confirmara otro, y se envían las guías de los modelos que pueden correr.
   - **0007 (2):** una ambigüedad de intención se pregunta aunque el agente haya puesto un valor.
   - **0007 (4):** un lugar solo se rechaza como sujeto de hoja cuando no se nombra persona ni objeto.
   - **0007 (5):** en Direct, «múltiples ángulos» amplía el paso a tres sin devolver el plan.
   - **0007 (7):** un upscale que no alcanza el objetivo con ×4 lo dice, y uno encadenado toma el tamaño de su paso de origen.

## Alternativas

- **Suelo que devuelve el plan.** Se rechaza: es enrutado, no señal, y añade llamadas.
- **`tool_choice` al proveedor.** Se rechaza: es un mecanismo ajeno al harness de la app y depende del proveedor.
- **Disparar con la palabra sola.** Se rechaza: el mapa existe para evitar el disparo en cualquier petición.

## Consecuencias

- **Lo que pide la ruta lo cumple el agente.** La señal no se impone por código. Si el agente la ignora, el plan pasa por el normalizador como cualquier otro.
- **El planificador local (sin clave) usa la misma puerta** para las operaciones de imagen.
- **Guided pierde los ajustes heredados.** Cada petición empieza sin ajustes confirmados. Al volver a Auto, la tarjeta aparece una vez para lo no aprobado.

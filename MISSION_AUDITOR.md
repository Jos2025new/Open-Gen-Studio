# Misión — implementar T1–T6 (rama `better-worflows-xyz765`)

Tú implementas. Otro agente (Claude) **solo comprobará después** que cada problema quedó resuelto de verdad: leerá tu código, tus tests y tu registro, y los contrastará con los datos. Escribe pensando en esa revisión: cada afirmación tiene que poder comprobarse.

## Qué leer antes de tocar nada

1. `AGENTS.md`, sección **"Plan — turnos que no se quedan mudos, resultados honestos, latencia y depuración (2026-10-03)"** (la primera). Es tu especificación: qué, dónde, por qué, por qué así y riesgos de T1–T6. Síguela. Si al implementar algo no encaja con lo escrito, no lo cambies en silencio: anota en el paso qué cambiaste y por qué (como en W4 de ese archivo: "Cambiado al implementar").
2. `AGENTS.md`, **"Reglas de trabajo"** (al final del bloque inicial). Sobre todo: toda comprobación que la app imponga al agente en código se añade también a "How the app works" del prompt (`src/engine/agent/context.ts`). Y los **puntos frágiles bajo supervisión** (guardado del estado).
3. Contexto de lo que ya existe y no debes romper: en `AGENTS.md`, F23 y F24 (Check status, `pollJob`, `failedJobMessage`), F30 (`keepCommentedPlan`) y el plan "pruebas reales de los flujos frágiles" (B1–B4). Además, `e2e/REFERENCE_RUNS.md` (la versión automática y la comparación, que usarás en T6).

## Orden y forma de trabajo

- Orden: **T1 → T2 → T3 → T4 → T5 → T6**. No empieces uno sin terminar el anterior.
- Por cada paso:
  1. Escribe primero el test y **comprueba que falla sin tu arreglo** (anota cómo lo comprobaste). En T1, el test 2 reproduce la secuencia de `ses_mursnwichu` con el código actual. Si no falla, anótalo como "carrera descartada" y deja solo la defensa.
  2. Implementa lo mínimo, con el estilo del código que lo rodea.
  3. `npx tsc --noEmit -p .` y `npx vitest run` (toda la suite en verde; `composer-choice` falla a veces en la suite completa y pasa aislado: si te pasa, dilo).
  4. **Un commit por paso**, con un mensaje que diga qué cambia para el usuario. Termina el mensaje con tu línea de atribución.
  5. **Trazabilidad**, obligatoria, en el mismo commit:
     - en `AGENTS.md`, marca el paso `[x]` y añade debajo una línea **"Hecho:"** con los archivos y funciones tocados, los tests nuevos (archivo y nombre), cómo comprobaste que el test fallaba sin el arreglo, el hash del commit anterior (punto de retorno) y cualquier desviación de lo escrito y su porqué;
     - en `TRAZABILIDAD.md`, una fila por paso con el mismo contenido resumido.
- T6 se mide **antes y después** con la versión automática (`e2e/REFERENCE_RUNS.md`, sección "Versión automática y comparación") con DeepSeek V4.1 Flash y GPT 6 Luna. Guarda las dos ejecuciones en `e2e-runs/` y anota en el "Hecho:" de T6: tokens de entrada, llamadas y segundos por escenario, antes y después. Si empeora, revierte ese commit y anótalo.

## Límites (no negociables)

- **Nada de gasto en generaciones sin permiso del usuario.** Los tests usan respuestas simuladas. La versión automática solo gasta tokens del agente (céntimos) y es la única ejecución de pago permitida, solo en T6.
- **Nunca imprimas ni copies claves de API.** `data/state.json` las contiene: léelo solo con scripts que no las muestren y no lo edites.
- **No abras la app en el navegador mientras el usuario la use** (dos pestañas escriben el mismo estado). Si necesitas el navegador, pregúntale antes.
- No toques lo que no está en T1–T6. Si encuentras otro fallo, anótalo al final de la sección del plan como "Hallado, sin cambiar" con su evidencia.
- Sin arquitectura nueva: reutiliza lo que el plan nombra (`notice` con Retry, `retryAgentTurn`, `recordMetric`, `stripImages`, `repairHistory`, `runGeneration`, `data/` y el servidor local).

## Qué comprobará la revisión (para que lo tengas en cuenta)

- **T1:** un paso cuya generación quedó en error o sin resultados no aparece como hecho, y el cierre del agente no afirma ese resultado. Los pasos de texto siguen funcionando.
- **T2:** el caso de 16 000 tokens da un mensaje honesto con Retry, y una llamada fallida aparece en las métricas sin dejar medias NaN.
- **T3:** el aviso aparece a los 60 s sin salida, el tope de 5 min corta con Retry y ningún reloj sigue vivo después del turno.
- **T4:** en todos los lienzos no hay dos peticiones a la vez del mismo modelo developer de Atlas, y "Upstream access denied" se reintenta una sola vez, anotado en la tarjeta.
- **T5:** ninguna clave en `Generation.sent` ni en `data/logs/app.log` (con su test), ningún medio incrustado, rotación por tamaño, y los `catch` revisados.
- **T6:** las cifras de antes y después son reales y reproducibles con los comandos anotados.
- Cada paso, en todos: test que falla sin el arreglo, un commit, el "Hecho:" completo, y "How the app works" actualizado donde corresponda.

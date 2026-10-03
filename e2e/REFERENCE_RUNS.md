# Pruebas de referencia en la app real

Qué son: ejecuciones del mismo guion (`e2e/BROWSER_TESTS.md`) en la app real, en el navegador, con generaciones de pago baratas. **No son pruebas de estrés ni las mejores pruebas posibles**: es el camino normal de un usuario obediente que elige lo recomendado. Sirven como **referencia**: repetidas con el mismo guion, dicen si un cambio mejora o empeora el flujo real (fases, tarjetas, planes, tiempos, coste) y dejan datos comparables.

Por qué existen: de 30 correcciones (AGENTS.md F1–F30) casi todas se descubrieron en sesiones reales; los tests automáticos simulan un agente que siempre obedece y no las veían.

## Cómo se hace (cada ejecución)

1. Servidor de desarrollo en marcha (`npm run dev`, puerto 5173) y **ninguna otra pestaña de la app abierta** (desde `62988c6`+ una pestaña desfasada ya no puede pisar el estado: la rechaza y avisa; aun así, una sola pestaña).
2. El agente principal lanza un subagente (Sonnet) con `e2e/BROWSER_TESTS.md` y límites explícitos: umbral crítico $1.50 (no más Run), tope $3.00 (para todo), plan suelto > $0.60 = Cancel, 75 min en total, 25 min por escenario, 8 min sin cambio = saltar, nunca "Continue anyway".
3. El subagente hace de usuario con `agent-browser` (ventana visible), escribe `e2e-runs/<fecha>/log.md` (hora, paso, lo que ve, gasto) y capturas en `shots/`.
4. Al terminar, el informe automático sobre lo que guardó la app:
   `E2E_REPORT=1 E2E_SINCE=<hora de inicio ISO> E2E_OUT=e2e-runs/<fecha> npx vitest run tests/e2e/browser-report.test.ts`
   → `report.md` (línea de tiempo, comprobaciones, tiempos), `report.json` y `sessions.json` (las sesiones y sus generaciones, sin claves).
5. Se cruzan el log del subagente y el informe; los hallazgos y lo aprendido se anotan aquí y en AGENTS.md.

## Configuración fija (para que las ejecuciones se puedan comparar)

| | |
|---|---|
| Agente de la app | NanoGPT · `deepseek/deepseek-v4.1-flash` (sin `:thinking`), Normal, razonamiento Medium, modo Auto |
| Imagen | el Nano Banana más barato de la tarjeta, 1k |
| Vídeo | el más barato entre Seedance 2.0 Mini y MiniMax H3 Developer, 480p, 5 s |
| Escenarios | S1 UGC por etapas (corneta inventada → elegir → vídeo → "en un sofá" + pregunta sobre el plan + recarga con tarjeta abierta) · S2 hoja de personaje de imagen adjunta, 2 opciones · S3 animar imagen adjunta · S4 una imagen suelta |
| Imagen de prueba | `bench/fixtures/character.png` |

## Ejecuciones

### R1 · 2026-10-03 00:13–00:47 · commit `99c70d2` · `e2e-runs/2026-10-03-0013/`

**Resultado:** S1, S3, S4 completos y como se esperaba; S2 cortado por Atlas ("Upstream access denied", y el reintento también). Coste: $0.18 en medios (estimado $0.21) + $0.03 del agente de la app; el subagente contó $0.24 por los botones Run.

**Confirmado en uso real** (antes solo en tests): fases en orden; producto inventado con su propia imagen; candidatas que cierran el plan; tarjeta de ajustes en cada petición nueva y tras recargar; un comentario deja el plan esperando; la misma chica tras elegirla; la tarjeta de vídeo con la variante imagen→vídeo; lo confirmado es lo que se ejecutó; estimado = cobrado.

**Tiempos:**

| | |
|---|---|
| Agente por petición | 31–181 s |
| Hasta la primera tarjeta de preguntas | 90–110 s |
| Hoja de personaje (S2) | 181 s, 5 llamadas, con una vuelta perdida |
| Imagen Nano Banana 2 Lite developer | ~40–60 s |
| Vídeo Seedance 2.0 Mini 480p 5 s | ~3,5 min |

Los tiempos por llamada (primer byte, razonamiento, salida) se perdieron con las sesiones (ver abajo); desde R2 el informe los guarda.

**Fallos hallados → arreglos:**
1. Retry de un paso que vuelve a fallar dejaba el plan en "Running" para siempre → arreglado (`62988c6`).
2. El agente mandaba `purpose` para imagen y la tarjeta se rechazaba (una vuelta perdida, en 2 de 2 sesiones con DeepSeek) → se ignora.
3. El cierre copiaba "[made with …]" literal → resumen sin corchetes.
4. El cierre inventó "pediste 9:16" → el resumen da la forma real; solo "delivered differs" autoriza decir que difiere.
5. **Pérdida de datos:** una pestaña con estado antiguo guardó a las 05:44 y borró las 4 sesiones de la prueba → el servidor rechaza escrituras basadas en una versión vieja; la pestaña deja de guardar y avisa (`tests/state-conflict.test.ts`).

**Sin arreglar:** Atlas "Upstream access denied" con las variantes developer (hipótesis: límite de simultaneidad; falta una prueba de pago); títulos de tarjeta = cola del prompt; primera respuesta del agente lenta (sin datos por llamada para saber si es el proveedor o el razonamiento).

**Aprendido:**
- Los arreglos del harness funcionan con un modelo barato en uso real. Lo que falla ahora son los caminos de error y la redacción del cierre.
- La app real encuentra lo que los tests no ven (estado entre pestañas, reintento colgado).
- El informe tiene que guardar una copia de los datos de la ejecución, no depender del estado de la app.
- El guion debe pedir tiempos por paso; el subagente los anotó solo a medias.
- Probar como usuario obediente no es estrés. Una tanda de estrés queda pendiente: cambios de idea, recargar durante una generación, dos pestañas, peticiones ambiguas, cambiar el modelo en la tarjeta, comentarios encadenados y errores forzados.

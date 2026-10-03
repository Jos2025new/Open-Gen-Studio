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

**Línea base de referencia: R1 (2026-10-03, Sonnet en el navegador, commit `99c70d2`).** Es la medida del comportamiento real **antes** del bloque de poda T1–T6 (`8590306`…`8716fc7`). Por qué sirve de base: guion fijo, configuración fija (abajo), 4 escenarios de los flujos que más han fallado, generaciones reales, y datos guardados (log, capturas, informe). Cifras clave: agente 31–181 s por petición (13–30 s por llamada), imagen ~40–60 s, vídeo 480p 5 s ~3,5 min, $0.18 en medios, 3 de 4 escenarios completos. Cualquier ejecución posterior se compara con R1 con `tests/e2e/compare.test.ts`; si empeora en flujo, fallos o tiempos, se revisan primero los commits de T1–T6.

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

## Versión automática y comparación

Qué es: el mismo guion sin navegador ni generaciones (`tests/e2e/twin.test.ts`). Usa el motor real de la app y el agente real (DeepSeek V4.1 Flash en NanoGPT, con la clave de `data/state.json`, que nunca se imprime). Las tarjetas se responden con las mismas reglas del guion. Las generaciones terminan al momento con resultados de relleno. Cuesta céntimos de tokens y tarda unos 4 min.

```
TWIN=1 E2E_OUT=e2e-runs/<fecha>-twin npx vitest run tests/e2e/twin.test.ts
E2E_REPORT=1 E2E_STATE=e2e-runs/<fecha>-twin/state.json E2E_OUT=e2e-runs/<fecha>-twin npx vitest run tests/e2e/browser-report.test.ts
E2E_COMPARE=e2e-runs/<navegador>,e2e-runs/<fecha>-twin npx vitest run tests/e2e/compare.test.ts
```

`compare.md` muestra, por escenario y por petición, el flujo (preguntas → ajustes → plan → respuesta), los pasos (tipo, modelo, cantidad, variaciones, referencias), las comprobaciones que fallaron en cada ejecución y los segundos y llamadas del agente.

Cómo leerla: lo que sale igual en las dos lo cubre la versión automática, que es barata y se puede repetir en cada cambio. Lo que solo falla en el navegador es lo que la simulación no ve (proveedores, recargas, pestañas, la interfaz) y pide una ejecución real.

### Primera comparación: R1 (navegador) frente a la versión automática del 2026-10-03

| Escenario | Flujo | Fallos navegador / automática | Agente, s navegador / automática |
|---|---|---|---|
| S1 corneta | igual | 0 / 0 | 229 / 132 |
| S2 hoja | igual | 2 / 0 | 181 / 34 |
| S3 animar | igual | 0 / 0 | 31 / 27 |
| S4 perfume | distinto: la automática preguntó 4 cosas antes; el navegador fue directo a ajustes | 0 / 0 | 38 / 55 |

Lo que dice:
- **El flujo del harness se reproduce sin navegador.** Las fases, las candidatas, la tarjeta en cada petición y el comentario que deja el plan esperando salen iguales. Para esto basta la versión automática.
- **Solo los vio el navegador:** el error de Atlas, el reintento colgado y la pérdida de datos por la otra pestaña. Esto exige la prueba real.
- **El valor inválido de `purpose` no se repitió en la automática.** El agente no responde siempre igual a la misma entrada. Una sola ejecución no basta para decir que un fallo del agente ha desaparecido: hay que repetirla varias veces.
- **Tiempos:** el mismo modelo tardó 132 s frente a 229 s en S1, y 34 s frente a 181 s en S2. Parte es la vuelta perdida y parte la variación del proveedor. Hay que medir varias veces antes de culpar al código.
- **Diferencia del montaje:** la versión automática usa el catálogo grabado (`tests/fixtures/live`), en el que el Nano Banana más barato era `nano-banana-2` de NanoGPT, no el Lite developer de Atlas que había en vivo. Hay que refrescarlo con `npm run snapshot:models` (gratis) antes de comparar modelos y precios.

### Medición de T6 (2026-10-03, `e2e-runs/2026-10-03-t6-*`)

Seis ejecuciones del gemelo: **antes**, **después** (recorte siempre activo) y **con umbral**, con DeepSeek V4.1 Flash y GPT 6 Luna. Todas con S1–S4, generations de relleno y la misma clave.

| | llamadas | s | tokens de entrada | en caché | $ agente | comprobaciones falladas |
|---|---|---|---|---|---|---|
| DeepSeek antes (1) | 16 | 166 | 380 617 | 234 240 | 0,0297 | 0 |
| DeepSeek antes (2) | 18 | 325 | 505 814 | 443 008 | 0,0276 | 1 |
| DeepSeek después | 22 | 227 | 491 695 | 197 632 | 0,0399 | 2 |
| DeepSeek después (2) | 19 | 222 | 434 250 | 229 376 | 0,0350 | 0 |
| DeepSeek con umbral | 17 | 236 | 342 587 | 242 432 | 0,0217 | 1 |
| Luna antes | 19 | 172 | 406 551 | 285 931 | 0,0184 | 1 |
| Luna después | 19 | 144 | 382 264 | 216 175 | 0,0230 | 1 |
| Luna con umbral | 21 | 180 | 450 271 | 348 822 | 0,0157 | 1 |

Qué dice:
- **El recorte siempre activo empeoraba el coste**: el prompt por llamada bajaba ~13 %, pero la caché del proveedor caía de 234 k a 198 k tokens (DeepSeek) porque el prefijo cambia una vez por petición, y lo que se ahorra ahí es menos de lo que se deja de ahorrar en caché. De ahí el umbral de 40 000 caracteres (`attachments.ts`).
- **La variación entre ejecuciones del mismo guion es enorme**: 342 k–506 k de tokens de entrada con el mismo código (el agente pregunta de más o de menos; en una ejecución-deepseek S4 preguntó dos cosas que no debía y el plan fue rechazado dos veces). Dos ejecuciones por brazo no bastan para resolver diferencias por debajo del ~20 %.
- **Las comprobaciones falladas no dependen del recorte**: son las de siempre (plan con un asset inventado, guía de vídeo antes de los ajustes, candidatos en el mismo plan).
- El informe (`report.md`) y `compare.md` ahora llevan tokens de entrada y tokens en caché por petición, que es lo que hay que mirar para esto.

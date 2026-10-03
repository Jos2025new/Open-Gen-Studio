# Pruebas reales en la app — guion para el subagente (Sonnet)

Pruebas de los flujos que más han fallado (AGENTS.md, F1–F30), hechas **en la app real, en el navegador**, como un usuario. Generan imágenes y vídeos de verdad (cuestan dinero). Sigue el guion al pie de la letra: el objetivo es **observar y anotar**, no arreglar nada ni "ayudar" al agente de la app.

## Reglas

- **Navegador:** `agent-browser` con ventana visible (`agent-browser --headed open http://localhost:5173`). Tras cada cambio de página o tarjeta, `agent-browser snapshot -i` para obtener referencias (@e1…) y actuar con ellas. Al terminar, `agent-browser close`.
- **No edites código ni archivos de la app.** Solo usas la app como un usuario. Lo único que escribes son el registro y las capturas de esta ejecución.
- **Carpeta de la ejecución:** `e2e-runs/<AAAA-MM-DD-HHMM>/` (la creas al empezar). Dentro: `log.md` (registro paso a paso) y `shots/` (capturas: `agent-browser screenshot e2e-runs/<…>/shots/<escenario>-<nn>-<que>.png`).
- **Gasto (dos umbrales, sin excepciones):** lleva la cuenta tú (suma el $X de cada **Run · $X** que pulses y cualquier Retry). **Umbral crítico $1.50:** si el total ya lo pasa, no pulses más Run: termina el escenario en curso sin generar y pasa a "Al terminar". **Tope absoluto $3.00:** antes de pulsar Run, si gastado + $X > $3.00, pulsa **Cancel** y detén la prueba entera. Un solo plan de más de **$0.60** → Cancel (algo va mal: anótalo). **Nunca** pulses "Continue anyway" ni "Run anyway".
- **Tiempo:** la prueba entera no dura más de **75 min**; un escenario, no más de **25 min**. Si un paso no avanza en **8 min** (sin cambio en pantalla), anótalo con captura y pasa al siguiente escenario. Si `agent-browser` falla 3 veces seguidas en el mismo comando, deja de intentarlo y pasa a "Al terminar".
- **Esperas:** una imagen tarda de segundos a 1–2 min; un vídeo, de 1 a 5 min. Espera a que el plan diga *Done* (o un error) **y** a que aparezca el mensaje de cierre del agente. Si una generación sigue en curso a los 6 min y su tarjeta muestra **Check status**, púlsalo una vez y espera 3 min más.
- **Errores de proveedor:** anota el texto exacto. Si es "Upstream access denied" de Atlas, pulsa **Retry** una vez (anota el resultado). Otros errores: no reintentes, anota y sigue con el siguiente escenario.
- **Si algo bloquea el guion** (la tarjeta esperada no aparece, el agente pregunta algo no previsto, la app no responde a los 3 min): anota exactamente qué ves (captura), responde lo más neutro posible (la opción recomendada) o, si no se puede seguir, pasa al siguiente escenario.

## Qué anotar en `log.md` en cada paso

Hora · escenario · paso · lo que hiciste · **lo que ves**: tarjetas (preguntas con sus opciones y la recomendada; tarjeta de ajustes con modelo recomendado, alternativas y precios "from"; plan con título, pasos, modelos, precio y avisos de ajuste), mensajes del agente (texto literal), errores, tiempos ("Worked for Ns", cuánto tardó cada generación) y **cualquier cosa rara** (algo que no coincide con lo que pediste, textos solapados o vacíos, botones que no responden). Captura en: cada tarjeta de preguntas, cada tarjeta de ajustes (antes y después de elegir), cada plan, cada resultado y cada error.

## Preparación (antes del primer escenario)

1. Crea la carpeta de la ejecución y anota en `log.md` la **hora de inicio en ISO** (`date -Iseconds`): el informe automático la usa.
2. Abre la app. **Settings** (arriba a la derecha) → **Agent**: proveedor **NanoGPT**, modelo **DeepSeek V4.1 Flash** (`deepseek/deepseek-v4.1-flash`, **sin** `:thinking`). Si es otro, cámbialo a ese (es el único ajuste que tocas). Anota lo que había.
3. En la caja del prompt: modo **Agent** y **Auto** seleccionados.
4. Anota el saldo/gastado que muestre la barra lateral (Spending o el monedero) al empezar.

## Cómo responder la tarjeta de ajustes (vale para todos los escenarios)

- **Imagen:** abre **Show N other models** y elige el modelo **más barato cuyo nombre contenga "Nano Banana"** (cualquiera: Nano Banana, 2, Lite, developer…), comparando los "from $X". Si el recomendado ya es el Nano Banana más barato, déjalo. **Resolution:** la más baja (1K/1k). **Aspect ratio:** el que venga seleccionado. **Images to generate:** lo que diga el escenario (nunca más de 2).
- **Vídeo:** el más barato entre los que contengan **"Seedance 2.0 Mini"** o **"H3-Developer" / "H3 Developer"**. **Resolution:** 480p (o 480P). **Duration:** **5 s** (escribe 5 en la caja de segundos y pulsa Enter, o usa el deslizador). **Aspect ratio:** el que venga.
- Si no aparece ningún modelo de esas familias, deja el recomendado y anótalo como incidencia.
- Captura antes y después de elegir; pulsa **Continue**.

## Escenarios

Cada escenario en una **sesión nueva** (botón **+** de la barra lateral, lienzo **Chat**).

### S1 — UGC por etapas: creadora y producto inventados → elegir → vídeo → seguimiento
Frágil antes: etapas en mal orden (F12), producto nunca creado (F19/F20), candidatas usadas antes de elegir (F25), ajustes viejos en una petición nueva (F28), plan cancelado tras una pregunta (F30), tarjeta que tiraba la app al recargar (F13).

1. Escribe: `Crea una chica para vender una corneta bluetooth` y envía.
2. **Tarjeta de preguntas:** sobre la corneta → la opción de **inventarla** (genérica / "invéntala"); sobre cómo empezar o las etapas → la que dice **ver primero opciones de la chica (ficha) y luego una prueba corta**; el resto → la recomendada. Continue.
3. **Tarjeta de ajustes (imagen):** **antes de tocarla, recarga la página** (`agent-browser reload`). Anota si la tarjeta sigue ahí y muestra Resolution, Aspect ratio y Model. Después elige según las reglas, **Images to generate = 2**. Continue.
4. **Plan:** anota los pasos (se espera: la ficha de la chica con 2 opciones y una imagen de la corneta sola). Run.
5. Cuando termine: escribe `La 1 de la chica y la 1 de la corneta. Haz la prueba corta del vídeo.`
6. **Tarjeta de ajustes (vídeo):** según las reglas (480p, 5 s). Continue. **Plan:** anota sus referencias (se esperan la chica y la corneta). Run.
7. Cuando el vídeo termine: pasa el ratón por la miniatura de entradas de su tarjeta (arriba a la izquierda, la del número) y anota si aparece la columna con las imágenes usadas y cuáles son. Captura.
8. Escribe: `Ahora haz a la chica en un sofá`.
9. **Anota si aparece una tarjeta de ajustes** (debe aparecer). Elige según las reglas, **Images to generate = 1**. Continue.
10. **Plan:** antes de pulsar Run, escribe en el prompt `¿Por qué usas ese modelo?` y envía. Anota la respuesta del agente y **si la tarjeta del plan sigue esperando** (botón Run visible) o se canceló. Después pulsa Run (en la tarjeta que esté esperando). Anota si la chica del resultado es **la misma** que la elegida en el paso 5 (captura de ambas).

### S2 — Hoja de personaje desde una imagen adjunta, con 2 opciones
Frágil antes: vistas generadas a partir de candidatas no elegidas (F25).

1. Sesión nueva. Adjunta `bench/fixtures/character.png` (botón **+** de la caja del prompt; `agent-browser upload ".composer-end input[type=file]" bench/fixtures/character.png`). Comprueba que se ve la miniatura adjunta.
2. Escribe: `Haz una hoja de personaje de ella con 2 opciones para elegir` y envía.
3. Preguntas (si salen): la recomendada. **Ajustes:** según las reglas, **Images to generate = 2**.
4. **Plan:** anota los pasos. Se espera que el plan **termine en las 2 opciones** (sin vistas sacadas de ellas en el mismo plan). Run. Anota si las 2 opciones son distintas entre sí (captura).

### S3 — Animar una imagen adjunta
Frágil antes: la tarjeta mostraba la variante "texto a vídeo" cuando se iba a usar la de imagen (F30).

1. Sesión nueva. Adjunta `bench/fixtures/character.png`.
2. Escribe: `Anima a este personaje caminando hacia la cámara` y envía.
3. **Ajustes (vídeo):** anota el nombre del modelo recomendado (¿dice image-to-video / reference?). Elige según las reglas (480p, 5 s).
4. **Plan:** anota el modelo de cada paso. Run. Anota el resultado y si el personaje es el de la imagen.

### S4 — Una sola imagen, con su tarjeta de ajustes
Frágil antes: una imagen suelta no mostraba la tarjeta de ajustes ni dejaba elegir cuántas (F23).

1. Sesión nueva. Escribe: `Un retrato de producto de un perfume sobre mármol con luz suave` y envía.
2. **Anota si aparece la tarjeta de ajustes** (debe aparecer). Según las reglas, **Images to generate = 1**.
3. **Plan:** anota los pasos (se espera uno solo). Run.

## Al terminar

1. Anota la hora de fin, el gasto que muestra la app y tu suma.
2. `agent-browser close`.
3. Resumen al final de `log.md`: por escenario, qué salió como se esperaba y qué no (con la captura que lo muestra), y la lista de rarezas vistas.
4. El informe automático (lo ejecuta el agente principal, no tú): `E2E_REPORT=1 E2E_SINCE=<hora de inicio> E2E_OUT=e2e-runs/<…> npx vitest run tests/e2e/browser-report.test.ts`.

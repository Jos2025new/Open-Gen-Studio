# Plan: ruta estándar del agente, prompting por modelo y medición

Fecha: 2026-09-26. Estado: fases R0–R7, R9 y R10 implementadas (ver `TRAZABILIDAD.md`); falta medir con el banco (R0d y R8).
Lista de seguimiento: sección R0–R8 de `AGENTS.md`. Una fase por commit, con tests; la suite completa debe seguir pasando.

## Objetivo y restricción

El agente es un **operador**: sigue reglas por defecto salvo que el usuario pida algo concreto, sabe cómo hacer cada cosa antes de hacerla, y lo consulta **solo cuando hace falta**. Pregunta lo que de verdad falta (las preguntas que hagan falta, juntas), cotiza una vez y ejecuta; los cambios posteriores son revisiones del plan, no nuevas rondas de preguntas y cotizaciones.

**Restricción del usuario: no añadir latencia ni carga al modelo.** Criterio para cada fase:
- Ninguna llamada extra al LLM en el caso normal. La única excepción aceptada es R4 (cargar una guía), y solo cuando el agente la pide.
- Texto fijo en el prompt del sistema: pocas líneas. Nada que crezca con la conversación ni con el catálogo.
- Si una fase empeora las métricas de R0 en peticiones claras (llamadas, tokens, segundos hasta el plan), se corrige o se revierte antes de seguir.

## Evidencia (código actual y fuentes)

- **Sin ruta por defecto.** Sin skill ni workflow, el agente solo tiene reglas generales (`agent/context.ts`, `SYSTEM_PROMPT`). En la prueba real propuso Kling ×3 sin preguntar y, al pedir Seedance 2.0 Fast, eligió Seedance 2.5 (5,40 USD). Lo del modelo ya lo resolvió `find_models` (A1); la estructura del plan sigue siendo improvisada.
- **Skills y workflows solo manuales.** `composer.skillId`/`workflowId` se eligen en el composer (`AgentControls.tsx`); si no se elige nada, el agente no sabe que existen (`context.ts:133`). Los workflows no referencian skills (`skills.ts`).
- **Prompting genérico.** La regla actual pide para todo "sujeto, acción, escenario, composición, luz, estilo, lente…", que en imagen→vídeo empuja a volver a describir la imagen. Para las referencias solo dice "describe en el prompt para qué sirve cada una" (`context.ts:53`).
- **Guías existentes fuera de la app.** `~/.claude/skills/ai-director/references/models/{wan3,seedance2,seedance2-5,minimax-h3}/prompting.md` y `model-playbook.md`. Protocolo de referencias según esas guías y la documentación del proveedor:
  - Seedance 2.0 / 2.5: `@Image1`, `@Video1`, `@Audio1`; una función concreta por referencia, más lo que no debe aportar (guía seedance2-5, líneas 69–86; ejemplo oficial en `API DOC/bytedance seedance 2 5.md`, `Odysseus@image2`).
  - Wan 3: `@Image1 defines … Do not use the image background.`; primer y último fotograma suelen excluir las referencias libres (guía wan3, líneas 88–123).
  - MiniMax H3: **no** usa `@Image1`, sino `<Picture 1>` con alineación temporal ("aligns with the 0.00-second mark"); con buenas referencias, el prompt describe acción, cámara y sonido, no la apariencia (guía minimax-h3, líneas 29–31 y 104; fuente oficial: MiniMax-H3 `VIDEO_PROMPT_WRITING_GUIDE_ref_en.md`).
- **Tercer testimonio (agente de la plataforma del usuario, 2026-09-26).** Antes de responder consultó su catálogo (`media_models`, solo lectura). Su conocimiento por modelo es **estructural**, no artístico: notas de sintaxis de referencias en la definición de la herramienta, más un catálogo con `best_for` / `avoid_for` por modelo que explica sus elecciones, y valores por defecto **por propósito** (borrador, pieza final o toma larga, texto o edición). Reconoce no tener una ruta por defecto fija ("dos trabajos parecidos pueden salir con modelos distintos"). Afirma que Google Omni Flash 1.1 cita `<IMAGE_REF_0>` / `<VIDEO_REF_0>`, contando desde cero (**sin verificar**). Sus modelos por defecto (MiniMax H3 Max, Z-Image Turbo) son decisiones de su producto, no de esta app.
- **Cuarto testimonio: Higgsfield SuperComputer (2026-09-26).** Describe su flujo entero y consultó en vivo la ficha de Seedance 2.5 y Wan 3. Distingue **esquema** (el catálogo: modos, roles de referencia, límites) de **estilo** (la guía: cómo escribirle a ese modelo); sin guía, prompting genérico. Detecta el workflow **antes** de la ruta genérica, lo ofrece en la misma pregunta en lenguaje llano, y que falte un dato no descarta el workflow: sus propias preguntas lo piden. Lee el límite del prompt de la ficha. Tiene una sola puerta de gasto. Reconoce, como los otros tres, que elegir el modelo es su punto débil. Carga la skill de la modalidad **en cada petición** (puerta obligatoria): **no se adopta**, porque supone una lectura o llamada extra cada vez; aquí lo esencial va en línea (R2, R3) y la guía completa, bajo demanda (R4). Su default (Seedance 2.5) es decisión de su producto.
- **Comprobado en esta app (2026-09-26):**
  - **Longitud del prompt:** de 166 esquemas de Atlas con prompt, 19 declaran `maxLength` y 10 solo lo dicen en la descripción ("up to N characters"). La app solo comprueba Tripo (`MODEL3D_RULES`).
  - **Coste de editar o extender:** las operaciones directas ya se estiman bien (editar o hacer upscale por la duración del clip de origen, extender por los segundos nuevos; `jobs.ts:700`). En los planes del agente, en cambio, un paso de operación de vídeo se estima con la duración del composer (`executor.ts:48`), así que la tarjeta puede no coincidir con el coste real. Seedance 2.5, al editar, exige `duration -1` y la salida sigue la duración del clip de entrada (4–30 s) (`API DOC/bytedance seedance 2 5.md`, líneas 107 y 111).
- **Higgsfield, guion + 3 imágenes:** no describe las referencias, las cita por posición; necesita saber el papel de cada una (lo deduce viéndolas o pregunta); el guion decide planos y duración. Al contrastarlo se halló que **nuestro agente no veía las imágenes adjuntas** (solo su tamaño en texto); corregido como fallo (`AGENTS.md`, V1–V3).
- **Higgsfield, workflow UGC y modelos de imagen:** su workflow es un flujo de producción, no una plantilla: valores fijos que no pregunta (modelo, 9:16, 1080p, audio), entradas necesarias en una sola pregunta, variantes de formato (review, unboxing, try-on…) de las que carga solo una, continuidad (el fotograma aprobado anterior es referencia del siguiente; una sola identidad de producto y creador), un adaptador por modelo compartido, planificador de duración antes de gastar, inspección visual entre pasos y postproducción (unir clips, subtítulos). En imagen tiene dos niveles: por defecto según la tarea, y el resto solo si el usuario lo nombra (aquí: lista corta de preferidos y `find_models`). Sus modelos "Soul" son propios de Higgsfield y no existen aquí.
- **Higgsfield, serie a partir de una imagen:** fija la identidad (la imagen es la referencia de todos los planos y episodios), genera primero referencias de personaje, locaciones y objetos (el usuario elige variantes), comprueba si la historia cabe en la duración y ofrece ampliar, centrarse en un momento o comprimir, propone 2–3 tratamientos solo si el brief es abstracto, aprueba estilo y plan en una tarjeta, no muestra nombres internos, une los clips en un `final.mp4` y ofrece revisión con reparación. Fija la salida en 1080p: **el usuario lo rechaza** por coste.
- **Comprobado en esta app:** la biblioteca de sujetos (`Session.subjects`) solo mantiene la identidad con Kling. Con otros modelos, `@Nombre` pasa a ser el nombre en texto y sus imágenes no se envían (`mentionSubjects`, `params.ts:989`).
- **Higgsfield, "todo con Wan 3":** respeta la elección explícita del usuario aunque su workflow fije otro modelo, pero explica antes de gastar qué cambia (continuidad, límite del prompt, parámetros). Aclara que un modelo solo cubre los pasos de su tipo (Wan no genera imágenes: las referencias siguen con un modelo de imagen). Regla de montaje: cambiar al menos un eje entre clips contiguos (tamaño de plano, sujeto o ángulo) para evitar saltos. Dice que Wan 3.0 corta el prompt en 5.000 caracteres; la documentación de Atlas del mismo modelo dice 20.000 (`API DOC/alibaba wan 3 0 reference.md`, línea 28): **los límites dependen del proveedor** y se leen de cada esquema (R3). Su temor de que una referencia mal ordenada ponga a la persona equivocada no aplica igual aquí: en R10 la numeración la calcula la app, no el modelo de lenguaje.
- **Otros agentes (ImagineArt, Buzzy AI), preguntados por el usuario.** Ambos dicen usar un índice ligero con carga bajo demanda, una ruta normal por defecto, una tarjeta única de configuración con opciones premarcadas y referencias con papeles por modelo. Es una **autodescripción, no una prueba**: Buzzy afirma usar `<<<image_1>>>` con Seedance, lo que contradice la documentación (`<<<element_N>>>` es Kling en Atlas). Las notas por modelo salen de la documentación del proveedor, no de otros agentes.
- `guidedRounds` vale 2 por defecto (`store.ts`); `ask_questions` admite de 1 a 4 preguntas por ronda.
- Variantes relevantes en el catálogo pulido (`tests/fixtures/live/expected.txt`): Wan 3 (`atlas::alibaba/wan-3.0/{image,reference,text}-to-video`, `nanogpt::alibaba/wan-3.0/…`, `fal::alibaba/wan-3.0/…`), Seedance 2.0 / Fast / 2.5, MiniMax H3 (`atlas::minimax/h3/…`, `nanogpt::minimax-h3`). NanoGPT incluye además variantes `-spicy` que hoy `find_models` devolvería (ver decisiones pendientes).

## Fases

### R0. Medir el antes (sin cambiar el comportamiento)
**Dónde:** `engine/agent/runtime.ts` (contadores y marcas de tiempo por turno), `engine/types.ts` (`Session.agentMetrics`), `tests/bench/agent-bench.test.ts` (nuevo, se salta si no hay clave), `bench/` (resultados en JSON).
**Qué:** por cada petición se registra: llamadas al LLM, tokens de entrada y salida, ms hasta el primer texto y hasta la tarjeta del plan, rondas de preguntas, revisiones, cancelaciones, modelos, skill, workflow y guía usados, y coste estimado frente al aprobado. Solo contadores de lo que ya pasa por el código.
**Banco de pruebas:** 8–10 peticiones fijas: animar un personaje (vaga, con imagen), "dos clips con Seedance 2.0 Fast", cambiar de modelo, quedarse solo con el primero, retrato de producto, póster en el Designer, canción, 3D desde imagen. Se ejecutan contra el LLM real **solo hasta el plan** (nunca se generan medios); cuestan céntimos de tokens y **requieren permiso del usuario** en cada ejecución.
**Aceptación:** la tabla del "antes" queda guardada en `bench/` con el commit de referencia; los tests existentes no cambian.

### R1. Ruta estándar como reglas por defecto
**Dónde:** `agent/context.ts` (unas líneas en `SYSTEM_PROMPT`), `providers/registry.ts` (preferencias de vídeo por proveedor).
**Qué:** cuando no hay skill ni workflow que encaje y la petición es vaga: Direct (usar la imagen dada), un clip, calidad media y modelo Wan 3, con Seedance 2.0/2.5 y MiniMax H3 como sugerencias. Lo que pida el usuario manda siempre sobre estos valores; si la petición ya es clara, no se pregunta nada.
**Tabla por propósito (aprobada por el usuario, 2026-09-26, como sugerencias recomendadas):** unas 4–5 líneas fijas en las mismas reglas; cero llamadas. Son recomendaciones, no obligaciones: lo que pida el usuario manda, y el agente puede proponer otra con motivo. Propuesta inicial, a confirmar en R1 con duraciones y precios de los esquemas reales:
  - Borrador o prueba → variante rápida o barata (Seedance 2.0 Fast, MiniMax H3 Fast).
  - Clip corto o pieza final → Wan 3 (preferido).
  - Toma larga o muchas referencias → Seedance 2.5.
  - Edición o extensión de un clip → operaciones Edit/Extend video con su modelo preferido (hoy Wan 3.0 video-edit / video-extend en NanoGPT).
  Si una petición no encaja en ninguna fila, se usa Wan 3.
**Tabla de imagen por tarea (aprobada por el usuario, 2026-09-26, como sugerencias recomendadas):** mismo mecanismo que la de vídeo, con las familias de la app. Propuesta inicial, a confirmar en R1 con los IDs reales de cada proveedor conectado:
  - General, texto dentro de la imagen, diseño, edición → GPT Image 2 / 2.5.
  - Foto héroe, fotorrealismo → Nano Banana Pro.
  - Cartoon o ilustración → Nano Banana 2.
  - Hoja de personaje, identidad, retoque de caras → Seedream 5.
  - Vectorial (logo, icono, sticker) → Recraft.
  - Póster con tipografía → Ideogram (o GPT Image).
  Lo que no es generación (quitar fondo, ampliar el encuadre, upscale) sigue yendo por las operaciones dedicadas (Remove BG, Reframe, Upscale).
**Modelo pedido por el usuario:** manda sobre la tabla y sobre el `fixed` de un workflow. Si le falta algo que el flujo necesita (tipo de salida, referencias, duración, límite del prompt), el agente lo dice **una vez**, en lenguaje llano, en la tarjeta o en el resumen del plan, antes de cotizar; nunca lo sustituye en silencio. Un modelo solo se aplica a los pasos de su tipo: "todo con Wan 3" cubre los clips, y las imágenes de referencia siguen con la tabla de imagen, lo que el plan indica.
**Multi-stage (decidido, 2026-09-26):** lo decide el agente según la petición. Multi-stage cuando hay historia, serie o personajes que reaparecen, o si el usuario lo pide: primero un plan de referencias (imágenes, baratas), el usuario elige y se guardan como sujetos (R10), y luego el plan de clips. Direct en el resto. Cada etapa tiene como máximo una tarjeta de preguntas y una cotización.
**Resolución y coste (decidido, 2026-09-26):** la calidad por defecto es media (resolución intermedia del modelo, p. ej. 720p) y ningún workflow ni regla fija la resolución alta (1080p o más), porque puede disparar el coste. La resolución alta solo se usa si el usuario la pide o la elige en la tarjeta, que siempre muestra el precio. En pasos caros, el agente puede proponer primero un borrador en resolución baja.
**Número de clips y duración:** salen de la petición o del guion, nunca del número de referencias (tres imágenes no son tres clips). Un guion con personajes que reaparecen lleva al camino narrativo (workflow Storyboard, sujetos de Kling) en vez de clips sueltos.
**Por qué:** hoy la estructura y el modelo se improvisan en cada petición.
**Aceptación (banco):** en "animar este personaje" el plan usa Wan 3 con la imagen como referencia o primer fotograma, o pregunta una sola vez con esas opciones marcadas. Llamadas y tokens en peticiones claras: iguales que en R0.

### R2. Reglas universales de prompting
**Dónde:** `SYSTEM_PROMPT` (reemplaza la regla de "Writing prompts"; mismo tamaño aproximado).
**Comunicación:** al usuario nunca se le muestran nombres internos (herramientas, workflows, IDs) ni jerga; los resúmenes van en lenguaje llano.
**Qué:** en imagen→vídeo el prompt describe movimiento, física, cámara y qué debe conservarse, no la imagen otra vez. En general, **ninguna referencia se parafrasea**: se cita con su papel (y lo que no debe aportar) y la apariencia la pone la referencia, que el agente ya ve (fallo V corregido en `a4c1eae`). Si el papel de una referencia no se deduce de la imagen ni del mensaje, se pregunta en la tarjeta única. Nada de modificadores vacíos ("8k masterpiece") sino descripciones físicas (lente, profundidad de campo, luz); en inglés.
**Por qué:** volver a describir la imagen compite con ella.
**Aceptación (banco):** los prompts de imagen→vídeo no repiten la apariencia de la referencia; mismo recuento de tokens de salida o menor.

### R3. Protocolo de referencias por familia, en línea
**Dónde:** `modelRules.ts` (`REFERENCE_PROTOCOLS`, cada uno con su fuente), `agent/context.ts` (línea del modelo seleccionado), `agent/modelIndex.ts` (resultados de `find_models`).
**Qué:** 1–3 líneas por familia, visibles solo junto al modelo en uso: Seedance y Wan `@Image1…` con función y exclusiones; MiniMax H3 `<Picture 1>` con alineación temporal. **Comprobar primero** que el orden de las referencias que envía la app coincide con la numeración (`reference_images` y `refers` en Atlas; imágenes, luego vídeos, luego audio).
**Para qué es mejor / qué evitar (`best_for` / `avoid_for`):** una línea por modelo preferido, con fuente (documentación del proveedor y límites del esquema; por ejemplo "Seedance 2.5: tomas de hasta 30 s y muchas referencias; evitar para borradores baratos"). Se muestra en la lista corta del contexto y en los resultados de `find_models`, para que el agente pueda justificar y elegir alternativas. Solo para modelos con dato verificable; el resto sin línea.
**Límite de longitud del prompt:** el parser guarda el máximo del esquema (`maxLength`, o "up to N characters" en la descripción) y el validador rechaza antes de enviar, con código `PROMPT_TOO_LONG` (el mismo que ya usa Tripo). Se mide la cobertura en Atlas, fal y NanoGPT con la red de regresión; sin dato, no se inventa límite.
**Gemini Omni Flash 1.1:** nota de protocolo (`<IMAGE_REF_0>`, desde cero) **solo tras verificarla** en la documentación de Google o del proveedor; hasta entonces, sin nota.
**Por qué:** cada modelo nombra las referencias a su manera; hoy el agente escribe referencias genéricas.
**Aceptación:** test de que cada familia recibe su nota y su `best_for` / `avoid_for`, y ninguna otra; banco: prompts con la etiqueta correcta y modelo coherente con el propósito. Ninguna llamada extra.

### R4. Índice de skills, workflows y guías + `read_guide`
**Dónde:** `SYSTEM_PROMPT` (índice: una línea por elemento), `agent/tools.ts` y `runtime.ts` (herramienta `read_guide`), `engine/guides/` (guías condensadas de Wan 3, Seedance 2.0, Seedance 2.5 y MiniMax H3, de 300–500 palabras, con fuente).
**Qué:** el agente ve nombre y "cuándo usarla"; carga el contenido solo cuando la tarea lo pide. Una skill o workflow elegido a mano sigue funcionando como hoy.
**Workflows como flujos de producción (aprobado por el usuario, 2026-09-26):** además de sus pasos, cada workflow puede declarar:
  - `fixed`: valores que el workflow decide (modelo, proporción, audio). El agente no los pregunta. **La resolución no puede ir en `fixed`**: sigue la calidad elegida (media por defecto), por coste.
  - `needs`: entradas necesarias (foto del producto, personaje, duración). Si faltan, se preguntan en la tarjeta única.
  - `variants`: formatos del mismo workflow (p. ej. review, unboxing, try-on). En el índice solo aparece una línea; se carga solo la variante elegida.
  - `continuity`: regla de encadenado (el resultado aprobado de un paso es referencia del siguiente; una sola identidad de sujeto o producto en todo el flujo). Los planes ya encadenan referencias entre pasos; aquí se vuelve regla del workflow.
  - Reparto de la duración total entre clips antes de cotizar: función de la app (`plan.ts`), sin llamadas.
  Las notas de protocolo por modelo (R3) son compartidas por todos los workflows, no se repiten en cada uno.
**Workflow narrativo, montaje:** entre clips contiguos cambia al menos un eje (tamaño de plano, sujeto o ángulo) para evitar saltos; la identidad se mantiene con los sujetos (R10).
**Workflow narrativo (serie, corto, guion):** si la historia no cabe en la duración pedida, el agente lo dice con números y ofrece ampliar, centrarse en un momento o comprimir, como opciones de la tarjeta de preguntas. Si el brief es abstracto, ofrece 2–3 tratamientos como opciones de una sola pregunta; si es concreto, lo respeta sin preguntar. El número de clips lo decide el agente a partir de la historia.
**Workflow antes que ruta genérica:** si la petición encaja en un workflow, ese gana sobre R1. Se ofrece dentro de la misma tarjeta de preguntas, en lenguaje llano y sin nombres internos. Cada workflow declara las entradas que necesita (`Workflow.needs`: p. ej. foto del producto, personaje, duración); si falta una, la pregunta entra en esa misma tarjeta, sin ronda extra, y la falta no descarta el workflow.
**Por qué:** el agente no sabía que existen, y meterlas todas en el contexto añadiría texto a cada mensaje.
**Latencia:** +1 llamada, solo cuando se carga una guía. El banco medirá con qué frecuencia ocurre en peticiones normales; si es alta, se revisa el índice.

### R5. Skill recomendada por workflow
**Dónde:** `skills.ts` (`Workflow.skill?`), `agent/context.ts`.
**Qué:** "Character sheet" → "Character consistency", "Product ad pack" → "Product photography", etc. Se aplica si el usuario no eligió otra skill. Solo datos.

### R6. Preguntas con opción por defecto marcada
**Dónde:** `agent/tools.ts` (`ask_questions`: campo `default` por pregunta), `components/chat/QuestionsCard.tsx` (opción premarcada y botón "Continue").
**Qué:** las preguntas necesarias, juntas y con la opción preferida marcada; no repetir lo que el usuario ya resolvió. `guidedRounds` no cambia.
**Aceptación:** un clic basta para seguir con los valores por defecto; banco: rondas de preguntas iguales o menores.

### R7. Proporción heredada de la imagen de entrada
**Dónde:** `plan.ts` (normalización de pasos de vídeo y 3D).
**Qué:** si el paso no fija la proporción y tiene imagen de inicio o referencia, se usa la más cercana a la de la imagen entre las que admite el modelo; se anota como ajuste.
**Por qué:** hoy depende de que el agente lo decida. Es código de la app y no toca al modelo.

### R9. Coste de los pasos de operación de vídeo en los planes
**Dónde:** `executor.ts` (`estimateSteps`), reutilizando la lógica de `jobs.ts` (`opSpec`).
**Qué:** un paso del agente que edita, hace upscale o extiende un vídeo se estima igual que la operación directa: editar o hacer upscale por la duración del clip de origen, extender por los segundos nuevos. Si el origen es la salida de otro paso (duración aún desconocida), se estima con la duración de ese paso y se marca como aproximado.
**Por qué:** hoy la tarjeta del plan puede no coincidir con el coste real de ejecutar la misma operación a mano.
**Aceptación:** test de que el precio del paso en el plan es igual al de la operación directa sobre el mismo clip. Sin cambios para el modelo; cero llamadas.

### R10. Sujetos con cualquier modelo (identidad fija)
**Dónde:** `params.ts` (`mentionSubjects`), `jobs.ts` (entradas del paso), `modelRules.ts` (protocolo de R3), `agent/context.ts`, acción "Save as subject" en el menú de un resultado (`components/assets/AssetActions.tsx`) y paso del agente para crear un sujeto desde una imagen.
**Qué:** `@Nombre` en el prompt añade las imágenes del sujeto a las referencias del paso (sin pasar el límite del modelo) y reescribe la mención con la sintaxis del modelo: `@ImageN` en Seedance y Wan, `<Picture N>` en MiniMax H3, elemento en Kling como hoy. Las numeraciones cuentan las referencias que ya lleve el paso. Una serie reutiliza los mismos sujetos en cada episodio.
**Por qué:** hoy solo Kling mantiene la identidad; con Wan 3 (el preferido) el personaje cambia entre clips y episodios. La numeración de las menciones la calcula la app a partir de las referencias reales del paso, no el modelo de lenguaje, para que una referencia mal ordenada no ponga a otra persona en el plano.
**Aceptación:** test con Seedance, Wan, MiniMax y Kling: mismas imágenes enviadas, mención reescrita con la numeración correcta y límite de referencias respetado. Cero llamadas.

### R8. Medir el después y comparar
Mismo banco de pruebas en el commit final. Tabla por petición y en total: llamadas, tokens, segundos hasta el plan, preguntas, revisiones, modelo elegido frente al esperado, etiqueta de referencia correcta y coste. Se registra en `TRAZABILIDAD.md`.
**Éxito:** en peticiones claras, llamadas y tiempo no suben; en peticiones vagas o con modelo pedido, bajan las revisiones y aciertan el modelo y el protocolo.

## Cambios respecto al plan al implementarlo (2026-09-26)
- **R1, nombres de familia:** el agente puede escribir "Wan 3" en `model` y la app elige la variante (`familyRef`, índice local). *Por qué:* sin esto la ruta estándar exigía una vuelta de `find_models` en cada petición, contra la restricción de latencia.
- **R1, calidad media en código:** en vídeo la resolución por defecto es la intermedia del modelo, o la suya si es menor (`mediumResolution`); el prompt no decide la resolución. *Por qué:* algunos modelos traen 1080p o 2K por defecto; así nunca sube el coste.
- **R3, fuente más específica primero:** 24 endpoints declaran en su esquema cómo citar referencias; esa sintaxis gana a la de la familia (p. ej. fal MiniMax H3 dice "Image 1"). *Por qué:* el esquema del endpoint es la fuente más concreta.
- **R4, sin guías por modelo:** sus fuentes están en la máquina del usuario; el mecanismo (`read_guide`) está listo. Sin variantes aún en los workflows.
- **R4, `total_duration`:** el reparto de la duración lo hace la app si el agente da el total. *Por qué:* cero llamadas.
- **R10, sin paso del agente para crear sujetos:** se crean con "Save as subject".
- **Coste en contexto:** el prompt fijo pasó de 9.620 a 14.768 caracteres y las herramientas de 5.760 a 6.764. Si el banco muestra peor tiempo o tokens en peticiones claras, se recortan primero R1–R3.
- **Aceptación de R5 y R7 (no estaba escrita):** R5, un workflow elegido sin skill aplica la suya en el contexto del agente; R7, un paso de vídeo desde una imagen vertical sale vertical con la nota "aspect … from the input image".

## Decisiones pendientes del usuario (antes de la fase que las usa)

**Provisional (2026-09-26, Claude, a petición de avanzar):** 1 → calidad = solo resolución; 3 → `-spicy` excluidas salvo que se nombren. Ambas se cambian en una línea (`mediumResolution` en `params.ts`, filtro en `searchIndex`).

1. **Calidad alta / media / baja (R1):** decidido en parte: media por defecto y nunca alta fija por coste. Falta: ¿la calidad es solo resolución, o también variante del modelo (p. ej. Seedance 2.5 frente a 2.0 Fast)?
2. ~~Multi-stage~~ **Decidido (2026-09-26):** lo decide el agente con la regla de R1.
3. **Variantes `-spicy` de NanoGPT:** ¿se excluyen del índice de `find_models` y de la ruta estándar?
4. **Banco de pruebas (R0/R8):** permiso para ejecutarlo con la clave del LLM (solo planes, sin generación).
5. ~~Tabla por propósito (R1)~~ **Decidido (2026-09-26):** se adopta como sugerencias recomendadas (borrador, clip corto o final, toma larga, edición).

## Fuera de alcance

- **Inspección visual entre pasos y revisión final** (como en el workflow UGC de Higgsfield): una llamada con visión por paso. Si se añade, será **opcional y apagada por defecto**, por decisión del usuario, porque choca con la restricción de latencia; en flujos caros podría ahorrar dinero al no animar un fotograma defectuoso.
- **Unir clips y subtítulos (postproducción):** la app no une vídeos hoy. Sería una operación local nueva, sin proveedor; es un trabajo aparte y más grande. Con series pasa a ser el **siguiente trabajo candidato** tras este plan.

- **Revisar el resultado** (detectar que un vídeo perdió el estilo o la paleta, como hace el agente citado): requiere que un modelo con visión revise cada resultado, es decir, una llamada extra por generación. Choca con la restricción de latencia; sería una fase aparte y opcional.

Guías para Kling, Veo, FLUX 3 y otras familias (siguen las reglas actuales hasta tener fuentes verificadas); cargar las guías por defecto en el contexto; cambios en el validador de coste o de entradas.

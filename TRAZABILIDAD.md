# Trazabilidad de cambios

Para cada cambio: qué hace, dónde está, qué lo verifica y qué queda sin verificar. Sirve para saber si un cambio nuevo rompió algo que antes funcionaba. El plan paso a paso está en `AGENTS.md`, el historial en `PROGRESS.md` y el detalle de proveedores en `MODEL_VALIDATION.md`.

## Cómo comprobar que nada se rompió

| Comprobación | Comando | Qué detecta |
| --- | --- | --- |
| Tipos | `npx tsc --noEmit -p .` | Contratos rotos entre módulos. |
| Tests unitarios | `npm test` | Lógica de precios, parámetros, rutas de entradas, polling, payloads (tests con nombre en la tabla). |
| **Red de regresión de proveedores** | `npm test` (incluye `tests/live-snapshot.test.ts`) | Cómo se lista e interpreta **cada** variante de las familias prioritarias (~560: Atlas 162, fal 257, NanoGPT 138). Compara con `tests/fixtures/live/expected.txt`. Si un cambio altera un modelo, el test falla y muestra la diferencia. |
| Aceptar un cambio intencionado | `npx vitest run -u tests/live-snapshot.test.ts` y revisar `git diff tests/fixtures/live/expected.txt` | El diff se revisa y se sube en el mismo commit que el cambio de código. Así cada commit dice exactamente qué modelos cambiaron. |
| Catálogos nuevos del proveedor | `npm run snapshot:models`, luego lo anterior | Descarga de nuevo los catálogos y esquemas públicos (sin clave ni coste). El diff muestra qué cambió **en el proveedor**. Conviene hacerlo en un commit aparte del de código, para no mezclar causas. |
| Navegador | `npm run dev` (puerto 5173) | Interfaz y payloads reales con `fetch` interceptado (sin gastar). Pasos concretos en cada fila. |

Familias cubiertas por la red: `scripts/model-families.json`. Para ampliar la cobertura se añade el patrón y se regenera.

## Registro

La tabla por cambio está dividida en fragmentos de menos de 30 KB. Las filas conservan el texto y el orden originales:

- [Registro 1: T1–T6, commits de proveedores y música (4c-2)](docs/trazabilidad/registro-1.md).
- [Registro 2: 3D, Designer, ruta del agente, gasto y C1–C4](docs/trazabilidad/registro-2.md).

Una fila nueva va al principio de `registro-1.md`. Si ese fragmento pasa de 30 000 bytes, se abre otro y se enlaza aquí y en `docs/README.md`.

## Qué se espera ver al probar (cambios del 2026-09-26)
| Cambio | Qué deberías ver | Cómo comprobarlo |
| --- | --- | --- |
| R0 métricas | Nada visible; en `data/state.json`, `agentMetrics` en cada sesión con llamadas, tokens, tiempos y desenlace. | Pedir algo al agente y mirar el archivo. |
| R0/R8 banco | Un archivo `bench/<fecha>-<commit>.json` y una tabla por petición en la consola. | Comandos en `HANDOFF.md`. |
| R1 ruta estándar | "Anima este personaje" propone un clip con Wan 3, la imagen como primer fotograma y calidad media (p. ej. 720p), sin preguntar si la petición es clara. Nota "model "Wan 3" → …" en la tarjeta si el agente escribió la familia. | Chat con una imagen adjunta. |
| R1 calidad media | Al elegir un modelo de vídeo, la resolución por defecto es la intermedia (720p entre 480/720/1080), no la más alta. | Composer en modo vídeo. |
| R2 prompts | En imagen→vídeo el prompt habla de movimiento y cámara, no vuelve a describir la imagen. | Leer el prompt del paso en la tarjeta. |
| R3 citas y límite | Con Seedance/Wan el prompt cita `@Image1`; con MiniMax H3 `<Picture 1>` (o la sintaxis que dicte el esquema). Un prompt demasiado largo se rechaza antes de pagar con `[PROMPT_TOO_LONG]`. | Plan con referencias; prompt muy largo. |
| R4 workflows | Si la petición encaja (p. ej. "hoja de personaje"), el agente propone ese flujo y pregunta lo que falta en una sola tarjeta. | Chat en modo Guided. |
| R5 skill por workflow | Con un workflow elegido y sin skill, los prompts siguen el estilo de la skill recomendada. | Elegir "Character sheet" sin skill. |
| R6 preguntas | La tarjeta de preguntas llega con una opción ya marcada; Continue funciona con un clic. | Modo Guided con una petición vaga. |
| R7 proporción | Un vídeo pedido desde una imagen vertical sale 9:16, con la nota "aspect 9:16 from the input image". | Plan con imagen vertical. |
| R9 coste | El precio de editar/extender un vídeo en la tarjeta del plan es el mismo que en la operación directa sobre ese clip. | Comparar tarjeta y menú del vídeo. |
| R10 sujetos | "Save as subject" en el menú de una imagen; `@Nombre` funciona con Seedance, Wan o MiniMax (la imagen del sujeto viaja como referencia). Chip Subjects visible con esos modelos. | Guardar un sujeto y usarlo en un prompt. |
| G1 registro | Cada generación y cada mensaje al agente aparecen como cargos en Spending (≈ si es estimado). | Panel Spending → Latest charges. |
| G2 límite | Con límite y pasándolo: "Continue anyway" / "Run anyway" en la confirmación; tras aceptar ya no pregunta. Lo que corre no se detiene; un aviso al cruzar. Sin límite: nunca pregunta. | Ajustes → Budget, límite bajo. |
| G3 panel | Botón Spending en la barra lateral; panel con total, agente/medios, desgloses y periodo; expandible a pantalla completa; marca roja si se pasa del límite. | Abrir el panel. |
| G4 modelo del agente | Nunca se elige solo un modelo sin visión: Ajustes lo explica y ofrece "Use … anyway"; el chat avisa si el agente cae al planificador local. | Proveedor sin modelos con visión, o sin clave. |

## Qué se espera ver al probar (C1–C4, 2026-09-27)
| Cambio | Qué deberías ver | Cómo comprobarlo |
| --- | --- | --- |
| C1 | Una petición de vídeo normal sale con MiniMax H3 Developer (Atlas) y la tarjeta dice "normal video → MiniMax H3 Developer (atlas)"; "un borrador" sale con H3 Max Turbo; un clip de 20–30 s, con Wan 3. Si nombras un modelo, se usa ese. | Chat con el agente, sin tocar el selector de vídeo. |
| C2 | El selector de vídeo ya no muestra Kling V3 Pro si nunca lo elegiste; si eliges uno a mano, el agente lo usa. | Composer en modo vídeo; luego pedir un vídeo al agente. |
| C3 | En Atlas, el precio pasa de "≥ $x" a un importe exacto al cabo de un momento, y el cargo registrado en Spending coincide (sin "≈"). En NanoGPT, si el cobro difiere, la tarjeta dice "est … · charged …". | Composer o tarjeta del plan con un modelo de Atlas; panel Spending tras generar. |
| C4 | Nada visible; el agente carga la guía de MiniMax o Wan antes de escribir el prompt de vídeo (una vez por conversación). | Métrica `guides` en `data/state.json`. |

## Estado de la línea base (antes de cubrir lo que faltaba)

Tras la fase 7 quedan 5 modelos en `MISSING`: 3 LoRA de MiniMax H3 en fal (fase 8), FLUX 3 `draft-enhance` (necesita el `draft_cache_url` de un borrador previo) y `flux-3-action/so101` (robótica, fuera de las familias creativas).

En `tests/fixtures/live/expected.txt`, `MISSING:` marca los modelos que aún no pueden ejecutarse porque exigen algo que la app no envía (21 casos: máscaras, `keyframes`, `video_clips`, audio, LoRA, la imagen de origen de Ideogram Character junto a sus referencias…). `ERROR` marca los esquemas que el proveedor no sirve: fal `minimax/h3-max/director` devuelve 404. Cada tarea siguiente debe reducir esos casos, y el diff lo deja registrado.

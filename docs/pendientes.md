# Pendientes y propuestas

Lista viva, revisada contra el código de `task/agent-forcing`. Formato de cada línea: casilla, asunto, **fecha** del último cambio de estado, quién lo dijo y la evidencia. Al cerrar una, marca `[x]`, pon la fecha y la evidencia (commit, test o prueba), y muévela a «Hecho».

Evidencia: **código** = leído en el código · **test** = cubierto por `npm test` · **real** = ejecutado contra el servidor o el proveedor real · **usuario** = lo afirma el usuario.

## Decisiones del usuario

- [x] Calidad por defecto = resolución media (`mediumResolution`). **2026-10-08**, aprobado por el usuario.
- [x] Operaciones con modelo de imagen: confirman su modelo; Auto una vez por sesión, Guided en cada petición, Direct usa el compositor (`454d721`, ADR 0009). **2026-10-08**, el usuario: «rige lo más nuevo». Sustituye la regla anterior, en la que heredaban el modelo de su origen.
- [ ] Modelos `-spicy` excluidos salvo que se nombren: aplicado de forma provisional. Probablemente se bloqueen si la app deja de ser solo local. **2026-10-08**, pendiente del usuario.
- [ ] ADR 0005, 0006, 0008 y 0009: propuestos, implementados y en uso. Falta su aprobación formal. **2026-10-08**.
- [ ] Fusionar `task/agent-forcing` en `task/modelo-general`. Avance directo, sin conflictos: ver [fusion-agent-forcing.md](fusion-agent-forcing.md). **2026-10-08**, decide el usuario.
- [x] Registro de rendimiento para sesiones de prueba ([ADR 0012](decisions/0012-registro-de-rendimiento.md)): aprobado; en la app y en el sandbox, apagado por defecto. **2026-10-08**, el usuario delegó el alcance.
- [ ] Publicar la app (plataforma, acceso, claves en servidor). Hoy es solo local; ver [seguridad](seguridad.md). **2026-09-25**, sin decidir.
- [ ] Prueba con gasto real de voz y efectos (NanoGPT): voz, instrucciones de tono y sonido. **2026-10-08**, la hará el usuario. **Sin verificar:** el formato real de la respuesta de cada modelo (audio directo o JSON con URL; se aceptan ambos) y si el efecto admite fijar la duración (hoy la elige el modelo).

## Por probar

- [ ] Capas FX (ADR 0011, rama `task/fx`): plan completo en [fx-pruebas.md](fx-pruebas.md). **2026-10-08**, pendiente.
- [ ] Bucle de tarjetas con un vídeo caro (`3f551d1`), y P2, P3 y P4 (`95eab99`). **2026-10-08**, lo prueba el usuario en el sandbox.
- [ ] Precisión de `remove_bg`, `extract_frame` y `create_voice` con casos reales. **2026-10-08**, pendiente.
- [ ] Calidad de los cortes de `grid_split` con una generación real. **2026-10-08**, pendiente.
- [ ] **fal.ai: no probado** (generaciones y subida de vídeos grandes). El usuario no usa fal. En teoría funciona, pero nada se ha verificado con una generación real. **2026-10-08**.

## Funciones propuestas sin implementar

- [ ] **Caché de las capas FX** (coste medido; reparto pendiente de confirmar; [fx-pruebas.md](fx-pruebas.md), sección 5). Hoy cada fotograma recalcula todas las capas FX: con 50 desenfoques, 398 ms por fotograma, el 95 % atribuido a pasos FX se calculó con una fórmula defectuosa y está pendiente de confirmar con la atribución corregida. Propuesta, como GIMP e Inkscape (`Drawing::setCacheBudget`):
  - guardar el resultado de cada capa FX con una clave (versión de su contenido debajo, parámetros y escala) y un presupuesto de memoria;
  - reutilizar los lienzos temporales en vez de crear uno por paso;
  - después, renderizar por teselas solo la zona que cambia.
  
  Repetir el banco tras cada mejora. **2026-10-08**, pendiente; recordatorio pedido por el usuario.
- [ ] Importar el `.zip` de datos (el exportar ya existe). **2026-10-08**, pendiente.
- [ ] Recortar un vídeo o quitarle el audio. El servidor local ya usa ffmpeg para `join_clips`; sería la vía más ligera. **2026-10-08**, pendiente.
- [ ] Quitar el fondo de un vídeo (`pixelcut/video-background-removal`, NanoGPT; ID verificado). **2026-10-08**, pendiente.
- [ ] Subir vídeos grandes a fal con su API de subida. Ligado a «fal no probado». **2026-10-08**, pendiente.
- [ ] Designer: máscaras de capa, capas de ajuste, estilos de capa, PSD y gestión de color. **2026-10-08**, próximo trabajo del usuario.
- [ ] Limpiar copias `data.bak-*`: se crean solo al pulsar «Wipe all data» y solo ocupan disco, sin efecto en el funcionamiento ni en la interfaz. Las copias automáticas de `data/backups/` ya se limitan a 20. **2026-10-08**, solo si hace falta.

## Calidad del código

- [ ] Partir los 13 archivos de más de 30 KB (`runtime.ts`, 115 KB). Afecta al desarrollo; no pueden crecer (ADR 0008). **2026-10-07**.
- [ ] Cobertura por riesgo ([ADR 0010](decisions/0010-estrategia-de-pruebas.md)): pocas pruebas de recorrido completo en el sandbox, con el LLM y los proveedores simulados (petición → plan → aprobación → resultado; paso a Nodes y Designer). Hoy 129 de 199 módulos no tienen test directo. **2026-10-08**, decidido; sin implementar.

- [ ] 4 tests fallaron una vez con la carga en 42 (procesos ajenos): `agent-direct-model`, `agent-retry`, `chat-to-nodes` y `join-clips`. Pasaron por separado y en dos ejecuciones completas posteriores (cargas 33 y 29). No se capturó el error: la causa no está confirmada, aunque probablemente sea el margen de tiempo superado con más carga que la medida en el [ADR 0010](decisions/0010-estrategia-de-pruebas.md). **2026-10-08**. Si se repite, guardar la salida de `npx vitest run` con el error.
- [ ] 11 tests de 7 archivos fallaron una vez con la carga en 47–52 (`agent-contract-journey`, `agent-direct-model`, `composer-choice`, `join-clips`, `settings-phase`, `journeys/composer-variant`, `journeys/import-safety`); pasaron por separado (51 de 51) y en la ejecución completa siguiente. La auditoría externa vio fallar `import-safety` igual. Misma causa probable que el caso anterior; tampoco se capturó el error. **2026-10-08**.
- [ ] Contraste de `--text-4` (2,39:1) en textos de 10 px. Afecta a la legibilidad. **2026-10-07**.
- [ ] Medir la memoria del historial del Designer (40 entradas, unos 16 MB por copia de 2048×2048). **2026-09-24**.
- [ ] Unificar los datos repetidos de los proveedores (opcional). **2026-09-24**.

## Auditoría externa (GPT 6 Astra, 2026-10-08)

Revisó `3f551d1`; su dictamen es refactorizar por partes, sin reescribir. Cada punto se comprobó contra `9c877cc` (**código** = leído; **sin comprobar** = depende de uso real). Son propuestas: el orden lo decide el usuario. La auditoría ordena pensando en vídeo, y el próximo trabajo del usuario es el Designer.

- [ ] **Una sola revisión candidata** antes de evaluar o seguir: hoy hay tres líneas vivas (`modelo-general`, `agent-forcing` y `fx`). Primer paso: `task/fx` en `task/agent-forcing` (avance directo, preparado el 2026-10-08). **2026-10-08**, el usuario lo pidió.
- [ ] **Producción de varios planos revisable y retomable:** brief, planos ordenados, toma elegida, duración y revisión, reutilizando `Asset`, `Generation`, `Plan` y `nodeIsCurrent` (`flow/freshness.ts:53`, código), sin hacerlo obligatorio para una imagen suelta. **2026-10-08**, propuesta.
- [ ] **De Nodes a la entrega:** `join_clips` se rechaza en Nodes (`plan.ts:860`, código). Habilitarlo con el ejecutor existente; después, un montaje mínimo (orden, entrada y salida, duración, audio y exportación), no un editor completo. **2026-10-08**, propuesta.
- [ ] **Continuidad declarada, conexión válida y calidad visual son cosas distintas:** `continuity` comprueba conexiones, no identidad ni geometría (código; ya lo dice [continuity-contract.md](continuity-contract.md)). Primero revisión humana por contacto; comprobaciones automáticas solo cuando compensen. **2026-10-08**, propuesta.
- [ ] **El presupuesto no es un máximo:** `budget.ts:24-27` avisa, se puede aceptar seguir, y los precios desconocidos no cuentan (código). Para «hazlo solo hasta X» haría falta un modo con reservas, conciliación y una política para precios desconocidos. Nunca reintentar a ciegas un envío incierto. **2026-10-08**, propuesta.
- [ ] **Una regla, un propietario:** sacar del runtime (1921 líneas) la política de preguntas y aprobaciones, la resolución de la petición efectiva y el ciclo de ejecución. Las decisiones creativas, en guías; los requisitos duros, en validadores. Enlaza con «Partir los 13 archivos». **2026-10-08**, propuesta.
- [ ] **Ejecución fuera de la pestaña,** solo cuando haga falta para lotes o producciones largas: un ejecutor local con estado, intentos y cola acotada. Hoy una recarga recupera trabajos remotos, pero no reanuda los pasos que no habían empezado (sin comprobar en un caso real). **2026-10-08**, propuesta.
- [ ] **Medir por recorridos:** unos pocos pedidos reales con su resultado esperado (planes válidos al primer intento, preguntas redundantes, pasos rehechos, tiempo hasta un resultado útil). Coincide con el ADR 0010. El protocolo de [depuracion.md](depuracion.md) da la base de medida sin gasto; la evaluación de pago, aparte y con presupuesto aprobado. **2026-10-08**, propuesta.
- [ ] **Carga de la app:** paquete principal de 1,64 MB minificado (521 KB comprimido) y avisos de imports dinámicos que no separan módulos (dato de la auditoría, sin comprobar aquí). Medir el arranque con una sonda antes de optimizar. **2026-10-08**, propuesta.

## Hecho

- [x] Generar voz y efectos de sonido. **2026-10-08**, **test** ([nanogpt-speech](../tests/nanogpt-speech.test.ts), 10 casos, con proveedor simulado). Modelos elegidos por el usuario: GPT-4o mini TTS 2025-12-15, Gemini 3.8 Flash TTS (por defecto: entre los tres primeros de Artificial Analysis y 0,05 USD por 1000 caracteres), ElevenLabs v4 y v4 Turbo, MiniMax Speech 2.8 Turbo y HD; efectos con ElevenLabs Sound Effects v2. Ver [catálogo](catalogo-voz-y-efectos.md).
- [x] Tests fiables con carga ([ADR 0010](decisions/0010-estrategia-de-pruebas.md)): reloj falso en lugar de esperas reales, esperas por condición y 20 s de margen global para trabajo de CPU. **2026-10-08**, **real**: 4 de 4 ejecuciones completas sin fallos con carga entre 25 y 39 (antes, hasta 8 fallos).
- [x] Exportar los datos en un `.zip`. **2026-10-08**, **real**: ruta `/x/store/export` en un servidor Vite con datos de prueba. Devuelve 200 y un zip con `asset/` y `state.json`, con las claves vaciadas (0 apariciones). Sin test automático.
- [x] Precio exacto de Atlas antes de generar (`src/engine/quotes.ts`). **2026-10-08**, **real**: `POST /api/v1/model/calculate` con Wan 3.0 a 720p devuelve 0,40 USD para 5 s y 0,80 USD para 10 s. **test**: [quotes.test.ts](../tests/quotes.test.ts). **usuario**: funciona.
- [x] 3D y Designer (`PLAN_3D_DESIGNER.md`, P1–P9): cuatro modelos 3D, visor, exportación PDF/SVG, lineart editable y pinceles con textura. **2026-10-08**, **código** y **test** ([3d-contracts](../tests/3d-contracts.test.ts), [model3d](../tests/model3d.test.ts), [design-export](../tests/design-export.test.ts), [brush-control](../tests/brush-control.test.ts): 22 aprobados). **usuario**: el visor se probó y se amplió después.
- [x] Banco del agente, antes y después (R0d/R8). **usuario**: lo ejecutó en otras sesiones, con GPT y con Claude, con Grok y MiMo y con gasto real. En el repositorio: [comparación NanoGPT](nanogpt-price-comparison.md), [expansión 2](nanogpt-price-expansion-2.md) y `bench/2026-10-01-3273c0a.json`. No se volvió a ejecutar el 2026-10-08.

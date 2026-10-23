# Pendientes de datos, calidad, funciones y decisiones

Detalle de las filas C, F y G del [índice](pendientes.md). Prioridad, **origen** y evidencia como en [pendientes-agente](pendientes-agente.md).

## Datos y guardado (C)

- **C0 · crítico · 2026-10-21 · El indicador «Connected» sigue verde con el servidor local caído**, y el aviso «Disk copy pending» no dice la causa (048, anotado, sin arreglar). Es una alerta que afirma algo falso y esconde que el trabajo no se está guardando en disco (en el sandbox: «si se cae, la pestaña sigue abierta pero no guarda ni genera»).
- **C1 · alto · 2026-10-16 · Guardado protegido, fase 2 y 3** ([ADR 0022](decisions/0022-guardado-local-first-sin-bloqueo.md), [protegida](persistencia-protegida.md)). Fase 2: commit atómico del formato 2 (hoy `HEAD.json` es el punto de publicación y las sesiones se escriben aparte; el orden exacto de escritura **no se verificó**, [persistencia](features/persistencia.md)), inventario de las ~15 rutas de borrado, marcas de borrado e historial de versiones (retención propuesta: últimas 10 y todas las de 7 días, por confirmar; SQLite como alternativa). Fase 3: aviso de recuperación al abrir y retención de `backups/rejected-*`. Límites aceptados de la fase 1 en el ADR. Antes de tocar estas zonas: autorización explícita (AGENTS.md, regla 5).
- **C2 · medio · 2026-10-16 · Probar en el sandbox «Delete all»** (borrar, recargar, comprobar; código en `c2c40ee`) y el webm real de H5. [039](history/039-2026-10-W42.md).
- **C3 · bajo · 2026-10-18 · Rescate de la pestaña abierta** (`rescate-pestana.js`, fuera del repo) y restaurar lo rescatado en el sandbox con la fase 1. Probablemente obsoleto (la pestaña de entonces ya no existe); confirmar con el usuario antes de cerrarlo. [043](history/043-2026-10-W42.md).
- **C4 · medio · 2026-10-18 · Conflicto de guardado a las 17:49 en otro sandbox:** sin registro ni causa. [problemas conocidos](problemas-conocidos-2026-10-18.md).
- **C6 · bajo · 2026-10-08 · Limpiar copias `data.bak-*`** (solo se crean con «Wipe all data»; solo ocupan disco). Las copias automáticas de `data/backups/` ya se limitan a 20.

## Calidad del código y pruebas (C)

- **C7 · bajo · 2026-09-24 · Unificar los datos repetidos de los proveedores** (opcional).
- **C8 · medio · 2026-10-08 · Tests que fallan con carga:** 4 tests con carga 42 (`agent-direct-model`, `agent-retry`, `chat-to-nodes`, `join-clips`), 11 tests de 7 archivos con carga 47 a 52 (también `import-safety`, `composer-choice`, `settings-phase`…) y `writer-lock` 15c (2026-10-21, pasa sola). Siempre pasaron por separado; nunca se capturó el error. Si se repite, guardar la salida de `npx vitest run`. Causa probable: margen de tiempo con más carga que la medida en el [ADR 0010](decisions/0010-estrategia-de-pruebas.md).
- **C9 · medio · 2026-10-07 · Partir los 11 archivos de más de 30 KB** (eran 13; hoy 11 según `check-sizes`; `runtime.ts` 115 KB). No pueden crecer (ADR 0008). `docs/features/agente.md` está en 29 869 de 30 000 bytes. Nunca recortar reglas del agente para caber (`tests/agent-rules-kept.test.ts`).
- **C10 · medio · 2026-10-08 · Cobertura por riesgo** ([ADR 0010](decisions/0010-estrategia-de-pruebas.md)): pocas pruebas de recorrido completo en el sandbox con LLM y proveedores simulados. El conteo «129 de 199 módulos sin test directo» es del 2026-10-08, no se recalculó.
- **C11 · medio · 2026-10-07 · Contraste de `--text-4` en textos de 10 px.** Recalculado el 2026-10-22: 3,65:1 (Atlas), 2,95 (Grafito), 2,82 (Claro) y 3,34 (Blanco), todos bajo 4,5. `theme-tokens.test.ts` no incluye `--text-4`. Los valores cambiaron con el sistema de bases; el defecto sigue.
- **C12 · bajo · 2026-10-08 · Carga de la app:** paquete principal de 1,64 MB minificado (521 KB comprimido) e imports dinámicos que no separan módulos (dato de la auditoría externa, sin comprobar). Medir el arranque con una sonda antes de optimizar.
- **C13 · medio · 2026-10-08 · Medir por recorridos:** pocos pedidos reales con resultado esperado (planes válidos al primer intento, preguntas redundantes, pasos rehechos, tiempo hasta un resultado útil). Base sin gasto en [depuracion](depuracion.md); la evaluación de pago, aparte y con presupuesto aprobado.
- **C14 · medio · 2026-10-08 · Una regla, un propietario:** sacar del runtime la política de preguntas y aprobaciones, la petición efectiva y el ciclo de ejecución; decisiones creativas en guías, requisitos duros en validadores. Enlaza con C9.

## Funciones propuestas sin implementar (F)

- **F1 · medio · 2026-10-08 · Producción de varios planos revisable y retomable** (brief, planos, toma elegida, duración, revisión), reutilizando `Asset`, `Generation`, `Plan` y `nodeIsCurrent`; sin obligarla para una imagen suelta.
- **F2 · medio · 2026-10-08 · De Nodes a la entrega:** `join_clips` no se ejecuta en Nodes (`flow/fromChat.ts:26`). Habilitarlo con el ejecutor existente; luego un montaje mínimo, no un editor completo.
- **F3 · bajo · 2026-10-08 · Continuidad declarada, conexión válida y calidad visual son cosas distintas:** `continuity` comprueba conexiones, no identidad ni geometría. Revisión humana por contacto primero ([continuity-contract](continuity-contract.md)).
- **F4 · bajo · 2026-10-08 · Ejecución fuera de la pestaña** (solo para lotes o producciones largas): ejecutor local con estado, intentos y cola acotada. Hoy una recarga recupera trabajos remotos, no reanuda pasos que no habían empezado (sin comprobar en un caso real).
- **F5 · bajo · 2026-10-08 · Importar el `.zip` de datos** (exportar ya existe).
- **F6 · bajo · 2026-10-08 · Recortar un vídeo o quitarle el audio** (el servidor local ya usa ffmpeg para `join_clips`).
- **F7 · bajo · 2026-10-08 · Quitar el fondo de un vídeo** (`pixelcut/video-background-removal`, NanoGPT; ID verificado).

## Decisiones del usuario y ramas (G)

- **G1 · medio · 2026-10-08 · Aprobación formal de los ADR 0005, 0006, 0008 y 0009:** siguen «Propuesto», implementados y en uso. En el 0006 entra la reversión de «ajustes solo para la petición» y el umbral de 0,50 USD (019, punto 39). El 0015 (mosaicos) también sigue «Propuesto».
- **G2 · medio · 2026-09-25 · Fusiones:** (a) `task/workflow-ask-first` a `task/agent-stop`: avance directo, `agent-stop` no tiene commits propios que esta rama no tenga (medido el 2026-10-22), espera el «sí»; (b) `main` está 1132 commits por detrás de esta línea y la fusión a `main` la decide el usuario; (c) la app real (`task/agent-forcing`) no lleva nada de esta línea (B2).
- **G3 · medio · 2026-09-25 · Publicar la app** (plataforma, acceso, claves en servidor). Hoy es solo local; [seguridad](seguridad.md). Sin decidir.
- **G4 · bajo · 2026-10-09 · Estructura de QA con subagentes:** esperaba el visto bueno del usuario (022). Sin comprobar si sigue vigente; la práctica actual es delegar en Sonnet o Haiku y revisar el diff.
- **G5 · medio · 2026-10-20 · Sistema visual de tarjetas** ([propuesta](propuesta-sistema-visual-tarjetas.md), ADR 0024): pasos 3 (plantillas), 4 (migración tarjeta a tarjeta, con B-02) y 5 (`check-card-style`); revisión visual del usuario de los pasos 1 y 2 y de «Marco tranquilo», «Blanco» y los bordes de paneles, todo sin ver en pantalla. Cada cambio visual exige su aprobación (regla 6).
- **G6 · bajo · 2026-10-21 · Sistema resuelve el modo claro a Claro** (podría ser Blanco).
- **G7 · bajo · 2026-10-20 · Pestaña «Look» en inglés:** el usuario quizá quiera «Apariencia».

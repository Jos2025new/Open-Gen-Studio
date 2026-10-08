# Pendientes y propuestas

Lista viva, revisada contra el código de `task/agent-forcing`. Formato de cada línea: casilla, asunto, **fecha** del último cambio de estado, quién lo dijo y la evidencia. Al cerrar una, marca `[x]`, pon la fecha y la evidencia (commit, test o prueba), y muévela a «Hecho».

Evidencia: **código** = leído en el código · **test** = cubierto por `npm test` · **real** = ejecutado contra el servidor o el proveedor real · **usuario** = lo afirma el usuario.

## Decisiones del usuario

- [x] Calidad por defecto = resolución media (`mediumResolution`). **2026-10-08**, aprobado por el usuario.
- [x] Operaciones con modelo de imagen: confirman su modelo; Auto una vez por sesión, Guided en cada petición, Direct usa el compositor (`454d721`, ADR 0009). **2026-10-08**, el usuario: «rige lo más nuevo». Sustituye la regla anterior, en la que heredaban el modelo de su origen.
- [ ] Modelos `-spicy` excluidos salvo que se nombren: aplicado de forma provisional. Probablemente se bloqueen si la app deja de ser solo local. **2026-10-08**, pendiente del usuario.
- [ ] ADR 0005, 0006, 0008 y 0009: propuestos, implementados y en uso. Falta su aprobación formal. **2026-10-08**.
- [ ] Fusionar `task/agent-forcing` en `task/modelo-general`. Avance directo, sin conflictos: ver [fusion-agent-forcing.md](fusion-agent-forcing.md). **2026-10-08**, decide el usuario.
- [ ] Publicar la app (plataforma, acceso, claves en servidor). Hoy es solo local; ver [seguridad](seguridad.md). **2026-09-25**, sin decidir.
- [ ] Texto a voz y efectos de sonido: **implementar** (usuario, **2026-10-08**). Falta elegir los modelos concretos y aprobar el coste máximo de las pruebas.

## Por probar

- [ ] Bucle de tarjetas con un vídeo caro (`3f551d1`), y P2, P3 y P4 (`95eab99`). **2026-10-08**, lo prueba el usuario en el sandbox.
- [ ] Precisión de `remove_bg`, `extract_frame` y `create_voice` con casos reales. **2026-10-08**, pendiente.
- [ ] Calidad de los cortes de `grid_split` con una generación real. **2026-10-08**, pendiente.
- [ ] **fal.ai: no probado** (generaciones y subida de vídeos grandes). El usuario no usa fal. En teoría funciona, pero nada se ha verificado con una generación real. **2026-10-08**.

## Funciones propuestas sin implementar

- [ ] Importar el `.zip` de datos (el exportar ya existe). **2026-10-08**, pendiente.
- [ ] Recortar un vídeo o quitarle el audio. El servidor local ya usa ffmpeg para `join_clips`; sería la vía más ligera. **2026-10-08**, pendiente.
- [ ] Quitar el fondo de un vídeo (`pixelcut/video-background-removal`, NanoGPT; ID verificado). **2026-10-08**, pendiente.
- [ ] Subir vídeos grandes a fal con su API de subida. Ligado a «fal no probado». **2026-10-08**, pendiente.
- [ ] Designer: máscaras de capa, capas de ajuste, estilos de capa, PSD y gestión de color. **2026-10-08**, próximo trabajo del usuario.
- [ ] Limpiar copias `data.bak-*`: se crean solo al pulsar «Wipe all data» y solo ocupan disco, sin efecto en el funcionamiento ni en la interfaz. Las copias automáticas de `data/backups/` ya se limitan a 20. **2026-10-08**, solo si hace falta.

## Calidad del código

- [ ] Partir los 13 archivos de más de 30 KB (`runtime.ts`, 115 KB). Afecta al desarrollo; no pueden crecer (ADR 0008). **2026-10-07**.
- [ ] Cobertura por riesgo ([ADR 0010](decisions/0010-estrategia-de-pruebas.md)): pocas pruebas de recorrido completo en el sandbox, con el LLM y los proveedores simulados (petición → plan → aprobación → resultado; paso a Nodes y Designer). Hoy 129 de 199 módulos no tienen test directo. **2026-10-08**, decidido; sin implementar.

- [ ] Contraste de `--text-4` (2,39:1) en textos de 10 px. Afecta a la legibilidad. **2026-10-07**.
- [ ] Medir la memoria del historial del Designer (40 entradas, unos 16 MB por copia de 2048×2048). **2026-09-24**.
- [ ] Unificar los datos repetidos de los proveedores (opcional). **2026-09-24**.

## Hecho

- [x] Tests fiables con carga ([ADR 0010](decisions/0010-estrategia-de-pruebas.md)): reloj falso en lugar de esperas reales, esperas por condición y 20 s de margen global para trabajo de CPU. **2026-10-08**, **real**: 4 de 4 ejecuciones completas sin fallos con carga entre 25 y 39 (antes, hasta 8 fallos).
- [x] Exportar los datos en un `.zip`. **2026-10-08**, **real**: ruta `/x/store/export` en un servidor Vite con datos de prueba. Devuelve 200 y un zip con `asset/` y `state.json`, con las claves vaciadas (0 apariciones). Sin test automático.
- [x] Precio exacto de Atlas antes de generar (`src/engine/quotes.ts`). **2026-10-08**, **real**: `POST /api/v1/model/calculate` con Wan 3.0 a 720p devuelve 0,40 USD para 5 s y 0,80 USD para 10 s. **test**: [quotes.test.ts](../tests/quotes.test.ts). **usuario**: funciona.
- [x] 3D y Designer (`PLAN_3D_DESIGNER.md`, P1–P9): cuatro modelos 3D, visor, exportación PDF/SVG, lineart editable y pinceles con textura. **2026-10-08**, **código** y **test** ([3d-contracts](../tests/3d-contracts.test.ts), [model3d](../tests/model3d.test.ts), [design-export](../tests/design-export.test.ts), [brush-control](../tests/brush-control.test.ts): 22 aprobados). **usuario**: el visor se probó y se amplió después.
- [x] Banco del agente, antes y después (R0d/R8). **usuario**: lo ejecutó en otras sesiones, con GPT y con Claude, con Grok y MiMo y con gasto real. En el repositorio: [comparación NanoGPT](nanogpt-price-comparison.md), [expansión 2](nanogpt-price-expansion-2.md) y `bench/2026-10-01-3273c0a.json`. No se volvió a ejecutar el 2026-10-08.

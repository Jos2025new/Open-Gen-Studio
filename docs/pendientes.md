# Pendientes y propuestas

Revisado el 2026-10-08 contra el código de `task/agent-forcing` y con las respuestas del usuario. Cada línea dice su estado y quién lo dijo. Al cerrar una, muévela a «Hecho» con su commit o su evidencia.

## Decisiones del usuario

| Asunto | Estado |
| --- | --- |
| Calidad por defecto = resolución media del modelo (`mediumResolution`) | **Aprobado** por el usuario (lo confirmó el 2026-10-08). |
| Modelos `-spicy` excluidos salvo que se nombren | **Pendiente.** Aplicado de forma provisional. Probablemente se bloqueen si la app deja de ser solo local. |
| ADR 0005, 0006, 0008 y 0009 | **Propuestos**, implementados y en uso. Falta su aprobación formal. |
| ¿Las operaciones con modelo de imagen confirman su modelo (`454d721`, ADR 0009) o heredan el de su origen sin tarjeta (lo dicho en otra sesión ≈01:00)? | **Por confirmar.** Hoy rige la primera. |
| Fusionar `task/agent-forcing` en `task/modelo-general` | **Pendiente del usuario.** Comparación y decisiones en [fusion-agent-forcing.md](fusion-agent-forcing.md): avance directo, sin conflictos. |
| Publicar la app (plataforma, acceso, claves en servidor) | **Sin decidir.** Hoy es solo local; ver [seguridad](seguridad.md). |
| Designer: máscaras de capa, capas de ajuste, estilos de capa, PSD y gestión de color | **Próximo trabajo del usuario.** Nada de esto existe hoy. |

## Por probar

| Qué | Quién / estado |
| --- | --- |
| Bucle de tarjetas con un vídeo caro (`3f551d1`), y P2, P3 y P4 (`95eab99`) | Lo prueba el usuario en el sandbox. |
| Precisión de `remove_bg`, `extract_frame` y `create_voice` | Pendiente: no hay casos reales en el corpus. |
| Calidad de los cortes de `grid_split` con una generación real | Pendiente. |
| **fal.ai** (generaciones y subida de vídeos grandes) | **No probado.** El usuario no usa fal. En teoría funciona, pero nada se ha verificado con una generación real. |

## Funciones propuestas sin implementar

| Función | Estado |
| --- | --- |
| Importar el `.zip` de datos (el exportar ya existe) | Pendiente. |
| Recortar un vídeo o quitarle el audio | Pendiente. El servidor local ya usa ffmpeg para `join_clips`; sería la vía más ligera. |
| Quitar el fondo de un vídeo (`pixelcut/video-background-removal`, NanoGPT) | Pendiente. ID verificado. |
| Subir vídeos grandes a fal con su API de subida | Pendiente, ligado a «fal no probado». |
| Texto a voz y efectos de sonido | **No existen.** Atlas filtra el catálogo de audio a MiniMax Music y Lyrics (`AUDIO_FAMILIES` en `providers/atlas.ts`); las demás familias esperan la decisión del usuario. Sí existen: música, letras, transcripción, voces de Kling para sujetos, entradas de audio y vídeo con audio nativo o lip-sync. |
| Limpiar copias `data.bak-*` | Sin hacer, solo si hace falta. Se crean únicamente al pulsar «Wipe all data» y solo ocupan disco: no afectan al funcionamiento ni a la interfaz. Las copias automáticas de `data/backups/` ya se limitan a las 20 últimas. |

## Calidad del código

| Asunto | Efecto |
| --- | --- |
| 13 archivos de más de 30 KB (`runtime.ts`, 115 KB) | Desarrollo: cuesta más leerlos y cambiarlos. No pueden crecer (ADR 0008); falta partirlos. |
| 129 de 199 módulos sin test que los importe directamente ([mapa](map.md)) | Desarrollo. Muchos son componentes de interfaz cubiertos solo de forma indirecta: un fallo visual o de interacción puede pasar `npm test` y llegar al usuario. |
| Tests que fallan por tiempo de espera con la máquina cargada | Desarrollo: falsas alarmas. Hasta 8 fallos con carga 34; ninguno sin carga. |
| Contraste de `--text-4` (2,39:1) en textos de 10 px | Interfaz: legibilidad baja. |
| Remediación: medir la memoria del historial del Designer; unificar los datos repetidos de los proveedores | Sin hacer; el segundo era opcional. |

## Hecho (verificado)

- Exportar los datos en un `.zip` (`/x/store/export`, botón en Settings).
- Precio exacto de Atlas antes de generar (`src/engine/quotes.ts`). El usuario confirma que funciona.
- 3D y Designer (`PLAN_3D_DESIGNER.md`, fases P1–P9): los cuatro modelos 3D, el visor (probado por el usuario y ampliado después), la exportación a PDF y SVG, el lineart editable y los pinceles con textura.
- Banco del agente, antes y después (R0d/R8): el usuario lo ejecutó en otras sesiones, con GPT y con Claude, e incluyó modelos como Grok y MiMo, con gasto real. Lo registrado en el repositorio: [comparación NanoGPT](nanogpt-price-comparison.md), [expansión 2](nanogpt-price-expansion-2.md) y `bench/2026-10-01-3273c0a.json`.

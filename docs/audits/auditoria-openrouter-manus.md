# OpenRouter: verificación de Manus AI cruzada con el código (2026-10-25)

Manus AI verificó la [auditoría de OpenRouter](auditoria-openrouter.md) contra la doc oficial, sin acceso al repo. Sus 17 grupos no traen fallos de verificación; los puntos que dependen del código los dejó «pendientes». Aquí se comprueban en `src/engine/providers/openrouter.ts` (commit d31c232). Nada corregido aún.

## Puntos de código comprobados

| # | Afirmación | Código | Estado |
| --- | --- | --- | --- |
| 1 | Vídeo no envía `input_references` (imagen, audio, vídeo) | `loadSchema` solo da `firstFrame`/`lastFrame` (l. 266-275); `generate` solo arma `frame_images` (l. 305-312) | Confirmado |
| 2 | Si van `frame_images` e `input_references`, ganan los fotogramas (i2v) | La app no conoce la regla; hoy no aplica porque no envía refs | Hay que imponerla al añadir refs |
| 3 | Vídeo se envía siempre como data URL | `encodeImage(…, 'content-part')` en l. 307 y 310 | Confirmado. La doc de vídeo no lo garantiza; solo el skill oficial lo menciona |
| 4 | Passthrough `provider.options.<slug>.parameters` (vídeo) y `provider.options[slug]` (imagen) | No existe en el archivo | Confirmado |
| 5 | `polling_url` relativa sin resolver | Se usa tal cual (l. 321, 340); en el navegador una ruta relativa iría al servidor de la app | Confirmado; hoy funciona porque OpenRouter devuelve URL absoluta |
| 6 | Sondeo cada 5 s (la doc sugiere 30 s) | `sleep(5000)` l. 364 | Confirmado, menor |
| 7 | Estados terminales | `completed`, `failed`, `cancelled`, `expired` (l. 344, 359) | OK |
| 8 | Descarga con Authorization | `/videos/{id}/content` con cabeceras (l. 350); si falla, la URL sin firmar | OK |
| 9 | Opciones de imagen desde el catálogo agregado, no por endpoint | Parámetros de `/images/models` (l. 227-231), que la doc define como unión; los endpoints solo se leen para el precio (l. 134) | Confirmado: puede ofrecer opciones que el endpoint elegido rechaza |
| 10 | `previous_job_id` (extender/editar) | No existe | Confirmado; la doc no liga el campo a modelos concretos, se queda oculto |

## Matices nuevos de Manus que cambian el plan

- **Wan 3.0 Prime** se describe como texto a vídeo o primer fotograma, no como referencias generales. No hay que agruparlo con Wan 3.0 al dar referencias.
- **`architecture.input_modalities`** sirve como filtro inicial, no como prueba de que un modelo acepte audio o vídeo como referencia. Solo se habilita con la descripción del modelo o la doc.
- **Recraft**: las listas de passthrough y de referencias cambian por variante (Styles exige de 1 a 10 referencias; V4/V3, de 0 a 1; V4.1 Flash no acepta imagen).
- **`null` no es `false`** en los flags del catálogo de vídeo (Grok, HappyHorse): es desconocido.
- **Prompt**: la doc no define `@image1` ni otra sintaxis; las referencias se nombran en lenguaje natural.

## Orden propuesto (pendiente de aprobación)

1. Referencias de imagen en vídeo para los modelos cuya descripción lo dice (Seedance 2.0, Fast, Mini, 2.5), excluyentes con el fotograma inicial. Audio y vídeo solo donde la descripción lo confirme (Seedance Mini).
2. Resolver `polling_url` contra `https://openrouter.ai`.
3. Opciones de imagen desde el endpoint del modelo y passthrough desde `allowed_passthrough_parameters`.
4. Sondeo a 30 s.

Frágil: los catálogos cambian; todo se lee al usarlo. Un envío real a vídeo con data URL sigue sin probar.

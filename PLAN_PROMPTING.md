# Plan: prompting de imagen (síntesis de dos perspectivas)

Fecha: 2026-09-26. **Estado: APLICADO el 2026-09-27 a petición del usuario** (§1–4 y ronda 2 puntos 1 y 4; detalle en `AGENTS.md`). Siguen fuera las afirmaciones sin fuente de la nota final, las marcas de retirada y Clarity.
Ronda sin fuentes: no se contrastó con las APIs reales ni con los esquemas reales de los proveedores, y no se vieron los archivos fuente de los que salieron las dos perspectivas (la curada por el usuario y la de Qwen). Todo lo de abajo es propuesta hasta tener esas fuentes.

## 1. Reglas universales (en el prompt del agente, sustituyendo el bloque actual sin alargarlo)
Ambas versiones coinciden en todas; no necesitan fuente por modelo.
1. Orden de la descripción: uso → sujeto → acción → contexto → composición (plano, ángulo, lente) → luz → estilo o medio → color → ambiente.
2. Concreto y en frases, no una lista de palabras clave ni adjetivos vacíos.
3. Texto literal entre comillas, con posición y tipografía.
4. Referencias por papel ("Imagen 1 = identidad, Imagen 2 = estilo"), sin describir lo que ya muestran.
5. Edición: "cambia solo X; conserva A, B y C; no añadas Z".
6. Upscale: no redefinir el contenido; solo nitidez y detalle.
7. Restricciones en positivo si el modelo no tiene negative prompt ("fondo blanco liso, sin logotipos").
8. Orden temporal y una acción por clip en vídeo.
9. Iterar un cambio a la vez.

Casi todo ya está en R2 (`PLAN_AGENT_ROUTE.md`). Lo nuevo son las reglas 3, 5, 6, 7 y el ambiente: reescribir, no añadir.

## 2. Una línea por familia (visible solo con el modelo en uso)
Estructura preferida y para qué sirve cada una. A verificar con las fuentes antes de escribirlo.

| Familia | Estructura del prompt | Mejor para |
|---|---|---|
| GPT Image 2 / 2.5 | escena → sujeto → detalles → restricciones | texto, diseño, edición, fondo transparente |
| Seedream 5 | sujeto > entorno > estilo > luz > técnica | personajes, identidad; HEX y multilingüe |
| Nano Banana | sujeto + acción + contexto + composición + estilo | foto héroe (Pro), ilustración (2) |
| Recraft | corto = interpretativo; largo = control del layout | vector, logos ("flat colors, no gradients") |
| Ideogram 4 | texto libre con Magic Prompt, o JSON sin él | póster y tipografía |
| Z-Image Turbo | prompt largo y estructurado, restricciones en positivo | rápido y barato |
| Qwen Image | retratos muy detallados | realismo de personajes |
| P-Image | sujeto, comportamiento, estilo, entorno | iteración rápida |
| Step Image Edit 2 | corto y directo | edición rápida |

La columna "Mejor para" amplía la tabla por propósito de R1 y las líneas `best_for` de R3.

## 3. Parámetros técnicos (en el código, leídos del esquema de cada variante)
El agente no los decide ni los memoriza.
- Negative prompt: solo si la variante tiene el campo. Lo tienen Qwen y Z-Image Base; Z-Image Turbo no.
- Pasos y CFG: los valores por defecto del proveedor. Nunca números de una guía que el esquema no admita (p. ej. Turbo en fal permite 1–8 pasos).
- Fondo transparente: el parámetro `background` en GPT Image, no texto en el prompt.
- Magic Prompt: `expand_prompt` en Ideogram. Activado si el prompt es libre; desactivado si es JSON o texto exacto.
- Longitud máxima del prompt: del esquema (ya hecho en R3).
- Calidad (`quality` en GPT Image): sigue la calidad media por defecto, igual que la resolución.

## 4. Lo que la app hace por su cuenta (cero coste para el modelo)
- Conservar la misma semilla al revisar o regenerar con un cambio: así se cumple el "un cambio a la vez".
- Reescribir las instrucciones internas de Edit, Relight, Angle y Upscale con el patrón "cambia solo / conserva / no añadas".

## Ronda 2 (2026-09-26) · también PENDIENTE DE REVISIÓN
Tras la auditoría de DeepSeek sobre la versión de Qwen y la integración posterior de Qwen. Sin fuentes todavía.

**Decidido (usuario):** el usuario escribe en cualquier idioma; el agente redacta los prompts en inglés (la regla actual). Excepción: el texto literal que debe aparecer en la imagen va tal cual, entre comillas y sin traducir.

Cambios propuestos:
1. Reglas universales nuevas (reescribiendo, sin alargar): repetir qué se conserva en cada iteración de edición (el drift es real); la referencia define estilo o identidad y el prompt define sujeto, composición y pose; describir relaciones espaciales y físicas, no objetos sueltos.
2. El plan cubre también vídeo: las reglas de Grok (bloque `Sound:`, orden temporal, una acción por clip, extensión en segundos nuevos) van a la línea por familia, junto a Wan, Seedance y MiniMax.
3. Modelos que se retiran: marca con fecha y fuente en `modelRules.ts` para no recomendarlos (Step Image Edit 2, 10 de octubre de 2026, sin verificar).
4. Calidad media también para `quality` de GPT Image 2.5 (admite `xhigh` y `max`; por defecto `medium`), no solo la resolución.
5. Upscalers en código: Clarity con `creativity` baja y `resemblance` alta por defecto (no redefinir el contenido).
6. Plantillas y checklist: contenido de las guías por familia (`read_guide`), no del prompt fijo.

Contrastado con la red de regresión guardada (no APIs en vivo): Grok reference-to-video 1–7 imágenes (NanoGPT ≤4); extensión de Grok 2–10 s nuevos; Grok v1 cita `@Image1` y v1.5 `<IMAGE_0>` (ya cubierto por R3); Nano Banana 2 hasta 14 imágenes al editar; Step Image Edit 2 en fal sí tiene `negative_prompt` (la auditoría dice que con CFG 1.0 no actúa: verificar antes de rellenarlo). `true_cfg_scale` y las resoluciones exactas de Qwen 2512 son del pipeline oficial, no de las APIs de los proveedores. No aparece el límite de 8,7 s de edición de Grok. La integración de Qwen repite errores ya corregidos por la auditoría (`text_mode`, `guidance_scale=0`, "Grok único vídeo con audio"): no usarla como referencia.

---

## Nota de Claude
- Lo único contrastado fue la **red de regresión guardada en el repo** (`tests/fixtures/live/expected.txt`, esquemas descargados el 2026-09-25), no las APIs en vivo. De ahí salen los datos de la sección 3 (negative prompt en Z-Image Base y Qwen, 1–8 pasos en Z-Image Turbo de fal, `background`, `quality` y `expand_prompt`). Pueden haber cambiado desde entonces.
- En ese contraste, varias afirmaciones de las dos perspectivas no aparecían en los esquemas: `true_cfg_scale` (Qwen), `input_fidelity` (GPT Image), `text_mode` y `cfg_scale` (Step Image Edit 2), `guidance_scale` (Seedream 5), LoRA en P-Image, 8–12 pasos en Z-Image Turbo, y "Grok es el único vídeo con audio". No se aplican hasta tener fuente.
- Sin verificar (sección 5 de la conversación): Flare = velocidad y Sunburst = calidad en GPT Image 2.5; HEX con nombre del color; "adult" al describir personas; longitudes "óptimas" del prompt.
- Orden propuesto al implementar: 3 y 4 (código, sin coste para el modelo) → 1 → 2. Medir con el banco (R0/R8) antes y después: las reglas 1 y 2 tocan el prompt fijo del agente.

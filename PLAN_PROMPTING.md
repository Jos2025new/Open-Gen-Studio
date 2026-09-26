# Plan: prompting de imagen (síntesis de dos perspectivas)

Fecha: 2026-09-26. **Estado: PENDIENTE DE REVISIÓN. No implementar todavía.**
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

---

## Nota de Claude
- Lo único contrastado fue la **red de regresión guardada en el repo** (`tests/fixtures/live/expected.txt`, esquemas descargados el 2026-09-25), no las APIs en vivo. De ahí salen los datos de la sección 3 (negative prompt en Z-Image Base y Qwen, 1–8 pasos en Z-Image Turbo de fal, `background`, `quality` y `expand_prompt`). Pueden haber cambiado desde entonces.
- En ese contraste, varias afirmaciones de las dos perspectivas no aparecían en los esquemas: `true_cfg_scale` (Qwen), `input_fidelity` (GPT Image), `text_mode` y `cfg_scale` (Step Image Edit 2), `guidance_scale` (Seedream 5), LoRA en P-Image, 8–12 pasos en Z-Image Turbo, y "Grok es el único vídeo con audio". No se aplican hasta tener fuente.
- Sin verificar (sección 5 de la conversación): Flare = velocidad y Sunburst = calidad en GPT Image 2.5; HEX con nombre del color; "adult" al describir personas; longitudes "óptimas" del prompt.
- Orden propuesto al implementar: 3 y 4 (código, sin coste para el modelo) → 1 → 2. Medir con el banco (R0/R8) antes y después: las reglas 1 y 2 tocan el prompt fijo del agente.

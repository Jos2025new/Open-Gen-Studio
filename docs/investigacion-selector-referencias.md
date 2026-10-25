# Selector de referencias con @ (F5.1)

2026-10-25. Investigación documental; no es una prueba de esas aplicaciones. El usuario aclaró durante la ejecución que solo quiere autocompletado @ en los campos actuales, sin cambios de GUI ni aprobación de maqueta. Sustituye F5.2 del [plan](plan-proveedores-2026-10-25.md); la [maqueta](mockups/referencias-arroba.html) es únicamente una propuesta histórica y no se aplica como rediseño.

## Referencias consultadas

- [Runway: referencias de medios](https://help.runwayml.com/hc/en-us/articles/52963720640275-Using-reference-media-to-guide-your-generations): asigna etiquetas por tipo y orden; escribir @ abre una lista de adjuntos y referencias guardadas. Elegir una la inserta en el prompt.
- [Runway: Gen-4 References](https://help.runwayml.com/hc/en-us/articles/40042718905875-Creating-with-Gen-4-Image-References): autocompleta nombres con @ y distingue referencias temporales de guardadas. Su límite de tres pertenece a ese modelo; no se traslada a OGS.
- [Midjourney: Omni Reference](https://docs.midjourney.com/hc/en-us/articles/36285124473997-Omni-Reference): la web usa un destino específico para la referencia. Sirve para distinguir el rol del adjunto; no demuestra un selector @ ni su teclado.
- [W3C APG: combobox](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/): patrón para sugerencias, selección con flechas/Enter, Escape y foco en el campo. Es la fuente de accesibilidad; no se atribuye ese teclado a Runway.

## Adaptación propuesta a OGS

Un desplegable junto al campo existente, sin tarjeta de confirmación adicional. Mismo componente para composer y prompt editable del plan. Solo lista imágenes adjuntas del contexto y sujetos disponibles, con miniatura, nombre y etiqueta inequívoca. Sin consultas remotas ni persistencia nueva.

- @ abre la lista; el texto escrito filtra por nombre. Flechas cambian la opción activa, Enter inserta y Escape cierra sin borrar lo escrito. El foco permanece en el editor. Un clic inserta lo mismo que Enter.
- Las imágenes conservan el orden real de `refs`. Un sujeto inserta su `@Name` existente; `mapSubjectPrompts` lo transforma según el modelo y lo numera después de las referencias. No se convierte un sujeto a un índice fijo al editar.
- La selección reemplaza únicamente la mención junto al cursor y conserva el resto del prompt. No cambia adjuntos ni convierte referencias en fotogramas. Si no hay coincidencias, muestra un texto breve sin sugerencias ficticias.
- `@Image1` es la decisión D2 para Seedance. Los modelos con otra sintaxis siguen usando sus reglas actuales; el selector no debe prometer que todos interpretan ese token.
- Verificar antes de implementar: nombres duplicados, cursor en medio de texto, edición de un plan con referencias aún no generadas, cambio de modelo y reordenación de adjuntos. La maqueta ilustra el caso de Seedance; no sustituye estos tests.

## Evidencia local

`src/engine/subjectPrompts.ts` calcula la numeración desde las referencias reales. `src/components/composer/MediaControls.tsx` ya inserta sujetos por nombre. La propuesta reutiliza ese contrato, sin un segundo registro de identidades. Las miniaturas de la maqueta son símbolos de ejemplo, no assets del usuario.

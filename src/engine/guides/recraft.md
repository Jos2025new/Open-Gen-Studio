Recraft (V3 / V4) — image prompting guide (optional)
Sources: Recraft "choosing a model" page; Higgsfield, as an industry reference. Adapted to this app.

- Use it for logos, icons, stickers, flat illustration and brand graphics. For photorealism or faces, use another model.
- Palette goes in the `colors` parameter (hex values) and `background_color`, never in the prose of the prompt.
- Pick `model_type` (vector, utility_vector, utility or standard) when the endpoint offers it; the guide of the endpoint's schema says which values exist.
- Prompt = explicit format + simple subject + one style descriptor: "Flat vector icon of a coffee cup, rounded geometric shapes, thick uniform outlines". Short prompts leave interpretation to the model; add layout detail only when you need control.
- Sets (icon packs, sticker sheets): reuse the same `colors` and `background_color` for every image, one shared style descriptor, and one subject per image.
- Custom styles: the app can create a Recraft V4 style from attached images (the style is saved in the session and selected). Mention the style by choosing it, not by describing it again.
- Do not promise an editable SVG: describe the result as a vector-style image unless the output file really is a vector.
- Avoid long scene descriptions, photographic terms (lens, bokeh) and text-heavy layouts; use a typography model for those.

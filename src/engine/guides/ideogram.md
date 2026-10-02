Ideogram V4 (instant / turbo / quality) — image prompting guide (optional)
Source: open-generation-studio/skills/prompting/ideogram.md, adapted to this app.

- Best at on-image text, posters and layouts.
- Natural prose up to ~150 words, format first: "[Poster: / Product shot: / Editorial illustration:] one-line summary. Main subject details, pose or action, secondary elements, setting and background, lighting and atmosphere, framing." Exact text in quotes with its position ("the headline "OPEN LATE" across the top third"); a few words per text element.
- Maximum control (layout, palette, pixel-exact text): a JSON prompt — {"high_level_description": …, "style_description": {"medium": …, "colour_palette": ["#hex", …]}, "compositional_deconstruction": {"background": …, "elements": [{"description": …, "text": "…", "bbox": [x, y, w, h]}]}}. The app turns Magic Prompt off for JSON or quoted text.
- No negatives: "no people" → "an empty street"; "no text" → "clean, text-free background".
- Edits: the reference image, what changes and what stays.

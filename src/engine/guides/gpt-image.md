GPT Image 1.5 / 2 / 2.5 (OpenAI) — image prompting guide (optional)
Source: open-generation-studio/skills/prompting/gpt-image.md, adapted to this app (size, quality and background are parameters).

- Strong at layouts, posters, UI mockups, infographics and text in many scripts (Latin, CJK, Arabic). 2.5 Flare = fast, 2.5 Sunburst = highest quality.
- Order: the deliverable first ("A square ecommerce image of…"), then subject → composition → style → constraints. For long prompts use labelled sections: "Scene:", "Subject:", "Details:", "Constraints:". Name materials precisely ("brushed aluminium", not "shiny metal"). Refine one variable per iteration.
- Text: exact words in quotes, placement and type style, plus "sharp label text, clean kerning, readable from a distance". Dense text or fine type → params.quality "high" (medium is fine for products).
- Edits: what changes and what stays exactly the same (identity, background, pose, lighting, product shape, label text, camera angle). One change per turn.
- References always get a role: "image 1 is the character, image 2 the background".
- Transparent background: params.background "transparent" and say "isolated subject, no backdrop, no shadow"; on later edits repeat "keep the transparent background".
- Avoid "beautiful / high quality" instead of concrete descriptors.

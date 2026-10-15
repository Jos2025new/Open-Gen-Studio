Qwen-Image (Alibaba / QwenLM) — image prompting guide (optional)
Source: QwenLM/Qwen-Image official README, adapted to this app.

- Strong at text rendering (English and Chinese) and at following detailed prose. Write one paragraph: subject → aspect or composition → setting → light → mood or camera, in concrete visual terms.
- Text in the image: the exact words in "double quotes", with their position and style ("the headline "OPEN LATE" in bold white sans-serif across the top third"). Keep each text short; one block per sentence.
- State what you want, not what to avoid: "plain white background" instead of "no clutter". Constraints are positive sentences in the prompt.
- No quality incantations: do not write "4K", "Ultra HD", "masterpiece" or "best quality". Physical detail (materials, light direction, lens) does the work.
- Longer, structured prompts help on complex scenes; a short prompt leaves the layout to the model.
- Edits (edit variants): cite inputs as "Image 1", "Image 2" ("put the jacket from Image 2 on the person in Image 1"). One change per call, and say what stays as it was (identity, pose, background, lighting).
- The number of reference images depends on the endpoint's schema; the app clips to what the model accepts.
- Avoid several edits in one instruction and vague targets ("make it better").

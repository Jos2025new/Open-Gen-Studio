Video edit and extend — general guidelines (any model)
Source: production practice supplied by the user (2026-09-26), adapted to Atlas Cloud / fal / NanoGPT; edit routes, references and limits checked against the Atlas and fal schemas (2026-09-25). For a model's own syntax, also read its model guide when it has one.

THE BASE RULE
An edit model does not describe a scene: it executes an instruction on a clip that already exists. Writing a text-to-video prompt drags artifacts and re-generates the whole shot.
- Imperative instruction, not description: "Replace X with Y", "remove Z", "change A's colour to blue". Do not narrate the scene.
- Say what stays the same: camera, framing, motion, timing, light, audio and every other element. Without it the model tends to regenerate the take.
- Be physical and concrete about what is new: material, colour, size, screen position (left/right, foreground/background) and how it integrates with light and shadows. The vaguer the new object, the more it "floats".
- One main edit per generation. Long chains ("and also…") lose adherence: edit in steps.
- To remove something, say what fills the gap (background, texture), not only "remove this".
- Extend: describe how the action continues from the clip's current end state, in time order; the new seconds are what gets billed.

EDITS WITH REFERENCES AND A SPECIFIC STYLE: THREE LAYERS
When references and a style join the edit, the prompt is no longer "preserve + one change":
1. SOURCE: what the clip is and what is NOT touched (subjects, motion, camera, timing, audio, framing).
2. STYLE LOCK: the style as a global layer over the whole frame — palette, texture/grain, contrast, light type, lens, era. Positive and consistent ("teal-orange grade, 35 mm grain, halation in the highlights").
3. CHANGE: the single local edit (add / remove / replace / modify), with position and physics.
Exempt from the preserve list what the style rewrites — "preserve subjects, motion and framing; colour, grain and lighting change with the style". If look attributes stay in the preserve list, the model contradicts itself and the style barely lands.
- Separate references by ROLE, in one sentence each. A reference bleeds its content: a style reference with a person in it will try to add that person.
  - Style reference: "take only the grade, the grain and the lens — not its content or framing".
  - Subject or object reference: "take only the identity / shape; the style comes from the style lock".
- Global or local style: global (restyle the whole clip) → grade, grain and light go to the style lock, not to preserve. Local (only the inserted element matches the clip) → preserve the clip's look and add an integration sentence ("the new object matches the clip's light and grain").
- Across several clips, reuse the same style reference (or a subject). Changing it makes the style drift; text-only style drifts more than image-anchored style.

CHOOSING THE EDIT MODEL (what our providers offer; the app reads limits from each schema)
- Fix the identity of an inserted subject or product → Kling O3 edit (1 clip + up to 4 reference images: element, scene or style; clip up to 10 s on Atlas; keeps the original sound by default) or Gemini Omni Flash 1.1 edit (reference images cited as <IMAGE_REF_0>, from zero; keeps everything the prompt does not mention; 3–10 s; long prompts up to 20 000 characters).
- Keyframe control, 4K, or one model for text, image, reference, edit and extend with native audio → Gemini Omni Flash 1.1.
- Simple restyle or add/remove, clip up to 15 s, lowest cost, no identity to fix → FLUX 3 Video Edit (prompt up to 4 096 characters; describe the new element in words; output length follows the input clip).
- Creative or bold edits, maximum obedience to the instruction → Grok Imagine Video edit (its own edit route on Atlas and fal).
- Edit with Seedance 2.5 → through its reference-video mode (the app handles it: duration -1, 4–30 s clips).
- A long clip (over 15 s) or a sequence of many edits → not FLUX (15 s limit); use Kling O3, Gemini or Seedance 2.5 within their clip limits.
- Default when nothing above decides: the edit model preferred in Settings; resolution medium unless the user asks.

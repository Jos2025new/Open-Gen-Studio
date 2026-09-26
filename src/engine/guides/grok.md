Grok Imagine Video (xAI) — prompting guide
Source: high-end production practice supplied by the user (2026-09-26), adapted to Atlas Cloud / fal / NanoGPT; variants, limits and reference syntax checked against the Atlas and fal schemas (2026-09-25).

VARIANTS ON OUR PROVIDERS (the app reads the limits from each variant's schema)
- Grok Imagine Video (v1): text-to-video, image-to-video (start image), reference-to-video (1–7 images; on Atlas capped at 10 s), and edit / extend of an existing clip through the app's Edit video and Extend video operations.
- Grok Imagine Video 1.5: text, start image or 1–7 reference images; up to 15 s; reference-to-video capped at 720p on Atlas.
- Resolution follows the chosen quality (medium by default).

WHAT DEFINES HOW TO PROMPT IT
- It has the best instruction following in the stack. No tag soup, no stacked camera tokens: clear natural-language direction, in order of importance, as you would brief an operator. What comes first weighs most.
- Audio is native (music, SFX, ambience) and part of the prompt, not an extra. Without a description it still makes sound, but generic; describe it to control it.
- Iterate one change at a time: when something fails, fix only the sentence that governs it, do not rewrite the prompt.

BASE FORMULA (sentences, in this order)
1. Main action in one sentence — what happens, who, where.
2. Subject and look — age, clothing, materials, colour; what must stay stable.
3. Scene — place, time of day, weather, background.
4. Camera and movement — "locked-off camera", "slow dolly forward", "low-angle medium shot"; operator terms work (handheld, whip-pan, tracking).
5. Light and atmosphere — source, direction, time (golden hour, side window light).
6. Motion with physics — weight and contact ("drops splash as they land"), not only the gesture.
7. Audio: ambience + SFX + music or dialogue.
Template: <Main action.> <Subject: age, clothing, key features.> <Scene: place, time, background.> <Camera: shot + movement.> <Light and atmosphere.> <Physics detail.> Audio: <ambience + SFX + music or dialogue.>
Example: A young woman in a beige trench coat runs through a night market in the rain, dodging stalls with red tarps. Lateral tracking medium shot, camera at chest height. Neon reflected in the puddles, cold saturated mood. Splashes mark every stride and the coat streams back. Audio: steady rain, crowd murmur, a tense rising synthwave bed.

REFERENCES
- Reference images give subject, style or composition; a start image fixes the first frame. Say what each brings: "the same person as <IMAGE_0>, the colour style of <IMAGE_1>".
- Syntax: <IMAGE_0>, <IMAGE_1>… counted from zero (Atlas v1.5, fal v1.5). If the model's inputs give another syntax (fal v1: @Image1), that one wins; the app rewrites @Name subjects accordingly.

EDIT AND EXTEND
- Edit (restyle, add or remove objects): an imperative, surgical prompt — "keep the composition and motion; replace only X with Y" — not a new scene.
- Extend: describe how the action continues from the clip's last moment, in time order; the new seconds are what gets billed.

STYLE: PHOTOREAL, 2D OR 3D
Style is an anchoring instruction: put it in the first sentence, use one style family per clip, and in long clips repeat it once mid-prompt. Never mix families: "cinematic" in a 2D clip pulls it toward 3D/CG, its default zone.
- Photoreal: anchor "real filmed footage", "live action". Real, not clean texture (skin with pores and micro-imperfections, worn metal, dust in the air); optics and camera ("35 mm, shallow depth of field", "handheld, slight shoulder movement"); light motivated by the scene ("side window light", "sodium street lamps mixed with neon"); fine film grain and a muted grade. Avoid a bare "cinematic" (vague) and "hyperrealistic" / "8K ultra HD" (pushes to plastic CG). The more "perfect" the description, the more it looks like a render: name imperfections.
  Example: Real handheld footage. A baker in his fifties, weathered face and floury hands, pulls a loaf from a wood-fired oven. 35 mm, medium shot, shallow depth of field, camera with a slight sway. Warm oven light from lower left; smoky, dusty air. Steam rises and fades. Audio: crust crackling, fire popping, bakery ambience.
- 2D: name the exact subtype — hand-drawn 2D animation, classic anime, flat cartoon, watercolour, inked comic, flat vector. Clean ink lines, flat colours without gradients, two-tone shading, limited palette; limited animation ("on twos, ~12 fps"), painted backgrounds, elastic cartoon motion. Camera moves over the illustration (pan, zoom), not a physical operator. Grok tends to return 3D volume: state the style positively and exclusively ("flat ink and colour, illustrated look, no three-dimensional volume, no render textures"); for a consistent character, pass it as a reference image.
  Example: Hand-drawn 2D animation, classic anime style. A girl in a red cape runs along a cliff toward the sea. Clean ink lines, flat colours, two-tone shading, gouache-painted backgrounds, illustrated look with no 3D volume. The camera pans sideways following her; strong wind. Orange sunset light. Hair and cape flutter with elastic motion. Audio: wind, gulls, soft piano.
- 3D: name the degree of stylisation — family feature-animation look, realistic game cinematic (real-time engine, ray tracing), clay / stop-motion, clean isometric render, stylised low-poly. A bare "3D" returns cheap generic CG. Materials and light: subsurface scattering, global illumination, ray-traced reflections, realistic microfacet materials; stylised = exaggerated proportions, big expressive eyes, soft surfaces; clay = visible fingerprints, frame-to-frame micro-jitter. A virtual camera can dolly, orbit and crane. Do not mix "photoreal" with stylised.
  Example: Stylised 3D feature-animation render. A round rusty robot peeks cautiously around the corner of a rainy alley; exaggerated proportions, big glowing eyes. Soft reflective materials, subsurface scattering, global illumination, puddles with ray-traced reflections. Virtual camera in a slow orbit at chest height. Violet and blue neon. The robot shakes off the water with an elastic bounce. Audio: dripping, servo hum, light orchestral music.
- For all three: textures and materials consistent with the family (pores for photoreal, flat ink for 2D, subsurface for 3D), and audio that matches the look (natural ambience vs cartoon orchestra vs motors and servos).

HappyHorse 1.0 / 1.1 (Alibaba) — prompting guide
Source: production practice supplied by the user (2026-09-26), adapted to Atlas Cloud / fal / NanoGPT; routes, limits and audio checked against the Atlas and fal schemas (2026-09-25).

CONTRACT ON OUR PROVIDERS (differs from other platforms; the app reads it from each variant's schema)
- Routes: text-to-video, image-to-video (one opening image), and reference-to-video with 1–9 reference images for subject consistency (Atlas 1.1, fal). Atlas 1.0 also has a video-edit route (the app's Edit video operation). No end frame, no reference videos or audios.
- Duration 3–15 s. Resolution 480p / 720p / 1080p (fal and NanoGPT: 720p / 1080p): medium by default, 1080p only if the user asks. Ratios 16:9, 9:16, 1:1, 4:3, 3:4.
- Prompt: at most 2 500 characters. Keep it compact.
- Audio: native on fal (synchronised; voice in Chinese or English, other languages are translated to English; write English speech in lowercase, acronyms and proper nouns in capitals). On NanoGPT it is silent. Only write dialogue or sound when the variant makes audio; otherwise treat the clip as silent.

ONE CONTINUOUS SHOT
It does not do multi-shot or keep characters across cuts: never ask for "scene 1 / scene 2" in one clip. Size the duration to one shot.

ORDER OF THE PROMPT
1. Subject + concrete action in the first sentence: who or what, and exactly what it does (a physical verb, not a state). "A bay horse gallops along a beach at sunset" beats "something nice with a horse".
2. Setting and moment: place, time of day, weather, background.
3. Camera: one clear move — locked-off, lateral tracking right, slow dolly-in, close-up. Several contradictory moves confuse it.
4. Light: main source and direction ("warm sunset light from the left, soft backlight").
5. Style: in its own block with technical anchors (see below).
6. Close with "one continuous shot, no cuts, natural physical motion".
Template: [Subject] [concrete, continuous action]. [Setting + time + mood]. Camera: [one move or locked-off]. Light: [source + direction]. Style: [look], [optics / depth of field]. One continuous shot, no cuts, natural physical motion.
Example (9:16, 8 s): A young rider in a leather jacket gallops across a field of golden wheat. Summer sunset, golden dust rising behind the hooves. Camera: lateral tracking parallel to the gallop, at stirrup height. Light: low sun backlighting from the right, warm glints in the mane. Style: cinematic, 35 mm, warm earthy colours, slight depth of field. One continuous shot, no cuts.

OPENING IMAGE AND REFERENCES
- With an opening image, it is the first frame: describe only motion and camera. Re-describing what the image shows makes the model reinterpret it and change the identity.
- With reference images, say in the prompt how each is used, by order and role ("the woman in the first reference image, wearing the jacket from the second"). No provider documents a tag syntax for HappyHorse: do not invent one.
- The image beats the text: its look wins. Use the style block to reinforce that same look, not to change it.

STYLE: PHOTOREAL, 2D OR 3D
It averages toward a semi-realistic look when the vocabulary is vague. Declare the style explicitly in its own block with technical anchors, never as a loose adjective; put it at the start and remind it at the end with a short phrase ("no illustrated look", "no CGI", "no 3D gradients"); never mix families. A hybrid gets its canonical name: "2.5D cel-shaded", "anime with photoreal background", "3D action figure photographed" (3D subject, real camera: describe the real camera as in photoreal).
- Photoreal: camera + medium + light + imperfections. "Real photography, full-frame DSLR, 50 mm lens, f/2.0, real depth of field. Skin with pores and visible texture, fine sensor grain, slight chromatic aberration at the edges. Natural grade, no retouching, no illustrated look, no 3D render." Anchors: filmed with a real camera, documentary footage, available natural light, visible sweat / dust / moisture, lens imperfections (vignetting, flare). Avoid "perfect", "clean", "smooth", "stylised", "glossy" — they push to render.
- 2D: drawing technique + line + flat colour, or it applies volumetric shading and looks fake 3D. "Traditional hand-drawn 2D animation, crisp ink contours, flat colour fills without 3D gradients, two-tone cel shading, watercolour-painted background, no CGI, no 3D volume." Anchors: cel shading, inked line, no gradients, limited palette, 90s anime / 60s cartoon / comic look, pencil and paper. Avoid depth of field, optics, lens, "cinematic" — photo vocabulary drags it to render.
- 3D: decide which 3D, or it comes out generic plastic. "Full 3D render, ray-traced renderer, PBR surfaces with correct roughness and metalness, subsurface scattering on skin, soft global illumination, feature-animation look, stylised character with big eyes, polished finish." Alternatives: real-time game engine, realistic documentary CGI, clay / stop-motion, stylised low-poly, 2.5D cel-shaded with lines and halftone.
Same subject in the three styles (9:16, 6 s):
- Photoreal: A dog jumps from a rock into a river at sunset. Camera: lateral tracking. Light: sunset backlight. Style: real photography, 50 mm f/2.8, fine grain, splashing water with crisp droplets, no illustrated look.
- 2D: A dog jumps from a rock into a river at sunset. Camera: lateral tracking. Style: hand-drawn 2D animation, inked line, flat colour, two-tone cel shading, painted background, no CGI.
- 3D: A dog jumps from a rock into a river at sunset. Camera: lateral tracking. Style: full 3D render, PBR, global illumination, feature-animation finish, fur with defined clumps, no illustrated look and no real photo.

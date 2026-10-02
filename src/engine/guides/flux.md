FLUX 3 Video and Video Edit (Black Forest Labs) — prompting guide
Source: production practice supplied by the user (2026-09-26), adapted to Atlas Cloud / fal / NanoGPT; routes and limits checked against the Atlas and fal schemas (2026-09-25). FLUX 3 is video; the image family is FLUX.2, prompted differently.

ROUTES ON OUR PROVIDERS (the app picks the route and fills the frame inputs)
- Text-to-video, image-to-video (start frame), first + last frame, keyframes-to-video (up to 10 images pinned at positions — the storyboard mode; the app places them), extend (continues from the last frames of a clip) and edit (Edit video operation).
- Draft: on NanoGPT, FLUX 3 with quality "draft" (about a third of the full price, fixed 720p, same 5–20 s and modes); the app picks it for draft-purpose video steps. Atlas has no draft.
- One continuous shot per clip: no shots or cuts inside one generation (use keyframes for a storyboard, or several clips).
- Duration 5–20 s (keyframes need an explicit duration). Resolution 720p / 1080p: medium by default. Aspect from auto to 21:9, 2:1, 16:9, 9:16, 1:1, 4:3, 3:4.
- Size the actions to the duration: in 5 s, one clear action.
- Audio is on by default (voice, SFX and ambience synced to the image, with lip-sync on written dialogue): always write the audio section; ask for silence explicitly if wanted.

HOW TO WRITE IT
Natural-language prose, not tag soup. No "masterpiece, 8k, ultra detailed" and no negative prompts: describe what you want, not what to avoid. Most important first. Blocks in this order:
1. Shot and context — one or two sentences of what happens in this shot.
2. First frame — what is already visible at frame 0, subjects in place. No empty opening or delayed reveal.
3. Blocking — measurable positions ("a metre from the table", "left of frame", foreground / midground / background) and where each character looks.
4. Camera and optics — physical movement (dolly in, lateral track, handheld, crane), height and distance, field of view in plain words ("wide-angle", "telephoto") rather than brands or f-numbers.
5. Light — main source, direction and what exposure prioritises. An anchor, not decoration.
6. Physics — motion with weight and ground contact.
7. Audio — ambience, SFX and the exact dialogue lines with tone and language.
Template: [A shot of N seconds.] [Subject + action, already visible in the first frame.] [Positions and gaze.] [Camera: height, distance, movement.] [Light: main source and direction.] [Relevant physics.] Audio: [ambience] + [SFX] + [exact line, with tone and language]. [Style / medium, if any.]

FRAMES AND IDENTITY
- Start frame fixes the first frame; end frame fixes the last (needs the start frame); keyframes pin up to 10 ordered frames; extend continues from a clip's last frames.
- Across several shots of the same character or place, reuse the same references in all of them so identity does not drift.
- To fix a style over several shots, lock it with one keyframe per style and leave the prompt for action and audio.

EDIT (FLUX 3 Video Edit)
- One MP4, under 15 s and 50 MB; output length and resolution follow the input clip. Prompt up to 4 096 characters.
- The prompt is a change instruction, not a scene description: what changes and what stays intact. "Replace the red jacket with a green one; keep the framing, motion, face, background and lighting identical."

STYLE: PHOTOREAL, 2D OR 3D
The skeleton does not change (shot → first frame → blocking → camera → light → physics → audio); the medium block (at the start or end) and the vocabulary do, because each word family drags the model toward a medium.
- Photoreal: name the real capture, not quality — camera body + lens + stock ("shot on a 35 mm lens, f/2"), real light with a physical source (side window, practical interior light, golden-hour backlight), imperfection and texture (pores, fine grain, dust, wear), handheld micro-shake, real weight, breathing, cloth. Avoid "cinematic masterpiece", "8k ultra detailed", "hyperrealistic"; and illustration or render words ("stylized", "painterly", engine names) push it to CGI.
- 2D: close the medium in one sentence — line (hand-inked, variable or even weight), shading (flat 2–3 value cel shading, hard edges), palette, and one texture accent that signs the look (halftone, paper grain, line boil); then the background (painted matte or flat blocks). Avoid (it turns 3D): volumetric, ray-traced, subsurface scattering, ambient occlusion, bokeh, depth of field, lens flare, chromatic aberration, film grain, camera brands, 3D software names. Animation timing: on twos (~12 fps), held key poses, smear frames, motion lines, squash and stretch. Framing: in wide shots characters shrink and lose identity — keep the character at least a third of the frame height for any action beat; keep wide for establishing. For running in place: parallax scroll (character animating in place, background sliding behind).
- 3D: name the render discipline — stylised animated-feature 3D or realistic game cinematic; they are different looks. Materials and how light behaves on them (satin plastic, cloth, metal). Here the words banned in 2D help: volumetric light, soft shadows, ambient occlusion, rim light, depth of field, light rays. Smooth 24 fps motion (not on twos), weight, secondary motion, hair and cloth with inertia. Describe the look ("stylised, rounded forms, satin materials, studio lighting") instead of naming studios or engines.
- The rule most people skip: with a stylised visual reference (keyframe, character or scene plate), do not describe the style again in text — the reference rules, and restating it makes the model reinterpret and drift. The prompt then carries action, camera, physics and audio plus one short anchor ("keep the reference's look exactly"). Add a single anti-drift line at the end only if the style drifts; not by default.
Same shot in three styles (a woman opens a letter in the kitchen):
- Photoreal: Medium shot. A woman in her forties at a wooden kitchen table opens a cream envelope, fingers steady. Shot on a 35 mm lens, f/2, natural window light from the left, soft falloff, fine grain. Handheld, slight breathing motion. Audio: room tone, paper tearing, a faint exhale.
- 2D: Medium shot. A woman at a kitchen table opens a cream envelope. Hand-drawn ink outlines with varying weight, flat three-value cel shading, muted warm palette, halftone accents in the shadows, painted matte background. Her motion on twos with a held key pose as the flap opens; a smear frame on the tear. No photographic depth, no soft gradients. Audio: paper tearing, light piano.
- 3D: Medium shot. A woman at a kitchen table opens a cream envelope. Stylised 3D animated-feature look — rounded forms, satin materials, soft shadows, subtle ambient occlusion, volumetric window light. Smooth 24 fps motion with secondary hair and cloth movement. Audio: paper tearing, room tone, light score.
The action and camera block is identical; only the medium, the vocabulary and the timing change.

DRAFT → FINAL
- FLUX 3 has no reproducible seed across tiers: the final render is a new take of the same idea, never the draft's frames made sharper.
- A draft validates composition, camera move, pacing, subject behaviour and whether the prompt wording works; it does not validate exact frames, micro-timing or face and fabric detail. Draft looks soft by design (720p): never reject an idea for softness.
- Loop: draft short (5 s) → refine the wording, not the settings → stretch the duration in draft if the idea must hold longer → final with the same prompt, aspect and duration.
- When a look must be locked before motion, make the still first and use image-to-video: the still is the anchor the seed cannot be.

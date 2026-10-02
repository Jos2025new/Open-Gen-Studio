Seedance 2.0 / 2.5 (ByteDance) — prompting guide
Source: high-end production practice supplied by the user (2026-09-26), adapted to Atlas Cloud / NanoGPT; limits checked against Atlas seedance-2.5/reference-to-video docs.

WRITING STYLE (both versions)
- Cinematic prose in English, present tense, physical verbs, concrete nouns. Nothing the camera cannot see or the mic cannot hear.
- Aspect, resolution, fps and audio on/off are request parameters, never prompt text. The only thing the prompt needs to know about time is the clip duration.
- Size the prompt to the input — a short input gets a short prompt; longer is never better by itself:
  - Lazy input (one line, a mood): 60–180 words, 1–2 paragraphs, no shot headers. Spine, place, person, beat, one camera line, one audio line.
  - Medium input (one or two sentences): 200–450 words, 2–4 shots with light headers.
  - Rich input (brief, beat sheet, broken prompt): seven blocks in order — SPINE (one-line story) → PLATE (the place) → CHARACTERS → SHOTS → CAMERA LAW → GRADE AND AUDIO → CONSTRAINTS.
- PLATE comes first and is ONE space. A duplicated or wrong location almost always means two conflicting spaces were described up top.
- Shot headers carry absolute clip time: "Shot 2 — MS at low angle, gimbal, 35mm, 00:05–00:09". Cuts are "Hard cut." on their own line.
- Numbers, not adjectives: "dolly forward at 0.8 m/s", "115° ultra-wide" — not "slow smooth push".
- Break the default framing: foreground element 5–40 cm from the lens, subject in the left or right third, camera never level with the eyes.
- One grade family, never mixed: warm-tungsten, cool-daylight, neon-noir, pastel-drift, storm-desat, ember-night, log-flat. When copying a reference's look, use log-flat.
- Counters, not bans: "Count of Leo in frame throughout: one" — not "only one Leo". The one allowed flat negation: "No music, no score, no bgm."
- Name references by handle, never re-describe them: @Image1 (subject or style), @Video1 (motion or camera), @Audio1 (rhythm, tone, voice). Numbered per type, in the order the refs are sent. Give each one job plus what it must not bring ("@Image1 is the character; ignore its background").
- Cue a moment once. If the exhale triggers the beat, do not also time it with "now".
- Audio: name the diegetic sounds; ask for silence or "no music" on purpose, or a generic score appears.
- Dialogue: short lines in double quotes, attributed, with tone ("'We leave at dawn,' she says, worn out."). Split long speech into lines and cuts.

VERSION LIMITS (the prompt stretches only because 2.5 holds more)
- 2.0: up to 15 s per generation. 5 s = one shot; 10–15 s = 2–4 shots. Up to 9 reference images (+ start/end frame), 3 videos, 3 audios.
- 2.5: 4–30 s. 20–30 s = up to 8 shots with absolute-time headers across the whole timeline. Up to 30 images, 10 videos, 10 audios (reference videos and audios: 2–30 s each, 30 s combined). With many references the prompt concentrates on action and camera; the look comes from the references.
- Resolution follows the chosen quality (medium by default). Do not ask for high resolution unless the user did.

EDIT AND EXTEND (2.5, through the app's Edit video / Extend video operations)
- Edit: describe only the change — what is replaced, added, removed or modified, and when inside the existing clip. No absolute shot headers as if generating from scratch; tie the change to what is already there. Duration is the input clip's (the app sends -1); the clip must be 4–30 s.
- Extend: describe where the action continues from the current end state. The aspect follows the extended clip.

ANIMATION (2D, 3D, 2.5D, stop-motion) — same skeleton, different vocabulary
- Replace the grade family with a STYLE FORMULA of 80–100 words and repeat it word for word in every shot and every asset. Literal repetition is the whole consistency mechanism; rephrasing it "similarly" in shot 3 loses the look.
- 2D / anime: ban photographic terms (bokeh, volumetric, realism, film grain, DSLR, live action). Use clean tapered contour lines, 2–3 tone flat cel shading, flat fills, painted watercolour backgrounds with paper grain, hard painted shadows, speed/impact lines, flat palette.
- 3D (feature animation, game cinematic): render vocabulary is allowed — subsurface-scattered skin, PBR, global illumination, stylised hair clumps, rendered depth of field, rim light.
- 2.5D (painterly 3D): 3D base with 2D treatment — drawn contours, halftone, chromatic aberration, painterly brush layers, paper texture.
- Stop-motion: physical materials (felt, clay, fingerprints), small practical lights, micro-jitter.
- Write the frame cadence inside the prompt, or the model smooths it out: 2D and 2.5D "animated on twos (12 drawings per second)"; stop-motion "12fps physical stop-motion cadence"; 3D "24fps smooth".
- Rhythm, not constant motion: mix snappy key poses with brief holds at impact or emotional moments and fluid motion where the action flows; vary it shot to shot to fit the scene and the user's style, never one fixed rule.
- If a result shows deformed hands or limbs, the fix for the next try is a simpler gesture or placing that moment across a cut; not a default constraint.
- Anchor the style with an image: one style key passed as a reference ("@Image1 is the style reference — match its line weight and palette exactly") beats paragraphs of adjectives. For several shots, make the character, location and prop images first in the locked style and pass them as references; the prompt then carries only action, camera and cadence.
- No proper names in animation: stable 3–4 word descriptors ("the silver-haired woman", "the melancholy skater boy"), identical across shots.

EXAMPLE (mood "sci-fi dune", 10 s, live action)
A lone pathfinder finds a black warship rib breaking the sand of a slot canyon at dusk.
A rust-grey desert canyon under a shattered moon; iron-oxide walls carved into flutes, ash-fine sand, one black hull rib rising from the floor. Mara walks the rib line in an ash-grey EVA suit and cracked mirrored visor, breath fogging in bursts. She stops, palm on the metal, and the hull wakes with a slow amber pulse.
115° ultra-wide gimbal, pushing forward at 0.6 m/s, camera below her eyeline, never level. Storm-desat rust-and-ember palette, dusk skylight through dust, one warm amber point appearing at the end. Diegetic only — canyon wind, sand hiss, boot crunch, rising sub-bass thrum. No music, no score, no bgm.

EXAMPLE (2D anime, 10 s)
Style formula (repeat verbatim in every shot): 2D anime, hand-drawn line art with clean tapered black contours, flat cel shading in two tones, painted watercolour backgrounds with visible paper grain, muted teal-and-mustard palette, animation on twos, no photographic depth of field, no realism.
A girl in a yellow raincoat waits alone under a bus shelter as the rain turns to petals.
Locked low MS, 50mm-equivalent flat perspective, camera static, foreground puddle 10 cm from lens, subject in right third, never level with her eyes. Diegetic only — rain on corrugated roof, distant traffic hiss, one bicycle bell. No music, no score, no bgm.

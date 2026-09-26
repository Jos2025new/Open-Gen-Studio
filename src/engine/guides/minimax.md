MiniMax H3 (standard, Max, Fast, Developer) — prompting guide
Source: high-end production practice supplied by the user (2026-09-26), adapted to Atlas Cloud / NanoGPT; tiers, resolutions and durations checked against the Atlas schemas (2026-09-25). Reference labels: MiniMax official video prompt guide (VIDEO_PROMPT_WRITING_GUIDE_ref_en).

WHAT H3 IS GOOD AT
- The strongest model in the stack for motion: action, acrobatics, dance, physical comedy, bodies interacting. Pick it for motion-led shots, not for fine texture.
- Native audio, dialogue in many languages (write the line in the language wanted).

TIERS ON OUR PROVIDERS (names differ from other platforms: read the variant, not the brand name)
- The prompt is written the same way on every tier; what changes is resolution, duration and whether references are accepted — the app reads them from each variant's schema.
- Atlas today: H3 standard (480P / 768P / 2K, 4–15 s, image and reference routes); H3 Max and Max Turbo (480P / 768P, 5–15 s, text or start image, no reference route); H3 Fast (480P only, 5–15 s, with references); H3 Developer (480P / 768P, 4–15 s, with references, cheapest).
- Resolution follows the chosen quality: medium (768P) by default; 2K only if the user asks.
- At low resolution (480P), write more directly: micro-texture (skin pores, fabric grain) is lost. At 2K the prompt can be more sensory.

STRUCTURE (natural cinematic language)
1. Scene context — 1–2 sentences, only what happens in this shot.
2. First frame — the key subjects already in position (no empty opening frame).
3. Blocking — measurable positions ("less than a metre from X", screen left/right, foreground/midground/background); body orientation and gaze direction separately.
4. Optics — diagonal FOV in degrees + distance (47° normal, 84° wide, 29° portrait, 18° tele) and the visible result.
5. Camera — the operator's physical behaviour: height, distance, side, movement.
6. Light — main source + direction + camera side + exposure priority.
7. Physics — the critical motion with weight, ground contact, cause → effect.
8. Audio — ambience, or the exact line in double quotes, attributed ("She says: \"You came.\""). Lips move only on scripted dialogue. For no score, end with "non_diegetic_music: N/A"; never ask for a soundtrack and ban music together.

RULES
- No "negative constraints" block: write the wanted states in positive.
- Motion is its strength: describe the action step by step with timing ("at 2 s she jumps, turns 360° with arms open and lands").
- H3 cuts between shots by default: write "one continuous take" when no cut is wanted. For several beats in one clip, time them: "0–3s: … 3–7s: … 7–10s: …", naming shot size and subject at each cut so identity holds.
- Start/end frames: describe the transition between them, not only the two ends.
- References: open with one line per file and its role, using MiniMax's labels — "<Picture 1> is the character reference (lock this woman's face)", "<Picture 2> is the first frame"; video and audio references by their role (camera or motion reference, voice reference). A file without a declared role is ignored or misused. Each extra reference spends attention: use only those that anchor identity, style or composition.

STYLE: REALISTIC, 2D OR 3D
H3 leans strongly photoreal: style is declared, not hinted. Put it in the first sentence, repeat it once at the end as a quality suffix, and never mix two styles in one shot (realism wins and the result is a hybrid). A reference or start frame carries the style, but restate it in text or H3 will "realise" it.
- Realistic / live action: "real photography, live action, filmed with a real camera". Ask for natural imperfection: skin with pores, sweat, fine hair, wrinkles, worn fabric, dust in the air. Physical optics and light: FOV in degrees, depth of field, subtle film grain, motivated light (window, practicals), slight exposure imperfection. Real weight and contact. Avoid "render", "CGI", "3D", "cartoon", "illustration", "perfect / flawless" (plastic skin).
- 2D (anime, cel, vector, ink, watercolour): name the exact medium; describe the drawing, not the camera — line quality, cel shading in flat colour planes, limited palette, painted backgrounds, flat graphic shadows. Remove camera depth: "flat 2D, not photorealistic, no 3D render, no depth of field". Drawn physics: squash and stretch, speed lines, exaggeration; motion reads best in clear silhouettes and flat colour. Avoid "photorealistic", "PBR", "subsurface", "cinematic" (pulls to realism).
- 3D (stylised feature, AAA game cinematic, realistic PBR): declare the render ("stylised 3D render, feature-animation look" or "AAA game cinematic"). Material and light language: subsurface scattering, rim light, ambient occlusion, volumetric light, specular highlights, global illumination, light depth of field. Stylised = exaggerated proportions (big head, big eyes, expressive hands); AAA = human proportions with an engine look. Motion can be cleaner and more readable. Avoid "photography", "filmed", "documentary" (pushes to live action).
- With a 2D start image, write "the style of the reference image, 2D animation", or H3 may translate it to 3D or realism between frames. Keep one style across start/end frames and every reference.

EXAMPLE (standard, 8 s, 16:9)
Real photography, live action. A dancer jumps and spins in a minimalist studio. First frame: she is already on the floor, knees bent, looking at camera. Static camera at 3 m, 29° portrait FOV, warm side light from camera left, exposed for the face. At 2 s she jumps, turns 360° with arms open and lands. Real weight on the landing, firm foot contact, her hair follows the spin. Audio: the dull thud of the landing and her breathing; non_diegetic_music: N/A. Real photography, natural skin texture.

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

PROMPT FORMAT (Higgsfield's production skill for H3, user-supplied 2026-10-01): one string with six labelled sections, in this order, always.
subject_definitions:<Picture 1> is [role: the creator / the character sheet / the storyboard, read in scene order]. <Picture 2> is [role: the exact product]. <Subject 1> is [the identity it defines: who she is, or the product's design system].
summary:reference generation — [the mode and the concrete result, one line].
retention_analysis:<Subject 1>: fully_preserved - [face, hair, build; or product shape, palette, materials, exact visible text]. <Picture 1>: partially_preserved - [what to take from it and what to exclude: sheet grid, borders, labels, background].
detailed_description:[One style sentence (real photography, live action… or the exact 2D/3D medium), full-screen aspect and the camera policy.][Shot 1] [Full-frame composition with the subjects already in place, one main change, the camera move with direction, amount and speed, and the visible end state.][Shot 2] At 00:02.000, [the next state and the causal transition].[… one entry per beat, timestamps rising inside the duration …][The exact final composition; the last reveal ends before the end and the full frame holds still until the close.][Speech, only when wanted, at the end of detailed_description with a stable speaker: (S1) says on camera, in Spanish: <d>[Spanish] ¿Buscas un parlante portátil?</d> plus one line describing S1's voice.]
overall_soundscape:[Concrete physical SFX and ambience only.]
non_diegetic_music:N/A (or the music, described, when the user wants it)

RULES FOR THE SECTIONS
- Shot 1 has no timestamp; later shots use "At 00:SS.mmm", rising. One action per beat: never stack camera moves or actions in one shot.
- References: <Picture N> in the order the refs are sent, each with its role in subject_definitions; a file without a role is ignored or misused. Up to 9 images, 3 videos, 3 audios (audio needs an image or video).
- Text: quote every visible word allowed, in its language, with position and treatment; no incidental text.
- Everything positive and renderable: the prompt describes what is seen and heard. Rules for you (which claims are allowed, what not to invent) never go in the prompt — apply them by what you write.
- Duration: whole seconds, 4–15. H3 cuts between shots by default; for one continuous take say so in the camera policy.

WHAT EACH SHOT CAN CARRY (from production practice)
- Blocking: measurable positions (less than a metre from X, screen left/right, foreground/midground/background); body orientation and gaze separately.
- Optics: diagonal FOV in degrees + distance (47° normal, 84° wide, 29° portrait, 18° tele).
- Light: main source + direction + camera side + exposure priority.
- Physics: the critical motion with weight, ground contact, cause → effect. Motion is H3's strength: time it ("at 2 s she jumps, turns 360° and lands").
- Start/end frames: describe the transition between them, not only the two ends.

STYLE: REALISTIC, 2D OR 3D
H3 leans strongly photoreal: style is declared, not hinted. Put it in the first sentence, repeat it once at the end as a quality suffix, and never mix two styles in one shot (realism wins and the result is a hybrid). A reference or start frame carries the style, but restate it in text or H3 will "realise" it.
- Realistic / live action: "real photography, live action, filmed with a real camera". Ask for natural imperfection: skin with pores, sweat, fine hair, wrinkles, worn fabric, dust in the air. Physical optics and light: FOV in degrees, depth of field, subtle film grain, motivated light (window, practicals), slight exposure imperfection. Real weight and contact. Avoid "render", "CGI", "3D", "cartoon", "illustration", "perfect / flawless" (plastic skin).
- 2D (anime, cel, vector, ink, watercolour): name the exact medium; describe the drawing, not the camera — line quality, cel shading in flat colour planes, limited palette, painted backgrounds, flat graphic shadows. Remove camera depth: "flat 2D, not photorealistic, no 3D render, no depth of field". Drawn physics: squash and stretch, speed lines, exaggeration; motion reads best in clear silhouettes and flat colour. Avoid "photorealistic", "PBR", "subsurface", "cinematic" (pulls to realism).
- 3D (stylised feature, AAA game cinematic, realistic PBR): declare the render ("stylised 3D render, feature-animation look" or "AAA game cinematic"). Material and light language: subsurface scattering, rim light, ambient occlusion, volumetric light, specular highlights, global illumination, light depth of field. Stylised = exaggerated proportions (big head, big eyes, expressive hands); AAA = human proportions with an engine look. Motion can be cleaner and more readable. Avoid "photography", "filmed", "documentary" (pushes to live action).
- With a 2D start image, write "the style of the reference image, 2D animation", or H3 may translate it to 3D or realism between frames. Keep one style across start/end frames and every reference.

EXAMPLE (UGC review, 5 s, 9:16, creator sheet + product photo; Higgsfield's corrected version of a real prompt)
subject_definitions:<Picture 1> is the streamer creator identity reference, read as a casting sheet only.<Picture 2> is the exact portable speaker product reference.<Subject 1> is the adult female streamer shown in <Picture 1>: identical face, hair, build and outfit.<Subject 2> is the portable speaker shown in <Picture 2>: identical body shape, top handle and front control panel.
summary:reference generation — one continuous 5-second vertical handheld UGC clip of the streamer presenting the portable speaker on camera.
retention_analysis:<Subject 1>: fully_preserved - face identity, hair, skin tone, outfit, on-camera energy.<Subject 2>: fully_preserved - body silhouette, top handle, front control panel layout, visible controls, colour.<Picture 1>: partially_preserved - take identity only; exclude sheet grid, borders, panel labels and studio background.<Picture 2>: partially_preserved - take product geometry only; exclude its background and any printed text.
detailed_description:Vertical 9:16 full-screen handheld smartphone UGC, medium close-up, lived-in home streaming corner, natural window light, warm neutral grade, no on-screen text or logos.[Shot 1] Full-frame medium close-up of <Subject 1> seated at a desk with a softly blurred streamer setup behind; she raises <Subject 2> into frame at shoulder height and tilts it so the top handle and front control panel face the lens; a slow, small handheld drift right (about 5% of frame, gentle speed) reveals the panel; she settles the speaker and looks to camera; ends holding both the speaker and her gaze, smiling.[Final] The reveal ends at 00:04.500; hold the complete final frame from 00:04.500 to 00:05.000 with no camera, gesture, lighting or fade movement.(S1) says on camera, in Spanish, at a natural conversational pace: <d>[Spanish] Mira este parlante portátil: tiene asa y controles al frente. ¿Qué te parece?</d>S1 is an adult woman, warm conversational Spanish, slight smile, close-mic smartphone-adjacent quality. No other speech, no added text.
overall_soundscape:Quiet room tone with faint keyboard ambience, soft fabric rustle as the speaker is lifted, a light settle as it lands in her hand.
non_diegetic_music:N/A
- A longer cut (10 s) keeps the six sections: scale the timeline (At 00:0X.000), add a real second beat (e.g. a push-in on the front panel at 00:05.000), end the last reveal at 00:09.100 and hold to 00:10.000. It is a new generation, not an extension: say so to the user.
- Camera as a spec, not a vibe: direction, amount (% of frame) and speed. Speech: (S1) says…: <d>[Language] …</d> plus one line describing S1's voice.

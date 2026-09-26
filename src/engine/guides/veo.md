Veo 3.1 (Google) — prompting guide
Source: production practice supplied by the user (2026-09-26), adapted to Atlas Cloud / fal / NanoGPT; variants, durations, references and audio checked against the Atlas and fal schemas (2026-09-25).

CONTRACT ON OUR PROVIDERS (the app reads it from each variant's schema)
- Variants: Veo 3.1 (highest quality), Fast, Lite. Routes: text-to-video, image-to-video, first + last frame (continuous transitions), reference-to-video (1–3 images for consistent subjects), and extend (fal; the app's Extend video operation).
- Duration 4 / 6 / 8 s; reference-to-video is always 8 s. Never ask for more: longer pieces are chained (extend, or first/last frames between clips).
- Aspect 16:9 or 9:16. Resolution up to 4K: medium by default, higher only if the user asks.
- Audio is generated in the same pass as the image when the variant's audio switch is on (on by default on fal, off by default on Atlas). With audio on, always write the audio section.
- Strict moderation: no NSFW, close watch on real people and copyrighted characters. With a sensitive subject, warn the user before the plan: the job can come back blocked.
- Strong at character consistency across scenes and at frame-to-frame transitions; Veo is photoreal by default.

HOW TO WRITE IT
- Not like the "cinematic" block prompts of Seedance: one descriptive paragraph in natural language, present tense, 3–6 dense sentences — not a wall of text.
- Order: 1) subject + action; 2) scene (place, time, atmosphere); 3) camera (shot size, height, movement); 4) light (main source + direction); 5) style / look; 6) audio — dialogue in double quotes with speaker and tone, plus SFX and ambience.
- Positive sentences, no "NO…" block. The schema has a negative_prompt field; use it only for a clear exclusion the user asked for.
- One camera move; no contradictory moves. Measurable positions, light and action instead of vague descriptions ("a pretty girl in the street").
- One scene per clip: several scenes in 8 s fail — use cuts with first/last frames.
Template: [Shot and camera]. [Subject] [concrete action] in [setting] at [time of day]. [Relevant wardrobe or object detail]. Lighting: [source + direction]. Style: [medium], [optics / look], [palette]. Audio: [ambience / SFX]. [Speaker] says in a [tone] voice: "line".
Example (8 s, 16:9): Medium shot, camera at eye level with a slight lateral track. A barista in her thirties, green apron stained with coffee, sets a cup on the wooden counter of a neighbourhood café at sunset. Steam rises from the cup. Lighting: warm window light from behind, soft backlight on her hair. Style: cinematic realism, 35 mm, fine grain, amber and green palette. Audio: café murmur and the espresso machine's steam; the barista smiles and says warmly: "Here you go, freshly made."

MOST COMMON MISTAKES
Asking for 10–15 s (8 s is the maximum); no audio section with audio on (it invents generic dialogue and SFX); several scenes in one clip; vague descriptions.

STYLE: PHOTOREAL, 2D OR 3D
Veo is photoreal by default (trained on real footage): photoreal is almost free, 3D needs pushing, and 2D slips toward realism unless it is locked.
- For all three: declare the medium in the first sentence and repeat it at the end ("Style: …") — Veo drifts to photorealism as the clip goes on and the closing line fixes it again. Positive phrasing ("hand-painted surfaces, no specular highlights" rather than "not photoreal"). Keep other media's words out: "cinematic", "realistic", "4K footage", "photograph" pull 2D and 3D toward a photo. A reference image in the target look does more than ten adjectives (reference-to-video takes 1–3 images; one can carry the look). Ask for stylised audio in 2D/3D (cartoon orchestra, cartoon SFX), or it adds documentary sound.
- Photoreal (its home): do not overload it — stacking "cinematic, masterpiece, 8K, hyperdetailed" pushes the grade to plastic. Real camera + real light + real imperfections: a lens (35 mm, 50 mm, tele), a concrete light source and its direction, depth of field, fine grain, physical camera movement (tracking, soft handheld), skin texture, dust in the air, slight motion blur.
  Example: Medium shot on a 50 mm, camera at chest height, soft handheld. An old woman waters geraniums on a balcony at sunset; dust hangs in the warm backlight. Style: realistic, fine grain, amber and blue palette. Audio: distant traffic, falling water; she hums.
- 2D (the hardest): fix the medium and remove the third dimension. Name the technique, not just "2D": traditional hand-drawn animation, cel animation, animated watercolour, flat vector, ink and line. Visible ink lines, flat colours, block shading, painted background, animated on twos (12 fps), no background blur, paper texture. Say "no depth of field, no photographic textures" and keep the camera flat (lateral pans, not 3D orbits — an orbit gives the render away).
  Example: Traditional hand-drawn 2D animation, ink lines and flat colours. A small fox jumps onto a rock while the rain falls; watercolour-painted background, no blur. Slow lateral pan, flat camera. Style: cel animation, animated on twos, ochre and blue-grey palette. Audio: light strings and stylised rain.
- 3D: it renders well but drifts to "realistic render" unless the finish is defined. Pick one family and stay in it: stylised feature-animation 3D, realistic game cinematic, clay / stop-motion. Soft global illumination, rim light, subsurface scattering on skin, matte plastic or clay materials, ambient occlusion, hair and cloth simulation, subtle depth of field. Say "non-photographic textures" or it turns into a real image; describe motion with weight and contact (that sells the 3D).
  Example: Stylised feature-animation 3D render, matte materials and non-photographic textures. A small round robot rolls across a toy kitchen; soft global illumination with rim light. The camera drops to floor level and follows it. Style: cartoon 3D, clay and matte plastic, subtle depth of field. Audio: light metallic steps and playful music.

WHEN TO PICK ANOTHER MODEL
Veo wins at photoreal and at character consistency across scenes. When an animated look (2D or 3D) is the deliverable and the animation is the hard part, MiniMax H3 holds style and motion better.

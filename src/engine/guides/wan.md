Wan 3.0 / Wan 3.0 Prime (Alibaba) — prompting guide
Source: high-end production practice supplied by the user (2026-09-26), adapted to Atlas Cloud / fal / NanoGPT; limits and syntax checked against the Atlas and fal schemas.

WAN 3.0 vs PRIME
- Same public contract: same parameters, reference limits, resolutions, durations and modes. The prompt that works on one works identically on the other.
- Prime is the premium route and costs more (Atlas base price about 1.5× per second: 0.061 vs 0.04 USD). It adds no capability. Use Wan 3.0 unless the user asks for Prime.

PICK THE MODE FIRST (they are exclusive)
- Frame pinning: start frame (+ optional end frame, which needs the start frame). Cannot be combined with reference media. The frame already decides the look: write motion and camera, never describe the image again.
- Reference-to-video: up to 10 images, 5 videos (at least 16 fps, 15 s combined) and 5 audios.
- Pure text-to-video.

HOW TO CITE REFERENCES (Wan is NOT Seedance)
- Positional words without "@": Image 1, Image 2, Video 1, Audio 1, in the order the refs are sent ("the subject in Image 1 walks past Video 1"; "Image 1 is the character; do not use its background"; "the camera move of Video 1").
- Bind each reference to a named role once, then reuse the role name.

STRUCTURE (the order of a cinematic brief)
1. Scene context — 1–2 sentences, only what happens in this shot.
2. First frame — the first visible frame already has the subjects in place (no empty establishing frame).
3. Blocking — measurable positions (1 m from X, screen left/right, foreground/midground/background); body orientation and gaze direction stated separately.
4. Optics — diagonal field of view in degrees + camera distance + the visible result (47° normal, 84° wide, 29° portrait, 18° tele).
5. Camera — height, distance, side and movement, as the physical behaviour of an operator. One main move per shot.
6. Lighting — main source + direction + camera side + exposure priority ("key from the window on the left, soft backlight, exposed for the face").
7. Physics — motion with weight, ground contact, cause and effect.
8. Audio — ambience or the exact line. Lips move only with scripted dialogue. Audio is on by default: if you do not describe it, the model improvises and may clash with the look.

STYLE: REALISTIC, 2D OR 3D
- The reference decides the style first; text is the second lever. For an exact look, pass an image or clip of that look as a reference and let the prompt only nuance it.
- Commit to the medium in the first sentence and use one medium's vocabulary only. Never mix registers ("anime 3D photorealistic" averages into a muddy hybrid). The style goes in the scene context, not as a tail of keywords.
- Realistic (easiest to break): write like a shoot — "real photography, filmed with a camera", physical camera and FOV in degrees, depth of field, subtle grain, practical light with a concrete source and direction, skin with pores and imperfections, handheld micro-movement, real physics. Audio: natural ambience and foley. Avoid "3D render", "artstation", "octane", "cinematic CGI".
- 2D: name the medium (hand-drawn, cel-shaded, flat vector, ink, anime, watercolour); clean line contours, flat colours without volumetric shading, no photographic depth of field. Ask for limited-animation motion ("animated at ~12 fps", snappy, squash-and-stretch) or the model adds photographic camera and physics and breaks the look. Audio: light cartoon music, exaggerated SFX. Avoid "photorealistic", "8k", "lens", "depth of field".
- 3D: name the sub-style (stylised feature animation, realistic game CGI, claymation, stop-motion look) because each implies different materials. Name materials (subsurface scattering on skin, matte clay, plastic, metal) and lighting as a rig (3-point, soft HDRI). Keyframed, clean, fluid camera — not handheld. Audio: light orchestral score, cartoon foley. Avoid "filmed with a real camera", "grain", "photojournalism".
- Series: repeat the same style sentence word for word in every clip of a sequence, or the look drifts.
- Visual and sound world must match: realistic → ambience and foley; stylised 2D/3D → stylised music and SFX.

PARAMETERS (set by the app, not written in the prompt)
- Duration 2–30 s, or automatic (the model picks). Ask for the exact length needed: cost is per second.
- Resolution 480p / 720p / 1080p: medium by default; 1080p only if the user asks.
- Prompt length limit comes from each provider's schema (Atlas and fal: 20 000 characters). Shorter is usually better: 1–3 sentences per shot.
- enable_thinking (reasoning before generating): off by default. Atlas documents it as needed for document or webpage input and not recommended otherwise; it adds latency. Suggest it only when the user wants maximum adherence on a very dense prompt.

TEMPLATE (16:9, 720p)
[Context] An X-second shot where [concrete action].
[First frame] In the first frame, [subject] is already at [position], [visible detail].
[Blocking] [Subject A] screen left, about 1 m from [subject B], body in profile, eyes to camera.
[Optics] 47° diagonal FOV (normal), camera at 2 m, mid-shot.
[Camera] Chest height, slow push in.
[Lighting] Key from the window on the left, soft backlight, exposed for the face.
[Physics] [Action] with weight and real contact.
[Audio] Ambience of [place]; "[line]" spoken by [character].

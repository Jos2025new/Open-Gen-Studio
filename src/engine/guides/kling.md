Kling 3.0 (Kuaishou) — prompting guide
Source: production practice supplied by the user (2026-09-26), adapted to Atlas Cloud / fal / NanoGPT; tiers, limits, sound and multi-shot checked against the Atlas and fal schemas (2026-09-25). Covers Kling V3; Kling O3 (Omni) is a separate family.

CONTRACT ON OUR PROVIDERS
- Tiers: std (iterate, drafts), pro (quality), 4K (final delivery, only if the user asks), turbo. Cost rises per tier.
- Duration 3–15 s (integer). Aspect only 16:9, 9:16 or 1:1. Prompt at most 2 500 characters (longer fails).
- Sound on by default; turning it off also lowers the cost. On fal the voice is Chinese or English; other languages are translated to English.
- Multi-shot is structured, not written in the text: plan steps carry `shots` [{prompt, duration}] whose seconds add up to the clip duration (the app sends Kling's multi_prompt; on fal a single prompt and shots cannot go together). The whole storyboard is ONE clip.
- A character saved in the library is mentioned as @Name and the app sends it as a Kling element (saving is the user's call). Otherwise the attached image goes in refs; keep the same image across clips, a different photo each time makes identity drift.
- Strict moderation: no NSFW, no recognisable IP; the safest shot is one that does not depend on a famous face.

PROMPT STRUCTURE
Structured and concise, not a list of loose words. Fixed order, each sentence solving one thing:
1. Subject + action — who, and what they do, with a concrete motion verb.
2. Scene — where, time of day, minimal context.
3. Camera — shot type and move in film vocabulary ("medium shot", "handheld", "slow dolly-in", "whip pan", "crane reveal"); Kling understands the terms better than long descriptions.
4. Lighting — source, direction and tint ("side window light, soft contrast, warm tones").
5. Style / optics — look and texture ("photoreal, 35 mm grain, shallow depth of field").
6. Audio — ambience, SFX and above all the exact dialogue.
Example (one shot, 16:9, sound on): Medium shot of a woman sitting in a café by the window, sipping slowly and looking out at the street. Café interior in the afternoon. Handheld camera at chest height, slight dolly-in. Side window light, soft contrast, warm tones. Photoreal, shallow depth of field. Audio: background murmur, clinking cups. She says: "I think I've decided."

AUDIO AND DIALOGUE
- Several characters: name the speaker and give approximate times ("At 0s, Ana (left) says: '…'. At 3s, Marcos (right) answers: '…'."). Kling places each voice on its character — its distinctive strength.
- Short lines: lip-sync degrades with long paragraphs.

MULTI-SHOT (where Kling 3.0 stands out)
Per shot, give its framing and one camera move; each shot's prompt follows the structure above. Example shots for 10 s: (1) extreme wide of the city at dawn, static camera, 3 s; (2) close-up of her eyes opening, slow dolly-in, 3 s; (3) medium shot of her getting out of bed, gentle low angle, 4 s.

PRACTICAL RULES
- Positive states instead of a block of "don't"s. The schema has a negative_prompt field; use it only for a clear exclusion the user asked for.
- Measurable: "a metre from the table", "framed on the left of frame", not "near" or "to one side".
- One movement idea per shot: three stacked camera moves average into a dead shot.

STYLE: PHOTOREAL, 2D OR 3D
The difference is which vocabulary rules: photoreal describes a real camera; 2D a drawing inside a moving frame; 3D a render engine and a rig. Mixing them gives a filter-like hybrid.
- Master rule: photoreal is assumed (spend words on optics, light and physics); 2D and 3D must be declared explicitly and early — one anchor sentence first — or Kling falls back to photoreal however much you write "drawing". Then each shot continues with its framing, camera and action; in 2D and 3D repeat the character anchor (design, colours) where it drifts most, in shots with the face visible.
- Camera: photoreal — lens and physical move ("47° FOV, 35 mm, dolly-in at 0.6 m/s, shallow depth of field, soft bokeh, motion blur, film grain, halation"); 2D — a frame, not a lens ("lateral pan, slow zoom, multi-layer parallax / multiplane, tracking"), no depth of field, bokeh or optical blur; 3D — virtual camera and engine ("orbiting camera, ray tracing, ambient occlusion, some render depth of field").
- Motion: photoreal — real physics (weight, gravity, ground contact, inertia, cloth and hair); 2D — animation physics (squash and stretch, anticipation, exaggeration, snappy timing, smears); 3D — rigged motion (weight, but stylised arcs, follow-through, secondary action on props).
- Light: photoreal — motivated, with a source ("side window light, realistic falloff, soft contrast, warm tones"); 2D — graphic ("two-band cel shading, hard-edged shadows, flat colours, clean outline"); 3D — three-point plus soft GI ("warm key, saturated rim, soft global illumination").
- Surfaces: photoreal — stock, sensor, grain, real skin, worn metal; 2D — line weight, flat colour with outline, no gradients, closed palette (4–6 colours), a named reference style (anime, illustration, watercolour); 3D — PBR, subsurface on skin, specular, stylised feature-animation or realistic game-cinematic materials.
- Identity: photoreal drifts little (fix it with a reference image or a subject); 2D drifts a lot and off-model shows — fix the design in the prompt (hair shape, eye style, exact clothing colours) and repeat the anchor; 3D — fix the render style and the character design as in 2D.
- Audio: photoreal asks for real foley; 2D and 3D accept stylised SFX (whooshes, boings, cartoon impacts).
- What to remove: in 2D — "film grain", "bokeh", "35 mm", "photoreal" (they push to photo); in photoreal — "cel shaded", "flat colours", "outline" (collapses to a webcam-filter look); in stylised 3D — "film stock" and "anime line art" (pick one pipeline). One style descriptor per generation: two styles ("photoreal 3D anime") is the number-one failure.
- Short anchors: photoreal — "Photoreal, fine 35 mm grain, shallow depth of field, motivated light." 2D — "Traditional 2D animation, anime style, flat colours with clean outline, two-tone cel shading, 12 fps look." 3D — "Stylised 3D animated-feature look, soft materials, saturated rim light, clean render."

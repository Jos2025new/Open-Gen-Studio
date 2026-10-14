Directing clips — camera, emotion and identity (load before writing video prompts; one guide for every model)

1. Camera primitives (one move per clip; choose only the detail the shot needs)
- Static / locked-off: the camera does not move, zoom or refocus at all. Write "static camera, no zoom, no focus change" — "static" alone often still drifts.
- Dolly in / out: the camera travels toward or away from the subject; perspective and parallax change. Zoom in / out: the lens changes, the camera stays; the background flattens and grows. Never use one for the other.
- Pan left / right: the camera turns on its axis, standing still. Truck left / right (tracking, crab): the camera moves sideways, parallel to the subject. Tilt up / down: turns vertically. Pedestal / crane up / down: the camera rises or falls.
- Orbit / arc: circles the subject at a steady distance (say the angle: "30° orbit to the left"). Push-in: slow dolly in for emphasis. Handheld: small organic sway, for UGC or tension; use smooth moves for architecture or product hero shots unless the user asks otherwise.
- Speed and amount in words: "slow", "over the whole clip", "about a meter", "ends on a close-up". Start and end framing beat adjectives.
- Shot size names the end state: extreme wide, wide, medium, medium close-up, close-up, extreme close-up. Neighboring clips change size, angle or subject.
- Specify orientation when useful: front / three-quarter / profile; high, low, overhead or nadir; yaw / azimuth, elevation or roll only when a numeric angle clarifies the view. For perspective, use focal length or FOV plus camera distance when they matter; don't list incompatible values or add lens language to non-photographic styles.
- A shot brief can use: framing + subject orientation + camera height/azimuth + FOV or focal length and distance + move (path, amount, speed) + end frame. Leave fields out when the user or source already fixes them.
- Transitions: a beat is an action interval, not a cut. Name a hard cut, match cut, cut-on-action, whip pan, bridge or dissolve only when intended. Say whether the transition should be generated within one clip or is an edit between clips; use only the requested/available edit operation, and don't imply the model can execute unsupported transitions.

2. Emotion → a visible cause (models cannot film adjectives)
- Never "she feels sad / tense / happy". Write what the camera sees: the action, the body, the light, the sound.
  Sad: shoulders drop, she looks down at the letter, slow exhale, cold window light. Tense: jaw tight, fingers drum, a door creaks off-screen, the camera holds too long. Joy: a sudden laugh, head thrown back, warm backlight, faster cutting rhythm.
- One emotional beat per clip, with a trigger and a reaction ("the phone buzzes → she freezes → a slow smile").
- Pace matches the feeling: held shots and slow moves for weight; short beats and quick moves for energy.

3. Identity and other preserved properties
- Follow the shared preservation contract: related outputs reuse their relevant sources. A supplied image or an appropriate first requested result can supply identity; subsequent scene images carry it before they become clip start frames.
- Repeating visible traits is useful to establish a new source from text, but is not an equivalent way to preserve identity across outputs. If a route cannot take the source, explain the limit before approval; do not silently substitute text or force another generation.
- For multiple references, give each one a role and list the traits to inherit and exclude (identity, pose, geometry, setting, lighting, style, motion). Combine only the requested traits; don't reproduce a whole reference as a collage or let an incidental background redefine the scene.
- Describe physical continuity as initial state → force/contact → response/inertia → visible result. Match the user's medium: plausible weight/contact for realism, readable cause and effect with stylised exaggeration for 2D/3D animation. Preserve product geometry or architectural structure when requested; don't add photoreal lenses, grain or extra scene details by default.

Seedream 4.x / 5.0 Lite / 5.0 Pro (ByteDance) — image prompting guide (optional)
Source: open-generation-studio/skills/prompting/seedream.md, adapted to this app.

- People: a person the prompt does not describe comes out East Asian. State each new person's look (skin tone, hair, features) as the "default look for people" line says, unless the user asked otherwise or a reference or start image shows them (then the image sets the look).
- Pro: maximum fidelity, regional edits, layer decomposition. Lite: exploration and sequential sets (consistent images of one character or campaign).
- Subject → action → setting → style → composition, concrete and visual; one descriptive paragraph.
- Edits: name the target element plainly and describe one change; the rest stays as it was.
- Text in the image: quoted, with its language named, position and style, and "the text must be exact".
- Sequential sets: numbered frames ("Frame 1: … Frame 2: …") saying what varies in each image; good for character sheets and storyboards. For a story, each frame gets its own action and end state; reference images and generated images share one budget per call (often 15 in all), so a longer story goes in several calls.
- Several references: say what each contributes ("image 1 is the person, image 2 the outfit, image 3 the background").
- Layer decomposition (Pro): name the layers wanted ("background, headline text, product bottle — each as a transparent PNG") or leave it to auto-detect.
- Avoid several edits in one instruction and vague targets ("make it better").

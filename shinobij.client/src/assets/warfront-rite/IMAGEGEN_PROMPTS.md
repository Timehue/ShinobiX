# Hollow Warfront AAA art pass

Mode: built-in image generation. Existing `warfront-rite-keyart.webp` was supplied only as a visual style, material, and palette reference.

## Arena plate

Project asset: `warfront-rite-arena-aaa.webp`

Runtime stage derivative: `warfront-rite-arena-stage-aaa.webp`. This preserves the generated plate unchanged while converting only the pure-black exterior pixels to real alpha, so the 3D arena has an octagonal silhouette instead of a rectangular image plane.

Source output: `exec-afbf91c5-17ab-4829-9a17-5d71c58b603a.png`

Prompt:

> Use case: stylized-concept
> Asset type: premium game arena floor texture / battlefield plate
> Input image: use the supplied Hollow Warfront key art only as the palette, material, and rendering-style reference.
> Primary request: create a new elongated octagonal ritual battlefield surface for eight stylized 3D companion creatures. The surface is carved black basalt and cracked obsidian with sophisticated inlaid metal, subtle cyan energy on the left half and restrained crimson energy on the right half. Three broad horizontal tactical routes must be readable through material variation, not cheap neon stripes. Include a central ritual seal and two small midfield ward plinths, but keep the playable surface spacious and uncluttered.
> Style/medium: AAA-quality stylized anime-fantasy game environment texture, hand-painted PBR-inspired material detail, premium action-RPG art direction.
> Composition/framing: strict top-down orthographic view, centered wide octagonal plate, symmetric competitive layout, generous clean space for eight 3D models and combat VFX; the full arena must fit inside the image with dark transparent-looking void outside its silhouette.
> Lighting/mood: low baked light, cool moonlit cyan and ember-crimson edge accents, subtle gold/brass ritual details; readable without overpowering live 3D lighting.
> Constraints: no characters, pets, creatures, UI, labels, letters, numbers, logos, watermarks, towers, or scenery above the floor; no perspective tilt; no circular tiny duel ring; avoid bright continuous lane lines and avoid visual clutter.

## Ritual sanctum

Project asset: `warfront-rite-sanctum-aaa.webp`

Source output: `exec-8b0bdd2c-aeab-421b-be86-d3843db32ffa.png`

Prompt:

> Use case: stylized-concept
> Asset type: Hollow Warfront deployment-menu background and battle-stage environment matte
> Input image: use the supplied Hollow Warfront key art only as the palette, material, atmosphere, and rendering-style reference.
> Primary request: create a premium empty ritual amphitheater carved into a vast dark cavern, built around an obsidian companion-beast war arena. Ancient beast guardian statues and fractured basalt arches frame the extreme left and right edges; cyan spirit-fire burns on the left, restrained crimson embers burn on the right, and small warm brass lanterns lead toward the center. The center must remain dark, spacious, and calm so a deployment UI panel or live 3D models can sit over it.
> Style/medium: AAA-quality stylized anime-fantasy action-RPG environment concept art, painterly realism, rich material detail, cinematic production art.
> Composition/framing: very wide landscape establishing shot, symmetrical competitive framing, low three-quarter eye-level from just above arena height; strong dark negative space across the middle 55%; important art confined to the side edges and upper perimeter; safe for desktop and portrait center crop.
> Lighting/mood: cavernous teal haze, subtle volumetric god rays, cyan versus crimson rim light, restrained gold highlights, deep blacks but readable stone detail, ominous ceremonial grandeur.
> Constraints: empty arena, no characters, pets, creatures, UI, text, letters, numbers, logos, or watermark; no bright center focal object; no modern technology; no busy details beneath the future UI panel.

## Impact crest

Project asset: `warfront-rite-impact-crest-aaa.png`

Source output: `exec-b2ddb9de-c891-4f3f-9835-371104106b17.png`

Prompt:

> Use case: stylized-concept
> Asset type: production game VFX sprite with real alpha transparency
> Primary request: a single centered radial magical impact crest made from a sharp eight-point white energy star, two broken circular brushstroke arcs, a few small angular sparks, and faint smoke wisps. Painterly anime-fantasy action-RPG effect, crisp luminous core with soft falloff, designed to be color-tinted in a 3D engine.
> Composition/framing: one effect only on a square canvas, centered, generous empty padding, all particles fully inside the frame, partially hollow center.
> Color palette: pure white and very pale neutral cyan only; no gray field.
> Transparency requirement: output RGBA with a genuinely transparent alpha background. Transparent pixels must have zero alpha. Do not draw or simulate a checkerboard, paper, white square, black square, colored backdrop, border, preview card, or mockup.
> Constraints: no text, letters, numbers, logos, watermark, characters, creatures, UI, or extra sprites.

The first impact-crest generation was rejected because it baked a checkerboard into an RGB image instead of producing real alpha. The accepted source above was validated as RGBA before conversion to the 512x512 project sprite.

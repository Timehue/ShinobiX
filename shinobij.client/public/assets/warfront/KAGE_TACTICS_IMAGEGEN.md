# Beastbound Warfront temple-court environment

Generated with the built-in OpenAI image generation tool. The landscape and
portrait files are responsive CSS environment layers; live Canvas2D/Three.js
geometry remains authoritative for actor roots, cover, bases, and occlusion.

## Landscape prompt

```text
Use case: stylized-concept
Asset type: production game environment background for a premium shinobi pet auto-battler, desktop landscape
Primary request: original moonlit shinobi temple rooftop courtyard built around a large readable tactical battle floor, suitable to sit behind live 2D/3D pet actors at actual gameplay scale
Scene/backdrop: elevated mountain temple roofs and courtyard terraces under a full moon, deep roof silhouettes, drifting low mist, weathered shrine architecture, layered eaves, torii gates, paper lanterns and distant pines
Subject: the environment only; a broad central octagonal/rectangular slate courtyard viewed from an elevated three-quarter top-down tactical camera, with subtle geometric lane seams and a neutral gold circular seal exactly at center; low-frequency playable floor stays clear while visual richness lives around the perimeter
Style/medium: high-end stylized-realistic shipped game environment key art, physically believable stone, slate, lacquered timber and rice-paper lantern materials, cinematic but gameplay-readable, cohesive premium auto-battler arena
Composition/framing: 16:9-ish wide landscape, elevated three-quarter top-down camera; central battle floor fills roughly 58% of image width and 60% of image height; long battle axis runs bottom-left to top-right; generous dark safe gutters at top and bottom for HUD; symmetrical-enough tactical readability without looking sterile; foreground roof ledges softly frame lower corners; nothing important at extreme edges
Lighting/mood: cool moonlight and wet-slate highlights, warm lantern pools, atmospheric depth; cyan Azure accent illumination confined to left/top perimeter and restrained vermilion Crimson accent illumination confined to right/bottom perimeter; center remains neutral warm gold and charcoal; strong silhouette separation but no bright VFX
Color palette: deep ink navy, charcoal slate, muted lacquer brown, parchment amber, restrained cyan and vermilion, neutral antique gold
Materials/textures: irregular weathered slate pavers, rain-darkened stone, lacquered timber grain, oxidized bronze fittings, aged plaster, soft mist
Constraints: environment only; NO pets, humans, characters, creatures, weapons, projectiles, combat effects, UI, text, labels, logos, symbols resembling real-world trademarks, or watermark; no baked units; no bright debug grid; no glowing chessboard; keep the central combat floor calm and low-frequency; torii and architecture stay at the perimeter and do not obstruct the playable floor; believable scale for small pet combatants; original fictional shinobi setting
Avoid: generic fantasy valley panorama, empty black rectangle, flat primitive tiles, front-facing cinematic vista, isometric miniature diorama, neon cyberpunk, overly saturated red/blue split, dense clutter across the playable center, giant foreground props, shallow side view
```

## Portrait prompt

```text
Use case: stylized-concept
Asset type: responsive portrait/phone-safe production game environment background for the same premium shinobi pet auto-battler
Input images: Image 1 is the approved landscape style and material reference only; create a new portrait composition rather than cropping it
Primary request: create the matching moonlit shinobi temple rooftop courtyard with a tall readable tactical battle floor for portrait phones
Scene/backdrop: same fictional mountain shrine complex, weathered slate, lacquered timber, torii, warm paper lanterns, layered roof silhouettes and mist
Subject: environment only; a broad central battle floor viewed from an elevated three-quarter top-down tactical camera, with the long battle axis running vertically from lower foreground to upper background and a neutral antique-gold circular seal exactly at center
Style/medium: match Image 1's high-end stylized-realistic shipped game environment quality, material response, palette, lighting and architectural language
Composition/framing: portrait 9:16; central playable floor fills roughly 78% of image width and 62% of image height; leave clear dark safe gutters across the top 14% and bottom 18% for HUD; perimeter richness hugs the left/right edges; keep the center calm and low-frequency; distant main temple above the board, soft roof ledges below; cyan Azure torii/lantern cues at upper-left perimeter and restrained vermilion Crimson cues at lower-right perimeter; nothing essential may be cut off by a narrow phone viewport
Lighting/mood: cool moonlight on rain-darkened slate, warm lantern pools, atmospheric mist and depth, center neutral charcoal/gold
Materials/textures: irregular weathered slate pavers, damp stone specular response, lacquered timber grain, oxidized bronze, aged plaster and rice paper
Constraints: environment only; NO pets, humans, characters, creatures, weapons, projectiles, combat effects, UI, text, labels, logos, watermarks, or baked units; no bright debug grid; no glowing chessboard; torii and architecture remain outside the playable floor; readable scale for small pet fighters; preserve the same fictional setting and premium finish as Image 1
Avoid: simply rotating or stretching Image 1, landscape crop, generic valley panorama, flat primitive arena, isometric miniature, neon cyberpunk, saturated red/blue split, clutter over the combat center, giant foreground props, side-on perspective
```

## Slate material prompt

```text
Use case: stylized-concept
Asset type: seamless tileable game texture for the live floor of a premium shinobi temple auto-battler arena
Primary request: weathered rain-darkened charcoal slate courtyard paving seen perfectly orthographic from directly overhead
Scene/backdrop: only the stone surface, evenly covering the entire square
Subject: broad irregular hand-cut slate pavers with subtle staggered joints, chipped edges, faint mineral veins, tiny moss traces in occasional seams and restrained damp specular variation
Style/medium: high-end stylized-realistic PBR-friendly game texture, premium shipped environment material, grounded and understated
Composition/framing: square, perfectly top-down orthographic; seamless on all four edges; large low-frequency stones sized for small pet combatants; no perspective, no vignette, no central focal point
Lighting/mood: neutral diffuse moonlit material reference, very soft even lighting, no cast shadows, no directional hotspot
Color palette: mid-dark blue-charcoal, muted graphite, slight cool gray and sparse desaturated moss
Materials/textures: worn slate, subtle damp sheen, shallow grout, believable micro-chipping
Constraints: texture only; seamless repeating edges; NO characters, pets, creatures, objects, lanterns, buildings, symbols, seals, runes, grid overlay, UI, text, logos, watermark, baked lighting, strong cracks, or deep holes; maintain low contrast so live actors remain focal
Avoid: black void, glossy marble, cobblestone circles, checkerboard, bright seams, obvious square debug grid, perspective view, dramatic light, clutter
```

## Shipping files

- `kage-tactics-temple-court-v2-landscape.webp` — 1280 × 720, WebP quality 70
- `kage-tactics-temple-court-v2-portrait.webp` — 720 × 1600, WebP quality 70
- `kage-tactics-slate-v1.webp` — 512 × 512, WebP quality 72

## V3 material-cohesion edit

The v3 plates were edited from the corresponding v2 plates with the built-in
OpenAI image generation tool on 2026-09-03. This was a style/material edit:
the camera, court footprint, center seal, lighting split, open gameplay area,
and architecture were supplied as locked invariants. The untouched v2 files
remain beside them. Raw built-in outputs are retained under
`artifacts/kage-arena-environment/round6-imagegen-sources/`.

### V3 landscape edit prompt

```text
Use case: style-transfer
Asset type: production gameplay arena environment plate, landscape 16:9
Input images: Image 1 is the sole edit target.
Primary request: Change only the rendering and material treatment of Image 1 into a premium stylized 3D / painterly game environment that visually belongs with clean, flatter stylized creature models. Keep it sophisticated and shipped-quality, with broad readable planes and deliberate hand-painted gradients.
Composition/framing invariants: Preserve the exact existing elevated three-quarter top-down camera, horizon, crop, octagonal court footprint, central medallion position and scale, open-floor negative space, stairs, roof silhouettes, shrine architecture, torii, lantern positions, railings, and every major edge. Do not move, add, remove, resize, or redesign any architecture or geometry.
Lighting/mood: Preserve the moonlit night and the exact cyan/azure left-side and restrained vermilion/red right-side gameplay lighting split. Compress highlights and shadows gently, soften atmospheric depth, use selective cool edge lighting, and keep pets readable against the floor.
Materials/textures: Simplify the slate into broader hand-painted stone planes; reduce tile-by-tile crack noise, wet sparkle, and peripheral microcontrast while retaining enough controlled surface variation, court boundary seams, and the neutral gold medallion to read clearly. Use slightly cool, outline-friendly color grouping and soft material transitions. Do not blur into mud.
Constraints: style/material edit only; preserve exact perspective and geometry; no text, UI, logos, watermarks, characters, animals, pets, combat units, VFX, new props, clutter, blockers, walls, platforms, pedestals, pads, rings, decals, glyphs, objective objects, or overlays. No baked gameplay elements.
```

Built-in output:
`C:\Users\Tyler R\.codex\generated_images\01a06665-f4c6-7ac2-8b7f-1226c3c26a70\exec-84e6dbf0-2a88-4570-95d7-b312896d9495.png`.

### V3 portrait edit prompt

```text
Use case: style-transfer
Asset type: production gameplay arena environment plate, portrait phone-safe
Input images: Image 1 is the sole edit target.
Primary request: Change only the rendering and material treatment of Image 1 into a premium stylized 3D / painterly game environment that visually belongs with clean, flatter stylized creature models. Keep it sophisticated and shipped-quality, with broad readable planes and deliberate hand-painted gradients.
Composition/framing invariants: Preserve the exact existing portrait elevated three-quarter top-down camera, full vertical crop, octagonal court footprint, central medallion position and scale, open-floor negative space, stairs, roof silhouettes, shrine architecture, torii, lantern positions, railings, and every major edge. Do not move, add, remove, resize, or redesign any architecture or geometry.
Lighting/mood: Preserve the moonlit night and the exact cyan/azure left-side and restrained vermilion/red right-side gameplay lighting split. Compress highlights and shadows gently, soften atmospheric depth, use selective cool edge lighting, and keep pets readable against the floor.
Materials/textures: Simplify the slate into broader hand-painted stone planes; reduce tile-by-tile crack noise, wet sparkle, and peripheral microcontrast while retaining enough controlled surface variation, court boundary seams, and the neutral gold medallion to read clearly. Use slightly cool, outline-friendly color grouping and soft material transitions. Do not blur into mud.
Constraints: style/material edit only; preserve exact perspective, geometry, and phone-safe framing; no text, UI, logos, watermarks, characters, animals, pets, combat units, VFX, new props, clutter, blockers, walls, platforms, pedestals, pads, rings, decals, glyphs, objective objects, or overlays. No baked gameplay elements.
```

Built-in output:
`C:\Users\Tyler R\.codex\generated_images\01a06665-f4c6-7ac2-8b7f-1226c3c26a70\exec-ce6d6cf0-adf4-4929-ac9c-f10b86d85e48.png`.

### V3 shipping files

- `kage-tactics-temple-court-v3-landscape.webp` — 1280 × 720, WebP quality 70, 93,688 bytes
- `kage-tactics-temple-court-v3-portrait.webp` — 720 × 1600, WebP quality 70, 89,712 bytes

## Fire impact burst v1

Generated with the built-in OpenAI image generation tool on 2026-09-03 as a
shared transparent combat-VFX sprite for the Canvas and Three renderers.

```text
Use case: stylized-concept
Asset type: production game VFX sprite with transparent background
Primary request: one premium asymmetric shinobi fire-impact burst for an auto-battler, designed to rotate along an incoming projectile axis
Subject: a single left-to-right directional flame body: narrow incoming ember tail on the left, a white-hot compressed impact core slightly right of center, and three to five swept flame petals and heat-shock wisps exploding forward to the right; the dominant outer contour must be flame-shaped and asymmetric, never circular
Style/medium: polished hand-painted AAA game VFX sprite, crisp stylized fantasy fire, readable at 64–120 pixels, painterly alpha edges, subtle ember flecks
Composition/framing: centered on a square canvas with generous transparent padding; strict horizontal left-to-right motion axis; no perspective floor and no scene
Color palette: white-yellow core, gold and deep vermilion flame body, a few dark ember/smoke accents; strong luminance hierarchy that survives desaturation
Lighting/mood: explosive, decisive, premium combat punctuation
Constraints: genuinely transparent background and preserved alpha; one isolated sprite only; no ring, no circle, no radial mandala, no UI reticle, no border, no text, no logo, no watermark, no character, no weapon, no environment; silhouette must remain legible when rotated and downsampled to phone size
Avoid: generic starburst, perfect symmetry, flat vector icon, opaque rectangle, bloom that erases the flame contour
```

Built-in output:
`C:\Users\Tyler R\.codex\generated_images\01a05f07-4e78-70e1-b7a4-55c9a7582ee2\exec-8c9a4cf9-d0d8-49ff-a403-2f2303904d8c.png`.

Workspace source and optimized runtime file:

- `kage-fire-impact-burst-v1.png` — 1254 × 1254 RGBA PNG source, 1,031,549 bytes
- `kage-fire-impact-burst-v1-512.png` — 512 × 512 RGBA palette PNG runtime asset, 65,420 bytes

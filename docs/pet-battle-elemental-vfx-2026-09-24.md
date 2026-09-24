# Pet battle elemental VFX research and implementation

Date: 2026-09-24
Scope: Pet Colosseum and Beastbound Warfront. Presentation only; simulation
events, combat outcomes, and replay timing remain authoritative.

## Research takeaways

Pokémon Stadium 2 makes a useful reference because attacks stay brief but are
not visually interchangeable. Its move demonstrations include elemental,
weather, status, and physical examples, and its Pokémon-specific actions let the
creature's body sell the move before or during the effect. The practical lesson
for these modes is to make the full action legible: anticipation, directed
travel, body response, contact, and a short aftermath. Big effects should earn
their screen time; frequent attacks still need a quick, clear silhouette.

The Stadium 2 move archive provides direct examples for [Thunder Wave],
[Sandstorm], [Rain Dance], [Future Sight], and other moves. A contemporary
review specifically notes the game's brief, varied technique animations and
species-adjusted attack actions, while also calling its arenas visually plain.
That points this pass toward richer, more authored attack effects and creature
response, while keeping the existing arena readable.

The GDC session [Visual Effects Bootcamp: Artistic Principles of VFX] frames
effects as artistic and gameplay work, with examples from *League of Legends*
and *Hearthstone*. Applied here: element identity must be recognizable at a
glance, attack travel should point toward its target, and visual intensity must
reinforce the combat event rather than obscure it. The project already has
simulation-clocked tells, travel, contact, body reactions, bounded particle
families, and camera response; this pass improves the shared color language and
adds a hand-authored contact layer to the live renderers.

## Shared visual language

| Element | Primary / highlight | Contact silhouette | Read |
| --- | --- | --- | --- |
| Fire | ember orange / hot gold | expanding flare | ignition, rising embers |
| Water | deep cyan / pale aqua | compressed ripple | pressure and splash |
| Wind | sea green / mint | opposing crescents | curved, slicing motion |
| Earth | ochre / warm sand | angular fault burst | weight and fracture |
| Lightning | gold / pale yellow | branching bolt | fast, jagged discharge |
| Neutral | slate / white | clean geometric impact | physical contact |

`src/lib/pet-element-vfx.ts` owns the common palette and silhouette metadata.
Both renderers now use it. This removes the previous cross-mode mismatch where
Lightning appeared violet in Colosseum and yellow in Warfront. Element names are
normalized case-insensitively because Colosseum's choreography uses lowercase
move kinds while Warfront events use title case.

## Implementation

- Added a transparent 3×2 contact atlas with distinct Fire, Water, Wind, Earth,
  and Lightning artwork. The last cell is intentionally unused. Neutral and
  non-core identities such as abyssal or arcane effects keep their existing
  geometry, rather than inheriting an unrelated elemental stamp.
- Pet Colosseum layers the matching camera-facing artwork over the existing
  element volume on contact. Its curves, particles, lights, impact timing, and
  signature scaling remain in place.
- Beastbound Warfront's Canvas renderer draws the matching atlas cell inside
  its vector result effect and angles the mark along the incoming attack.
- Warfront's WebGL renderer uses one shared atlas material and five fixed-size
  instanced pools for generic elemental contacts. Existing hero-specific Fire
  impact art stays in front for the authored hero attack.
- The atlas is optional in Canvas, loaded from the local asset cache, and falls
  back to the existing vector effect if it cannot load. WebGL preloads through
  Three's texture cache; no material is created per attack.

## Generated asset provenance

Created with the built-in image generation tool. Prompt summary: “Create a
transparent 3×2 VFX sprite atlas with five clean, distinct elemental contact
bursts for Fire, Water, Wind, Earth, and Lightning; reserve the sixth cell; no
text, no borders, no background; dramatic hand-painted game VFX, crisp center,
readable colored silhouettes, alpha edges suitable for compositing.” The first
generation included colored backplates, so a follow-up image edit removed the
backplates while preserving the effects. The source is
`shinobij.client/public/assets/warfront/elemental-impact-atlas-source.png`; the
runtime atlas is lossily optimized WebP with alpha at
`shinobij.client/public/assets/warfront/elemental-impact-atlas-v1.webp` (465 KB,
down from 2.1 MB PNG).

## Verification and current limits

The code path is shared and bounded, and the texture failure path retains the
existing vector presentation. TypeScript compilation passed, and targeted lint
reported no errors (three existing renderer warnings). A local browser capture
could not be started in this environment because Vite failed when Node tried to spawn esbuild
(`EPERM`); no visual screenshot was produced during this pass. The visual
reference demonstrates direction, layering, and impact readability goals, not
a claim that these renderers now match a large-budget console game's geometry,
animation, lighting, and per-move art coverage.

## References

- [Bulbagarden Archives: Pokémon Stadium 2 move demonstrations](https://archives.bulbagarden.net/wiki/Category:Moves_(Stadium_2))
- [Bulbagarden Archives: Thunder Wave in Stadium 2](https://archives.bulbagarden.net/wiki/File:Thunder_Wave_Stad2.png)
- [GameSpot: Pokémon Stadium 2 review](https://www.gamespot.com/reviews/pokmon-stadium-2-review/1900-2701265/)
- [GDC Vault: Visual Effects Bootcamp: Artistic Principles of VFX](https://gdcvault.com/play/1023943/Visual-Effects-Bootcamp-Artistic-Principles)

[Thunder Wave]: https://archives.bulbagarden.net/wiki/File:Thunder_Wave_Stad2.png
[Sandstorm]: https://archives.bulbagarden.net/wiki/File:Sandstorm_Stad2.png
[Rain Dance]: https://archives.bulbagarden.net/wiki/File:Rain_Dance_Stad2.png
[Future Sight]: https://archives.bulbagarden.net/wiki/File:Future_Sight_Stad2.png

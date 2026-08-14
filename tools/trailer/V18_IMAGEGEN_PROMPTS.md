# Shinobi Journey Trailer V18 - Image and Motion Prompts

## Generation mode

- Final keyframes were produced with the built-in `image_gen` tool in edit/compositing mode.
- Local reference images were inspected before generation.
- Selected keyframes were copied into `tmp/trailer/cinematic-v18/` for project use.
- Motion was generated locally with FramePack. Artifact-heavy orb/beam frames were rejected; only clean opening motion was retained, interpolated, and finished with a controlled cinematic push.

## 95 - Jutsu Duel Escalation

Selected keyframe: `tmp/trailer/cinematic-v18/95-jutsu-duel-escalation-v18.png`

```text
Use case: precise-object-edit
Asset type: 16:9 cinematic keyframe for a premium anime game trailer
Primary request: Replace the passive distant bridge standoff with the next active beat of the same 1v1 jutsu duel. The white-haired shinobi on the LEFT sweeps a tall curling wall of water up from the broken bridge and canyon. The black-haired masked rival on the RIGHT drives three low, jagged violet lightning paths across the wet bridge toward him. The water wall catches and bends the lightning into multiple planted kunai grounding rods along the bridge edges. Both fighters must be visibly casting, braced, facing one another, and directly engaged.
Input images: Image 1 is the identity, costume, elemental language, painterly anime quality, and color reference for both fighters. Image 2 is the broken-bridge environment and wide opposing composition to transform.
Scene/backdrop: broken ancient stone bridge over a deep mountain canyon at night, heavy rain, moonlit storm clouds, distant Japanese-inspired fortress lights, wet reflective stone
Subject: exactly two adult original shinobi rivals; white-haired water user on left in torn white-and-black clothing; masked black-haired lightning user on right in layered black armor
Style/medium: original high-end hand-painted anime feature-film key art, richly detailed, coherent anatomy, AAA cinematic lighting, crisp foreground, atmospheric background
Composition/framing: low wide camera, both full bodies large enough to read, opposing diagonal elemental action sweeping across frame, clear left-to-right combat geography, no empty dead center
Lighting/mood: cold moonlight, blue water highlights, controlled violet lightning, violent storm, determined expressions, high tension
Color palette: midnight blue, steel, icy cyan, restrained violet, tiny warm village lights
Constraints: preserve both established character identities and costume language; exactly two fighters; readable hands and limbs; direct jutsu counterplay; water must visibly redirect lightning into kunai; no text, logo, UI, border, or watermark
Avoid: passive waiting poses, swords touching, sword clash, glowing ball, energy orb, central sphere, symmetric beam struggle, giant central white flare, spirit animals, extra fighters, attacking a building, character fusion, distorted anatomy, excessive motion blur
```

FramePack motion prompt:

```text
On the broken rain-soaked bridge, the masked black-haired rival on the right drives three restrained jagged violet lightning paths low from right to left across wet stone. The white-haired shinobi on the left stays grounded and sweeps the existing tall water wall upward and inward; the water curls smoothly, catches the lightning, and redirects small branching arcs into the planted kunai along both bridge edges. Water droplets, rain, loose cloth, hair, and reflections move naturally. Both fighters hold their casting stances with subtle body weight and hand motion. Make a smooth slow camera push toward the elemental counterplay. Preserve exactly two fighters, established faces and costumes, correct left/right positions, coherent hands and limbs, broken bridge, water wall, lightning paths, and kunai. No running, jumping, sliding, sword clash, orb, ball, ring, giant flare, beam struggle, fire, spirit animal, extra fighter, duplicate body, anatomy morph, camera shake, or rapid zoom.
```

Selected final motion: `output/trailer/framepack-v18/95-jutsu-duel-escalation-v18-final.mp4`

The generated tail turned into a central orb/beam and was rejected. The clean water-and-lightning opening was motion-interpolated and extended with a smooth camera push to 96 unique frames.

## 96 - Jutsu Duel Climax

Selected keyframe: `tmp/trailer/cinematic-v18/96-jutsu-duel-climax-v18.png`

```text
Use case: compositing
Asset type: 16:9 cinematic climax keyframe for a premium anime game trailer
Primary request: Continue the exact same two-character 1v1 jutsu fight from Image 1 at its explosive climax. The white-haired water shinobi remains on the LEFT and drives a massive crescent-shaped wave diagonally from lower-left toward upper-right across the shattered bridge. The masked black-haired lightning rival remains on the RIGHT and slams a lightning-charged palm into the wet stone, causing several branching violet lightning pillars to erupt upward through the advancing wave. The wave splits around the lightning pillars; bridge stones lift; water spray explodes sideways; both fighters are clearly visible, grounded, braced, and resisting one another's technique.
Input images: Image 1 is the immediate preceding shot and must control character identity, costumes, storm palette, broken bridge, and cinematic style. Image 2 reinforces the exact established fighter designs and water-versus-lightning visual language.
Scene/backdrop: same broken ancient bridge over the mountain canyon at night, heavy rain, moonlit clouds, distant fortress lights
Subject: exactly two adult original shinobi rivals, same white-haired water user on left and same masked black-haired lightning user on right
Style/medium: original high-end hand-painted anime feature-film key art, AAA trailer finish, coherent anatomy, crisp readable silhouettes, richly rendered water, lightning, rain, stone fragments and spray
Composition/framing: dynamic wide low angle; strong jagged diagonal collision front across the frame; both full bodies readable near opposite thirds; large-scale elemental spectacle fills the middle without hiding the fighters
Lighting/mood: cold moonlight, icy cyan wave, restrained branching violet lightning, storm-dark environment, decisive final exchange
Color palette: midnight blue, steel, icy cyan, violet, small warm fortress lights
Constraints: preserve the same two established fighters and sides; exactly two people; physically coherent hands and limbs; obvious water jutsu versus lightning jutsu; no text, logo, UI, border, or watermark
Avoid: swords as the focal point, touching blades, sword clash, glowing ball, energy orb, central sphere, symmetric beam struggle, giant central white or orange flare, fireball, spirit animals, extra fighters, attacking a building, character fusion, distorted anatomy, excessive blur
```

FramePack motion prompt:

```text
The same two shinobi remain grounded on opposite sides of the shattered bridge in hard rain. The white-haired water user on the left drives the existing crescent wave forward and upward toward the right; the water curls, breaks into spray, and splits naturally around the existing lightning pillars. The masked black-haired rival on the right keeps one palm planted on wet stone and channels branching violet lightning upward through the bridge; nearby stones rise and tumble slightly while cracks pulse. Both fighters visibly strain but keep their established faces, bodies, costumes, positions, and silhouettes. Rain, hair, torn cloth, water spray, small stone fragments, and reflections move naturally. Use one smooth slow camera push toward the jagged collision front. Preserve exactly two fighters and the existing wave-plus-vertical-lightning composition. No swords, orb, ball, ring, sphere, central white flare, fire, beam struggle, spirit animal, extra fighter, duplicate body, anatomy morph, jumping, sliding, camera shake, or rapid zoom.
```

Selected final motion: `output/trailer/framepack-v18/96-jutsu-duel-climax-v18-final.mp4`

The later stylized shield-like transformation was rejected. The clean bridge-shattering wave-and-lightning opening was motion-interpolated and extended with a smooth camera push to 96 unique frames.

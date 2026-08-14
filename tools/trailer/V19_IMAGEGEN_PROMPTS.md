# V19 built-in ImageGen record

Built-in ImageGen mode was used for every V19 keyframe below. The generated keyframes were then animated locally with a conservative Stable Video Diffusion pass, optically interpolated to 30 fps, and assembled without a high-resolution still overlay to avoid ghost limbs.

## Final saved keyframes

- `tmp/trailer/cinematic-v19/97-lightning-dive-water-dodge-v19.png`
- `tmp/trailer/cinematic-v19/98-water-counter-evade-v19.png`
- `tmp/trailer/cinematic-v19/99-close-jutsu-parry-v19.png`
- `tmp/trailer/cinematic-v19/100-water-palm-lightning-guard-v19.png`
- `tmp/trailer/cinematic-v19/101-vault-over-lightning-sweep-v19.png`
- `tmp/trailer/cinematic-v19/103-low-kick-water-evade-v19.png`
- `tmp/trailer/cinematic-v19/104-rising-knee-lightning-guard-v19.png`
- `tmp/trailer/cinematic-v19/105-water-wheel-kick-lightning-guard-v19.png`

## Exact prompts

### 97 — lightning dive / water dodge

```text
Use case: precise-object-edit
Asset type: 16:9 action keyframe for an AAA-style anime game trailer
Primary request: Create the next physically readable beat of this same 1v1 duel, focused on character movement rather than a stationary elemental tableau. The masked black-haired lightning shinobi launches from the RIGHT upper third and dives diagonally down toward the LEFT with one lightning-charged open palm aimed at the white-haired rival. The white-haired water shinobi is low on the LEFT, twisting and sliding backward under the descending attack, one planted hand skimming the flooded bridge and throwing a curved wake of water behind him. The attack clearly misses by inches and tears a violet lightning scar through the wet stone.
Input images: Image 1 controls the exact two fighter identities, costumes, dark storm palette, broken bridge, moonlit fortress environment, and premium painted anime finish. Image 2 reinforces anatomy, face, and water-versus-lightning language.
Scene/backdrop: same broken rain-soaked stone bridge over a deep canyon at night, moon and distant fortress lights, hard diagonal rain
Subject: exactly two adult original shinobi rivals; white-haired water user low on the left; masked black-haired lightning user airborne from upper right
Style/medium: dark hand-painted anime feature-film action frame, premium theatrical detail, realistic weight, coherent anatomy, AAA trailer finish
Composition/framing: low three-quarter tracking camera, strong upper-right to lower-left attack diagonal, fighters large and readable, clear separation between bodies
Lighting/mood: cold moonlight and icy water highlights with restrained violet lightning; tense, fast, dangerous
Constraints: exactly two fighters; preserve established faces and costumes; lightning attacker visibly airborne and moving left; water fighter visibly ducking/sliding away; coherent hands, feet, limbs, and perspective; no text, logo, UI, border, watermark
Avoid: static facing poses, central energy ball, beam struggle, swords touching, symmetric composition, giant explosion, spirit animals, extra fighters, duplicate limbs, fused bodies, washed-out white flash, orange daylight, excessive motion blur
```

### 98 — water counter / aerial evade

```text
Use case: compositing
Asset type: 16:9 continuation action keyframe for an AAA-style anime game trailer
Primary request: Continue the exact same fight one instant after the lightning dive misses. The white-haired water shinobi on the LEFT has completed his slide, planted one foot, and pivots upward into a powerful counter: his leading forearm whips a narrow crescent blade of water diagonally from lower-left toward upper-right. The masked black-haired rival on the RIGHT is still airborne and twists his torso backward to evade; the water crescent clips only the trailing edge of his torn black cloak, scattering droplets and cloth threads. Both faces and full-body motion remain readable.
Input images: Image 1 is the immediate preceding shot and controls exact identities, costumes, broken bridge, storm palette, lighting, anatomy, and premium painted style. Image 2 reinforces the established designs and elemental rendering.
Scene/backdrop: same flooded broken bridge over the moonlit canyon in hard rain, distant fortress lights
Subject: exactly the same two adult original shinobi; white-haired fighter countering from left; masked black-haired rival evading toward right
Style/medium: same dark hand-painted anime feature-film action style as Image 1, coherent anatomy, AAA trailer detail
Composition/framing: dynamic low lateral camera; water crescent follows a strong lower-left to upper-right diagonal; bodies remain separate and occupy opposing thirds; no dead center
Lighting/mood: icy cyan water, restrained violet residual lightning, cold moonlit rain, decisive reversal
Constraints: exactly two fighters; preserve identities, costumes, side placement, and scale; visible pivot and midair evade; coherent hands, limbs, cloth, and perspective; no text, logo, UI, border, watermark
Avoid: static posing, giant circular wave, energy orb, beam clash, swords touching, direct body impalement, central white flash, orange daylight, extra fighters, duplicate limbs, fused bodies, distorted anatomy, excessive blur
```

### 99 — wrist parry / counter setup

```text
Use case: compositing
Asset type: 16:9 close-range finishing-fight keyframe for an AAA-style anime game trailer
Primary request: Replace the washed-out crossed-sword finale with a style-matched hand-to-hand jutsu exchange involving real body movement. On the same rain-soaked bridge, the masked black-haired lightning rival on the RIGHT lunges hard toward the LEFT with a violet-lightning palm aimed at the white-haired hero's ribs. The white-haired hero on the LEFT steps inside the attack, turns his torso, catches and redirects the attacker's wrist with one water-wrapped forearm, and draws his other fist back for a short counterstrike. Their bodies are close but clearly separate; the lightning passes behind the hero and scorches the bridge railing instead of exploding between them.
Input images: the two most recent reference images establish the exact fighter identities, costumes, storm-night palette, broken bridge environment, anatomy, and premium dark painted anime style. Preserve them exactly.
Scene/backdrop: same dark flooded bridge and fortress village in hard rain, moonlight, wet reflections, damaged stone railing
Subject: exactly the same two adult original shinobi rivals in one readable wrist-parry and counter setup
Style/medium: dark hand-painted anime feature-film action frame, premium cinematic detail, coherent martial-arts anatomy, AAA trailer finish
Composition/framing: close low three-quarter camera at torso height, strong right-to-left lunge, offset contact near left of center, faces and hips readable, no symmetry
Lighting/mood: cold blue rain, restrained violet lightning rim, tiny warm lanterns, intense close-quarters danger
Constraints: exactly two fighters; preserve faces, hair, masks, costumes, and body scale; each has two coherent arms and hands; visible attack line, wrist parry, planted feet, and counter preparation; no swords; no text, logo, UI, border, watermark
Avoid: crossed blades, central flash, glowing ball, beam struggle, static mirrored pose, giant explosion, orange daylight, washed-out exposure, extra fighters, duplicate limbs, fused hands, impalement, excessive blur
```

### 100 — water palm / lightning guard

```text
Use case: compositing
Asset type: 16:9 continuation action keyframe for an AAA-style anime game trailer
Primary request: Create the decisive next beat of the exact same rain-soaked 1v1 jutsu fight. Immediately after the close wrist parry, the white-haired water shinobi on the LEFT pivots through his hips and drives a compact water-wrapped palm strike into the masked black-haired rival's crossed forearm guard on the RIGHT. The rival is pushed backward one step toward the right, boots scraping wet stone, while restrained violet lightning runs from his guard into the bridge in thin branching cracks. A tight crescent burst of water wraps around the contact point and streams toward the right; it must not become a sphere, orb, or giant explosion. Both fighters show clear weight, balance, planted feet, and readable martial-arts anatomy. Preserve the exact two fighter identities and premium dark painted style from the references.
Input images: Image 1 controls the established fighter designs, costumes, moonlit flooded bridge, and water-versus-lightning look. Image 2 controls the close-range anatomy, dark blue/violet exposure, faces, masks, and hand-to-hand action style.
Scene/backdrop: same broken flooded stone bridge above a canyon, hard diagonal rain, moonlit fortress village, damaged stone rails and wet reflections
Subject: exactly two adult original shinobi rivals; white-haired water fighter advancing left-to-right; masked black-haired lightning rival recoiling but blocking on the right
Style/medium: dark hand-painted anime feature-film action frame, premium theatrical detail, coherent anatomy, AAA game-trailer finish, same cool color grade as both references
Composition/framing: low three-quarter camera at waist height, fighters large and separate, strong left-to-right force line, contact point offset right of center, faces and feet readable
Lighting/mood: cold blue rain and icy water highlights, restrained violet lightning, tiny warm lanterns, decisive and dangerous
Constraints: exactly two fighters; preserve faces, hair, mask, costumes, proportions, and side placement; each fighter has exactly two coherent arms and hands; visible planted feet, forearm guard, palm strike, and backward recoil; no swords; no text, logo, UI, border, watermark
Avoid: energy orb, ball of light, central flash, beam struggle, giant wave, giant explosion, crossed swords, static mirrored pose, orange daylight, washed-out exposure, extra fighters, duplicate limbs, fused bodies, distorted hands, impalement, excessive motion blur
```

### 101 — vault over lightning sweep

```text
Use case: compositing
Asset type: 16:9 final combat action keyframe for an AAA-style anime game trailer
Primary request: Create a new, unique late-fight beat with the exact same two original shinobi, replacing the overexposed sword-clash image. On the same rain-soaked bridge at night, the masked black-haired lightning rival on the RIGHT commits to a low sweeping kick from right to left, his boot trailing a thin violet lightning arc along the wet stone. The white-haired water shinobi on the LEFT vaults cleanly over the sweep with both knees tucked and one hand briefly touching the rival's armored shoulder for leverage; his other arm pulls a narrow ribbon of water behind him like a curved motion trail. Their bodies are clearly separate and moving in opposite vertical directions. No swords and no central energy collision.
Input images: Image 1 controls exact faces, hair, mask, costumes, anatomy, close-range martial-arts style, and dark blue/violet exposure. Image 2 controls the same bridge, rain, water and restrained lightning rendering, premium detail, and consistent fighter proportions.
Scene/backdrop: same broken flooded stone bridge above the moonlit canyon, hard diagonal rain, distant fortress village and warm lantern pinpoints
Subject: exactly two adult original shinobi rivals; black lightning fighter low on right sweeping left; white water fighter airborne over him moving left-to-right
Style/medium: dark hand-painted anime feature-film action frame, coherent high-end theatrical anatomy, premium AAA game-trailer finish, same cool grade as references
Composition/framing: dynamic low side camera, strong low-right-to-left kick arc and upper-left-to-right vault arc, fighters large and readable, generous dark negative space around silhouettes
Lighting/mood: cold moonlight, icy cyan water ribbon, restrained violet lightning edge light, intense fast close combat
Constraints: exactly two fighters; preserve identities, costumes, body scale, and elemental colors; each has coherent limbs, hands, and feet; visible sweep direction and vault direction; no text, logo, UI, border, watermark
Avoid: swords, crossed blades, glowing orb, ball of light, central flash, beam struggle, giant explosion, static mirrored pose, washed-out exposure, orange daylight, extra fighters, duplicate limbs, fused bodies, distorted hands, impossible contact, excessive blur
```

### 103 — low kick / water evade

```text
Use case: compositing
Asset type: 16:9 replacement combat keyframe for an AAA-style anime game trailer
Primary request: Replace an overexposed crossed-sword shot with a unique, physically readable hand-to-hand elemental exchange in the exact dark painted style of the references. On a rain-soaked fortress rooftop at night, the masked black-haired lightning shinobi launches from the RIGHT in a low airborne corkscrew, extending one armored heel in a sweeping kick toward the LEFT. The white-haired water shinobi on the LEFT leans his torso cleanly backward under the kick while planting one foot and sweeping a narrow crescent of water upward with his forearm; the water clips the trailing edge of the rival's black cloak rather than striking his body. Both faces, hips, feet, and attack directions are readable. The fighters remain fully separate.
Input images: Image 1 controls exact fighter identities, costumes, moonlit rain palette, restrained violet lightning, watery motion language, and premium dark painted anime finish. Image 2 controls coherent close-range anatomy, fortress environment, and theatrical AAA detail.
Scene/backdrop: flooded tiled fortress rooftop connected to the same moonlit bridge village, hard diagonal rain, distant pagodas and tiny warm lanterns
Subject: exactly the same two adult original shinobi rivals; black lightning fighter airborne from right moving left; white water fighter on left evading and countering upward
Style/medium: dark hand-painted anime feature-film action frame, premium cinematic detail, realistic martial-arts weight, coherent anatomy, AAA game-trailer finish
Composition/framing: low side-tracking camera at knee height, strong right-to-left kick arc crossing above a lower-left-to-upper-right water counter arc, fighters large and separated, no symmetry
Lighting/mood: cold blue moonlight, icy cyan water, restrained violet lightning rim, dangerous and fast, no bright center
Constraints: exactly two fighters; preserve faces, hair, mask, costumes, proportions, and elemental colors; coherent limbs, hands, and feet; clearly visible evade and kick directions; no swords; no text, logo, UI, border, watermark
Avoid: crossed blades, swords, glowing orb, ball of light, central flash, beam struggle, giant explosion, static mirrored pose, orange daylight, washed-out exposure, extra fighters, duplicate limbs, fused bodies, distorted hands, impossible contact, excessive blur
```

### 104 — rising knee / lightning guard

```text
Use case: compositing
Asset type: 16:9 continuation combat keyframe for an AAA-style anime game trailer
Primary request: Create the immediate next unique beat after the black lightning shinobi's airborne sweeping kick misses. On the same rain-soaked rooftop, the masked black-haired rival has landed low on the RIGHT and pivots back toward the LEFT, raising both armored forearms in a tight crossed guard. The white-haired water shinobi on the LEFT has already stepped inside the missed kick and drives a compact rising knee toward the guard while his rear hand pulls a narrow spiral of water around his hip and knee. The guarded knee impact pushes the black rival backward across wet tiles and sends restrained violet lightning into thin ground cracks. This is a close martial-arts exchange, not a magic collision.
Input images: Image 1 is the immediate preceding kick-and-evade beat and controls exact identities, costumes, rooftop, dark rain palette, and elemental rendering. Image 2 reinforces coherent faces, anatomy, restrained water/lightning effects, and premium hand-painted feature-film finish.
Scene/backdrop: same flooded fortress rooftop and moonlit pagoda village, hard diagonal rain, distant warm lantern pinpoints
Subject: exactly the same two adult original shinobi; white-haired water fighter advancing left-to-right with a rising knee; masked black-haired lightning fighter on right landing and blocking while sliding backward
Style/medium: dark hand-painted anime feature-film action frame, premium cinematic detail, realistic martial-arts weight, coherent anatomy, AAA game-trailer finish
Composition/framing: low close three-quarter tracking camera, contact point right of center, white fighter's upward force line opposing black fighter's backward recoil, full hips and planted/sliding feet readable
Lighting/mood: cold moonlight, icy cyan water spiral, restrained violet lightning in the guard and ground, fast and dangerous, no bright center
Constraints: exactly two fighters; preserve faces, hair, mask, costumes, proportions, and elemental colors; coherent limbs, hands, feet, guard, knee direction, and recoil; no swords; no text, logo, UI, border, watermark
Avoid: crossed blades, swords, glowing orb, ball of light, central flash, beam struggle, giant explosion, static mirrored pose, washed-out exposure, orange daylight, extra fighters, duplicate limbs, fused bodies, distorted hands, impossible contact, excessive blur
```

### 105 — spinning water kick / lightning guard

```text
Use case: compositing
Asset type: 16:9 continuation action keyframe for an AAA-style anime game trailer
Primary request: Create the decisive next beat of the exact same rain-soaked 1v1 jutsu fight. Immediately after the guarded water-palm impact, the white-haired water shinobi on the LEFT pivots on his planted front foot and drives a waist-high spinning heel kick from left to right. His kicking boot is wrapped in a narrow crescent sheet of water that clearly follows the arc of the leg. The masked black-haired lightning rival on the RIGHT drops his weight and catches the kick on one armored outer forearm while sliding backward toward the right; restrained violet lightning runs from the guard into thin cracks across the wet bridge. The kick, block, recoil, planted pivot foot, hips, and directions of travel must be physically readable. Their bodies remain separate and the contact is at the boot and forearm only.
Input images: Image 1 controls the exact fighter identities, costumes, moonlit flooded bridge, dark blue/violet exposure, water-versus-lightning rendering, and immediate prior action. Image 2 reinforces exact faces, mask, proportions, close-range martial-arts anatomy, and premium hand-painted feature-film finish.
Scene/backdrop: same broken flooded stone bridge above a canyon, hard diagonal rain, moonlit fortress village, damaged stone rails, wet reflections, tiny warm lanterns
Subject: exactly two adult original shinobi rivals; white-haired water fighter attacking left-to-right with a spinning heel kick; masked black-haired lightning fighter blocking and recoiling on the right
Style/medium: dark hand-painted anime feature-film action frame, premium theatrical detail, realistic martial-arts weight, coherent anatomy, AAA game-trailer finish, same cool color grade as both references
Composition/framing: low three-quarter tracking camera at hip height, fighters large and separate, strong circular kick arc flowing left-to-right, contact point right of center, faces, hips, guard, and both fighters' feet readable
Lighting/mood: cold blue rain and icy water highlights, restrained violet lightning, fast, decisive, dangerous, no bright center
Constraints: exactly two fighters; preserve faces, hair, mask, costumes, proportions, and side placement; each fighter has exactly two coherent arms and hands and two coherent legs and feet; visible pivot foot, spinning heel, forearm guard, backward slide, and elemental trails; no swords; no text, logo, UI, border, watermark
Avoid: energy orb, ball of light, central flash, beam struggle, giant wave, giant explosion, crossed swords, static mirrored pose, orange daylight, washed-out exposure, extra fighters, duplicate limbs, fused bodies, distorted hands or feet, impalement, excessive motion blur
```

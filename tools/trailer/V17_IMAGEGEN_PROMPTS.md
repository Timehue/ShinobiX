# Shinobi Journey Trailer V17 — Image and Motion Prompts

## Generation mode

- Final keyframes were produced with the built-in `image_gen` tool in edit/compositing mode.
- Each local input was inspected before generation.
- Selected images were copied into `tmp/trailer/cinematic-v17/` before use.
- Motion was generated locally with FramePack. Artifact-heavy ranges were rejected, and only clean ranges were motion-interpolated into final clips.

## 92 — Asymmetric Rain Duel

Selected keyframe: `tmp/trailer/cinematic-v17/92-rain-duel-counter-v17.png`

```text
Use case: precise-object-edit
Asset type: 16:9 keyframe for a premium anime game trailer
Primary request: Replace the stiff, symmetrical crossed-sword pose with a much more cinematic close-quarters blade exchange. The white-haired shinobi on the left is low and driving forward from one bent knee, using the flat of his sword to deflect the black-clad rival's powerful diagonal slash off to the upper right. Their blades meet once near the right side of center with a compact shower of real metal sparks. The black-clad rival leans into the attack from a higher stance, while the white-haired fighter rotates under the pressure and prepares a counter. Both fighters must clearly attack each other and their body weight must feel grounded.
Input images: Image 1 is the edit target and establishes the two original rivals, rainy moonlit village bridge, costumes, faces, premium anime rendering, and color palette. Preserve those identities and environment but fully replace the pose and camera composition.
Scene/backdrop: rain-soaked stone bridge through a bamboo village at night, moon and warm lanterns in the background, wet reflections and wind-blown rain.
Subject: exactly two adult shinobi opponents—white-haired fighter on left and black-clad masked rival on right—in one readable asymmetric sword exchange.
Style/medium: theatrical premium anime action key art, sharp anatomy, detailed wet cloth and armor, AAA-style game trailer illustration.
Composition/framing: wide 16:9 low three-quarter camera near waist height; fighters occupy opposing thirds; strong diagonal action from lower left to upper right; blade contact offset from center; faces visible enough to read intent.
Lighting/mood: cold moonlit rain with warm lantern rim light and a small orange-white spark burst at blade contact.
Constraints: exactly two fighters; coherent hands, wrists, swords, legs, and foot placement; each character holds exactly one sword; both face the opponent; no text, logo, watermark, or franchise symbols.
Avoid: symmetrical X pose, static fencing stance, both swords vertical, floating fighters, giant energy beam, glowing orb, explosion, excessive lens flare, severed or fused limbs, duplicate weapons, extra people, recognizable copyrighted characters.
```

FramePack motion prompt:

```text
On the rain-soaked bridge, the black-clad rival leans forward and presses his single diagonal sword strike downward. The white-haired shinobi stays low and grounded, pivots through his bent legs, and redirects the rival blade outward toward the upper right using his own single sword. A compact stream of realistic metal sparks sprays away from the contact point while rain breaks around the blades and puddles splash under both planted feet. Cloth strips and hair move naturally in the crosswind. The camera makes a smooth short lateral move toward the white-haired fighter as the parry completes. Preserve exactly two fighters, exactly one sword per fighter, their faces, hands, armor, foot placement, and asymmetric pose. No giant energy effect, beam, orb, explosion, jumping, sliding feet, duplicate weapons, extra limbs, body morphing, or camera shake.
```

Selected final motion: `output/trailer/framepack-v17/92-rain-duel-counter-v17-clean-smooth.mp4`

The later FramePack bloom was rejected. The clean opening blade-contact range was interpolated to a two-second, 60-frame source with 55 unique frame hashes.

## 93 — Lightning Companion Assault

Selected keyframe: `tmp/trailer/cinematic-v17/93-lightning-companion-assault-v17.png`

```text
Use case: compositing
Asset type: 16:9 keyframe for a premium anime game trailer
Primary request: Rebuild the companion battle as a synchronized lightning attack. The white-haired shinobi and the golden fox companion charge together from left to right toward one original dark Hollow beast on the far right. The fox runs low in the foreground and is unmistakably the lightning companion: thin cyan-white electricity wraps its fur, ears, tail, and paws, with branching ground arcs trailing behind each paw. The hero runs one pace behind and above the fox, sword drawn low, illuminated by the fox's lightning. The fox's leading paw launches a narrow forked lightning strike directly into the Hollow beast's shoulder armor; this is directional lightning, never fire or a ball of light.
Input images: Image 1 establishes the hero, golden fox with red scarf, Hollow enemy, ruined moonlit shrine, and combat relationship. Image 2 establishes the correct lightning treatment, fox identity, and premium rendering. Preserve those identities while creating a new synchronized attack composition.
Scene/backdrop: ruined moonlit shrine courtyard in hard rain, wet broken stone, torii silhouette, small lanterns, distant storm clouds.
Subject: exactly one white-haired shinobi, exactly one golden fox companion with red neck scarf and bare forehead, and exactly one original dark Hollow beast.
Style/medium: premium cinematic anime key art, sharp detailed anatomy and fur, dramatic depth, AAA-style game trailer illustration.
Composition/framing: wide 16:9 low tracking angle; fox large in the lower center moving right, hero on left moving right, enemy on far right bracing against the incoming lightning; clear open action path between them.
Lighting/mood: electric cyan-white lightning against deep navy rain, restrained violet enemy rim light, cool moonlight, tiny warm lantern accents.
Constraints: lightning must visibly originate from the fox and strike the enemy; hero and fox move in the same direction; fox has no headband, forehead plate, logo, symbol, or franchise mark; coherent paws, legs, hands, sword, and enemy anatomy; no text or watermark.
Avoid: fire, orange explosion, backlit silhouette, glowing ball, orb, ring, halo, shield dome, spirit fox, duplicate animals, extra fighters, reversed running, floating subjects, extra limbs, fused anatomy, recognizable copyrighted character symbols.
```

FramePack motion prompt:

```text
In hard rain, the golden fox companion drives forward from left to right in one controlled low lunge. Thin cyan-white lightning continues to crawl through its fur, ears, tail, and paws, and the existing narrow forked strike pulses directly from the fox leading paw into the dark Hollow enemy shoulder. The Hollow enemy braces and recoils slightly from the directional electric impact without changing shape. The white-haired shinobi takes one grounded step behind the fox with his single sword held low, staying aligned with the companion attack. Rain, cloth, fur, lightning branches, and wet-ground reflections move naturally while the camera tracks smoothly right with the pair. Preserve exactly one hero, one golden fox, and one Hollow enemy, all moving or facing right toward the enemy. Fox forehead remains bare. No fire, orange explosion, orb, ball, ring, halo, shield, spirit transformation, duplicate subjects, reversed movement, floating, extra limbs, anatomy morphing, or camera shake.
```

Selected final motion: `output/trailer/framepack-v17/93-lightning-companion-assault-v17-clean-smooth.mp4`

The later FramePack fire/orange transformation was rejected. The blue-lightning opening range was interpolated to a 2.2-second, 66-frame source with 53 unique frame hashes.

## 94 — Smoothed Tactical 1v1

Final motion: `output/trailer/framepack-v17/94-tactical-1v1-smooth-v17-proof.mp4`

The existing tactical keyframe was retained. Its clean water/lightning-to-kunai motion window was motion-interpolated into a 2.1-second, 63-frame clip with 56 unique frame hashes, replacing the visibly stepped V16 retime.

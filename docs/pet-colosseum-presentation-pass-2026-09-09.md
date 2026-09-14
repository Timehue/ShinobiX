# Pet Colosseum animation and effects quality pass

This pass improves the shared battle presentation after the training-balance and Crystal Bear rig repairs. Combat damage, AI rules, rewards and the repaired model assets retain the preceding implementation.

## Animation and movement

- Anticipation, strike and recovery clips now sample the battle's normalized phase. Normal and Fast playback complete the same authored pose windows; contact hit-stop retains its impact pose. Surface and outline mixers use the same sampling helper while their crossfades continue advancing.
- Ranged pets extend into their casting pose when the projectile launches. The charging orb and floor glyph build toward that release and fade as the shot leaves, instead of continuing to channel after arrival.
- Melee recovery gains a single backward bound with different lift for heavy, avian, serpentine and other bodies. It starts and finishes on the ground and remains on the existing collision-safe return route.
- Contact flashes dissipate independently of the held skeletal pose, preventing a bright impact from lingering throughout hit-stop.

## Effects and lighting

- Fixed a projectile transform bug: the world position was applied inside a rotating billboard, making the artwork move away from the flight path when the camera changed. World translation now belongs to the parent; billboard rotation affects only the artwork.
- Replaced oversized, hard-edged projectile glow spheres with small feathered glows. Trails sample the actual flight arc at fixed distances rather than keeping one bead per rendered frame. Low quality uses fewer trail samples; reduced motion omits the trail.
- Refined charge effects with a softer glow, restrained pulse, a smaller ordinary-cast glyph, and signature-only secondary rings. Particle counts follow the graphics preset.
- Added feathered light-shaft materials for the arena lights and signature pillar. End fades and viewing-angle fades remove the hard polygon strips previously visible against the sky. Stage beams are omitted on Performance and with reduced motion.
- Fixed the post-process color composition: its final output replaced processed red and blue with raw samples, so glow and blur effectively affected green alone. All three processed channels now survive. Chromatic displacement is limited to a subpixel accent near the frame edges, with no idle offset; radial blur and bloom are more restrained.

## Camera direction

- Camera cuts apply after framing and arena containment. The first frame of a new shot no longer starts too close and visibly corrects itself afterward.
- Launch framing begins before the dash/projectile moves. The shot stays on the same side of the action axis, and ranged shots frame both combatants.
- Melee recovery cuts back to the arena master shot so the retreating attacker remains visible. This corrected a clipped attacker observed during Fast playback.
- Camera settling uses delta-based exponential damping, and shot timing uses the shared hit-stop-aware presentation clock. Heavy framing reads the event's weight rather than a fixed damage-number threshold.
- Reduced motion retains the stable master view instead of performing action cuts and result orbits.
- Portrait composition uses a higher camera, a wider responsive lens and an optical shift above the command deck. The six-pet formation is visible above the party/control panels. Desktop retains its 48-degree base lens.

## Verification

- 88 passing tests cover choreography, shared playback, projectile paths, contact outcomes, real Three.js animation mixers, camera projection, graphics quality, model resources, roster resolution and effect mapping.
- The three Crystal Bear source/LOD deformation regressions also pass: 91 relevant tests in total.
- Changed presentation files pass ESLint. The final production build passes server/client types, emitted-asset checks and the product bundle budget: 8,162,722 bytes of budgeted JS/CSS, below the 8,200,000-byte limit.
- Mixer and camera tests exercise 30/60/144 Hz timing, Normal/Fast phase completion, fixed-distance projectile tails and a real perspective projection of all six portrait slots.

Representative browser checks used the optimized development preview with real models and the production battle component:

| Scene | Setting | Review |
| --- | --- | --- |
| Crystal Bear / Moon Serpent | Balanced, Normal | Earth projectile, release pose, flight arc, opponent melee |
| Crystal Bear / Moon Serpent | Performance, Fast | Contact pose, compact flash, recovery |
| Ember Phoenix / Frost Hare | Cinematic, Normal | Fire signature, light shafts, post-processing, KO and result |
| Red Fox, River Otter, Meadow Deer / Blue Frog, Mist Ferret, Leaf Monkey | Balanced, Fast | Six-pet round, cross-lane contact and full-arena recovery |
| Six-pet formation | Balanced, 390 × 844 | Portrait composition above party and command panels |

No browser rendering errors were reported. An existing Three.Clock deprecation warning remains. These are representative visual checks, not a human review of every model or a hardware frame-rate benchmark. The reduced-motion branch was reviewed in code; a live OS reduced-motion session was not exercised.

## Local evidence

Screenshots are in `output/pet-colosseum-aaa/`:

- `projectile-before.jpg` and `projectile-after.jpg`: oversized glow/offset artwork compared with the corrected arc.
- `melee-fast-contact.jpg`: Crystal Bear contact at Performance/Fast.
- `fire-finisher-final.jpg` and `fire-finisher-final-crest.jpg`: final Cinematic lighting and color treatment.
- `team-fast-contact.jpg` and `team-fast-recovery.jpg`: contact and the corrected arena master shot.
- `team-portrait-final.png`: all six pets above the portrait command deck.

Logs: `output/colosseum-aaa-tests-final.log`, `output/colosseum-aaa-bear-test.log`, `output/colosseum-aaa-lint-final.log`, and `output/colosseum-aaa-production-build-final.log`.

The work is local and has not been deployed.

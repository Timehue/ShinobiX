# Pet combat motion

`PetShowdownBattle` uses the shared `PetModel3D` renderer. Compatible pets now
receive restrained runtime skeletal wing folding, distal leg recovery, chest
breathing and neck attention. The mixer pose is restored before every frame so
unkeyed bones cannot accumulate rotations across dodges or leak into idle/KO.
Contact, hit-stop, defeat and victory retain their authored committed poses.
Wing folding tapers back to the authored pose before a dodge finishes.

Locomotion retains normalized stride across walk/gallop changes. Distal recovery
and body weight transfer follow the active clip's phase. Actual thigh banks use
the forward-swing half-cycle; bipeds alternate feet while quadrupeds pair their
forelegs/hindlegs in gallop. Complete named parent chains gate the layer, and
authored knee/ankle channels take priority. The four detailed showcase banks
(`rare-1`, `standard-7`, `starter-fire-l`, `starter-lightning-l`) retain their
authored leg/head performances.

Host-owned attack phases are prepared before normal mixer evaluation, keeping
combat impact timing and frozen contact poses intact. Completed fades retire
their outgoing actions using the scaled mixer clock. A rapid contact transition
also retires earlier outgoing fades. Loading, lazy boundaries, quality presets,
materials, textures, geometry, combat rules and original clips are preserved.

## Coverage and validation

The current combat resolver has 161 playable identities and 160 distinct GLBs.
All are skinned with 13 clips each. Shared mixer fixes cover all 161 identities;
154 support secondary motion, 153 support distal recovery, and 37 support the
avian wing layer. Bat/moth/winged-lion wing axes are excluded from that fold.
No model or source-art file is modified, and no decoder dependency is added.

The focused local suite passed 68 tests, including real imported GLBs, repeated
dodges, scaled/frozen clocks, malformed-chain exclusion, stride trajectories,
and all 13 takes on each showcase bank. The production build/types/size checks
and lint of changed TypeScript files passed. Local full-motion verification
covered five desktop/mobile previews, two recordings, 21 frozen-pose checks and
five actual primary-combat scenarios with no browser errors or overflow.
The complete strict layout matrix passed 20 tests with 10 configured skips.

The authorized release follow-up mounts shared renderer retirement in the QA
preview. Current main's combat changes, arena wheel behavior, controller
retirement and overlapping storage/design-token/browser gate repairs remain intact.
Dependency patches reuse the narrow compression, proxy-addr and source-map-js
updates proposed in PRs #294-297. Both fresh-install dependency audits report
zero vulnerabilities. Production security and release gates remain enabled.
The Dojo controller test boots the real authenticated production screen,
samples both controller edges on animation frames, and completes the Card Hall
tutorial on all seven browser/device cases. Its focused runner uses the same
immutable production preview. Stronghold leave-failure coverage checks enabled
movement and resumed polling directly, replacing an obsolete guidance string;
the complete local Chromium/WebKit lifecycle audit passes with no page errors.
Desktop/mobile paid recovery retry
coverage now expects its selected paid discharge to charge once.

Imported images and lazy stylesheets use shorter generated filenames with the
same content hashes, cache naming pattern and manifest mappings. Source art,
vendor names and entry CSS naming are preserved. The integration-enabled build
enforces the unchanged 9,150,000-byte product budget.
A byte comparison confirms all 943 emitted images and 69 stylesheets remain
identical when only lazy stylesheet filenames change.
All 943 final imported image payloads also match the original preview's SHA-256
fingerprints after both filename optimizations.

The motion layer uses native bone rotations and compact, labeled joint tuples
to fit the existing production bundle budget. An equivalence sweep compared
50,232 frames on all 161 identities, including every existing clip, and matched
2,135,952 bone quaternions exactly against the pre-budget-trim layer.

Repeated Owl wing residual after dodges fell from 42.17 degrees to zero on the
desktop preview and from 40.72 to zero on the constrained mobile preview.
Render counts and asset bytes are unchanged. The synthetic mixer benchmark
uses four paired warmups and eight counterbalanced paired trials, recording raw
trial order/timings. It measured 6.19 ms before / 2.57 ms after for 20,000 sampled
frames, with settled actions 13 -> 1 and evaluations 40,000 -> 20,000. This is
local Node mixer CPU evidence, not device FPS or GPU certification.

## Local review tooling

From `shinobij.client`, using installed project dependencies and Playwright:

```powershell
node --import tsx scripts/pet-motion-inventory.mjs
node --import tsx scripts/pet-rig-coverage.mjs
node --import tsx scripts/benchmark-pet-motion.mjs
node scripts/pet-motion-dev.mjs
# Another terminal; loopback production-component preview on port 5199:
node scripts/capture-pet-motion.mjs after
node scripts/capture-pet-motion.mjs after-video video
```

Open `http://127.0.0.1:5199/petmotionpreview.html?pet=standard-10` for the
standalone preview. For primary combat, build `npm run build:pet-colosseum-qa`,
serve with `node scripts/pet-motion-built-preview.mjs`, and capture with
`node scripts/capture-pet-combat.mjs http://127.0.0.1:5200`.
Generated evidence goes under `docs/pet-motion-evidence/`; recordings and
capture output are local artifacts, not required application files. The optional
comparison script expects a separately captured `before-framed/` baseline.

## Limits

These are genuine additive runtime skeletal motions, not new baked clips.
Existing whole-model procedural presentation still runs alongside them.
Planted-foot IK, terrain contacts, richer species-specific attack/defeat takes
and extreme feather/cape clipping still require source-rig and animation work.
No zero-sliding or zero-clipping guarantee is implied.

Current non-showcase banks have no authored distal rotation channels. A future
generic bank adding those channels needs both incoming and outgoing crossfade
channel protection before enabling recovery. Newly admitted rigs also require
inspection of axis conventions; names and parent chains alone cannot establish
compatibility with arbitrary new skeletons.

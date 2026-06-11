# Coliseum Visual Overhaul — Plan

> Status: **PLANNED, not started.** Written 2026-06-11 after auditing the shipped
> HD-2D coliseum (commits 902b3a8 → c283de0) against a real battle screenshot.
> Scope: presentation only. The deterministic engine (`runPetArenaBattle`),
> the event queue (`buildPetAnimationEvents`), and all balance math are
> untouched — same guardrails as docs/pet-battle-coliseum-remake.md.

## The complaint (user, with screenshot, 2v2 battle at ~1900px-wide viewport)

> "they face the wrong way, they overlap, they float, they look like they are
> just bashing into each other … even if we have to go top down — just
> something that looks better and cleaner."

Every one of those symptoms reproduces from the code. None of them requires a
perspective change to fix. Diagnosis first, then the plan.

---

## Diagnosis — five root causes, with code references

### 1. Wrong facing — facing is baked into pixels by a fallible offline pass

- Battle art is *supposed* to face right ("player as-is, enemy mirrored" —
  `PetColiseum.tsx` `usePetTexture(…, mirror)`); but gpt-image-1 largely
  ignores the "facing RIGHT" prompt and preserves the source portrait's
  orientation (`scripts/gen-pet-battle-sprites.mjs` header admits this).
- The repair is `scripts/normalize-petbody-facing.mjs`: a gpt-4o-mini vision
  classifier flips left-facing sprites and republishes. It has already needed
  one "stricter rubric" pass + a `--flip` manual override (c1802a6) and still
  ships wrong-facing sprites (the screenshot's Eclipse Kitsune + Abyssal Oni
  Hound both face *away* from the enemy). Each fix re-encodes pixels and
  republishes — slow, lossy, and it can never be right *in context*:
- The renderer already computes per-pet `toward` (direction to nearest living
  foe, `PetColiseum.tsx:527-536`) but only uses it for *motion* direction —
  sprite mirror is decided statically by side. In 2v2, pets that cross sides
  keep facing the wrong way even when the art is correct.

**Fix concept: make facing a runtime decision driven by metadata + `toward`,
never by flipping pixels.** Store `petbody:<id>:facing` = `left|right` in the
shared-image registry (the `petsheet:<id>:frames` precedent proves non-image
string values ride the store fine — `pet-battle-anim.ts:84-88`,
`shared-images.ts:42-49`). Renderer mirrors when `artFacing` disagrees with
`toward` (with hysteresis so it doesn't flutter). The classifier's only job
becomes writing metadata; a wrong call is fixed by flipping one string via the
existing admin pet-art grid — instant, no re-encode, no token spend.

### 2. Overlap — separation constants are smaller than the sprites

- Billboards are **2.3 world units wide** (`PetColiseum.tsx:159`), but the
  screen-visibility floor `MIN_X_SEP = 1.4` (`pet-coliseum-scene.ts:61`)
  *guarantees* up to ~40% sprite overlap even when "enforced". Nameplates
  (anchored above each sprite) collide along with them.
- Deeper cause: presentation positions come straight from the sim's 14×7 tile
  grid (`tileToWorld`), then get patched by `spreadPositions` relaxation. The
  sim was tuned for the DOM renderer's abstract grid, not for theatrical
  staging — pets wander into clumps because *nothing* gives the scene a
  composition. Chasing it with ever-bigger push constants (already two commits:
  51e488b, c283de0) is a losing game.

**Fix concept: formation-slot staging.** Decouple *where pets stand* from raw
sim tiles, the way every creature-battler (Pokémon, Octopath, FF) does: each
side owns fixed lane anchors (player front-left + back-left, enemy mirrored),
chosen so sprites can never overlap and nameplates never collide. The sim still
decides everything that matters — who acts, who's in melee range
(`dist = tileDistance(...)` still feeds `buildPetAnimationEvents` unchanged),
who advances/retreats — and the sim's *distance* is expressed as a bounded
"engagement offset" along the lane (advance frames slide the pet forward in
its lane, retreat slides back). Pure function of the frame → deterministic.

### 3. Floating — three compounding grounding bugs

- **Full camera-facing billboards tilt back.** `<Billboard>` (drei) pitches the
  plane up toward the elevated camera (y=4.1), so the sprite's bottom edge
  lifts off the floor visually. The HD-2D standard is a **Y-axis-locked
  billboard** (yaw only — `lockX`/`lockZ`): sprites stay vertical, feet stay
  planted.
- **Generated art has transparent padding under the feet.** The mesh assumes
  art reaches the plane's bottom edge (`position={[0, planeH / 2, 0]}`,
  `PetColiseum.tsx:190`), but gpt-image-1 centers the subject in a 1024² frame
  with margin — every pet hovers by its own random padding.
- **No crisp contact shadow.** One global `ContactShadows` blur
  (`PetColiseum.tsx:296`) reads as ambient darkening, not contact. And the
  floor texture itself is *perspective-painted* (an angled view of a circular
  floor, baked rings + brick border) re-projected by a real 3D camera —
  double perspective makes ground contact ambiguous everywhere.

**Fix concept:** Y-lock the billboards; measure each sprite's alpha bounding
box once at texture load (offscreen canvas scan, cached per src — works for
every already-published sprite with zero asset churn) and anchor the *visible
feet* to y=0; give every pet its own elliptical blob shadow that tracks its
position and shrinks/fades as it leaves the ground during lunges; regenerate
the floor texture as a true orthographic top-down tile and let the camera
supply the perspective.

### 4. "Bashing into each other" — attacks are single-pose lerp slides

- A melee attack is: windup (lean back) → lunge (slide `dx` toward target) →
  impact → recoil — each just a *target pose* (`poseMotion`,
  `pet-coliseum-scene.ts:142-159`) that the standee lerps toward
  (`PetColiseum.tsx:163-182`). Two flat standees gliding into each other with
  no anticipation arc, no contact freeze, no knockback impulse = "bashing".

**Fix concept: keyframed micro-choreography per beat, still 100% procedural.**
The event queue already provides the beats and durations — map each beat to a
small multi-keyframe timeline instead of one pose target:
- **Melee:** run-up along the lane with hop-gait + dust puffs → anticipation
  crouch (squash) → leap with a vertical arc to the contact point (stops at
  `CONTACT_GAP`, already gap-aware) → **hit-stop** (80–120ms freeze on both
  sprites + camera punch-in) → target white-flash 2 frames + knockback impulse
  scaled by damage% → attacker hops back to its slot.
- **Ranged:** plant + recoil on release; projectile flies a slight arc with the
  existing fx trail; target flinches on impact.
- **Idle:** breathing squash-stretch (scale, not just y-bob); KO topple kept.
- Impact already has camera shake + fx sprites — they'll finally land on a
  body that *reacts*.

### 5. Framing — fixed camera + fixed 560px canvas falls apart at wide aspects

- The canvas is `width:100%, height:560px` (`PetColiseum.tsx:493`) with a fixed
  vertical-FOV camera (`CAM_POS/CAM_FOV`, `:51-53`). At the user's ~1900px
  viewport that's a ~3.4:1 aspect: enormous horizontal FOV, pets tiny around a
  dead-empty center, and **black void wedges** where the 40-unit backdrop plane
  and 11-unit floor disc run out (both visible in the screenshot).
- The arena was made 75% bigger and the camera pulled back (c1802a6) to give
  walks room — which made the emptiness worse on wide screens.

**Fix concept:** aspect-aware framing. Camera frames the *living combatants'
midpoint* with a gentle dolly (formation staging shrinks the area it must
cover, so it can sit much closer); horizontal FOV capped — at ultra-wide
aspects the scene letterboxes/expands backdrop instead of stretching the
world. Backdrop becomes a wide curved surface (or simply a much wider plane +
a dark "outer sand" skirt disc under everything) so no aspect ever exposes
void. Per the project's layout lesson (memory: verify at REAL viewports), test
at the user's actual sizes — 1365×911 and 2005×1271 — not assumed ones.

---

## Research synthesis (2026-06-11) — four reference families

Four parallel web-research passes (auto-battlers, Pokémon Legends Z-A, the
Pokémon Colosseum/Stadium lineage, and cross-genre arena/stage design). The
findings converge hard on a handful of techniques and — importantly — supply
concrete numbers and one strategy I didn't have. Full citations at the bottom.

### A. The single biggest idea: our sprites never touch, so don't make them — *edit*

Pokémon Colosseum/Stadium's models **never actually make contact either**; the
games "use the camera and attack animations to mask this" — they **cut to the
defender on impact**, and the edit *implies* the hit. This is the
highest-leverage trick available to us because we have the identical problem
(flat billboards can't physically interpenetrate convincingly). It reframes
Phase 3: instead of fighting to make two standees meet perfectly in world
space, we can let a **dynamic camera hide the gap**.

This sets up the one real design decision (see "Key decision" below): the
**Super Auto Pets** model (make them physically bump, simultaneously, then snap
back) vs the **Colosseum** model (keep them apart, cut the camera to sell it).
For an HD-2D angled spectator battler, the strongest answer is a **blend** —
SAP-style bump for clean melee reads *plus* a Colosseum-style impact push-in.

### B. The #1 thing that makes modern Pokémon look flat — and our current scene too

The consensus diagnosis of why GameCube-era battles felt weighty and Switch-era
ones feel cheap: modern mons **freeze in place until the move's VFX finishes**,
then do a tiny push-back and snap home. The lineage instead triggered the
**defender's knockback/stagger the *instant* the hit lands**, overlapping
reaction with the effect. Our current `poseMotion` lerp has exactly the modern
flaw — the recoil is a slow ease, not an instant reaction. **Fix: impact must
fire the defender's stagger on the contact frame, not ease into it.**

Z-A's own reviews drive the same nail from the other side: the loudest
criticism was the **grounding disconnect** — mons "slide along the floor,"
hold default idle poses mid-move, beams clip through bodies. Reviewers called
the whole thing "clinical." That is precisely the floaty/sliding read the user
flagged in our screenshot. The lesson: **never let a billboard move without a
step/anticipation, and lock its shadow to its feet.**

### C. Concrete numbers for the choreography (from game-feel primary sources)

- **Attack = Anticipation → Strike → Recovery.** Anticipation **8–15 frames
  (~130–250 ms)** with a back-lean + squash; strike is near-instant
  (**~5–10 frames**); recovery/return on an ease-out. (GDKeys "Anatomy of an
  Attack.")
- **Hit-stop is the highest-ROI single addition** — freeze BOTH bodies (and
  hold the damage-number spawn) for **3–6 frames** at contact, scaling **longer
  for crits/KO**. Final Fight used a universal 6f; SF2 ≈10f; Smash scales with
  damage. (CritPoints, SmashWiki Hitlag.)
- **Vlambeer "Art of Screenshake" recipe:** muzzle/impact flash on frame 1,
  **white hit-flash + knockback on the defender**, **screenshake on both firing
  AND hitting (more on hit)**, a split-second hit-pause (longer on death),
  smoothstep camera lerp (never snap). Many small stacked feedbacks = "crunchy."
- **Pacing:** ~**one resolved bump per 0.6–1.0 s** reads as relaxed-but-alive
  (TFT); **hold a visible beat on KO** (the HS Battlegrounds "they die before
  you can see them" complaint); offer a **2×/skip** spectator speed control.
- **Snap the attacker back to its anchor** every time (the HS Battlegrounds
  "Glyph Guardian hangs in the middle" bug) or the formation desyncs.

### D. Staging & "intelligent-looking" movement (Z-A + SAP)

- **Move-driven auto-spacing reads as intelligence for free:** melee billboard
  slides IN to contact range then strikes; ranged/beam slides BACK to a fixed
  offset then fires. This is exactly the engagement-offset idea in Phase 2 —
  the research confirms it's the core blocking rule, not a nicety.
- **Three clear delivery silhouettes** — melee lunge, arcing projectile,
  straight beam — should look distinct from motion alone. (We already branch
  these in `buildPetAnimationEvents`; the renderer should make them read.)
- **SAP serializes its queue** (one bump fully resolves before the next) and
  deliberately *queues* ability VFX rather than overlapping them — its one
  famous bug was overlapping hurt-triggers blending into mush. **For 2v2,
  serialize beats; don't stack simultaneous VFX.**
- **Make beams STOP on the first body** (Z-A's through-clipping beams read as a
  bug).

### E. Arena/stage — direct fixes for the three named scene bugs

- **Baked-perspective floor is a known anti-pattern.** A texture with painted
  perspective fights a real 3D perspective camera (two disagreeing vanishing
  points → "wrong" read). Standard fix: **flat, tileable/orthographic floor
  texture with NO baked perspective + projected decals** (center emblem, court
  rings, scuffs); the camera supplies all foreshortening. A **center-emblem
  circle** both fixes the perspective fight AND fills our empty dead center
  (every creature-battler arena — Stadium's Poké Ball inlay — uses one as the
  camera's visual anchor).
- **Void wedges have an exact cause + fix.** three.js `camera.fov` is *vertical
  only*; horizontal is derived from aspect, so ultra-wide reveals un-dressed
  edges. Fix = **Hor+ with a horizontal-FOV clamp**: hold a target hFOV and
  derive vFOV via `vFOV = 2·atan( tan(hFOV/2) / aspect )`; at ultra-wide hold
  hFOV and let vFOV shrink. **Extend the backdrop + floor well past the widest
  supported frustum** ("set extension") so the camera never sees an edge —
  preferred over letterboxing.
- **HD-2D depth recipe** (Square Enix's own stack): wide-FOV + **tilt-shift /
  depth-of-field** that blurs the backdrop and keeps the combatant band sharp
  (this single effect sells "diorama" and hides backdrop sparseness); a **point
  light casting real shadows** to ground sprites; a **cool rim/back light** so
  warm-lit pets separate from the warm backdrop; **fog gradient + floating
  embers/dust + torch bloom** to fill dead air with atmosphere instead of
  geometry.
- **Value-contrast / grayscale test:** the scene must read in black-and-white —
  darken/desaturate the stands + distance, keep the contact band brightest, add
  a subtle vignette so combatants pop.
- **Composition:** rule-of-thirds, two ranks on the thirds with a clear central
  gap, horizon kept low-to-mid so the floor reads as a deep stage. Crowd = a
  **blurred low-detail ring**, never individually animated, lifted by a
  **crowd-roar swell on hits/KOs** + the existing announcer (audio carries the
  weight cheaply).

### Key decision surfaced by the research — physical-bump vs camera-cut

| Approach | How contact reads | Camera | Best for |
|---|---|---|---|
| **SAP (physical bump)** | sprites actually meet at midpoint, recoil, snap back | static + shake | clean, legible, low-risk |
| **Colosseum (cut/orbit)** | sprites stay apart; cut-to-defender implies the hit | dynamic cuts/orbit | dramatic, weighty, more work |
| **Blend (recommended)** | bump for melee reads + impact push-in/shake | mostly static, punches in on impact/KO | our HD-2D spectator battler |

The blend keeps Phase 1–2 unchanged and makes the camera question a contained
Phase 3/3.5 choice. A full cutting/orbiting camera (Colosseum-grade) is the
upgrade path if the blend still reads flat — and since we're spectator-only,
we have the license Z-A lacked to push the camera in on big beats.

---

## Direction: fix the HD-2D scene — don't go top-down

The user offered "even top down" as an escape hatch. Recommendation: **no**.

- True top-down would obsolete the entire art set: every petbody sprite is a
  three-quarter side view (overhead flat sprites read as paper cutouts), and
  the coliseum backdrop + prefight staging all assume a horizon camera. It's a
  full art regen (~$ and review time for every pet) plus a re-QA, to land on a
  perspective that creature-battlers deliberately avoid.
- Every diagnosed problem has a concrete, cheap fix *within* the current scene,
  and four of five fixes (facing, grounding, staging, choreography) are exactly
  the things a top-down rebuild would also have needed in some form.
- What the user is actually asking for — "cleaner" — is **staging discipline**
  (formation slots, no overlap, grounded sprites, readable attacks), not a
  different camera. Phase 2 delivers the clean staged look of a classic JRPG
  battle inside the existing renderer.

If after Phases 1–3 the look still doesn't land, the fallback isn't top-down —
it's locking the camera lower/flatter (pure constants change) for a more
side-on Octopath look, which all of this work transfers to 1:1.

---

## Build plan

Module rule stays: render logic in `PetColiseum.tsx`; ALL new math as pure
functions in `lib/pet-coliseum-scene.ts` (+ colocated tests, no r3f imports).
Each phase is independently shippable behind the existing `petColiseum.v1`
flag; old DOM renderer stays the default until the user flips it.

### Phase 1 — Grounded + facing right (the credibility fixes) ~1 day

1. **Y-axis-locked billboards**: drei `<Billboard lockX lockZ>` (or manual yaw
   group) so sprites stand vertical. Verify nameplate `Html` anchors still sit
   above heads at both real viewports.
2. **Runtime alpha-trim + foot anchor**: on texture load, scan the alpha bbox
   (offscreen canvas, cache per src). Pure helper
   `spriteBoundsFromAlpha(imageData) → { bottomPad, bbox, aspect }` in
   `pet-coliseum-scene.ts` (testable on synthetic data). Mesh height/offset
   derived from the bbox: visible feet at y=0, plane aspect matches art (no
   more uniform 2.3×2.5 squish).
3. **Per-pet blob shadows**: dark ellipse mesh at y≈0.01 under each standee,
   width from sprite bbox, opacity/scale eased down when the pet's y rises
   (lunge arc, KO). Drop the global `ContactShadows` if redundant.
4. **Runtime facing**:
   - New metadata key `petbody:<id>:facing` (`left`/`right`) in the shared
     registry (mirrors the `petsheet:<id>:frames` pattern; needs the same
     prefix handling already in place since both ride `petbody:`/`pet`).
   - `normalize-petbody-facing.mjs` rewritten to *write metadata only* (one
     vision call per sprite, no pixel flips, no republish of art). Keep
     `--flip`-style manual override writing metadata too.
   - Renderer: mirror = `artFacing` vs live `toward` (hysteresis ±0.3 world
     units before flipping mid-fight). Apply via mesh `scale.x` sign so the UV
     trick and pose math stay untouched. Placeholder (initials) never mirrors.
   - Admin pet-art grid: add a "Flip facing" button per pet that toggles the
     metadata key — the permanent, zero-cost correction path for classifier
     mistakes. (Admin-gated like existing publishes; flag the risk note since
     it touches an admin endpoint payload only, not auth logic.)
5. Sanity-check `depthWrite`/render order once sprites stop overlapping (minor;
   only if popping is visible).

**Exit gate:** screenshot at both real viewports — all four pets visibly
grounded, all facing their foe, before any staging work.

### Phase 2 — Staged formation (kill overlap permanently) ~1 day

1. Pure `formationSlots(combatants, frame) → world positions` in
   `pet-coliseum-scene.ts`: per-side lane anchors sized so
   `anchor gap ≥ max sprite width + nameplate width` — overlap becomes
   *impossible by construction*, not discouraged by relaxation. 1v1 uses the
   two center anchors; 2v2 staggers front/back with guaranteed x-separation.
   Delete/retire `spreadPositions` + `MIN_X_SEP` patching.
2. **Engagement offset**: map the sim's actor↔target `tileDistance` to a
   bounded 0..1 advance along the lane, so the sim's approach/retreat frames
   still *read* (walk-in with hop gait + dust) without literal tile-walk
   clumping. `dist` passed to `buildPetAnimationEvents` is *unchanged* (still
   raw sim tiles) — only where bodies *stand* is staged.
3. **Nameplate declutter**: compact plates (name + bar; numbers on the acting
   pair only or on hover), reserve pets' plates at reduced opacity until they
   act. Keep the existing DOM HP cards as-is.
4. Sprite scale: subtle size classes from the alpha-bbox (and later an optional
   per-species map) so a Colossus reads bigger than a Kitsune — clamp to
   ±15% so silhouettes stay readable.

**Exit gate:** 2v2 prefight → mid-fight screenshots show four cleanly separated,
readable combatants at both real viewports.

### Phase 3 — Combat choreography (kill "bashing") ~1.5–2 days

Research-driven numbers below (GDKeys, CritPoints, Vlambeer); all assume the
scene runs ~60fps so frames ≈ ms·0.06.

1. Pure `beatTimeline(eventType, opts) → keyframe[]` in
   `pet-coliseum-scene.ts` replacing single-target `poseMotion` for the action
   beats (idle/guard/ko poses can stay pose-based). Keyframes over the beat's
   existing `durationMs` (the scheduler in `PetColiseum.tsx:401-428` already
   budgets these — reuse untouched).
2. Melee, beat by beat: **anticipation** (back-lean + squash, ~8–15f /
   130–250ms) → run-up (lane glide + hop bob + `fx/earth` dust puffs) →
   **strike** (fast leap arc, ~5–10f, to the `CONTACT_GAP` stop) → **hit-stop**
   (freeze BOTH sprites **3–6 frames**, longer for crit/KO; camera punch-in via
   `petBattleCamera` beats) → **instant reaction** on the defender — the
   knockback/stagger fires on the *contact frame*, NOT an eased lerp (this is
   the §B fix; the current slow `recoil` ease is the modern-Pokémon flatness) —
   plus a 1–2 frame white flash, knockback impulse scaled by damage/maxHp →
   attacker **snaps back to its anchor** on an ease-out (the HS Glyph-Guardian
   rule; never leave it mid-lane). Crits/signatures keep the bigger shake they
   already trigger.
3. Ranged: cast recoil on release (frame-1 muzzle flash), projectile on a low
   arc (lerp + sine lift — `FxAnim` already supports from→to), **beam stops on
   the first body** (no through-clipping), target flinch on arrival.
4. Idle/victory: breathing squash-stretch (scale, not just y-bob); victory hop
   loop on the result frame.
5. **2v2 ordering:** serialize beats — resolve one attack's queue before the
   next; do NOT overlap simultaneous VFX (the SAP blend-mush lesson).
6. **Pacing + control:** target ~one resolved exchange per 0.6–1.0s; hold an
   extra beat on KO before the result overlay; add a **2× / skip** spectator
   speed toggle (cosmetic — scales the scheduler pace only).
7. `prefers-reduced-motion`: collapse timelines to the existing final-pose
   behavior (already handled for the scheduler — keep parity).

**Exit gate:** a recorded 1v1 melee + 1v1 ranged + 2v2 battle each read as
"attack → contact → instant reaction" to a fresh eye; no sprite ever passes
through another; the attacker always returns to its slot.

### Phase 3.5 — Dynamic camera (optional, the "weight" upgrade) ~1 day

Only if the static-camera blend from Phase 3 still reads flat. This is the
Colosseum lever — *editing implies the contact our billboards can't make*.

1. Extend the existing fixed-camera + shake into a small **beat-driven camera
   director** (pure `cameraForBeat(beat, combatants) → {pos, look, fov}` in
   `pet-coliseum-scene.ts`; the renderer eases toward it on a smoothstep):
   gentle **idle orbit drift** between beats (never a dead flat front view),
   **push-in on the attacker** at windup, **cut/whip to the defender** on
   impact, **pull out to frame all four** for 2v2 and on the result, an
   optional **KO punch-in / brief orbit flourish**.
2. Keep it short (~0.3–0.8s per move per the lineage) and gentle — a spectator
   battler can push the camera (the license Z-A wasted), but motion sickness
   and readability cap how aggressive it should be. Honor reduced-motion by
   falling back to the static frame.
3. Strictly cosmetic + deterministic (pure function of the frame/beat, no RNG)
   so replays still match.

**Exit gate:** side-by-side with the static version — does the cut-on-impact
sell weight without making the fight hard to follow at both real viewports?

### Phase 4 — Framing, floor, stage polish, rollout ~1–1.5 days

1. **Aspect-aware camera (fixes the void wedges):** Hor+ with a horizontal-FOV
   clamp — hold a target hFOV, derive `vFOV = 2·atan(tan(hFOV/2)/aspect)`; at
   ultra-wide hold hFOV and let vFOV shrink. Frame the living combatants'
   midpoint; formation staging lets CAM_POS sit much closer than today.
   Pure `frameCamera(aspect, combatants) → {pos, fov}` helper + tests.
2. **Set extension (no more voids):** extend the backdrop + floor/skirt disc
   well past the widest supported frustum so the camera never sees an edge;
   dark "outer sand" skirt under everything; fog tuned to blend skirt→backdrop.
   Letterboxing only as the last-resort fallback.
3. **Floor regen** via `gen-asset.mjs`: **orthographic top-down** sand/stone
   tile (NO baked perspective, NO baked vignette — the camera supplies
   foreshortening), with a separate faint **center-emblem + ring decal** plane
   projected on top (fixes the perspective fight AND fills the dead center).
   Light direction matched to the backdrop's warm key. Publish/bundle per the
   asset pipeline.
4. **HD-2D depth pass:** add **depth-of-field / subtle tilt-shift** (blur the
   backdrop + stands, keep the combatant band sharp); a **cool rim/back light**
   to separate warm pets from the warm backdrop; **floating ember/dust
   particles + torch bloom** for atmosphere; a **value-contrast/vignette** pass
   (darken stands + distance, brightest at the contact band — must read in
   grayscale). Crowd stays a blurred low-detail ring; add a **crowd-roar swell**
   on hits/KOs to the SFX hook.
5. Mobile + the user's real viewports pass (1365×911, 2005×1271, plus a phone
   width + one ultra-wide): canvas height responsive instead of fixed 560.
6. Rollout: demo to user behind the flag → flip `petColiseum.v1` default to ON
   (DOM renderer stays as fallback) only on explicit approval.

### Explicitly deferred (unchanged from the remake doc)

- AI-animated per-pet sprite sheets (`petsheet:` slot) — the asset-ladder step,
  gated on user spend. Everything above is procedural and free.
- Spine/Rive rigs for hero pets.

---

## Verification (every phase)

- `npm test` at repo root (scene tests live in `pet-coliseum-scene.test.ts` —
  new pure helpers each get cases); `npm run lint` + `tsc -b` in
  `shinobij.client`.
- Visual: `/petvfx.html` harness first, then a real flagged battle; screenshot
  at 1365×911 and 2005×1271 (the user's real viewports — never assume sizes)
  plus one ultra-wide and one phone-width.
- Determinism: no new code reads RNG or wall-clock into anything that feeds the
  sim; all new scene math is pure-function + tested. Replays must animate
  identically (same inputs → same timelines).
- Deploy (when asked): stop dev server → rebuild client dist →
  `git add -Af shinobij.client/dist` → commit src+dist together → push
  `HEAD:main` (cPanel serves committed dist; Railway self-builds).

## Open questions for the user

1. **Camera model** (the decision the research surfaced): ship the **static +
   shake blend** (Phase 3) and stop there, or invest in the **dynamic
   cut-on-impact camera** (Phase 3.5, the Colosseum lever that sells weight by
   hiding non-contact)? I lean: build Phase 3 first, demo, decide 3.5 from the
   real feel.
2. **Camera flavor** once staging lands: keep the slightly-elevated Z-A style,
   or flatten toward a side-on Octopath look? (Constants-only; can demo both.)
3. **Default-ON timing**: flip the coliseum to default after Phase 3 or only
   after Phase 4 polish?
4. Are per-species size classes wanted (Colossus > Kitsune), or keep all pets
   equal-height for readability?

## Sources (2026-06-11 research)

- **Auto-battlers / game-feel:** Super Auto Pets wiki + a327ex mechanics
  breakdown; Hearthstone Battlegrounds wiki (+ Glyph-Guardian "hangs in the
  middle" return bug); TFT design (GDC 2020; world-space mana-over-HP bars);
  Dota Underlords edge-docked UI; Mechabellum silhouette readability; GDKeys
  "Anatomy of an Attack" (anticipation 8–15f, reaction ~0.25s); CritPoints /
  SmashWiki Hitlag (hit-stop 6f Final Fight, ~10f SF2, damage-scaled); Vlambeer
  "Art of Screenshake" / "Juice It or Lose It."
- **Pokémon Legends Z-A:** Bulbapedia + Serebii (wind-up→execution,
  move-driven spacing, melee/projectile/beam, cooldowns); Smogon mechanics
  research; TheGamer impressions; GamesHub review + Metacritic (the "sliding /
  clinical / grounding-disconnect" criticisms = what to AVOID).
- **Pokémon Colosseum/Stadium lineage:** Nintendo World Report (camera
  zoom/orbit; "the models never touch — camera + animation mask it"); Bulbapedia
  Battle effects + Realgam Colosseum (center Poké Ball emblem; pan-out for
  doubles); PokéCommunity "Battles visually left behind…" (instant overlapping
  reaction vs the modern freeze-then-snap); Nintendo Life hidden-animations;
  faint-animation compilations.
- **Arena / HD-2D staging:** Wikipedia HD-2D (tilt-shift, point-light cast
  shadows, bloom/fog/particles); Octopath II "picture-perfect" framing; Carré's
  Corner fighting-stage grayscale/value rules; Darkest Dungeon art (chiaroscuro,
  rule-of-thirds); Halisavakis + Unity threads (orthographic floor projection vs
  the baked-perspective anti-pattern); three.js docs/forum (vertical-only FOV,
  Hor+ clamp `vFOV = 2·atan(tan(hFOV/2)/aspect)`, `<Bounds>` auto-frame).

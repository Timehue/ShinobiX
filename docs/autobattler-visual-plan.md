# Autobattler Visual & Combat Overhaul — make the stage and the fight worthy of the art

> Status: **PLAN, not started.** Written 2026-06-12 after the flipbook pilots
> (Eclipse Kitsune / Abyssal Oni Hound) landed and read clean. Scope:
> **presentation only.** The deterministic engine (`runPetArenaBattle` /
> `runPetArenaParty`), the beat queue (`buildPetAnimationEvents`), balance,
> ranked, and saves are **untouched** — every item here is renderer-side, behind
> the `petColiseum.v1` flag, so there is **zero balance / determinism / save
> risk** (the same invariant every coliseum change has held). Research-backed
> (sources at the bottom).

## The one-line thesis

**The art is the keeper; the stage and the choreography are not yet worthy of
it.** The posed sprites (Oni Hound, Kitsune) already look great. What drags the
scene down is everything *around* them — a flat, unlit stage and a fight that
still reads as "approach → bonk." Both are fixable without touching a single
line of game logic.

> A note on "3D models": the pets are **2D posed billboards on a 3D stage**
> (HD-2D), not rigged 3D models — and that's the right call (148 rigged creatures
> is an infeasible pipeline, and the Octopath/Triangle-Strategy look proves 2D
> sprites can look *more* beautiful than mid 3D). This plan makes them *read* as
> fully dimensional, lit creatures in the world via lighting, rim light, shadow,
> and post-processing — the exact HD-2D trick — and leaves a clean upgrade path
> to "more 3D" (per-pose normal maps) if we ever want it.

---

## Diagnosis — grounded in the actual renderer (`PetColiseum.tsx`)

Why it looks flat, read straight from the code:

1. **The sprites are `meshBasicMaterial` — unlit.** They *ignore the scene
   lights entirely.* No matter how good the lighting rig is, the creatures are
   lit only by their own baked texture → they read as flat cutouts pasted onto
   the floor, never as objects *in* the world.
2. **There is no post-processing. None.** No `EffectComposer`, no bloom, no
   depth-of-field, no vignette, no filmic tone-map. Every glow (auras, cast
   rings, the new afterimage trails, impact flashes) renders at face value
   instead of *blooming*, and the backdrop sits in hard focus competing with the
   action. This is the **single biggest gap** versus every HD-2D reference.
3. **Flat, high ambient + no real shadows.** `ambientLight intensity 0.95` +
   one directional at 0.9, `shadowMap` disabled. No form, no contrast, no
   contact — just the fake blob shadows. The whole scene is evenly, blandly lit.
4. **The backdrop is a static painted cylinder.** No parallax, no atmosphere, no
   air. The arena is a photograph, not a place.
5. **Every attack looks the same.** Even with multi-hit flurries + hit-stop +
   afterimages, there's no *distinct* per-ability spectacle, no element identity
   in the VFX, no telegraph→impact→reaction *cadence*, no persistent status
   read, and no signature/finisher peaks. Autobattlers live and die on per-unit
   readability + rationed spectacle — and right now it's all one texture of
   "sparks."

Everything above is renderer-only.

---

# PART A — The Stage (make it HD-2D gorgeous)

The HD-2D recipe (Octopath Traveler), confirmed by research: **dynamic lighting
+ depth of field + tilt-shift + bloom + a point light that casts sprite shadows
+ a wide FOV that flattens but keeps depth → a diorama.** We have none of the
post layer and an unlit sprite material. Closing that is the highest-ROI work in
the whole plan.

## A1 — The post-processing stack · **highest ROI, do first**

Add `@react-three/postprocessing` (v3 — targets R3F v9 / three 0.184, our exact
stack; client-only, bundled by Vite, so the server never requires it → **no
cPanel npm-install crash risk** — but the dep must be installed + `dist` rebuilt
+ committed). Wrap the scene in one `<EffectComposer>` (its `EffectPass` merges
effects into a single fullscreen pass — cheap):

- **Bloom** — the marquee upgrade. Makes elemental auras, cast rings, impact
  flashes, projectile trails, and the afterimage streaks actually *glow*. Use
  `mipmapBlur`, a luminance threshold so only bright/emissive pixels bloom (the
  matte creatures stay crisp), intensity tuned per element.
- **Depth of Field** — blur the backdrop and slightly the far/back pets →
  instant diorama/tilt-shift depth, and it focuses the eye on the live action.
  Focus distance tracks the camera's look target.
- **Vignette + ACES tone-mapping** — cinematic framing + richer, filmic color
  (currently default linear). A whisper of chromatic aberration at the edges.
- **N8AO (ground AO)** *(optional, gate on device)* — contact darkening where
  sprites/obstacles meet the floor → grounds everything far better than blob
  shadows alone.
- **Perf:** EffectPass merges to one pass; render DoF/AO at half-res; gate the
  heavy effects on `dpr`/device so mobile gets a lighter stack (or bloom-only).
  The coliseum chunk is already lazy-loaded.

## A2 — Real lighting + dimensional sprites

The lighting rig and the sprite material both have to change for the creatures
to feel *in* the scene:

- **Rebalance the rig:** drop ambient to ~0.35–0.45, add a warm **key**
  directional, a cool **rim/fill** from behind → contrast and form instead of
  flat wash. Tie a subtle warm flicker to the existing torches.
- **Rim light on the sprites** — the key move. A small shader (or the known
  billboard rim-light technique that works *without* a per-sprite normal map and
  supports sprite sheets) adds an **element-colored edge light** around each pet
  from the scene lights. This is the one thing that flips the flat cutouts into
  lit, dimensional creatures — for free, no new assets. (Richer optional path in
  Phase 6: real per-pose normal maps → `MeshStandardMaterial`, truly shaded.)
- **Soft real shadows** — enable `shadowMap`; give each pet a shadow-casting
  proxy (or a soft blob + AO) so the contact reads. A real soft shadow grounds a
  creature far harder than today's flat ellipse.

## A3 — Living backdrop & atmosphere

- **Air that moves:** instanced dust motes / drifting embers / element-tinted
  particles floating through the volume (cheap `Points`) — the single cheapest
  way to make a still scene feel alive.
- **Parallax depth:** split the backdrop into 2–3 layers (far wall, nearer
  arches/banners) that shift slightly with the follow-cam → real depth instead
  of a flat skybox.
- **Volumetric shafts:** fake god-rays (additive cones) from the arena openings
  → atmosphere + a reason for the bloom to sing.
- **Crowd/banner life:** subtle shimmer on the stands, swaying banners (torches
  already flicker).

## A4 — A floor that reacts

- **Combat decals accumulate:** scorch / frost / crack marks stamp at impact
  points and persist → the arena *testifies* that a real fight happened.
- **Element zones** light up under casts (ties into bloom).
- **Less-flat floor:** a normal-mapped or faintly specular floor that catches
  the key light, so it's a surface, not a sticker.

## A5 — Composition & camera

- A tighter, lower, more cinematic angle for 1v1; lean into the tilt-shift wide
  FOV that flattens-but-keeps-depth.
- Frame so the backdrop owns the top third (the "stage"), action sits on the
  lower-middle "apron."

---

# PART B — The Fight (read as *fighting*, not bonking)

Autobattler combat is **readability first, rationed spectacle second.** The
genre's known weakness is readability (research); the fix is *distinct, clear,
element-driven ability VFX* with a *telegraph → impact → reaction* cadence and a
few rationed peaks. We have the procedural motion (flurries, hit-stop,
afterimages) — now the *content* of each hit has to differ and the *state* of
the fight has to be visible.

## B1 — Distinct, element-driven ability VFX · **the big one**

Today every hit is the same generic spark. Give each **element** a signature
strike, scaled by impact tier (we already have **251 CC0 FX frames** wired
through `jutsu-vfx` / `jutsu-fx-assets` — lean on it much harder):

- Fire → flame burst + ember spray; Water → splash + droplet ring; Lightning →
  forked bolt + arc flash; Earth → rock shards + dust plume; Wind → slashing
  crescents; etc.
- **Real projectiles for ranged casts** — an element-colored projectile travels
  caster→target with a trail, then *bursts* on contact (instead of a number
  popping out of nowhere).
- Spark/flash/shake size all scale off the existing impact tier (jab = quiet,
  signature = dominates the frame).

## B2 — Telegraph → impact → reaction cadence

Make the rhythm *readable* and varied, not metronomic:

- **Anticipation tell** before a heavy hit — wind-up + a charging glow the
  watcher can read ("something big is coming").
- **Impact** — hit-stop + flash + knockback (have it), now married to the B1
  element VFX.
- **Reaction** — flinch (have it) + a state reaction: stagger on medium, full
  launch/tumble on heavy/crit.
- Vary timing by tier so exchanges breathe instead of tick.

## B3 — Persistent status visuals

The engine already tracks poison / burn / shield / slow / buffs — **render
them** so the watcher reads the *state*, not just the hits: poison = green drip
aura, burn = flame licks, shield = bubble shimmer, slow = frost at the feet,
buff = rising sparkles. This alone makes a fight legible as a fight.

## B4 — Signature & finisher moments (rationed peaks)

- **Signature move / KO** → brief slow-mo + a **cut-in card from the pet's own
  portrait art** + a full-screen element wash + a flash of letterbox. Persona /
  Star Rail grammar. Rationed hard so it stays special.
- The **KO blow** gets the biggest treatment — the speed *contrast* (slow-mo →
  snap back to full speed) is what sells the whole fight as fast.

## B5 — Persistent elemental auras

Every pet always carries a subtle element aura that **intensifies before its
turn** → constant life + a free turn telegraph (and it's what the Part-A bloom
makes glorious).

## B6 — 2v2 choreography

- **Serialize the camera** — exactly one action owns the screen at a time.
- **Off-turn participation** — idle pets hold an aggressive stance, face the
  action, and **guard-flinch when their partner is hit**.
- **Focus-fire reads** + **tag/follow-up attacks** for synergy pairs (ties into
  the teamwork bonds already shipped).

---

## Sequencing — quick wins first, all renderer-only

| Phase | What | Effort | Why this order |
|---|---|---|---|
| **1 — The Glow-up** | Post stack (Bloom + DoF + Vignette + ACES) + lighting rebalance + **rim-light on sprites** | ~½–1 day | Transforms the look on its own. The *existing* sprites + afterimages + auras suddenly read as a lit, cinematic diorama. **Biggest ROI by far — ship it, get a look.** |
| **2 — Elemental combat** | Per-element attack/projectile VFX by tier + persistent **status visuals** | ~1–2 days | Makes the fighting *distinct + readable* — kills "every hit looks the same." |
| **3 — Atmosphere & reactive floor** | Particles, parallax backdrop, god-rays, accumulating combat decals | ~1 day | Depth + life + permanence. |
| **4 — Signature moments** | Slow-mo finishers, ult cut-ins, full-screen washes | ~1 day | The spectacle peaks. |
| **5 — 2v2 direction** | Serialized camera, guard-flinch, focus-fire, tag attacks | ~1 day | Polishes the party mode. |
| **6 — Dimensional sprites** *(optional, heavier/paid)* | Per-pose **normal maps** (model-generated) → `MeshStandardMaterial`, truly shaded; or multi-angle poses | gated | Only if Phase-1 rim light isn't enough. Rim light already buys ~80% of this for free. |

**Minimum-viable beautiful = Phase 1.** It's the cheapest and the most
transformative — the art we already have, finally lit and bloomed on a diorama
stage.

---

## Risk, perf, and the one dependency

- **Zero gameplay risk.** Everything is renderer-side, behind `petColiseum.v1`,
  engine/balance/ranked/saves untouched.
- **One new dependency:** `@react-three/postprocessing` (v3). Client-only →
  bundled by Vite, the Express server never `require`s it, so the cPanel
  npm-install crash class does **not** apply. But: install it, **rebuild + commit
  both `dist/`** (cPanel serves committed dist verbatim; Railway self-builds),
  and verify peer-compat with three 0.184 / R3F 9.
- **Mobile/perf:** gate the heavy post effects (DoF, AO) on `dpr`/device; mobile
  fallback = bloom-only or post off. Keep the classic DOM renderer
  (`PetArenaBattlefield`) as the permanent fallback (do **not** delete it).
- **Verification:** Claude is blind to the live WebGL scene — every phase needs a
  user look (Phase 1 especially: bloom intensity, DoF focus, rim strength).

## Open decisions for the user

1. **Shadows:** soft *real* shadows (prettier, costlier) vs. blob + AO (cheaper)?
2. **Mobile post-processing:** full stack with a perf gate, or bloom-only on
   phones?
3. **Phase 6 normal-mapped sprites:** worth the per-pose generation later, or is
   rim light enough?
4. **Camera for 1v1:** push to a tighter, lower cinematic angle, or keep the
   current follow-cam framing?

## Key sources

HD-2D technique: [HD-2D — Wikipedia](https://en.wikipedia.org/wiki/HD-2D) ·
[Octopath HD-2D breakdown](https://samppy.com/octopath-travelers-hd-2d/).
R3F post-processing: [react-postprocessing docs](https://react-postprocessing.docs.pmnd.rs/) ·
[Bloom](https://react-postprocessing.docs.pmnd.rs/effects/bloom) ·
[SSAO/N8AO](https://react-postprocessing.docs.pmnd.rs/effects/ssao).
Dimensional sprites: [3D sprite edge/rim lighting (shader)](https://godotshaders.com/shader/3d-sprite-edge-lighting/) ·
[SpriteIlluminator normal maps](https://www.codeandweb.com/spriteilluminator).
Autobattler design / game feel: [TFT design pillars](https://nexus.leagueoflegends.com/en-us/2019/06/dev-design-pillars-of-tft/) ·
[TFT art blast](https://magazine.artstation.com/2020/06/riot-games-teamfight-tactics-league-of-legends-art-blast/) ·
[Juice in game design](https://www.bloodmooninteractive.com/articles/juice.html).
Anime-fight craft (companion plan): `docs/anime-fight-plan.md`.

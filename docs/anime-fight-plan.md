# Anime Fight Plan — make pet battles read as two elemental creatures *actually fighting*

> Status: **PLAN, not started.** Written 2026-06-11 after the maze pivot. Scope:
> presentation only. The deterministic engine (`runPetArenaBattle` /
> `runPetArenaParty`), the beat queue (`buildPetAnimationEvents`), balance,
> ranked, and saves are **untouched** — every item below is renderer-side, so
> there is zero balance/determinism risk. Research-backed (sources inline).

## The diagnosis (why it "walks up and bonks with weak abilities")

Three specific failures, each with a known fix from fighting-game / action-RPG craft:

1. **Pets return to far positions between every beat** → reads as "slowly walking
   up." Fix: dash/teleport approach + an *engagement bubble* (stay in close
   quarters between attacks).
2. **One engine "attack" renders as one slide-and-bonk** → reads as "weak
   abilities." Fix: split one damage beat into a 3–5 hit *string* with scaled
   impact on the final hit.
3. **Static sprites sliding fast looks cheap** regardless of speed. Fix:
   procedural smears/trails now; real animation frames later (the multiplier).

The strategy is two layers: a **procedural "speed pass"** (Phases 0–4, free, no
assets, no API key — delivers ~70–80% of the feel) and an **animated-frame pass**
(Phase 5, ~$110–200 via fal.ai — the multiplier that makes motion read as motion).

---

## Phase 0 — The anime stage (roll back the maze) · prerequisite · small

The maze was the wrong canvas (mazes only read top-down; our low side-on camera
sees domino slabs, and traversal is dead air). Revert to a **tight arena** so
pets are always in each other's faces.

- Grid back to small (one knob — the COLS/ROWS parametrization makes this a
  number change), keep the designed floor, keep a few **pillars / low walls** for
  wall-slams (Phase 2) + the existing cover gameplay.
- Keep all engine + terrain logic (high ground, shrines, bushes, teamwork bonds,
  smart targeting all survive — they read *better* at close range).
- Follow-cam + beatTimeline choreography survive and become the foundation.

---

## Phase 1 — Kill "walk up and bonk" · free · **highest leverage**

This phase alone fixes both named complaints. All renderer-side; the engine's
damage number is unchanged — we just split *how* it's shown.

- **Multi-hit strings (B2).** One damage beat → 3–5 visual sub-hits at ~80–120ms
  (jab-jab-jab-LAUNCHER rhythm), each with its own small spark + 3–5f micro
  hit-stop; the **final** hit gets the big freeze + knockback. Sum = the same
  deterministic damage. *The single biggest turn-based→anime conversion.*
  [DBFZ auto-combos]
- **Explosive approach (B1).** Attacker crosses to melee in **≤300ms regardless
  of distance** (scale speed, not duration) with a ghost trail; for ninja pets,
  occasionally **teleport** (smoke puff → reappear at melee mid-swing). Never a
  slow stroll. [DBFZ Super Dash/Vanish, Batman Arkham freeflow]
- **Engagement bubble (B3).** Cluster 2–4 beats into a close-quarters exchange
  where both pets *stay* in the bubble (no retreat to spawn between hits),
  punctuated by a knockback "phase shift" that resets spacing. [Pokkén
  Field/Duel phases]
- **Idle aggression (B4).** Never stand still: procedural micro-bounce
  (asymmetric 100ms/50ms timing reads as coiled energy), forward lean toward the
  foe, micro-feints, slow circling/strafing while waiting. [SLYNYRD fighting-idle
  guide]
- **Per-tick damage numbers (C3).** One small number per sub-hit, rapid, then the
  big summed total; bounce → scale → fade, drain the HP bar in sync. [RPG damage
  number craft]

---

## Phase 2 — Impact weight (the "weak abilities" fix) · free

Make the hit *feel* like force. One shared **impact-tier** value per hit drives
all of these, so a jab is quiet and an ultimate dominates the frame.

- **Damage-scaled hit-stop (A1).** Freeze BOTH fighters on contact; frames scale
  with damage (Smash formula `d×0.65+6`, cap 30f ≈ 500ms; weak ≈ 5–8f). Elemental
  hits ×1.5. *Highest-ROI single addition after multi-hit.* [SmashWiki Hitlag]
- **Hit-stop shake (A2).** During the freeze, vibrate the victim harder than the
  attacker, horizontal for grounded / vertical for airborne, decaying — logical
  position stays fixed. [Sakurai's 8 hit-stop techniques]
- **Scale of importance (A4).** Spark size, flash intensity, shake, and hit-stop
  all derive from the impact tier. Uniform medium sparks = everything reads weak.
  [Riot VFX style guide]
- **Procedural smears (E3).** During the 2–3 frames of a swing, stretch the sprite
  1.4–1.8× along the motion axis, squash perpendicular, tint the stretched copy
  element-colored, and **step** (no tween) between key poses — stepped motion
  reads *faster* than smooth. [Guilty Gear Xrd GDC talk]
- **Impact frames (A3).** On crits/finishers only, a 1–2 frame full-screen
  element-tinted silhouette flash. Rationed so it stays powerful. [Sakuga Blog]
- **Wall-slam (A6).** A heavy knockback slams the victim into a Phase-0 pillar →
  stick 6f → rebound, with a crack decal + camera shake. [DBFZ smash hits]
- **Permanence (A8/E4).** Big hits leave accumulating floor decals (scorch /
  frost / crack). The arena testifies a real fight happened. [Vlambeer
  screenshake]

---

## Phase 3 — Camera as director · free (builds on the follow-cam)

- **Cut per action (C1).** Don't smoothly track — **cut**: attacker wind-up
  close-up → impact shot → wide. 2–3 cuts per beat. Cuts themselves read as
  energy. [Honkai: Star Rail]
- **Finisher slow-mo (A5).** After a crit/kill freeze, run the next 300–500ms at
  0.3–0.5× then snap to full speed. The speed *contrast* is what sells speed.
  [Guilty Gear Strive counter-hit slowdown]

---

## Phase 4 — Elemental identity · free (procedural + existing FX library)

- **Persistent idle aura (E1).** Element wisps/embers orbit each pet at all times,
  intensifying before its turn. One dominant + one secondary color, never
  pure-saturated. [Riot VFX]
- **Dash trails (E2).** 3–5 element-tinted ghost copies along the dash path,
  leading edge sharp, trailing dissolving. Parallel streaks = speed.
- **Element washes/decals (E4).** Screen-edge color wash during big casts; element
  ground decals on impact (ties into Phase 2 permanence).

---

## Phase 5 — Animated sprite frames · **paid (~$5 pilot, ~$110–200 full)** · the multiplier

Static sprites sliding will always cap the quality. Real idle/attack/hurt frames
are what make it *anime*. We already have 148 transparent battle sprites to drive
image-to-video from.

**Recommended pipeline (from fal.ai research):**
1. Pre-composite each transparent sprite onto a flat chroma bg (i2v rejects
   alpha).
2. **Idle loop:** Luma **Ray 2 Flash** (`loop:true`, native looping), ~$0.20/pet.
   Backup: Wan FLF2V with first-frame=last-frame.
3. **Attack + hurt:** Kling **2.5 Turbo Pro** with `tail_image_url` = the original
   sprite, so each clip starts AND ends on the idle pose (chains seamlessly),
   ~$0.35/clip. Cheaper: PixVerse V6 540p ~$0.18.
4. **Alpha back:** `bria/video/background-removal` → WebM alpha (~$0.02/clip).
5. **Frames → sheet:** ffmpeg extract 8–16 frames @10–12fps, downscale to 512,
   pack a WebP sprite sheet for the billboards.
6. **On-model tips:** short clips (≤5s), "static camera / plain bg / creature
   centered" prompt, low motion, reuse seed per pet, end-frame=source as a
   consistency clamp.
- **Plan B (per pet, where i2v drifts):** `falsprite` (Nano-Banana-2 grid sprite
  sheet, ~$0.04/gen, same FAL_KEY) for clean discrete poses.

**Cost (current prices):** pilot 2 pets × 3 clips ≈ **$5 incl. retries**; full
148 × 2–3 clips ≈ **$110–200**. **Always pilot first**, you eyeball quality before
the full run.

**Renderer change:** swap the static billboard for a flipbook — idle loop always
playing; attack/hurt frames triggered by the beats.

---

## Phase 6 — 2v2 coordination · free

- **Serialize the camera (D1).** Exactly one action owns the screen at a time
  (partners may add one short peripheral contribution). [HSR/E7]
- **Off-turn participation (D2).** Non-acting pets hold idle-aggression stances,
  face the action, **guard-flinch when their partner is hit**, reposition at the
  bubble edge — never stand at spawn.
- **Dual / follow-up attacks (D3).** Back-to-back beats on the same target →
  choreograph a tag combo (partner 1 launches, partner 2 intercepts mid-air).
  Ties into the synergy/teamwork bonds already shipped. [Epic Seven Dual Attack,
  HSR follow-ups]

---

## Phase 7 — Ultimate takeovers (signature moves) · mostly free

- Strict hierarchy basic → skill → **ultimate**; the top tier *breaks the frame*
  (full-screen element wash, **cut-in card from the existing pet art**,
  letterbox), rationed to signatures/crits/finishers so it stays special. [Persona
  5 All-Out Attack, Epic Seven]

---

## Sequencing & gates

- **Minimum-viable anime (first shippable):** Phase 0 + Phase 1 (multi-hit, dash-in,
  engagement bubble) + the top of Phase 2 (scaled hit-stop). This alone kills both
  named complaints — ship it, get a look.
- **Phases 1–4 are free** and land ~70–80% of the feel before any spend.
- **Phase 5 (paid)** comes *after* the procedural layer proves the feel; **pilot 2
  pets** (~$5) and approve quality before the $110–200 full run.
- **Phases 6–7** layer on once 1v1 reads great.
- **Verification:** Claude is blind to the live 3D scene — each phase needs a user
  look; the Phase-5 pilot especially needs the user to eyeball asset quality.

## Key sources

Fighting-game craft: [SmashWiki Hitlag](https://www.ssbwiki.com/Hitlag) ·
[Sakurai hit-stop techniques](https://www.youtube.com/watch?v=tycbMSjDDLg) ·
[Riot VFX style guide](https://nexus.leagueoflegends.com/en-us/2017/10/dev-leagues-vfx-style-guide/) ·
[Guilty Gear Xrd GDC](https://www.ggxrd.com/Motomura_Junya_GuiltyGearXrd.pdf) ·
[Dustloop DBFZ](https://www.dustloop.com/wiki/index.php?title=DBFZ/Offense) /
[GGST](https://www.dustloop.com/w/GGST/Mechanics) ·
[Pokkén phases](https://wiki.supercombo.gg/w/Pokken_Tournament_DX/Phase_Mechanics) ·
[Sakuga impact frames](https://blog.sakugabooru.com/glossary/impact-frames/) ·
[Vlambeer screenshake](https://www.youtube.com/watch?v=AJdEqssNZ-U) ·
[SLYNYRD idle stance](https://www.slynyrd.com/blog/2024/9/26/pixelblog-52-idle-fighting-stance) ·
[Epic Seven dev interview](https://news.qoo-app.com/en/post/36433/qoo-otaku-epic-seven-interview) ·
[HSR follow-ups](https://honkai-star-rail.fandom.com/wiki/Follow-Up_Attack).
Animation pipeline: [fal.ai pricing](https://fal.ai/pricing) ·
[Luma Ray 2 Flash](https://fal.ai/models/fal-ai/luma-dream-machine/ray-2-flash/image-to-video/api) ·
[Kling 2.5 Turbo Pro](https://fal.ai/models/fal-ai/kling-video/v2.5-turbo/pro/image-to-video) ·
[Bria video bg-removal](https://fal.ai/models/bria/video/background-removal) ·
[falsprite](https://github.com/lovisdotio/falsprite).

# Tactical Pet Arena — improvement ideas (2026-06-25)

Context: the **control zone (king-of-the-hill)** objective was removed this pass — it
made pets stagnate (they ringed up on a tile and ground a meter) and read ugly. The
mode is now **deathmatch + scroll-capture** (race to 5) with the neutral **Arena Warden**
boss. The Warden was also given a full animation/VFX pass (facing, walk-bob, a
telegraphed rear-up → dodge-able slam with a hot ground warning ring, spawn-rise, death
topple, aura + embers).

What follows is a menu of next steps, roughly highest-leverage first. Everything here is
client/preview-safe unless flagged "balance" or "server".

## 1. Fill the dead time the zone used to (without the stagnation)
The zone existed to make the lulls *between* scroll cycles into positioning play. Better
ways to do that, all **movement-positive** (grab-and-go, never camp-a-tile):

- **Transient buff shrines — BUILT 2026-06-25 (see "Shrines" below).** A Chakra Font
  (team attack buff) / Mending Spring (heal + shield) that rotates in, is claimed by a
  short channel, and despawns.
- **Roaming scroll spawns.** Spawn the scroll at one of several painted points instead of
  always the centre paw, so the squads fight across the whole map over a match.
- **Escalating late scroll.** Past ~2.5 min the scroll is worth 2 — a built-in climax
  (this is the *good* half of the old `zoneValue` idea, applied to the thing players
  actually chase). **(balance)**

### Research: are shrines the right call? (yes)
Modern MOBAs converged on exactly this shape, and *away* from static control:
- **Dota 2 (patch 7.38)** converted simple rune/Lotus pickups into **Shrines** you must
  *enter and channel briefly* while *driving opponents off* — pickup → contested-channel.
- **Pokémon UNITE** spawns **one buff objective at a time**, each granting a timed buff +
  a small shield, respawning on a timer; objectives are spread across the map to force
  rotations and "which objective do we take?" decisions.
- **Deadlock** runes grant timed buffs at contested map points → repeated movement.
The throughline: *one contested pickup at a time, short channel, rotating spawn, timed
buff, no camping*. That's precisely what was built. A plain static zone (what we removed)
is the pattern these games deprecated. Sources in the chat log / commit message.

## 2. Deepen the Warden now that it's a real character
The animation work gives it presence; make it matter more:

- **Enrage at 50% HP** — slams faster + gains one telegraphed *line-dash* charge. More
  reason to commit a team, more spectacle. **(balance)**
- **Carrier aggro.** The Warden preferentially hunts the scroll-carrier → a real
  "grab the boss buff *or* screen the carry" tension.
- **Contestable drop.** On death it drops the attack-buff as a pickup at its corpse
  rather than auto-granting it — the kill is a fight, then a scramble. **(balance)**
- **Pit hazard on death** — a brief collapsing-ground ring where it fell.

## 3. Readability & match flow
- **Objective ticker / mini-HUD**: a Warden countdown + next-scroll timer alongside the
  existing objective line (the data is already in every snapshot — `boss.spawnSecs`,
  `scroll.spawnSecs`).
- **Sudden-death overtime** instead of the HP tiebreak: at the time cap with a tie, spawn
  one golden scroll — next capture wins. Decisive and dramatic.
- **Pre-match VS splash** showing each squad's four roles; **end-of-match MVP** (most
  kills / the carrier who scored the winning capture).

## 4. Strategic depth
- **Per-pet ultimate meter** that charges from damage/objectives and unleashes a signature
  element move (visually big, mechanically a burst/heal/zone). **(balance)**
- **Map hazards** at the corner seals / chokes that interact with the assassin dash and
  any future knockback.
- **Surface the commander intent** (the sim already computes posture + a rally point) as a
  faint on-map marker so a watching player reads the squad "deciding".

## 5. Mode / meta (server)
- **Ranked Arena season.** The lobby is already server-authoritative (ownership-validated
  pets, server-minted seed, sealed rosters → identical replay) and pays **no** rewards
  today. A seasonal ladder is the natural payoff. **(server, balance)**
- **Shareable replays.** Deterministic seed + roster = byte-identical match, so a short
  code reproduces any match for spectating/sharing — nearly free given the determinism
  invariant.
- **Role draft / ban** before the match; **3v3 / asymmetric** sizes.

## 6. Polish / perf
- **Gate the new Warden VFX (aura, embers, extra slam FX) behind the `liteFx` /
  `isLowEndMobile()` path** (see the mobile-perf gate) so low-end phones drop the
  particles but keep the core squash/telegraph. Recommended before this ships wide.

---
### Shrines — BUILT 2026-06-25 (follow-up)
- **Sim** (`pet-arena-sim.ts`): `Shrine` interface + `SHRINE_*` consts + `SHRINE_SPOTS`
  (5 rotating, centre-connected, NON-centre spots). `stepShrine`/`applyShrine`: ONE shrine
  active at a time, spawns on a timer (first at 14 s, respawns 20 s after each claim),
  claimed by a 1.5 s proximity-channel (closest, lowest-id — same shape as the scroll
  pickup, carriers excluded), then respawns at the next spot with the **alternate flavour**.
  - **power (Chakra Font)** → claimer's whole team gets a 12 s attack buff (reuses
    `AF.buffLeft`, the Warden-kill buff lane → consistent "buff" status/renderer).
  - **mend (Mending Spring)** → claimer + allies within 4.0 heal 18% max HP + a 10% shield.
  - **No score** — shrines are a tactical edge only; the win stays scroll caps + Warden.
  - AI: a `shrine` CandKind/candidate weighted BELOW the open scroll (objective owns
    priority while live); a power font pulls the squad mildly, a mending spring pulls a
    HURT pet hard (value scales with 1−hpFrac). Threaded through decide/candidates;
    `shrine` nudges in PHASE_ADJ.comeback / POSTURE_ADJ.press. Snapshot `shrine` field +
    `shrinespawn`/`shrineclaim` events. Deterministic (integer/quantised, lowest-id, no rng).
- **Art**: `shrine-power.webp` / `shrine-mend.webp` (gpt-image-1 transparent cutouts,
  `gen-asset.mjs --id shrine:* --no-style --transparent --gen-quality medium`, ~22 KB each)
  in `src/assets/coliseum/`, on-style with the Warden.
- **Renderer** (`PetColiseum.tsx`): `ArenaShrine` — grounded glowing relic, type-tinted
  ground glow (new `glowTexture()` white-radial), a claim ring that fills with `channelFrac`,
  a floating "⚡ Chakra Font" / "✚ Mending Spring" label, pop-in on (re)spawn. Director
  fires spawn/claim FX + feed + a light flash/shake (no banner/slow-mo — it's not a score).
- **Verify**: 20/20 `pet-arena-sim.test.ts` (added a shrine spawn/claim/payout test),
  tsc + eslint + vite build clean, and **live-confirmed** in `petvfx.html?arena4=1` — the
  Mending Spring sprite + green ground glow + label render correctly alongside the Warden.

### Warden combat + animation + smarter AI — BUILT 2026-06-25 (follow-up)
- **Warden does real damage + a smaller-range move** (`pet-arena-sim.ts`): the Warden now
  has TWO attacks — a fast SHORT-range single-target **swipe** (`BOSS_SWIPE_*`, ~0.8 s cd,
  no wind-up, the reliable un-dodge-able chip → it's a constant threat to anything in its
  face) and the slower **slam** (now `BOSS_ATK_CD` ~2.6 s, dmg 140→**200**, still
  telegraphed + dodge-able). New `Boss.swipeCd` + `bossswipe` event.
- **"Pet treatment" animations**: 4-frame flipbook (`warden-{idle,walk,windup,slam}.webp`)
  generated img2img off the base sprite via fal Nano-Banana on a **magenta chroma-key**
  backdrop (the proven path — black/white flood-removal eats the desaturated golem;
  `gen-warden-frames.mjs`, `keyMagenta`). `ArenaBoss` swaps frames by state (idle / walk
  while striding / windup on rear-up / slam on swipe+slam ticks) on top of the existing
  procedural squash/facing/aura. Old static `bossTexture` removed.
- **Smarter pet AI for this mode** (`pet-arena-sim.ts`):
  - **Shrine smarts** — `shrineP` now breaks an ENEMY's channel (rush the channeler),
    escorts an ALLY's channel (ring up), or claims a free one; the shrine candidate adds a
    big **deny** bonus when an enemy is claiming and dampens pile-on when an ally already is.
  - **Dodge the Warden slam** — a `dodge` candidate fires while `boss.windUp>0`: squishies
    (assassin/sage) bail out of the AoE, trackers mostly bail, **defenders tank it** (so the
    slam still lands on the frontline → the Warden stays threatening). Real counterplay.
  - **No-feed-the-boss** — a low-HP pet backs off the Warden pit (unless it's the comeback
    team) instead of suiciding into the swipe/slam.
- **Verify**: 21/21 tests (added a Warden-swipe/damage test), tsc + eslint + vite build
  clean, live-confirmed in `petvfx.html?arena4=1` (animated Warden up + pets engaging it +
  Mending Spring active).
- **Anti-kite tuning (later same day):** the slam AoE was widened (`BOSS_ATK_RADIUS`
  2.6→**3.3**, slam trigger range 2.2→2.6) so ranged pets can't sit just outside and chip
  for free, and a **short LUNGE** gap-closer was added (`BOSS_LUNGE_*`: a cd-gated ~4-unit
  leap at a target beyond slam reach, no leap damage — the follow-up swipe/slam punishes the
  kite; `bosslunge` event + director FX). The renderer's slam warning ring now tracks the
  TRUE AoE (`BOSS_ATK_RADIUS` exported + used). 22/22 tests (added a lunge test).

### Done this pass
- Removed the control-zone objective end-to-end (sim, snapshot, events, AI candidate,
  renderer `ArenaZone`, zone event handling, test).
- Slam is now **telegraphed + dodge-able**: the Warden rears up (`bosswindup` event,
  `boss.winding` flag, `BOSS_WINDUP` ticks) and the AoE resolves against live positions
  when the rear-up ends — not when it commits.
- `ArenaBoss` renderer: facing flip, walk-bob, rear-up scale + hot ground warning ring
  sized to the slam AoE, impact squash, spawn-rise, death topple, pulsing aura + embers.
- Heavier slam impact (FX + hitstop + slow-mo + shake) and a wind-up rumble in the
  director.

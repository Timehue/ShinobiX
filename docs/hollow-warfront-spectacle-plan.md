# Hollow Warfront — Spectacle Plan (make it exciting to watch, make the mini bosses matter)

Status: P1 + P2 + P3 + P4 BUILT (2026-08-07), plus the "High" visual-quality
preset retirement (perf) and a server-authoritative FIRST-WARFRONT-WIN-OF-THE-DAY
×5 ryo bonus (`api/pet/battle-result.ts`; the date is committed atomically with
the save/reward before the legacy NX key is mirrored; warfront-mode tokens only;
PetArena toasts it). P5 IS ALSO BUILT: MERCY ACCELERATION (`mercy` event — from halftime, a
3-structure lead latches collapse-grade ×3 siege until the Collapse crescendo
takes over; fires ~7/40 mirrors, decided matches end loudly instead of
dragging), awakened-claim slow-mo (renderer), and end-screen receipts now
tally Sigils + name the Hollow Ascendant. The full plan is implemented.

AAA hardening added on 2026-08-10: server-owned Rookie/Veteran/Elite opponent
bands now scale the sealed warband to the committed squad's authoritative power;
the countdown discloses both power ratings and the exact reward contract. Coach
Council pays the sealed base opponent reward for a completed match, independent
of outcome, at most three times per UTC day. It never grants a first-win bonus or
increments win progress. Watch/Auto retains server-replayed outcome rewards.

P3/P4 as built: each awakened claim mints a team Sigil pip (`sigilpip` event,
◆◆◇ rows beside the structure pips); the third claim crowns HOLLOW ASCENDANCE
(`ascendance` — permanent elite waves + ×1.3 siege for that team; fires in
~13/40 matches, an earned crown). The Warden hour is announced 20s before the
WAR phase (`wardensoon` banner + pit cut), and Warden takers now leave the pit
with a 15% team shield (Rayquaza calibration — a closer, not an auto-win).
Post-arc fairness re-verified: the current 40-seed identical-roster mirror probe
finished 19 blue / 21 red with two clock verdicts, replacing the old 37 / 3
pathology. Sim changes go through the usual
pipeline: edit `shinobij.client/src/lib/pet-warfront-sim.ts` →
`node scripts/gen-pet-sim.mjs` (revert line-ending churn on untouched
`api/_pet-sim` files) → `scripts/warfront-parity.test.ts`.

Implementation notes for the built pieces (P1 "Awakened Sigil" + P2 "the
march"): Councils warn at 90/180/270/360s, then the Sigil awakens 15s later
(40s window, none scheduled into the Hollow Collapse); rotation start pad is seeded (`seed % 4`);
an awakened camp fights at full fury (wide aggro, 5s signatures, no regen) and
pays a double bounty; the coaches' answer is STANCE-FLAVORED (balanced/jungle/
headhunt full-squad; siege/turtle trade the Sigil for lane pressure) — an
unconditional both-teams call re-exposed a deep PRE-EXISTING symmetric-play
side bias (see below). A recruited boss now marches the enemy lane and deals
real structure damage (sentinel first, then totem, never the Ward Seal;
MINI_DMG ×1.5, ward + collapse multipliers respected).

The old fixed-side simulation bias is no longer merely hidden by the adaptive
coach. Pet, structure, camp, and neutral resolution order now alternates
deterministically; hollow target selection is symmetric. The current bounded
mirror probe is 19/21, and the multi-archetype regression matrix requires both
sides to win without exceeding the side-skew or timeout ceilings.

## Why it's boring today (diagnosis)

The moment-to-moment layer is healthy (dead air ~1/match, floaters, kill feed,
broadcast camera). What's missing is the **appointment structure** that makes
MOBAs watchable: in LoL/Dota, spectators always know *where the next fight will
be and when*, because Baron/Dragon spawn on announced timers and their buffs are
decisive enough that both teams must show up. Warfront's four named camp bosses
(Ancient Golem / Crystal Behemoth / Void Stalker / Rift Devourer) are ambient —
no schedule, no announcement, no forcing function — so the AI pokes and leaves
(camps contested only ~11–33% of a match, kills rare) and the elaborate payoff
machinery that already exists (recruit-on-kill, camp trophies, permanent boons)
almost never fires. That is the "they legit do nothing" problem: not missing
mechanics, missing **convergence**.

Autobattler lessons (TFT GDC talk): keep spectating "clean" — one readable
focal point at a time, embrace extreme outcomes (blowouts should end fast, not
drag), and make synergies/payoffs visible on the board, not in tooltips.
Pokémon Unite lesson: one scheduled final objective creates the climax, but
"flip it = instant win" (old Zapdos) reads as random — the Rayquaza calibration
(strong closer: shields + faster scoring, not auto-win) is the target feel.

## P1 — Awakened Sigil rotation (the appointment objective) ★ core fix

Every 90s, ONE of the four camps "awakens" on a fixed, HUD-visible schedule
(next-objective timer + minimap ping + banner 15s ahead: "THE ANCIENT GOLEM
STIRS"). While awakened:
- Its bounty is big and team-wide (the existing camp trophy + coins ×2).
- Both AI coaches issue a squad call to contest it (reuse the existing
  squad-call/committed machinery; stance flavors *how many* pets rotate).
- The camp boss fights at full signature cadence (quake/shell/blink/gout).

Effect: every 90 seconds the match manufactures a 4v4 teamfight at a known
place with a known prize — the exact Baron/Drake loop that carries pro LoL as a
spectacle. Kills feed the existing shutdown/comeback economy. The camera
director already prioritizes clustered fights, so this needs almost no renderer
work; the announcer already knows the bosses' names.

## P2 — The slain boss MARCHES (visible payoff, Herald-style)

Today a recruited boss "escorts" pets and buffs them (invisible-ish). Change the
recruit payoff: the slain boss respawns for the killing team and **marches the
nearest lane as a siege monster** — smashes minion waves, then visibly wails on
the sentinel/totem (give it structure damage; today it deals none). Keep the
per-camp identity as its marching aura (Golem shields the wave, Behemoth heals,
Stalker reveals, Devourer makes the wave elite). "You killed the Golem → you
WATCH the Golem crack the enemy gate" is the single most legible "minis matter"
moment we can buy, and it reuses the whole `m.ally` recruit system.

## P3 — Sigil arc (escalation narrative, drake-soul style)

Each awakened-boss kill grants a permanent team Sigil pip (HUD: ◆◆◇). At 3
Sigils → **Hollow Ascendance** banner: elite waves + siege buff until end of
match. Gives casters/viewers a running score to narrate ("Blue is one Sigil
from Ascendance") and gives the losing team a clear steal-the-third drama hook.
Calibrate short of auto-win (Rayquaza rule).

## P4 — Warden as the scheduled climax

The Warden is visible but mechanically dormant, invulnerable, and non-aggro
until WAR. Its contestable moment is announced 20 seconds ahead, and during Hollow
Collapse make its bounty the Rayquaza-style closer (team shield + heavy siege
speed) so the last fight of the match is always AT the pit, on camera.

## P5 — Watchability polish (cheap, renderer-only)

- **Next-objective ticker** in the score strip (spectators live on timers).
- **Mercy acceleration**: if the composite lead exceeds a blowout threshold
  after halftime, ramp `suddenRamp` earlier — extreme outcomes should END, not
  crawl to the clock (TFT lesson).
- Slow-mo + "STOLEN!" replay treatment extended from Warden to awakened-Sigil
  steals (last-hit by the other team).
- Sigil pips + shutdown streaks surfaced in the end-screen receipts.

## Perf (shipped with this doc)

"High" quality retired player-facing: option removed from the Warfront FX
dropdown; a previously stored `petVisualQuality=high` resolves to Medium
(`pet-visual-quality.ts`); `?petQuality=high` remains as the QA override. High's
shadow pass + 1.75 DPR + dynamic lights + distortion was the lag tier. Medium
now exposes the existing squad-camera wall at a cheaper cadence and sheds it
first when the adaptive frame governor detects pressure.

## Broadcast story and opening strategy (2026-08-07 pass)

- The deterministic director can see four seconds ahead, frames objective setup
  before the result, owns a recruited-boss convoy through its first conversion,
  and offers a Medium tactical PiP with tap-to-follow.
- Live intent and stakes explain whether each team is contesting, trading,
  defending, escorting, or pushing; the feed and banners say what changed.
- Ranked turning points on the end receipt are buttons: three seconds of pre-roll
  and four seconds of follow-through, then the finished match is restored without
  reporting rewards twice.
- Opening doctrine is a soft counter triangle for the first 60 seconds:
  Vanguard > Zealot > Bulwark > Vanguard. The read grants +6% attack and +5%
  primary movement; Warden's Pact stays neutral and invests in the later map.
- Precommit scouting reveals one warband style and two unmarked possible
  doctrines, not the raw seed or exact answer. After squad commitment, the
  server reveals the immutable opponent, setup, difficulty band, and power read.
- Coach War Council is real in vs-AI. The start token seals immutable combat
  inputs; each choice is appended through the authenticated Council endpoint,
  and the result endpoint validates and server-replays the complete bounded log.
  Coach rewards are fixed, daily-capped completion rewards—not outcome, win,
  or first-win rewards—so live decisions remain worth making without trusting a
  client-solvable deterministic result.

## Implementation notes / risks

- P1+P2 are sim changes → cross-engine determinism contract (no sin/cos/atan2/
  hypot — use hyp2/dsin/dcos), gen-pet-sim regen, and both the legacy and
  authored Warfront parity suites must remain green. Server settlement must
  continue to reproduce the exact client event/result contract.
- Balance guard: awakened-camp squad calls must respect the Hollow Collapse
  aggro-off rule (don't divert the finale) and the "never camp spawn corner"
  regression test.
- Keep kills-don't-directly-win: Sigils/marches convert fights into *structure*
  pressure, which is the existing verdict formula.

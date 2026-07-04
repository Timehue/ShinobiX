# Pet Coliseum feel overhaul — "make it read like a Pokémon battle"

Goal: the live Pet Coliseum duel looked like the pets *"ran in place and dashed for
no reason."* This pass makes casual pet fights read as a **planted, legible,
dramatic face-off** instead of an illegible MOBA-style spacing skirmish — without
touching any server-authoritative outcome.

## The diagnosis

The live engine (`shinobij.client/src/lib/pet-duel-sim.ts`, behind
`petDuelEngine.v1`, default ON) is a continuous 30 TPS deterministic sim on a big
field. Pets held a wide "neutral" bubble, **circled** each other between attacks,
**backed off after every hit**, and **dashed** back in to re-engage — a real
tactical layer that is illegible to a viewer, so it read as aimless motion. The
presentation layer (move flashes, ultimate cut-ins, announcer, slow-mo) was already
rich; it was drowned out by the wandering.

## What shipped (4 phases)

All behind the existing `petDuelEngine.v1` flag. **Ranked, sector-war territory,
pet-ladder, and clan-war pet duels are byte-identical to before** (see Gating).

- **Phase 1 — Camera (renderer, `PetColiseum.tsx` `DuelDirector`).** The duel camera
  now re-aims every frame: a **cut to the attacker on wind-up** (+ gentle push-in),
  a **cut to the defender on impact**, and a **hold on the victim on KO**, all easing
  back to the live midpoint. An **adaptive dolly** tightens the frame when the pets
  plant close and widens when they spread — so a planted clash fills the frame.
- **Phase 2 — Plant the pets (sim, gated by `plantedMotion`).** Tighter melee/tank
  neutral range, spawns closer (±7 vs ±10.2), the aimless orbit cut for melee/tank
  (ranged still kites), no back-off circle after each hit, and the dash reserved for
  one decisive lunge into melee.
- **Phase 3 — Legibility & drama (renderer).** A guaranteed **"<Move>!" banner on
  every action** (basics get a synthesized `"<Element> Strike"`), a **scaled wind-up
  telegraph** (heavy moves glow + a micro slow-mo), **weightier HP bars** (a lagging
  "damage-taken" chip), and **MISS / recoil reads** that were previously silent.
  Also fixed a pre-existing bug where the *final* KO showed no blast / no "is down!"
  line (the terminal `ko` event carries no `actorId`).
- **Phase 4 — Turn cadence (sim, gated).** A short symmetric post-strike **recover
  breath** so exchanges alternate like turns.

### Tier-2 — cadence variety (sim, gated by `plantedMotion`)

After the fights were lengthened to ~25–45s, a single tempo read as repetitive over
the longer runtime. Tier-2 adds three planted-only cadence beats so a long fight
**arcs** instead of holding one metronome. All are determinism-safe (only
`+ - * / min/max/round/abs`, integer/quantized compares; `rng()` is drawn only behind
a `plantedMotion &&` short-circuit) and **inert on the authoritative path**, so ranked/
ladder/sector stay byte-identical (the `default==explicit-off` test still passes):

- **Feint** — a *healthy* melee pet occasionally winds up and doesn't commit
  (`rng() < 0.09`, skipped once bloodied so a desperate pet commits for real). The
  wind-up telegraph plays; no `hit` event fires; it pays the basic cooldown but no
  stamina — a mind-games beat that breaks the trade rhythm.
- **Fight-phase pacing** (`plantedPaceMul`) — a cagey, bigger-telegraph opening (×1.25
  for the first 6s), then snappier and more desperate once bloodied (×0.78 under 33% HP).
  Scales basic wind-up and recover ticks only.
- **Momentum knockback** — an *occasional true-heavy* blow (crit or ≥18% max HP) shoves
  the victim back ×1.6 harder, so spacing resets and the fight ebbs and flows. Gated to
  real heavy hits: a lower threshold fires on nearly every trade and the constant
  re-spacing grinds even matchups into the time cap.

Tuning note: the momentum threshold (0.18) and feint's bloodied gate matter for *length*.
An early 0.10 threshold + un-gated feint pushed ~38% of fights to the 45s cap (constant
re-spacing / feint-stalled grinds); the tuned values keep the median at ~31s with the
distribution centred in-window. **The 45s cap, HP scale (`PLANTED_TTK_HP`), feint rate,
and momentum threshold are the length/feel knobs — all planted-gated.**

### The fairness fix (important)

Planting the pets into tight melee exposed a latent bias: the sim steps fighters in
fixed **player-first** order each tick, giving the pet that steps *second* a reaction
edge (it sees the first's fresh wind-up and can dodge it). Wide default spacing hid
it (mirror 50.1%); tight planted melee amplified it (mirror dropped to 42.5%). Fix:
in planted mode the per-tick **step order alternates by tick parity**, averaging the
edge out. Determinism-safe (tick parity + a build-time flag, no rng).

## Gating: why `plantedMotion` is a param, not a global change

`plantedMotion` is a boolean threaded like `accuracyEnabled`, **appended as the last
param** of `runPetDuel` / `runPetPartyDuel` / `buildFighter`, stored per-`Fighter`,
**default `false`**. All motion changes branch on it. `false` reproduces the shipped
engine byte-for-byte (asserted by `pet-duel-sim.test.ts` and the parity test).

It is set **`true` only on client-authoritative casual PvE**, where the server does
NOT re-simulate the duel (`api/pet/battle-result.ts`: *"we don't simulate the battle
server-side"*):

| Caller | `plantedMotion` | Why |
|---|---|---|
| `PetArena.tsx` 1v1 (`pveOpp`) | `pveOpp` | vs-AI only; real-player/clan 1v1 stays false so both clients agree |
| `PetArena.tsx` 2v2 | `!pvpParty` | PvE only; clan-war pet2v2 stays false |
| `Dungeon.tsx` (Hollow Gate) | `true` | pure client-side PvE |
| `PetArena.tsx` ranked (`:605`) | `false` | authoritative, two-client canonical |
| `api/village/sector-pet.ts` (server) | `false` | server-authoritative territory |
| `api/pet-ladder/_core.ts` (server) | `false` | server-authoritative ladder |
| `SectorWarPetBattle.tsx` / `PetLadder.tsx` replays | `false` | must match the server |

Because authoritative callers never pass the param, **no competitive outcome shifts
and there is no client/server desync**. This also means we never had to hand-edit the
fragile, drift-prone, parity-untested hand copy `api/pet-ladder/_duel-sim.ts`.

## Balance validation (planted vs default, rare roster)

| metric | default | planted |
|---|---|---|
| mirror player-win % (fairness gate 42–58) | 50.1 | **52.9** |
| round-robin player-side % | 45.9 | **49.8** |
| KO % | 99.8 | 99.7 |
| 30s-cap (timeout) % | 35.6 | **15.3** |
| avg fight length (s) | 23.2 | **18.8** |

Planted fights are fairer on the round-robin, far more decisive, and snappier. The
mirror is a slight *player* lean (benign — the player is always the left side).

## Propagation & tests (every sim change)

`pet-duel-sim.ts` is the source of truth. After editing it:
1. `node scripts/gen-pet-sim.mjs` — regenerates `api/_pet-sim/*` (sector-war server copy).
2. `node --import tsx --test scripts/pet-sim-parity.test.ts` — client ≡ generated server.
3. `node --import tsx --test shinobij.client/src/lib/pet-duel-sim.test.ts` — engine + the new planted-flag test.
4. `node --import tsx scripts/pet-duel-balance.ts` — balance harness (default path).
5. `npm test` (root) + `npm run lint` / `npm run build` (client).
6. `npm run build` (root) + commit the regenerated `dist/` (cPanel serves committed dist).

Do **NOT** hand-edit `api/_pet-sim/*` (generated) and do **NOT** change `ARENA_X`/
`ARENA_Y` (the renderer's field→floor mapping normalizes by them).

## Promotion path (optional, needs sign-off)

To make the planted feel apply to **authoritative** fights too (sector-war, ladder,
clan-war), flip those callers to `plantedMotion=true` AND:
- Hand-port the sim edits into `api/pet-ladder/_duel-sim.ts` (drift-prone; locate by
  surrounding code, not line number — and add a parity assertion for it first).
- Re-run the balance harness on the authoritative matchup distribution and get
  balance sign-off, since it *does* change competitive outcomes.

## Rollback

- Renderer (Phase 1/3): revert `PetColiseum.tsx`.
- Sim (Phase 2/4): flip the client casual callers back (`true`→omit) for an instant
  behavior revert with no server/parity change; or revert `pet-duel-sim.ts`,
  re-run `gen-pet-sim.mjs`, rebuild.
- Whole engine: `localStorage.setItem("petDuelEngine.v1","0")` falls back to the old
  round engine.

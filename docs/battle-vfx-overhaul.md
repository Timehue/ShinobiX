# Battle VFX overhaul — jutsu Arena + Pet Arena (incl. signatures)

Goal: stop slapping the same element explosion on every cast. Pick the effect by
**intent** (damage / DoT / control / support), **discipline** (nin/gen/tai/buki),
and **element**, and give signatures + KOs a cinematic tier. Cosmetic only — the
sims stay the source of truth (the VFX layer is already firewalled from balance &
ranked-replay determinism).

Source packs (in `~/Downloads`, public domain / royalty-free):
- **CodeManu "Free VFX Asset Pack"** (https://codemanu.itch.io/vfx-free-pack) —
  `Effect_*` (big, glossy, cinematic). Frames already individual under
  `<Effect>/30fps/Frames/<Effect>_1/`. Public domain, no attribution required.
- **Ninja Adventure FX** — small pixel art (matches sprite scale). Sheets. CC0.

The existing element folders (`fire/water/earth/wind/lava/none` + `lightning/ice`)
and the pet-kind folders (`buff/heal/shield/slash`) stay as-is. We ADD new keys.

## 1. New `fx/<key>/` folders (all sliced from CodeManu "Free VFX Asset Pack")

`jutsu-fx-assets.ts` auto-discovers any `src/assets/fx/<key>/` folder via
`import.meta.glob`, so adding a folder is all it takes to make a key resolvable.
All frames normalized to a 64×64 transparent canvas (matches existing). Additive
(black-bg) effects are luminance-keyed to alpha during slicing so they render as
plain `<img>` with no blend-mode needed.

| key | CodeManu effect | additive | role |
|---|---|---|---|
| `blood`     | Effect_BloodImpact  | no  | lifesteal, wound, Blood nature |
| `shadow`    | Effect_Tentacles    | no  | debuff, root/movelock, mark, Shadow nature |
| `poison`    | Effect_PuffAndStars | no  | poison DoT (green `fx-poison` tint) |
| `burn`      | Effect_DitheredFire | no  | ignition / burn DoT |
| `impact`    | Effect_Impact       | no  | neutral hit, push shockwave |
| `spark`     | Effect_SmallHit     | no  | light hit, lightning crackle, stun |
| `bighit`    | Effect_BigHit       | no  | crush, Iron nature, heavy melee |
| `kaboom`    | Effect_Kabooms      | no  | KO finisher, Fire signature, AoE |
| `explosion` | Effect_Explosion2   | no  | heavy / KO, Water signature |
| `magma`     | Effect_Magma        | no  | Lava nature |
| `charge`    | Effect_Charged      | no  | signature wind-up (on caster) |
| `aura`      | Effect_Anima        | no  | big self-buff / alt signature wind-up |
| `eshield`   | Effect_ElectricShield | no | strong shield / absorb / reflect |
| `vortex`    | Effect_TheVortex    | YES | drain, siphon, confuse, Wind signature |
| `power`     | Effect_PowerChords  | YES | flagship (mythic/apex) signature |

Pipeline: `scripts/slice-battle-vfx.mjs` (sharp), sources pre-extracted to
`scripts/vfx-sources/<Effect>/`. Downsamples each sequence to ≤12 evenly-spaced
frames, trims, fits onto a 64×64 transparent square, writes `fx/<key>/NNN.png`.
`additive:true` → alpha = perceptual luminance (black → transparent glow).

## 2. Selection logic

### 2a. Pure helpers (node-testable, in `lib/jutsu-vfx.ts`)

`jutsuFxSpriteKey(jutsu, { heavy, isKO }): { key, variant? }` — main Arena. Priority:

1. `isKO` → `kaboom`
2. **self/support** (`isSelfSupportJutsu`): Heal → `heal` (+`fx-heal`); Shield/Barrier/Absorb/Reflect → `eshield` (Water/Earth → `shield`); else a SELF power-up → `aura`, an outward-cast ward/prevent → `buff`
3. **control** (`isControlJutsu`): Stun → `spark`; Seal/stat-down → `shadow`
4. **pressure** (`isPressureJutsu`): Ignition → `burn`; Wound → `blood`; Poison → `poison` (+`fx-poison`); Drain/Siphon → `vortex`
5. **damage** (default): bloodline nature Lava→`magma`, Blood→`blood`, Shadow→`shadow`, Iron→`bighit`; else physical (Tai/Buki) → `slash`; else element folder (`fire/water/earth/wind/lightning`); None → `impact`
6. `heavy` upgrades only a plain neutral/physical hit (`slash`/`impact`) → `bighit`; element sprites keep their identity (they already read big, and the particle layer densifies on `heavy`)

Returns `{ key: "" }` → caller falls back to particle burst only.

`petFxSpriteKey({ beat, actionKind, vfxKey, signature, element, isKO }): { key, variant? }`
— pet Arena. Mirrors the existing beat×actionKind block but: routes
`blood/shadow/poison` (folders now exist; poison gets `fx-poison`), adds a
`ko → kaboom` case, and a **signature** branch (charge beat → `charge` on caster;
impact → `power` when `flagship`, else element-heavy: Fire→`kaboom`,
Water→`explosion`, Earth/Iron→`bighit`, Wind→`vortex`, Lightning→`spark`,
else→`explosion`). KO + signature picks carry the `fx-signature` marquee variant.

`flagship` is the apex tier: `PetArenaFrame.signatureMove.flagship` is set in the
simulator when the casting pet's rarity is `mythic` (derived deterministically
from rarity — cosmetic only, no combat/replay impact), so the rarest pets detonate
the over-the-top `power` burst while lower-tier signatures stay element-themed.

### 2b. Call sites

- **Main Arena** `triggerCombatFx` ([App.tsx ~27501]): replace
  `bundledJutsuFxFrames(jutsu.element)` with `bundledJutsuFxFrames(jutsuFxSpriteKey(...))`,
  pass the tint variant to `JutsuSpriteFx`, and anchor self-casts on the caster
  tile (already have `opts.selfCast` + focus logic).
- **Pet Arena** sprite block ([App.tsx ~12160-12177]): replace the inline
  `fxKey` ladder with `petFxSpriteKey(...)`; handle the `ko` beat; play the
  signature wind-up sprite on the caster during `charge`.

## 3. CSS (`index.css` + `styles/battle-skin.css`)

- `.jutsu-sprite-fx.fx-poison` — green drop-shadow (mirrors existing `.fx-heal`).
- `.jutsu-sprite-fx.fx-signature` — slightly larger + brighter (height 112/132px)
  for the signature/flagship tier so the marquee reads bigger than a basic.
- Additive frames are pre-keyed, so no `mix-blend-mode` needed; if a glow still
  needs lift, add `.fx-screen { mix-blend-mode: screen }` as an optional variant.

## 4. Phases / checklist

- [x] P1 doc (this file)
- [x] P2 `scripts/slice-battle-vfx.mjs` + run → 15 new `fx/` folders (10 frames each)
- [x] P3 `jutsuFxSpriteKey` + `petFxSpriteKey` + unit tests (`jutsu-vfx.test.ts`, 17 cases)
- [x] P4 wire main Arena `triggerCombatFx` (sprite key + tint variant plumbed)
- [x] P5 wire pet Arena sprite block (+ signature wind-up, KO finisher)
- [x] P6 CSS tints (`.fx-poison`) + signature scale (`.fx-signature`); main-arena
      `.fx-heal`/`.fx-poison`; updated `assets/fx/CREDITS.txt`
- [x] P7 `npm run lint` (0 errors / 58 baseline warnings) + `npm test` (55 pass)

## 5. Caveats

- Additive set (`vortex`, `power`) MUST be luminance-keyed or they show black
  boxes. Verify a frame after slicing.
- Keep Foozle big effects to heavy/signature/KO so they don't swamp the board.
- Tinting via drop-shadow only — never pixel-recolor (keeps it cheap + reversible).
- New folders are committed art (like the existing fx frames); the slice script
  runs offline on a dev machine, not in CI.

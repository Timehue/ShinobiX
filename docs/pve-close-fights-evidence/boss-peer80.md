# Level-80 cooperative boss acceptance

This standalone offline probe closes the peer-level gap in the level-100 stress
matrix. It changes no production source and does not rewrite earlier evidence.
The JSON contains the complete owned fixture, independent audit, hydrated combat
sheet, catalog gear/jutsu definitions, actual results, baseline hashes and all
307 candidate source hashes. `complete: true`, zero changed sources and zero
changed prior evidence files were verified against the current files.

The capture ran at candidate `a7036c7b28dddee175f8068bff5bc262baa66b18` on
Node `v24.15.0`. Baseline builders and engine are loaded from archived main
`a31087565df43d4b34f81f5b5bdb5acf5841b724`; archived source is independently
checked against Git blobs, normalizing checkout CRLF only for that Git proof.
Raw before/after SHA-256 hashes are retained separately. JSON SHA-256:
`3c86266dba45c4ff5018f7156ed0987b1c013b0f3909b1bea93ef4797e8daa3d`.

## Legal peer fixture

Every player and every boss is level 80. The three identical players use exactly
19,500 earned stat points, zero unspent points, and a cap-limited Genjutsu
specialist allocation: Genjutsu offense 2,500; intelligence/willpower 2,171;
other attacks/physical axes 1,278-1,279 and defenses 1,596-1,597. No stat exceeds
the 2,500 rank cap. This is a strong focused build, not twelve capped stats at a
fabricated level-80 ledger.

An owned synthetic S-rank bloodline derives the real 1.20 multiplier. Earth and
Wind are the two acquired natures; twelve ordinary-account slots contain only
catalog attacks, damage setup, shielding, lifesteal, recovery and mobility.
Mastery is the legal rank cap of 50. Gear is the level-gated catalog Crimson set
and Ashen Dragon Katana; derived raw armor DR is 0.35. No named, legacy or custom
gear, invented passive, supporter slot, companion or consumable is included.
The independent production-gate audit passes with no failures or acquisition
warnings. Resources are the shared level pools: 8,400 HP and 8,181 CP/SP.

## Method and source models

Seeds are 71041, 71178 and 71315. Forty-two matched cases pair actual archived
main/current constructors and engines with the identical fixture and public
policy. Seven additional current-runtime rotation controls use seed 71041.
The attentive policy escapes marked tiles, answers visible shields/Reflect/DR
with Clear, Cleanses harmful statuses, maintains setup, heals when injured and
focuses adds before the boss. It previews only legal immediate own actions;
it cannot inspect hidden player input or future random draws. This bounded
policy is not an optimal or coordinated role-specialist team.

World trios deposit the maximum sixty Hollow Shards. They contribute to the
existing 600,000-HP shared pool from the same 547,545-HP snapshot for twenty
rounds. A full raid kill is not the participation model or acceptance criterion.
Clan trios attack the existing 24,000-HP persistent-pool slice under each boss's
authored 18-20-round window. Pool damage, survival and slice clears are reported
separately. Entry, attempts, rewards and settlement are not executed or changed.

## Prepared world trios

| Boss / ID | Old survivors | Current survivors | Current minimum player HP | Current bankable team damage | Rotation control |
| --- | --- | --- | --- | --- | --- |
| Chicxulub / `hollow-beast` | 9/9 | 9/9 | 1,291 / 15.37% | 80,701-83,853 | 0/3, wiped round 17 |
| Murogane / `hollow-gate-bull` | 9/9 | 9/9 | 3,872 / 46.10% | 92,835-96,038 | 0/3, wiped round 19 |
| Donkaku / `hollow-maze-minotaur` | 9/9 | 7/9 | 0% (two casualties) | 60,412-86,479 | 0/3, wiped round 17 |

All nine attentive raids reach the twenty-round contribution deadline with
survivors. Old attentive bankable damage was 162,955-194,869 for Chicxulub,
218,145-221,435 for Murogane and 186,888-199,576 for Donkaku. The stronger source
kits now require actions on counterplay and sustain. Preparation does not make
ignoring mechanics safe: the same fixture and shards wipe in each rotation
control. Donkaku still causes casualties under bounded attentive play, so these
results do not imply universally safe prepared raids.

## Prepared clan trios

| Boss / ID | Old clear rounds | Current clear rounds | Current survivors | Current minimum player HP | Rotation control |
| --- | --- | --- | --- | --- | --- |
| Oni Warlord / `oni-warlord` | 5-6 | 10-11 | 9/9 | 3,020 / 35.95% | Cleared round 11; 3/3 alive |
| Abyssal Leviathan / `abyss-leviathan` | 7-9 | 12-13 | 9/9 | 1,931 / 22.99% | Cleared round 13; 1/3 alive |
| Fallen Kage / `fallen-kage` | 6-7 | 9-11 | 9/9 | 2,528 / 30.10% | Wiped round 11; 21,895/24,000 damage |
| Ancient Stone Golem / `stone-golem` | 5-6 | 10-13 | 9/9 | 2,133 / 25.39% | Wiped round 12; 22,319/24,000 damage |

All twelve attentive clan assaults clear their slices within budget. The
same-seed controls show why counterplay matters: two bosses wipe a rotation,
Leviathan takes two casualties, while Oni remains beatable by direct pressure.
This preserves authored differences instead of demanding a wipe from every
boss. Rotation controls are one seed per boss; they are examples, not a wipe
probability estimate. Health figures are observed minima, not guaranteed
targets. The final story Kage is a different solo progression source.

## Limits and reproduction

Tower HP loss/recovery are separately accumulated observed lower bounds per
action/turn boundary when simultaneous damage and healing can net. Shields are
reported separately. World bankable damage uses the real contribution tracker;
net shared HP loss also includes boss regeneration and is a different field.
No live-account play, unprepared peer-80 matrix, duo/four-player sensitivity or
specialized support composition is claimed. The main stress report retains
broader preparation and policy comparisons at level 100.

```powershell
$env:NODE_PATH = Join-Path (Get-Location) 'node_modules'
node --import tsx scripts/pve-boss-peer80-probe.ts
```

The run verifies all eight previous evidence files remain byte-identical.
Strict standalone TypeScript checking also covers this script, its fixture
imports and the separate clan acceptance policy/ratchet correction.

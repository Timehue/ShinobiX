# Legacy System — Generated Asset Manifest

Companion to [legacy-system-plan.md](legacy-system-plan.md) §17. All art below
was generated with the project's standard pipeline (gpt-image-1 → sharp →
WebP/PNG, same style wrapper as `shinobij.client/scripts/gen-asset.mjs`), is
original anime-inspired shinobi fantasy work (no copyrighted IP), and carries a
reproducibility sidecar `.txt` with the exact prompt next to every file.
Regeneration: rerun the batch manifest script (idempotent, skips existing
files) or regenerate one file with `gen-asset.mjs` using the sidecar prompt.

**Wiring status:** the Wandering Sage is fully wired (sector face via the
`wanderingSage` archetype in `lib/wanderer-art.ts`, VN portrait auto-resolved,
`scenes/legacy-sage-offer.png` used by the offer VN). The 8 emissary faces,
badges beyond the defs' `badge` fields, jutsu icons, era banners,
`legacy-trial.png`, the hall banner, and the map marker are STAGED for their
deferred waves — wiring notes below.

---

## 1. Wandering Sage & the Legacy Emissaries (9 NPCs)

The Sage offers Legacies (plan §7). The **eight Legacy Emissaries** are the
"multiple wandering AIs that just do legacy quests": each is a new wanderer
archetype whose only verb is `legacyQuest` — they roam sectors like existing
wanderers (bandit/pilgrim/sage framework in `lib/wanderers.ts`) and hand out
**Legacy trial objectives and stage challenges for their category** (gauntlet /
metric-delta objectives, plan §9.2). Emissaries only offer quests relevant to
the player: pre-acceptance they hint and give category-flavored mini-quests
(feeding `legacy:stats`); post-acceptance the matching emissary becomes the
trial-giver for that player's Legacy category.

Sector face art (512×512 opaque WebP, matching existing wanderer faces):
`shinobij.client/src/assets/wanderers/legacy/<slug>.webp`

| Slug | Name | Category served | Personality hook |
|---|---|---|---|
| `wandering-sage` | The Wandering Sage | Legacy offers (all) | hooded elder, violet eyes, talisman staff |
| `storm-caller-ryn` | Storm-Caller Ryn | Ninjutsu | elemental ascetic, lightning + water robes |
| `veil-mother-suzu` | Veil-Mother Suzu | Genjutsu | porcelain half-mask, lantern moths |
| `iron-pilgrim-daigo` | Iron Pilgrim Daigo | Taijutsu | scarred monk, stone prayer beads |
| `blade-keeper-hana` | Blade-Keeper Hana | Bukijutsu | shrine warden, back full of sealed swords |
| `duel-broker-kesshi` | Duel-Broker Kesshi | PvP | eyepatch, chained ledger of challenges |
| `hollow-warden` | The Hollow Warden | PvE / Gatebreaker | cracked bone mask, keystone sigils |
| `lantern-warden-mei` | Lantern-Warden Mei | Support / Village | iron shield + healing lantern |
| `mapless-ojii` | Mapless Ojii | Explorer | old cartographer with a blank map |

VN dialogue portrait (341×512 WebP, auto-resolved by speaker name via
`defaultVnPortrait("Wandering Sage")`):
`shinobij.client/public/portraits/wandering-sage.webp`

**Wiring notes (implementation wave 4/5):**
- Add the 9 slugs to the `ART` map in `shinobij.client/src/lib/wanderer-art.ts`
  (module imports, same as existing archetypes) and extend
  `WandererArchetypeId` + spawn tables in `lib/wanderers.ts` with the
  `legacyQuest` verb (emissaries excluded from the generic spawn pool —
  spawned per-player by eligibility, like the Sage, plan §7.2).
- Emissary VN portraits: the WorldMap wanderer dialog uses the square face
  (`wandererAvatar`), so no extra portrait files are needed; if an emissary
  ever runs a full VN, copy its square face to
  `public/portraits/<speaker-slug>.webp`.

## 2. Legacy badges (100 — all generated)

256×256 opaque PNG at `shinobij.client/public/badges/legacy-<slug>.png` —
deliberately the same folder/format as achievement badges so the existing
`/badges/${id}.png` render sites (Profile, UserView) work unchanged for
Legacy badges.

**All 100 are generated and live** (one per legacy; slug = legacy id, i.e.
`badge: d.badge ?? d.id` in `api/_legacy-defs.ts` `LEGACY_DEFS` — that is the
authoritative list, with a `.txt` prompt sidecar next to each file). The list
below is the 20 hand-mapped launch originals; the remaining 80 were generated
in the depth wave.

Commons: `wandering-shinobi`, `village-veteran`, `proven-fighter`,
`road-worn-shinobi` (bronze frames)
Ninjutsu: `elemental-storm`, `burning-vanguard` · Genjutsu: `moonlit-ghost`,
`shadow-strategist` · Taijutsu: `iron-fist`, `unbroken-body` · Bukijutsu:
`warborn-blade`, `crimson-duelist` (silver frames)
PvP: `duel-king` · PvE: `gatebreaker` (gold frames)
Village: `ashen-will` (Ashen Leaf), `storm-fang` (Stormveil),
`frostbound-shield` (Frostfang), `moonlit-oath` (Moonshadow)
Support: `village-guardian` · Explorer: `hidden-path`

## 3. Specialty Jutsu icons (100 — 20 generated, 80 pending)

320px WebP at `shinobij.client/public/legacy/jutsu/<jutsu-slug>.webp`, one per
Legacy. **The jutsu themselves are SHIPPED** (all 100, ids `legacy-<jutsu-slug>`
in `shinobij.client/src/data/legacy-jutsu.ts`, server catalog
`api/pvp/_legacy-jutsu-catalog.ts`); the 20 icons below are generated and wired
(via `SHIPPED_ICON_SLUGS` in the data file, so a missing icon renders as an
empty slot rather than a broken image). Generate the remaining 80 with the
authored batch runner (resumable; needs `OPENAI_API_KEY`):

```
cd shinobij.client
node --import tsx scripts/gen-legacy-jutsu-icons.mjs           # ~80 images, gen-quality low
```

then add the new slugs to `SHIPPED_ICON_SLUGS` (or make the image path
unconditional) and rebuild both dists. The original 20, mapped at authoring
time:

| Legacy | Specialty Jutsu icon |
|---|---|
| Wandering Shinobi | `steady-stride` |
| Village Veteran | `rallying-banner` |
| Proven Fighter | `second-wind` |
| Road-Worn Shinobi | `camp-respite` |
| Elemental Storm | `tempest-convergence` |
| Burning Vanguard | `cinder-charge` |
| Moonlit Ghost | `moonlit-execution` |
| Shadow Strategist | `false-opening` |
| Iron Fist | `break-stance` |
| Unbroken Body | `immovable-oath` |
| Warborn Blade | `crimson-draw` |
| Crimson Duelist | `duelists-riposte` |
| Duel King | `throne-challenge` |
| Gatebreaker | `hollow-break` |
| Ashen Will | `ember-oath` |
| Storm Fang | `tide-fang-bolt` |
| Frostbound Shield | `oathkeepers-guard` |
| Moonlit Oath | `veiled-crescent` |
| Village Guardian | `shielding-palm` |
| Hidden Path | `vanish-step` |

## 4. Era banners (5)

1024px-wide WebP at `shinobij.client/public/legacy/eras/`:
`era-1-shinobi-awakening`, `era-2-hollow-gate-opens`,
`era-3-village-dominion`, `era-4-world-boss-awakening`,
`era-5-mythic-legacies`.

## 5. VN scene backgrounds (2)

PNG at `shinobij.client/public/scenes/` — this establishes the folder the VN
engine already looks in (`defaultVnScene(eventId)` → `/scenes/<slug>.png`,
currently 404s for every event):
- `legacy-sage-offer.png` — moonlit village road (Sage offer VN, eventId
  `legacy-sage-offer`)
- `legacy-trial.png` — torii-lined trial grounds (trial VNs, eventId
  `legacy-trial`)

## 6. Hall of Legends + map marker

- `shinobij.client/public/legacy/hall-of-legends-banner.webp` — header art for
  the Legends tab (plan §13).
- `shinobij.client/public/legacy/sage-marker.webp` — transparent 256px violet
  chakra-spiral marker for the world-map "a Sage has appeared" dot (plan §7.2).

## Deployment note

These are source assets. They reach players on the next client build
(`public/` is copied into `shinobij.client/dist/`, `src/assets` bundles via
imports once wired). Per the dist image-churn rule, when that build is
committed for cPanel, add these new files explicitly rather than re-committing
every recompressed PNG.

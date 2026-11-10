# Sector building counters

Sector buildings have public thresholds with named keepers, persistent local
trust and server-settled services. The registry in
[`shared/sector-buildings.ts`](../shared/sector-buildings.ts) owns their identity,
position, reachable approaches, interaction footprints and service lists.
Existing stronghold, village and shrine admission remains with its existing
system; speaking to a keeper does not grant entry or an offering.
There are 57 named counters, including a dedicated counter at Heartwood’s
existing kettle table; the shrine keeper retains the separate witness register.

## Covered places

The audit found 28 ordinary strongholds (S2–8, S10–16, S18–24, S27–33), the
Obsidian Stronghold (S99), four village gates (S1, S9, S17, S26), and six shrines
(S4, S15, S23, S31, S44, S56). Public counter interaction now covers these even
when their guarded activity is unavailable.

The previously unnamed painted frontages receive distinct identities:

- S38: the damaged banner tower becomes Gorgewatch Post.
- S50: the western collapsed houses become Esplanade Record House; the eastern
  frontage becomes Esplanade Repair Yard.
- S52: the western arrival house, southern lantern frontage, southwestern
  performers’ house and eastern tea counter become four separate premises.
  The first three are painted collapsed, so they are ruins: their keepers work
  from the open ground beside the fallen roofs, and public repairs restore them
  for seven days at a time. Only the eastern tea counter is painted intact.
- S60: the western broken walls become Obsidian Road Station; the northern
  fragments become Obsidian North Watch.
- S62: the western houses become Greycliff Relay House; the eastern carved-stone
  enclosure becomes Greycliff Witness Enclosure.

Five already named, story-only road places also have ordinary public use:
Flower-Pickers’ Shelter (S3), South Watch Post (S27), Lower-Road Kitchen (S28),
Shuttered Boathouse (S20) and Old Toll Booth (S21). Their campaign records and
outcomes remain owned by their existing story systems.

## Player services

1. **Reception.** Daily conversation builds local trust. Stronghold greetings
   use the current village holder; the counter explains interior restrictions.
2. **Tea and regulars.** Reserve 30 ryo, rest for 15 seconds, and receive the
   existing small Cafeteria meal recovery. Cancel before serving for a full
   refund. Kettle rounds have a 15-minute cooldown. Hosts recognize repeat
   visits and refer only to a selected, owned companion.
   Eda’s outdoor festival ledge accepts new cups only during its existing
   serving phase and suitable weather. Preparing, packing and covered phases
   retain the public book. Accepted cups can still finish or be refunded after
   closing; the server reads the same territory weather and routine as the map.
3. **Chronicle investigations.** Five ruins each have three distinct reachable
   observations and keeper testimony. Record a bounded account or preserve its
   unanswered question. The first complete account pays 90 ryo; evidence,
   interpretation and the readable account survive reconnecting.
4. **Communal repairs.** Choose exact existing material grades, complete three
   timed work steps, and contribute to a shared restoration roll. Completed
   masonry stages change the map artwork. A restored ruin stands for seven
   days, then weathers back to its painted ruin (see below). Roadside meeting places receive
   maintenance seals on their signposts rather than a roof painted over a road.
   A road place can instead stand as a real building (`building` in its
   registry entry): its tiles beside the road become solid (`B`) in the
   sector's walk mask, its own top-down sprite replaces the signpost, and its
   seals sit on that roof. The sprite is painted into the sector floor, like a
   restored ruin, from a small client table
   (`shared/sector-standing-structure-art.ts`, pinned to the registry by a
   test). It therefore shows from neighbouring sectors and never waits on the
   counter request: the tiles are solid either way. The Flower-Pickers’ Shelter (S3,
   a 2×2 building on tiles 101, 102, 113 and 114, about the size of the
   stronghold across the road; counter approached from road tile 100) is the
   first.
   A story road place’s campaign stop stays on its counter approach, so Mira’s
   marker stands at the shelter rather than on the old signpost tile.
   `scripts/validate-sector-layouts.mjs` keeps each painting within its own
   14–43 blocked tiles and lets placed buildings add at most four more per
   sector (one stronghold-sized building). Every unsited `B` cell must match a registered building exactly. The
   occupancy guide (`scripts/sector-layout-guide.mjs`) draws those tiles in
   their own colour. `scripts/author-sector-world.mjs` does not add them, so a
   re-authored mask must keep those cells `B` by hand; the validator refuses
   one that drops them.
   Other systems read those `B` cells, not the registry. The roaming world
   boss (`world-boss-sector-placement.ts`) claims every `B` cell, so its tap
   area never reaches over a building's roof. A trail sign stands on walkable
   ground only (`signTile` in `api/sector/_traces.ts`). A sign left on a
   tile that later became a building moves to the nearest open tile when it
   is next read.
   Changing a mask also changes the continuous-world `layoutVersion`, which
   hashes every mask. Saved world cursors then fall back to their sector tile.
5. **Courier relays.** Carry a sealed pouch through two receiving counters on
   the canonical connected road graph. Both receiving stamps are required.
   The work book retains the itinerary away from the issuing building.
   Harbor/deepwood stops follow Tetsu’s established circuit, including the
   Greycliff frontage and Ren’s actual Heartwood tea table. Tetsu keeps his
   existing mat; the player uses a separate reachable approach.
6. **Watch rounds.** Inspect the public approach and route marker, then return
   to the signal threshold. Each observation preserves server-derived weather
   and day/night conditions. Shared reports describe inspected points, never
   certify unchecked routes as safe.
   At Gorgewatch, braces and weatherproofing change the inspection. A fully
   restored post reopens the longer signal sightline from the bridge crossing.
   Each accepted round seals its stage so other players’ repairs cannot move
   an unfinished checkpoint after reconnecting.
7. **Regional workshops.** Use existing supply recipes, exact selected inputs,
   ordinary level gates and inventory capacity checks. Five local trust opens
   a keeper’s third regional recipe where present; other existing crafting
   locations retain their recipes.
8. **Entrusted contacts.** Observe a marker from a nearby sightline, check the
   intact exterior seal, then use its agreed shutter, slot or speaking window.
   The protocol varies with the server hour and remains sealed into the order.
   A broken seal or wrong handoff loses two local trust, pays nothing and
   shutters the contact for five minutes.
9. **Witness registers.** Each shrine retains its own local account. Repair,
   courier and investigation signatures require real completed deeds.
   Chronicle accounts record people and choices; they do not contain souls or
   manufacture missing campaign witnesses.
10. **Festival premises.** Nao teaches arrival duty and the existing S54
    entrance, Fumi teaches lantern preparation with returned practice equipment,
    and Mina teaches bow/left/right/bow. Eda’s eastern counter serves tea.
    These activities retain the existing Sunscar admission flow.

At five trust the road book expands from two nearby staffed stops to four.
Completed work also earns saved counter distinctions. The global work-book
button remains available after an order ends, with lifetime deed counts and the
last 80 named counter receipts. Distinctions are local records, not new equippable
title items.
The road book docks clear of the personal-quest journal and yields while the
journal is expanded. Routes to or from the isolated Obsidian arena open the
existing atlas travel flow; they never pretend to be connected walking roads.

The MMORPG research and ranked adaptation list are recorded in
[`sector-building-research.md`](archive/reports-and-plans/sector-building-research.md). These comparisons
explain the design approach; the rules below and the registry remain authoritative.

## Repair economy and persistence

Every repair reserves **3 ore/mineral inputs, 2 hunting lining materials,
2 fish, and 4 harvested lashing/packing materials**. The existing ingredient
planner validates exact grades and quantities. Rare stock is never selected
automatically. Cancellation returns the exact escrowed items once.

Each completed order pays **180 ryo**. Every three personal lifetime repairs pay
**3 bone charms**. Every 20 personal lifetime repairs earn **5 fate shards**,
with **no weekly shard cap**. Repairs 20, 40 and 60 each pay five shards, even
within the same week. Any unpaid milestone batches deferred by the retired cap
are settled together on the next completed repair. Cancelling or starting work
never advances either milestone or pays a deferred batch.
The server and counter copy share `BUILDING_REPAIR_REWARDS` in
`shared/sector-building-rules.ts`; `shardClaims` counts paid milestones, not shard
units. The obsolete `shardWeek` field is ignored and removed when progress is
next saved. Existing paid receipts remain historical and are never recalculated or
paid again when reward amounts change. There is **no daily repair cap**: players
can keep completing paid repairs while they can supply the required materials.
The daily count records activity and resets at UTC midnight without gating work
or resetting lifetime milestone progress. The internal daily payment count also
retains every completion, including more than 20 payments. Lifetime counters,
paid-batch counts,
personal contributions and shared revisions retain JavaScript safe integers;
they do not stop or rewind at one million after reloading. Stronghold and
road-place stages are permanent at 4, 12 and 24 completed communal orders;
subsequent work maintains the public shelter.

**Ruins restore for seven days.** A building whose painted art is a ruin
(`kind: 'ruin'`) counts its stages from the current restoration cycle
(`cycleRepairs` on the shared row), not from lifetime repairs. Its stages are
Ruin, Braced frame, Covered frame and Restored, named for the three
restoration sprites (timber frame, canvas cover, tiled roof), and the counter
calls the service Ruin restoration. The 24th order of a cycle
restores it and sets `intactUntil` to seven days later
(`BUILDING_RUIN_INTACT_MS`). While it stands the counter takes no new repair
orders; an order already under way when another crew finishes is still paid,
but never extends the timer or advances the finished cycle. When the time ends,
the stage returns to Ruin, the restoration art disappears and the next cycle
starts from zero. An unfinished cycle with no completed repair for fourteen days
(`BUILDING_RUIN_IDLE_FADE_MS`, measured from `cycleAt`, not from watch reports)
also returns to zero. Lifetime `repairs` and the contributor roll are never
reset. A row written before the timer existed is treated as a full cycle that
ends seven days after its last write. Gorgewatch’s long sightline follows the
same stage, so it opens only while the post stands.

**World fights damage ruins.** When a verified world PvP fight (world authority
with progression, both players present in the sector) ends, the terminal
settlement (`api/pvp/_committed-terminal-effects.ts` →
`api/sector/_ruin-battle-damage.ts`) damages every ruin in that sector: a
standing restoration loses twelve hours and falls at once if less than that was
left; unfinished work loses two repairs. Spars, ranked and arena fights never
count. Each battle counts once per building (`damagedBy`, so replayed
settlement is harmless) and each building takes at most four damaging fights a
UTC day (`BUILDING_RUIN_BATTLE_DAMAGE`).

**Restored buildings pay better.** While a ruin stands restored, work accepted
at its counter (courier, watch, contact, festival and a recorded field account)
pays a quarter more, and its workshop fee is a quarter lower
(`BUILDING_RESTORED_PERK`, `api/sector/_restored-perks.ts`). The bonus is sealed
into the order when the work is accepted, so a building falling mid-round keeps
the accepted terms and a round accepted on the ruin gains nothing. Repairs and
tea are unchanged.

**What a restored ruin looks like.** Each ruin has its own painted restoration
(`shinobij.client/public/sector-buildings/restored-<id>-v1.webp`). While it
stands, the painting is drawn into the sector floor canvas, under players and
NPCs, by `shinobij.client/src/lib/sector-restoration-art.ts` and the world
renderer's floor painting. The ruin's plot is cleared to ground sampled from
the same floor, the intact building stands on the ruin's main solid block, and
every other solid tile of that ruin gets a tidy intact feature (stacked crates,
a lantern rack, a hedge bed, a stone lantern, a brazier plinth or a wall
section), so no tile looks walkable while the walk mask blocks it. Pieces sit
only on solid tiles, and cleared ground never covers a road or water.
Stages 1–2 still show the timber frame and canvas cover over the ruin as work
in progress. In its final day a restoration shows its weathered painting
(`weathered-<id>-v1.webp`: faded, chipped and mossy roofs, frayed banners,
still standing) before it falls. Every sector's restored ruins ride the public
`GET /api/world-state` snapshot (`restoredRuins`, in its ETag), so neighbouring
sectors paint them before a player walks in; the sector you stand in uses its
fresher counter view. Two plots are larger than their counters: the Welcome House plot
includes the collapsed long house between it and the Performers' House, and
the Lantern House rebuilds the southern row of houses. Neighbouring ruins that
belong to no counter, such as the sector-edge walls, stay ruined.

The layout lives in `shared/sector-ruin-restorations.ts`, and
`scripts/bake-ruin-restorations.mjs` builds each painting from the Figma
renders in `shinobij.client/art-source/ruin-restorations/` (prompts in
`prompts.json`). The client ships only the draw boxes
(`shared/sector-ruin-restoration-bounds.ts`); a test pins them to the layout.
Changing a render or the layout means re-baking, then updating
`docs/art/sector-building-art-v1.json` and the sector-building receipt in
`scripts/verify-dist.mjs`.
The public work roll shows the leading 20 contributors. Personal counts remain
in the player’s record when a contribution falls outside that displayed roll.

Other paid work: courier delivery 120 ryo, three per UTC day; watch round
80 ryo, one per post per UTC day; entrusted handoff 100 ryo, one per contact per
UTC day; festival duty 60 ryo, one per premises per UTC day. Register signatures,
visits and unfinished work pay nothing. All amounts are server-owned.

Personal state is `character.sectorBuildings`; shared rows use
`world:building:<buildingId>` in the existing KV table. No schema migration is
required. Generic autosaves mirror the personal state and combat projections
strip it. Settlements replace the whole subtree so cleared active orders and
cancelled reservations cannot be resurrected by the legacy object merge.

The API holds fail-closed shared-building and player-save leases, checks verified
current presence, walkable proximity, travel, hospital, gathering and durable
battle state, then settles through the existing versioned writer and currency
ledger. Shared work appends its compare-and-set to the same atomic save commit;
a backend without atomic shared writes refuses before spending or paying.
Stable request identities recover lost replies; clients retry the same identity.
Save versions and communal revisions prevent stale reads from reversing progress.
Obsidian uses the existing arena’s verified, server-clamped tile and a walkable
adjacency check because it intentionally has no connected-road position cursor.

## Art and operations

Production WebP assets live in `shinobij.client/public/sector-buildings/`.
Thirty-nine illustrations/sprites cover the service families, Frostfang winter
variants, three transparent restoration stages, the ten restored and ten
weathered ruin paintings, three road-place headers and the Flower-Pickers’
Shelter map sprite.
The road-place headers (Flower-Pickers’ Shelter, South Watch Post, Old Toll
Booth) are resized from the campaign painting of the same place, so the counter
shows the place the story shows. Input manifests in
`docs/art/sector-building-*-inputs-v1.json` retain exact generation prompts and
source paths. `sector-building-art-v1.json` pins output hashes and sizes;
`node scripts/package-sector-building-art.mjs` repackages the retained originals.
Pass asset ids to re-encode only those; the rest keep their receipted bytes.
The ruin paintings come from `scripts/bake-ruin-restorations.mjs` instead, so
the packager carries their entries over unchanged.
Normal builds consume the checked WebP assets and do not call a provider.
The release verifier gives the thirty-nine assets a separate, fixed 2,581,396-byte
partition and verifies that delivered files match their checked source bytes.
The existing allowance for all other runtime assets remains unchanged.

`DISABLE_SECTOR_BUILDINGS=1` temporarily closes counter books. Existing guarded
entrance callbacks remain available at their proper thresholds when counter
metadata cannot load. Do not delete player escrow or shared rows to disable the
feature. Re-enable it to let unfinished orders resume or be cancelled.

Contract tests run in the root suite. `e2e-live/sector-buildings.spec.ts` exercises
the real server with actual saves and physical road travel. Run desktop and phone
projects against separate fresh servers to respect the registration allowance.
CI’s two building shards verify the immutable joined release artifact and feed
the compatibility gate. Frontend changes also require the full responsive and
strict combat-layout suites documented in `CLAUDE.md`.

## Counter inventory

This inventory is transcribed from the canonical registry for the initial release.
Positions and future changes belong in the registry above.

| Sector | Building | Keeper | Services |
| --- | --- | --- | --- |
| 1 | Stormveil Gatehouse | Harbor duty clerk Hina | reception, courier |
| 2 | North Docks Stronghold | Harbor duty clerk Isao | reception, repair, workshop, courier |
| 3 | Flower-Pickers’ Shelter | Shelter Keeper Ume | reception, repair |
| 3 | Upper Terraces Stronghold | Harbor duty clerk Kiri | reception, repair, workshop |
| 4 | Tidecaller Shrine | Tidecaller Keeper | register |
| 4 | Clocktower Hill Stronghold | Harbor duty clerk Nori | reception, repair, workshop |
| 5 | Reedmarsh Boardwalk Stronghold | Harbor duty clerk Riku | reception, repair, workshop |
| 6 | Eastern Stilts Stronghold | Harbor duty clerk Sae | reception, repair, workshop |
| 7 | Western Piers Stronghold | Harbor duty clerk Toki | reception, repair, workshop |
| 8 | Canal Heart Stronghold | Harbor duty clerk Yuna | reception, repair, workshop, courier |
| 9 | Ashen Leaf Gatehouse | Deepwood quartermaster Aya | reception, courier |
| 10 | Cliffside Deepwood Stronghold | Deepwood quartermaster Bun | reception, repair, workshop |
| 11 | Blossom Grove Stronghold | Deepwood quartermaster Chika | reception, repair, workshop |
| 12 | Canopy Heights Stronghold | Deepwood quartermaster Dai | reception, repair, workshop |
| 13 | Headland Woods Stronghold | Deepwood quartermaster Eri | reception, repair, workshop |
| 14 | Gorgeview Plateau Stronghold | Deepwood quartermaster Fusa | reception, repair, workshop, courier |
| 15 | Ren’s Heartwood Tea Table | Tea Seller Ren | tea, courier, reception |
| 15 | Heartwood Shrine | Heartwood Keeper | register |
| 15 | Heartwood Shrine Stronghold | Deepwood quartermaster Goro | reception, repair, workshop |
| 16 | Fern Terraces Stronghold | Deepwood quartermaster Hana | reception, repair, workshop, courier |
| 17 | Moonshadow Gatehouse | Road trust registrar Itsu | reception, courier |
| 18 | Jade River Bridge Stronghold | Road trust registrar Jin | reception, repair, workshop, courier |
| 19 | Western Eaves Stronghold | Road trust registrar Kana | reception, repair, workshop |
| 20 | Shuttered Boathouse | Contact Ren | intelligence, reception |
| 20 | Amethyst Canopy Stronghold | Road trust registrar Maki | reception, repair, workshop |
| 21 | Old Toll Booth | Toll Clerk Ise | intelligence, register |
| 21 | Moonstone Rise Stronghold | Road trust registrar Rena | reception, repair, workshop |
| 22 | Moonlit Cove Cliffs Stronghold | Road trust registrar Sora | reception, repair, workshop |
| 23 | Moonwell Shrine | Moonwell Keeper | register |
| 23 | Moongrotto Stronghold | Road trust registrar Tae | reception, repair, workshop |
| 24 | Crystal Plaza Stronghold | Road trust registrar Yori | reception, repair, workshop, courier |
| 26 | Frostfang Gatehouse | Winter supply clerk Anri | reception, courier |
| 27 | South Watch Post | Watch Guide Eda | watch, reception |
| 27 | Far Glacier Shelf Stronghold | Winter supply clerk Eiko | reception, repair, workshop, courier |
| 28 | Lower-Road Kitchen | Winter Cook Gen | tea, repair |
| 28 | Needle Spires Stronghold | Winter supply clerk Haku | reception, repair, workshop |
| 29 | Highpass Peaks Stronghold | Winter supply clerk Kota | reception, repair, workshop |
| 30 | Glacier Terraces Stronghold | Winter supply clerk Mei | reception, repair, workshop |
| 31 | Frostveil Shrine | Frostveil Keeper | register, tea |
| 31 | Shrinefall Shelf Stronghold | Winter supply clerk Natsu | reception, repair, workshop, courier |
| 32 | Knife-Edge Summit Stronghold | Winter supply clerk Oto | reception, repair, workshop |
| 33 | Cinderfrost Divide Stronghold | Winter supply clerk Ryo | reception, repair, workshop |
| 38 | Gorgewatch Post | Watcher Jun | watch, repair, survey |
| 42 | Fieldside Tea House | Tea Seller Mako | tea, courier, register |
| 44 | Shrine of the Ancients | Shrine of the Ancients Keeper | register |
| 50 | Esplanade Record House | Archivist Chise | survey, repair, register |
| 50 | Esplanade Repair Yard | Carpenter Rin | repair, workshop |
| 52 | Sunscar Lantern House | Lantern Maker Fumi | repair, workshop, festival |
| 52 | Sunscar Performers’ House | Performer Mina | festival, reception, repair |
| 52 | Eda’s Festival Tea Counter | Cook Eda | tea |
| 52 | Sunscar Welcome House | Arrival Host Nao | reception, festival, courier, repair |
| 56 | Hollow Gate Shrine | Hollow Gate Keeper | register |
| 60 | Obsidian North Watch | Watch Clerk Ise | watch, repair |
| 60 | Obsidian Road Station | Scout En | repair, survey, watch |
| 62 | Greycliff Witness Enclosure | Keeper Sena | register, survey, repair |
| 62 | Greycliff Relay House | Relay Clerk Hiro | courier, repair, survey |
| 99 | Obsidian Stronghold | Watcher Seki | reception, repair, workshop |

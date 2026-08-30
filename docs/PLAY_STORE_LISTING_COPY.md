# Play Store listing copy

Paste-ready text for the Play Console listing fields. Nothing here touches Play;
it exists so the fields are filled from a considered draft rather than written
under time pressure when the console finally opens.

Character limits are Play's, and the counts below are current as written — check
them again if you edit, because Play rejects over-length fields at save time.

---

## App name — 15 / 30

```
Shinobi Journey
```

## Short description — 75 / 80

```
Train your shinobi, master jutsu, and fight for one of four rival villages.
```

## Full description — 1,839 / 4,000

```
Shinobi Journey is a free browser-based shinobi RPG. Create a character, train
your body and chakra, learn jutsu, and earn your place in one of four rival
villages — Ashen Leaf, Frostfang, Moonshadow, or Stormveil.

BUILD A SHINOBI THAT IS YOURS
Train strength, speed, and chakra control, then shape a loadout from a deep
jutsu library. Awaken a bloodline and forge it into something no one else is
running. Progress comes from what you train and how you build, not from a
single correct path.

FIGHT PLAYERS, NOT JUST NUMBERS
Test your build in ranked PvP arenas where the outcome turns on your loadout,
your timing, and your read of the opponent. Climb the ladder, defend your
standing, and find out whether the build you have been perfecting actually
holds up.

TAKE ON THE WORLD
Run missions, hunt through the wilds, raid hidden dungeons, and push into the
Hollow Gate and the Endless Spire. Face weekly bosses that the whole server is
fighting at once. Work through a full story campaign across all four villages.

RAISE COMPANIONS
Befriend creatures in the wild, train them, breed them, and take them into
their own battles — arena duels, tactical squad fights, and the companion
ladder.

STAND WITH A CLAN
Form or join a clan, pool resources, run clan boss operations, and take your
village into war over a contested map. Territory is fought for, and holding it
means something.

A LIVING WORLD
Villages, sectors, shops, banks, hospitals, and taverns run on a shared
economy. Other players are out there in the same world — travelling the same
roads, holding the same territory, and competing for the same standing.

Shinobi Journey is free to play and in active development. It is played on a
connection, and your progress is saved to the server, so you can pick it up on
your phone or in a browser and continue where you left off.
```

---

## Notes on the copy

- **No prices in the description.** Play shows an in-app-purchase price range
  derived from your real SKUs, so prices written into prose duplicate that,
  drift the moment anything changes, and read as inaccurate if they disagree.
- **No competitor or franchise references.** Deliberate; the repo keeps a
  blocklist for this, and the store listing is the most public place it matters.
- **The "in active development" line is doing real work.** It sets an honest
  expectation for a live beta and reduces the sting of the rough edges that
  otherwise turn into permanent one-star reviews.
- ⚠ **Keep the listing consistent with the 13+ target-audience declaration.**
  This copy leads on training, PvP, clans and war rather than on cute
  companions, on purpose — see the Families-policy warning in
  `docs/PLAY_CONSOLE_SUBMISSION_ANSWERS.md`.

---

## Planned paid SKUs — NOT YET BUILT

Recorded here so the intent is not lost. **None of this exists in the code
today:** there is no payment path at all since the Patreon rail was removed, and
Fate Shards are earned-only — nothing mints them for money.

| Intended offer | Price | Status |
| --- | --- | --- |
| Profession switch | $10 of Fate Shards | Item exists: `profession-change-approval`, **200 Fate Shards** (`api/pvp/_item-catalog.ts`) |
| Village transfer slip | $20 of Fate Shards | ⛔ **No such feature exists.** There is no player-facing village-change mechanic anywhere in the codebase |

**Implied exchange rate.** If the existing 200-shard profession change is the
$10 anchor, that sets **20 Fate Shards ≈ $1**, which makes the $20 village
transfer slip **400 shards** — and silently prices every other shard item in the
game. See the blocker below for what that actually buys.

⚠ **Do not price shards off `docs/generated/economy-faucets.csv`.** It lists only
five Fate Shard faucets (three daily missions, the academy checklist, a 7-day
login streak), but at least thirteen code paths grant shards — dungeon runs
(+5), Endless Spire milestones, achievements, the weekly clan boss, the weekly
board, the black market, Sunscar, Hollow Gate events, pet events, the gauntlet,
map control, and admin/legacy refunds. Real income is materially higher than the
generated model implies and varies hugely by how a player plays, so any
"days to earn" figure derived from that CSV is wrong. The exporter under-reports
this currency.

### Three things to settle before building this

1. **Selling Fate Shards is pay-for-time, not pay-to-win.** Measured against
   `api/pvp/_item-catalog.ts` and `api/combat-core/formulas.ts` at the implied
   20 shards/$1:

   | | |
   | --- | --- |
   | Best purchasable offense set | 850 shards ≈ **$42.50** |
   | Offense-composite gain | **+340** |
   | statFactor 1.0000 → 1.0578 | **5.8% damage** |
   | Versus an opponent with the same gear | **0%** |
   | Level requirement on all 48 power items | **40+** (40 at L40, five at L55, two at L60, one at L75) |

   ⚠ **A correction, recorded so it is not repeated.** An earlier version of this
   section claimed "$45 buys +1,660 combat stats" and called it pay-to-win. That
   summed all eight offense/defense fields into one figure, but
   `statFactorFromComposites` reads **one** offense composite against **one**
   defense composite per hit — those fields never stack. The real edge is ~5.8%,
   it saturates against the `[0.35, 1.85]` clamp, it is gated behind level 40 so
   nothing is buyable early, and every item is earnable in game. Do not price
   gear by summing its bonus fields.

   The remaining considerations are real but minor: shards are fungible, so a
   buyer may spend them on gear rather than the convenience they came for, and
   the same shards reach the Chronicle Marketplace. Selling the two conveniences
   as **direct SKUs** avoids both and costs nothing, but it is a preference, not
   a blocker.
2. **Village transfer has to be built first**, and it is a real feature, not a
   shop entry: village identity touches clan membership, war allegiance,
   territory, story progress, and the public directory. Decide what happens to
   each before pricing it.
3. **Play declarations change the moment this ships.** The IARC "digital
   purchases" answer flips from No to Yes, the listing gains an in-app-purchase
   price range, and any randomised reward purchasable with bought shards brings
   the loot-box odds-disclosure requirement into scope. Update
   `docs/PLAY_CONSOLE_SUBMISSION_ANSWERS.md` in the same change.

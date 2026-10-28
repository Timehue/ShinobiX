# Narrative group combat audit — 2026-10-19

Several authored encounters described a squad but still launched one combatant.
Newly started encounters now seal the following independent opponents:

| Encounter | Opponents |
| --- | --- |
| Stormveil level 65 execution squad | Captain + eight soldiers (9) |
| Ashen Leaf level 65 retrieval squad | Leader, blade, sealer (3) |
| Frostfang level 35 recovery detail | Captain + twelve soldiers (13) |
| Frostfang level 65 purge unit | Captain, blade, sealer (3) |
| Black Bridge | Roof crossbow shooter, blade, sealer (3) |
| Defector | Shirakawa + two erasure operatives (3) |
| Gambler’s Debt | Kuroban + two House collectors (3) |
| Ashes, Cinder stage | Cinder + two scouts (3) |
| Hollow Caravan wave 1 | Vanguard striker, marksman (2) |
| Hollow Caravan wave 2 | Flanking blade, sealer (2) |
| Hollow Caravan wave 3 | Goro, bodyguard (2) |
| Frostfang Fourfold Breach defense | Ice captain + two escorts (3) |
| Natural village patrols | Captain/leader, blade, sealer (3), with village-specific elements |

The two twin trials, ordinary hunt formations, Sunscar caravan Tower encounters,
level-80 crisis triads and the sequential wanderer gauntlet already had multiple
actors or separate fights. They retain their existing encounter structures.
Affiliation with a group alone does not turn a named solo boss into a squad.

## HP, stats and authority

`shared/narrative-groups.ts` owns roster identity, roles, art and catalog move IDs.
`api/solo-pve/_group-combat.ts` embeds a direct `createTowerSession` battlefield
inside the original Solo-PvE session. It does not call `buildTowerEncounter`,
generate a Tower floor’s enemies, apply Tower floor/party stat scaling or mint
Tower reward authority.

The original sealed encounter’s total maximum HP is split exactly by roster
weights (leader 2, others 1, with integer remainder on the final member).
All four offensive schools share 1.3 times the original primary offense across
those weights; each member receives 80% of the original primary defense.
Levels and resource maxima remain from the original seal. These are explicit
group encounter stats, not one full-strength copy of the old boss per member.
Player stats, equipment, HP and resource ceilings retain the Solo-PvE seal.
Each enemy owns separate HP, chakra, stamina, effects, cooldowns, jutsu and turns.
Numerical technique fields come from the normal catalog. Members have distinct
role kits; named members retain their identity art. Large formations use spaced
starting tiles rather than one crowded column.
Group dossiers replace the old single-boss tactical hint, which could recommend
counters to a technique that the individual member no longer carries.

All commands, ownership checks, action versions, move-token receipts, physical
costs and expiry still use the authenticated Solo-PvE routes. Completed state is
projected back to the outer session. A group victory requires the completed
battlefield and every sealed required enemy to be down. Story bindings also
bind the complete required roster. A surviving member cannot unlock a chapter
reward or quest proof. Completed battlefields reject further actions.

Story settlement still uses the original chapter reward. World encounters still
use their original AI token/report and durable quest/event progression. Goro’s
wave comes from server-owned win proofs, not a client-selected wave number.
Both opponents must be defeated in each of three waves; Goro is present only in
the last. Final quest stages remain available for their original Claim action.
Settlement replays cannot duplicate rewards or quest advancement.

The story host and AI host select the existing multi-actor grid for marked
groups, use each member’s sealed art, and retain their own result presentation
and exit callbacks. Reward failures expose Retry. No new Tower endpoint is used.
Legacy in-progress sessions retain their existing sealed fight; new starts get
the new roster.

## Text examples

- Black Bridge previously launched one raider after describing several attackers.
  The choice now says: “The shooter and both accomplices turn on you. Defeat all
  three to secure the bridge.” The fight contains exactly those three opponents.
- Hollow Caravan’s objective now says: “Defeat both opponents in each of 3 waves
  using this quest’s Fight button. Face Goro and his bodyguard in the final wave
  to secure the caravan wreck.”
- Frostfang’s recovery choice no longer sends the captain and soldiers away
  immediately before fighting the full formation. The captain orders all twelve
  soldiers to seize the player. The purge choices consistently send the captain
  and two soldiers forward while the rest hold back.

## Validation

- Automated group regressions cover all 12 static rosters and four village
  patrol variants: exact total HP, unchanged player snapshot and client actor
  projection, independent stats/cooldowns, legal non-overlapping spawn tiles,
  available portraits, distinct kits, each enemy actually casting and spending
  its own resources, first-KO rejection, final-KO proof and terminal actions.
- Actual authenticated handlers cover all four converted story chapters,
  Defector, Debt, Cinder and Goro’s complete three-wave progression. Tests reject
  premature settlement, check original story payouts, replay receipts and final
  quest claims. Forfeit/expiry costs and stable action receipts are also tested.
- `shinobij.client/scripts/qa-narrative-groups.mts`: 32 complete desktop/mobile
  scenarios through the actual StoryBossFightHost/AiFightHost. Each checks the
  initial rendered per-enemy HP against its sealed value, all sprites decoding,
  targeting every opponent, no early reward, a failed reward request, Retry,
  successful result and Continue removing the battlefield. Screenshots reviewed
  include the 13-enemy mobile formation and desktop/mobile results.
  Evidence: `shinobij.client/test-results/narrative-groups/results.json` and PNGs.
  Browser/handler cases defeat the leader first; the node lifecycle cases also
  defeat members in reverse order, leaving the leader until last.
- Browser transport uses the real encounter builder/action service and proof
  checks with isolated memory state; reward responses are controlled for retry
  testing. Actual payout/storage authority is covered separately by handler tests.
- Last-hit lifecycle fixtures deliberately lower target HP and restore tester
  HP between turns; they verify completion, not encounter difficulty. Separate
  ability tests run enemy turns with original stats and resources. This audit
  does not certify every possible player build or overall encounter balance.
  A separate unlock-level balance pass is recorded in
  [narrative-group-balance-2026-10-19.md](narrative-group-balance-2026-10-19.md).
- Full repository suite (`npm run test:ci`): 16,099 passed, 28 skipped,
  zero failures or cancellations, 16,127 total tests.
- Ten additional desktop/mobile forfeit scenarios cover all four converted
  story chapters and the Debt group: temporary result-save failure, Retry, correct
  10% max-HP cost, no win reward and clean return. Evidence: `forfeit-results.json`.
- Both builds, distribution checks and size check pass; product JS/CSS is
  9,569,761 bytes against the unchanged 9,570,000-byte limit. Lint has zero errors
  and 23 existing warnings. Six combat smoke tests and the strict Tower layout
  case (28 viewport checks) pass. The focused Node checks pass 72/72.
  Updated appearance, identity, continuity and UI contract tests pass 80/80.

## Follow-up: mode isolation and completion

The follow-up question was whether authored multi-enemy PvE could inherit the
roaming boss's former completion problems or accidentally run as Battle Tower.
The expected behavior is that the shared grid/resolver only supplies combat;
Solo-PvE owns the stored session and actions, and the originating story/AI
handlers own physical outcomes, rewards and progression.

- **Matches expected behavior:** all 16 group roster variants persist only as
  Solo-PvE sessions. The new `api/solo-pve/narrative-group-mode-isolation.test.ts`
  exercises the real Tower state/action/settle handlers against those IDs.
  Each rejects the run with 404, leaves the PvE session and save unchanged,
  and no public Tower record or Tower battle lease is created.
- **Validation gap closed:** browser audits now retain and assert an empty
  `towerCalls` list, including requests whose failure a background poll could
  swallow. Twin audits also assert that the battlefield disappears after exit.
- **Validation gap closed:** forced group knockouts now join victory and
  forfeit coverage. The last-hit win fixture's between-turn healing is disabled
  for knockout cases. Defeats require zero remaining player HP, no win reward,
  retry after a temporary result-save failure, and a clean return.
- Fresh browser evidence: **64/64 desktop/mobile cases closed successfully**:
  32 group wins, 10 group forfeits, 10 group knockouts and 12 twin cases covering
  wins, forfeits and knockouts. Every case recorded **zero Tower API calls**.
  This includes the 9- and 13-enemy encounters. Representative mobile screenshots
  of the 13-enemy start and completion result were inspected.
- Fresh Node evidence: **97 lifecycle/handler/transport checks plus 17 mode
  isolation checks passed**, with no failures or skips. Server build passed.
  Repository lint passed with zero errors and the existing 23 warnings. The
  changed audit scripts also passed the TypeScript ESLint rules through stdin
  (the normal repository glob does not include `.mts` files).
- Subsequent full repository rerun (`npm run test:ci`) passed with exit 0:
  **16,193 passed, 28 skipped, zero failed and zero cancelled**, 16,221 total,
  in 749.4 seconds. This includes the new mode-isolation and late-story handler
  regressions. Full output: `.tmp/multi-pve-full-suite.log`.

The browser harness uses real builders, action resolution, hosts and result
screens with controlled local responses for reward/outcome outages. Real reward
storage, progression and replay protection are exercised by the authenticated
handler tests. This follow-up required test/QA changes only; combat rules and
gameplay tuning were not changed. It does not change project KB state.

## Black Bridge shooter artwork

Provider: OpenAI built-in `image_gen`, transparent background, with
`shinobij.client/public/portraits/pve/assassin.webp` as the inspected style reference.
Original retained at
`C:/Users/Tyler R/.codex/generated_images/01a15174-0510-7fd2-a884-066eb2d7753a/exec-4dcf17de-5aae-462b-8323-ddecb5acd721.png`.
Runtime copy: `shinobij.client/public/combat-actors/narrative/black-bridge-shooter.webp`,
384 × 384, 31,202 bytes. Resized with Sharp, fit inside, WebP quality 90.

Exact prompt:

> Create one full-body transparent-background combat sprite for a shinobi RPG. Exactly ONE adult human bandit, the Black Bridge Roof Shooter. Use the reference as the rendering style and general charcoal hooded shinobi costume reference, but replace both daggers with ONE clearly recognizable compact wooden-and-steel CROSSBOW held in both hands, aimed toward the lower left, with a short bolt ready. He is a lean masked man with alert eyes, dark hood, slate layered shinobi garments, arm wraps, simple dark shinobi boots, a small case of crossbow bolts on his hip. Compact low braced shooting stance, three-quarter view, whole body including both feet and whole crossbow, centered with generous transparent margins, readable at small game token size. Dark fantasy anime game illustration, clean silhouette, crisp detailed clothing and weapon, restrained cool-blue rim light, no magical aura. Only one head, two arms, two hands, two legs. No daggers, no sword, no bow, no scenery, no roof, no ground, no shadow platform, no text, no border, no other figures. Transparent background.
